/**
 * POST /api/v1/nfe/process-cancellations
 *
 * Busca no Odoo todas as NF-e com x_mgbp_nfe_status='cancelar_solicitado' e
 * processa o cancelamento na SEFAZ (envia evento 110111, atualiza Odoo com
 * status 'cancelada' ou mensagem de erro, posta no chatter).
 *
 * Caso de uso: usuário clica no botão 'Cancelar NF-e (MGBP)' no Odoo (que é
 * uma ir.actions.act_url que abre /cancelar-web no Render) - mas se o Render
 * free tier demorou para responder (timeout), ou se o usuário cancelou
 * diretamente via Odoo Server Action 'Cancelar NF-e (polling - antigo)',
 * o status fica 'cancelar_solicitado' e precisa ser processado.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { search, read, write, executeKw, create } from '@/lib/odoo-rpc';
import { config } from '@/lib/config';
import https from 'https';
import axios from 'axios';
import { carregarCertificado } from '@/lib/firebase-cert';
import { sefazHelpers } from '@/lib/sefaz-client';
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

interface CancelamentoResult {
  move_id: number;
  sucesso: boolean;
  cStat?: string;
  xMotivo?: string;
  protocolo_cancel?: string;
  erro?: string;
}

/** Cancela UMA NF-e na SEFAZ. */
async function cancelarNfe(
  moveId: number,
  chave: string,
  protocolo: string,
  justificativa: string
): Promise<CancelamentoResult> {
  try {
    const cert = await carregarCertificado();
    if (!cert) {
      return { move_id: moveId, sucesso: false, erro: 'Certificado A1 não configurado' };
    }

    // Monta XML do evento de cancelamento (tpEvento=110111)
    const idEvento = String(Date.now()).slice(-15).padStart(15, '0');
    const dhEvento = new Date().toISOString().substring(0, 19) + '-03:00';
    const cOrgao = chave.substring(0, 2);

    const eventoXml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<evento xmlns="${NS}" versao="1.00">` +
      `<infEvento Id="ID${cOrgao}110111${chave}${idEvento}01">` +
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
      uri: `#ID${cOrgao}110111${chave}${idEvento}01`,
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

    const httpsAgent = await sefazHelpers.agentAsync();
    const url = sefazHelpers.endpoint('cancelamento');
    console.log(`[PROCESS-CANCEL] Cancelando NF ${chave} em ${url}`);

    const resp = await axios.post(url, bodySoap, {
      httpsAgent,
      timeout: 60000,
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        SOAPAction: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4',
      },
      validateStatus: (s) => s < 600,
      transformResponse: [(d) => d],
    });

    const cStat = tag(resp.data, 'cStat');
    const xMotivo = tag(resp.data, 'xMotivo');
    const nProtCancel = tag(resp.data, 'nProt');

    if (cStat === '135' || cStat === '155' || cStat === '144') {
      // Sucesso no cancelamento
      await write('account.move', [moveId], {
        x_mgbp_nfe_status: 'cancelada',
        x_mgbp_nfe_erro: false,
        x_mgbp_nfe_protocolo_cancel: nProtCancel,
      });

      // Mensagem no chatter (texto plain com <br/> para Odoo renderizar)
      try {
        await create('mail.message', {
          model: 'account.move',
          res_id: moveId,
          body: 'NF-e CANCELADA na SEFAZ<br/>Data: ' +
                new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + '<br/>' +
                'Justificativa: ' + justificativa + '<br/>' +
                'cStat: ' + cStat + ' - ' + xMotivo + '<br/>' +
                'Protocolo cancelamento: ' + (nProtCancel || '-'),
          message_type: 'comment',
          attachment_ids: [],
        });
      } catch (e) {
        console.warn('[PROCESS-CANCEL] Falha ao postar no chatter:', (e as Error).message);
      }

      return { move_id: moveId, sucesso: true, cStat, xMotivo, protocolo_cancel: nProtCancel };
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
        body: 'ERRO no Cancelamento de NF-e<br/>Data: ' +
              new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + '<br/>' +
              'cStat: ' + cStat + '<br/>' +
              'Detalhe: ' + xMotivo,
        message_type: 'comment',
      });
    } catch (e) {
      console.warn('[PROCESS-CANCEL] Falha ao postar erro no chatter:', (e as Error).message);
    }

    return {
      move_id: moveId,
      sucesso: false,
      cStat,
      xMotivo,
      erro: `Cancelamento rejeitado: ${cStat} - ${xMotivo}`,
    };
  } catch (err) {
    console.error(`[PROCESS-CANCEL] Erro move_id=${moveId}:`, (err as Error).message);
    return { move_id: moveId, sucesso: false, erro: (err as Error).message };
  }
}

export async function POST(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  const t0 = Date.now();
  try {
    // Busca todas as faturas com status 'cancelar_solicitado'
    const moveIds = await search('account.move', [
      ['move_type', '=', 'out_invoice'],
      ['x_mgbp_nfe_status', '=', 'cancelar_solicitado'],
    ], { limit: 50 });

    console.log(`[PROCESS-CANCEL] ${moveIds.length} fatura(s) com cancelar_solicitado`);

    if (!moveIds.length) {
      return NextResponse.json({
        sucesso: true,
        processadas: 0,
        canceladas: 0,
        erros: 0,
        detalhes: [],
        mensagem: 'Nenhuma NF-e com cancelar_solicitado pendente.',
        duracao_ms: Date.now() - t0,
      });
    }

    // Lê dados das faturas
    const moves = await read<any>('account.move', moveIds, [
      'name', 'x_mgbp_nfe_chave', 'x_mgbp_nfe_protocolo',
      'x_mgbp_nfe_status',
    ]);

    const detalhes: CancelamentoResult[] = [];
    let canceladas = 0;
    let erros = 0;

    for (const move of moves) {
      const chave = move.x_mgbp_nfe_chave;
      const protocolo = move.x_mgbp_nfe_protocolo;
      if (!chave || !protocolo) {
        detalhes.push({
          move_id: move.id,
          sucesso: false,
          erro: 'Chave ou protocolo ausente no Odoo',
        });
        erros++;
        continue;
      }

      const just = 'Cancelamento solicitado pelo emitente via Odoo (processamento pendente)';
      const r = await cancelarNfe(move.id, chave, protocolo, just);
      detalhes.push(r);
      if (r.sucesso) canceladas++;
      else erros++;
    }

    return NextResponse.json({
      sucesso: true,
      processadas: moveIds.length,
      canceladas,
      erros,
      detalhes,
      duracao_ms: Date.now() - t0,
    });
  } catch (err) {
    console.error('[PROCESS-CANCEL] Erro:', (err as Error).message);
    return NextResponse.json(
      { sucesso: false, erro: (err as Error).message, duracao_ms: Date.now() - t0 },
      { status: 500 }
    );
  }
}

// Também aceita GET (para testar via browser / URL action)
export async function GET(req: NextRequest) {
  // Reaproveita POST
  return POST(req);
}
