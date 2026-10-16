/**
 * GET /api/v1/nfe/cancelar-web - Cancelar NF-e por move_id via redirect de browser
 *     ?move_id=2&api_key=KEY&redirect=https://...&justificativa=Texto
 *
 * Mesma estratégia do /emitir-web: Odoo SaaS bloqueia `import requests` em
 * Server Actions, então o botão "Cancelar NF-e (MGBP)" no Odoo é um
 * ir.actions.act_url que abre esta URL no browser. O middleware processa
 * e redireciona de volta para a invoice com mensagem.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { read, write, executeKw, create } from '@/lib/odoo-rpc';
import { config, isHomolog } from '@/lib/config';
import { carregarCertificado } from '@/lib/firebase-cert';
import { sefazHelpers } from '@/lib/sefaz-client';
import https from 'https';
import { SignedXml } from 'xml-crypto';

const NS = 'http://www.portalfiscal.inf.br/nfe';

function escapeXml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tag(xml: string, name: string): string {
  const m = String(xml || '').match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i'));
  return m ? m[1].trim() : '';
}

/** Redireciona direto para o Odoo (sem mostrar página HTML) com query string indicando resultado. */
function redirectBack(targetUrl: string, params: { sucesso: boolean; msg?: string }): NextResponse {
  const qs = new URLSearchParams({
    nfe_status: params.sucesso ? 'sucesso' : 'erro',
    nfe_msg: params.msg || '',
  }).toString();
  const sep = targetUrl.includes('?') ? '&' : '?';
  const finalUrl = `${targetUrl}${sep}${qs}`;
  return NextResponse.redirect(finalUrl, { status: 302 });
}

