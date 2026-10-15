/**
 * POST /api/v1/nfe/cancelar - Cancelar NF-e autorizada
 *     Body: { move_id: number, justificativa: string }
 *
 * Fluxo:
 *   1. Le fatura no Odoo
 *   2. Verifica status = autorizada
 *   3. Envia evento de cancelamento para SEFAZ
 *   4. Atualiza status no Odoo
 *   5. Posta no chatter
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { read, write, executeKw, create } from '@/lib/odoo-rpc';
import { config } from '@/lib/config';
import axios from 'axios';
import { carregarCertificado } from '@/lib/firebase-cert';
import https from 'https';

const NS = 'http://www.portalfiscal.inf.br/nfe';

function endpointCancelamento(): string {
  const uf = config.nfe.uf;
  const isHomolog = config.nfe.tpAmb === '2';
  const WS: Record<string, [string, string]> = {
    PR: ['https://nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4', 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4'],
    SP: ['https://www.nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx', 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx'],
    SVRS: ['https://nfe.svrs.rs.gov.br/ws/NfeRecepcaoEvento/NfeRecepcaoEvento4.asmx', 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeRecepcaoEvento/NfeRecepcaoEvento4.asmx'],
  };
  const ufKey = WS[uf] ? uf : 'SVRS';
  return WS[ufKey][isHomolog ? 1 : 0];
}

function tag(xml: string, name: string): string {
  const m = String(xml || '').match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i'));
  return m ? m[1].trim() : '';
}

export async function POST(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  const t0 = Date.now();
  try {
    const body = await req.json();
    const { move_id, justificativa } = body;
    if (!move_id) return NextResponse.json({ erro: 'move_id obrigatorio' }, { status: 400 });

    console.log(`[NFE-CANCEL] INICIO - move_id=${move_id}`);

    // 1. Le fatura
    const moves = await read('account.move', [move_id], [
      'name', 'x_mgbp_nfe_status', 'x_mgbp_nfe_chave',
      'x_mgbp_nfe_protocolo', 'company_id',
    ]);
    if (!moves || !moves.length) {
      return NextResponse.json({ erro: 'Fatura nao encontrada' }, { status: 404 });
    }
    const move = moves[0] as any;

    if (move.x_mgbp_nfe_status !== 'autorizada') {
      return NextResponse.json({
        sucesso: false,
        xMotivo: `NF-e precisa estar autorizada. Status atual: ${move.x_mgbp_nfe_status || 'vazio'}`,
      });
    }

    const chave = move.x_mgbp_nfe_chave;
    const protocolo = move.x_mgbp_nfe_protocolo;
    const just = (justificativa || 'Cancelamento solicitado pelo emitente via Odoo').substring(0, 255);

    if (!chave || !protocolo) {
      return NextResponse.json({
        sucesso: false,
        xMotivo: 'Chave ou protocolo ausente no Odoo. Reemita a nota.',
      });
    }

    // 2. Carrega certificado
    const cert = await carregarCertificado();
    if (!cert) {
      return NextResponse.json({ sucesso: false, erro: 'Certificado A1 nao configurado' }, { status: 400 });
    }

    // 3. Monta XML do evento de cancelamento (tpEvento=110111)
    const idEvento = String(Date.now()).slice(-15).padStart(15, '0');
    const dhEvento = new Date().toISOString().substring(0, 19);
    const cOrgao = chave.substring(0, 2);

    const detEvento =
      `<detEvento versao="1.00">` +
      `<descEvento>Cancelamento</descEvento>` +
      `<nProt>${protocolo}</nProt>` +
      `<xJust>${escapeXml(just)}</xJust>` +
      `</detEvento>`;

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
      `${detEvento}` +
      `</infEvento>` +
      `</evento>`;

    // 4. Assina o evento (similar a NF-e mas xpath diferente)
    const { SignedXml } = await import('xml-crypto');
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

    // 5. Envia lote de evento
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

    // Configurar https.Agent com certificado
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

    const resp = await axios.post(endpointCancelamento(), bodySoap, {
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

    console.log(`[NFE-CANCEL] SEFAZ: cStat=${cStat} xMotivo=${xMotivo}`);

    if (cStat === '135' || cStat === '155' || cStat === '144') {
      // Sucesso no cancelamento
      await write('account.move', [move_id], {
        x_mgbp_nfe_status: 'cancelada',
        x_mgbp_nfe_erro: false,
      });

      try {
        await create('mail.message', {
          model: 'account.move',
          res_id: move_id,
          body: `<b>NF-e Cancelada</b><br/>Justificativa: ${escapeXml(just)}`,
          message_type: 'comment',
        });
      } catch (e) {
        console.warn('[NFE-CANCEL] Falha ao postar no chatter:', (e as Error).message);
      }

      return NextResponse.json({
        sucesso: true,
        cStat,
        xMotivo,
        duracao_ms: Date.now() - t0,
      });
    } else {
      return NextResponse.json({
        sucesso: false,
        cStat,
        xMotivo: `SEFAZ negou cancelamento: ${xMotivo}`,
        duracao_ms: Date.now() - t0,
      });
    }
  } catch (err) {
    console.error('[NFE-CANCEL] Erro:', (err as Error).message);
    return NextResponse.json(
      { sucesso: false, erro: (err as Error).message, duracao_ms: Date.now() - t0 },
      { status: 500 }
    );
  }
}

function escapeXml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