/** Página HTML de redirecionamento (mesmo template do emitir-web). */
function htmlRedirect(targetUrl: string, title: string, body: string): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${title} - MGBP NF-e</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; max-width: 700px; margin: 50px auto; padding: 20px; color: #1a1a1a; }
  .box { border: 1px solid #e0e0e0; border-radius: 8px; padding: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
  h1 { margin: 0 0 20px 0; font-size: 22px; color: #714b94; }
  .info { background: #f4f0f8; padding: 15px; border-radius: 5px; margin: 15px 0; word-break: break-all; }
  .erro { background: #fdecea; padding: 15px; border-radius: 5px; margin: 15px 0; word-break: break-all; color: #b71c1c; }
  .ok { background: #e8f5e9; padding: 15px; border-radius: 5px; margin: 15px 0; word-break: break-all; color: #1b5e20; }
  .btn { display: inline-block; padding: 10px 20px; background: #714b94; color: #fff !important; text-decoration: none; border-radius: 5px; font-weight: 600; margin-top: 15px; }
</style>
</head>
<body>
<div class="box">
  <h1>${title}</h1>
  ${body}
  <p><a href="${targetUrl}" class="btn">Voltar para a invoice no Odoo</a></p>
</div>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function errorRedirect(redirectUrl: string, errMsg: string): NextResponse {
  // Se tem redirect real (chamado via URL action do Odoo), faz 302 redirect direto
  if (redirectUrl && redirectUrl.startsWith('https://mgbp-brasil.odoo.com/odoo/invoices/')) {
    return redirectBack(redirectUrl, { sucesso: false, msg: errMsg });
  }
  return htmlRedirect(redirectUrl, 'Erro no Cancelamento NF-e',
    `<div class="erro"><b>Erro:</b><br/>${errMsg.replace(/</g, '&lt;')}</div>`);
}

export async function GET(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  const { searchParams } = req.nextUrl;
  const moveId = parseInt(searchParams.get('move_id') || '0', 10);
  const redirectUrl = searchParams.get('redirect') || 'https://mgbp-brasil.odoo.com/odoo/invoices';
  const justificativa = searchParams.get('justificativa') || 'Cancelamento solicitado pelo emitente via botão Odoo';

  if (!moveId) return errorRedirect(redirectUrl, 'Parâmetro move_id inválido.');

  try {
    // Lê fatura
    const moves = await read<any>('account.move', [moveId], [
      'name', 'x_mgbp_nfe_status', 'x_mgbp_nfe_chave', 'x_mgbp_nfe_protocolo',
    ]);
    if (!moves || !moves.length) {
      return errorRedirect(redirectUrl, `Fatura move_id=${moveId} não encontrada.`);
    }
    const move = moves[0];

    // Permite cancelar NF-e em status 'autorizada' OU 'cancelar_solicitado'
    // (retry quando tentativa anterior falhou por rede/timeout)
    if (move.x_mgbp_nfe_status !== 'autorizada' && move.x_mgbp_nfe_status !== 'cancelar_solicitado') {
      return errorRedirect(redirectUrl,
        `NF-e não pode ser cancelada. Status atual: ${move.x_mgbp_nfe_status || 'vazio'}. Apenas NF-e autorizada ou em processo de cancelamento.`);
    }

    const chave = move.x_mgbp_nfe_chave;
    const protocolo = move.x_mgbp_nfe_protocolo;
    if (!chave || !protocolo) {
      return errorRedirect(redirectUrl, 'Chave ou protocolo ausente. Não é possível cancelar.');
    }

    // Carrega certificado
    const cert = await carregarCertificado();
    if (!cert) {
      return errorRedirect(redirectUrl, 'Certificado A1 não configurado no middleware.');
    }

    // Marca como "cancelar_solicitado" no Odoo (status intermediário)
    await write('account.move', [moveId], { x_mgbp_nfe_status: 'cancelar_solicitado' });

    // Posta mensagem no chatter indicando que o processamento começou
    // (para o usuário ver que o botão foi clicado e o Render está trabalhando)
    try {
      await create('mail.message', {
        model: 'account.move',
        res_id: moveId,
        body: 'Cancelamento de NF-e em processamento<br/>Data: ' +
              new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + '<br/>' +
              'Justificativa: ' + justificativa + '<br/>' +
              'Middleware MGBP NF-e está enviando evento de cancelamento à SEFAZ...',
        message_type: 'comment',
      });
    } catch (e) {
      console.warn('[NFE-CANCEL-WEB] Falha ao postar mensagem inicial:', (e as Error).message);
    }

    // Monta XML do evento de cancelamento (tpEvento=110111)
    // Id do evento: ID + cOrgao(2) + tpEvento(6) + chNFe(44) = 52 dígitos
    // Pattern oficial XSD NF-e: ID[0-9]{52}
    // O nSeqEvento e CNPJ vão como ELEMENTOS do XML, não no Id.
    // ANTES (errado): ID + cOrgao + 110111 + CNPJ + chave + nSeq = 67 chars (rejeitado cStat 215)
    const cOrgao = chave.substring(0, 2);
    const nSeqEvento = '1';
    const idEventoRef = `110111${chave}${nSeqEvento.padStart(2, "0")}`;
    const dhEvento = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().substring(0, 19) + '-03:00';

    const eventoXml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<evento xmlns="${NS}" versao="1.00">` +
      `<infEvento Id="ID${idEventoRef}">` +
      `<cOrgao>${cOrgao}</cOrgao>` +
      `<tpAmb>${config.nfe.tpAmb}</tpAmb>` +
      `<CNPJ>${cert.info.cnpj}</CNPJ>` +
      `<chNFe>${chave}</chNFe>` +
      `<dhEvento>${dhEvento}</dhEvento>` +
      `<tpEvento>110111</tpEvento>` +
      `<nSeqEvento>1</nSeqEvento>` +
      `<verEvento>1.00</verEvento>` +
      `<detEvento versao="1.00">` +
      `<descEvento>Cancelamento</descEvento>` +
      `<nProt>${protocolo}</nProt>` +
      `<xJust>${escapeXml(justificativa)}</xJust>` +
      `</detEvento>` +
      `</infEvento>` +
      `</evento>`;

    // Assina
    const sig = new SignedXml({
      privateKey: cert.privateKeyPem,
      publicCert: cert.certPem,
      signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
      canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    });
    sig.addReference({
      xpath: "//*[local-name(.)='infEvento']",
      transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
      digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
      uri: `#ID${idEventoRef}`,
    });
    sig.computeSignature(eventoXml, {
      location: { reference: "//*[local-name(.)='infEvento']", action: 'after' },
    });
    const eventoAssinado = sig.getSignedXml();

    // Envia lote
    const idLote = String(Date.now()).slice(-15);
    const loteXml =
      `<envEvento xmlns="${NS}" versao="1.00">` +
      `<idLote>${idLote}</idLote>` +
      eventoAssinado.replace('<?xml version="1.0" encoding="UTF-8"?>', '') +
      `</envEvento>`;

    const bodySoap =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
      'xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
      '<soap12:Body>' +
      `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${loteXml}</nfeDadosMsg>` +
      '</soap12:Body></soap12:Envelope>';

    const extraCas: string[] = [];
    if (cert.chainPem && cert.chainPem.length > 1) {
      for (let i = 1; i < cert.chainPem.length; i++) {
        if (!extraCas.includes(cert.chainPem[i])) extraCas.push(cert.chainPem[i]);
      }
    }
    const httpsAgent = new https.Agent({
      minVersion: 'TLSv1.2' as any,
      key: cert.privateKeyPem,
      cert: cert.chainPem && cert.chainPem.length ? cert.chainPem.join('') : cert.certPem,
      ca: extraCas as any,
      rejectUnauthorized: !config.nfe.tlsInsecure,
    });

    const axios = (await import('axios')).default;
    const resp = await axios.post(sefazHelpers.endpoint('cancelamento'), bodySoap, {
      httpsAgent,
      timeout: 60000,
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        SOAPAction: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4',
      },
      validateStatus: (s) => s < 600,
      transformResponse: [(d) => d],
    });

    // Extrai cStat/xMotivo/nProt do EVENTO individual (dentro de <retEvento><infEvento>)
    // NÃO do lote (que sempre retorna cStat=128 "Lote de Evento Processado")
    const retEventoMatch = resp.data.match(/<retEvento[\s\S]*?<\/retEvento>/i);
    const retEventoXml = retEventoMatch ? retEventoMatch[0] : resp.data;
    const cStat = tag(retEventoXml, "cStat");
    const xMotivo = tag(retEventoXml, "xMotivo");
    const nProtCancel = tag(retEventoXml, "nProt");

    if (cStat === '135' || cStat === '155' || cStat === '144') {
      // Sucesso no cancelamento
      await write('account.move', [moveId], {
        x_mgbp_nfe_status: 'cancelada',
        x_mgbp_nfe_erro: false,
        x_mgbp_nfe_protocolo_cancel: nProtCancel,
      });

      // Mensagem no chatter (texto plain)
      try {
        await create('mail.message', {
          model: 'account.move',
          res_id: moveId,
          body: 'NF-e CANCELADA na SEFAZ <br>\n' +
                'Data: ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' <br>\n' +
                'Justificativa: ' + justificativa + ' <br>\n' +
                'cStat: ' + cStat + ' - ' + xMotivo + ' <br>\n' +
                'Protocolo cancelamento: ' + (nProtCancel || '-'),
          message_type: 'comment',
        });
      } catch (e) {
        console.warn('[NFE-CANCEL-WEB] Falha ao postar no chatter:', (e as Error).message);
      }

      // Redireciona direto de volta para o Odoo (302 redirect, sem HTML)
      return redirectBack(redirectUrl, {
        sucesso: true,
        msg: `NF-e ${move.name} CANCELADA na SEFAZ. cStat: ${cStat} - ${xMotivo}. Protocolo: ${nProtCancel || '-'}`,
      });
    }

    // Falha - reverte status
    await write('account.move', [moveId], {
      x_mgbp_nfe_status: 'autorizada',
      x_mgbp_nfe_erro: `Cancelamento rejeitado: ${cStat} - ${xMotivo}`.substring(0, 500),
    });

    // Mensagem de erro no chatter
    try {
      await create('mail.message', {
        model: 'account.move',
        res_id: moveId,
        body: 'ERRO no Cancelamento de NF-e <br>\n' +
              'Data: ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' <br>\n' +
              'cStat: ' + cStat + ' <br>\n' +
              'Detalhe: ' + xMotivo,
        message_type: 'comment',
      });
    } catch (e) {
      console.warn('[NFE-CANCEL-WEB] Falha ao postar erro no chatter:', (e as Error).message);
    }

    return errorRedirect(redirectUrl,
      `SEFAZ rejeitou o cancelamento: ${cStat} - ${xMotivo}<br/>Status restaurado para 'autorizada'.`);
  } catch (err) {
    console.error(`[NFE-CANCEL-WEB] Erro:`, (err as Error).message);
    return errorRedirect(redirectUrl, `Erro interno do middleware: ${(err as Error).message}`);
  }
}
