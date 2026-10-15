/**
 * GET /api/v1/nfe/dashboard/consulta-sefaz?move_id=2&api_key=KEY
 *     ou ?chave=XXXX
 *
 * Consulta NF-e na SEFAZ pelo serviço NFeConsultaProtocolo4.
 * Usa mTLS com certificado A1 + cadeia ICP-Brasil (mesmo agent do sefaz-client).
 * Retorna: cStat, xMotivo, nProt, dhRecBto, chNFe, situação atual.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { read, write } from '@/lib/odoo-rpc';
import { sefazHelpers } from '@/lib/sefaz-client';
import { config, isHomolog } from '@/lib/config';
import axios from 'axios';

const NS = 'http://www.portalfiscal.inf.br/nfe';

function tag(xml: string, name: string): string {
  const m = String(xml || '').match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i'));
  return m ? m[1].trim() : '';
}

export async function GET(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  const { searchParams } = req.nextUrl;
  const moveIdStr = searchParams.get('move_id');
  const moveId = moveIdStr ? parseInt(moveIdStr, 10) : 0;
  const chaveParam = searchParams.get('chave') || '';
  const redirect = searchParams.get('redirect') || '';

  let chave = chaveParam;

  try {
    if (!chave && moveId) {
      const moves = await read<any>('account.move', [moveId], [
        'name', 'x_mgbp_nfe_chave', 'x_mgbp_nfe_protocolo',
        'x_mgbp_nfe_status', 'x_mgbp_nfe_dh_emissao',
      ]);
      if (!moves || !moves.length) {
        return jsonOrHtml(redirect, { sucesso: false, erro: `Fatura move_id=${moveId} nao encontrada` }, 404);
      }
      const move = moves[0];
      chave = move.x_mgbp_nfe_chave;
      if (!chave) {
        return jsonOrHtml(redirect, {
          sucesso: false,
          erro: 'NF-e sem chave cadastrada no Odoo. Status atual: ' + (move.x_mgbp_nfe_status || 'vazio'),
        }, 400);
      }
    }

    if (!chave || chave.length !== 44) {
      return jsonOrHtml(redirect, { sucesso: false, erro: 'Chave NF-e invalida ou ausente (44 digitos)' }, 400);
    }

    // Usa o agent mTLS do sefaz-client (com CAs ICP-Brasil)
    const httpsAgent = await sefazHelpers.agentAsync();

    // Monta XML de consulta
    const cons =
      `<consSitNFe xmlns="${NS}" versao="4.00">` +
      `<tpAmb>${config.nfe.tpAmb}</tpAmb>` +
      `<xServ>CONSULTAR</xServ>` +
      `<chNFe>${chave}</chNFe>` +
      `</consSitNFe>`;

    const soapBody =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
      'xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
      '<soap12:Body>' +
      `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">${cons}</nfeDadosMsg>` +
      '</soap12:Body></soap12:Envelope>';

    const url = sefazHelpers.endpoint('consulta');
    console.log(`[CONSULTA-SEFAZ] Consultando chave ${chave} em ${url}`);

    const resp = await axios.post(url, soapBody, {
      httpsAgent,
      timeout: 45000,
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        SOAPAction: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4',
      },
      validateStatus: (s) => s < 600,
      transformResponse: [(d) => d],
    });

    const cStat = tag(resp.data, 'cStat');
    const xMotivo = tag(resp.data, 'xMotivo');
    const nProt = tag(resp.data, 'nProt');
    const dhRecBto = tag(resp.data, 'dhRecBto');
    const chNFe = tag(resp.data, 'chNFe');
    const tpEvento = tag(resp.data, 'tpEvento');
    const xEvento = tag(resp.data, 'xEvento');
    const nSeqEvento = tag(resp.data, 'nSeqEvento');

    let situacao = 'desconhecida';
    if (cStat === '100' || cStat === '150') situacao = 'autorizada';
    else if (cStat === '101' || cStat === '102' || cStat === '135' || cStat === '155') situacao = 'cancelada';
    else if (cStat === '110' || cStat === '301' || cStat === '302') situacao = 'denegada';
    else if (cStat === '217') situacao = 'nao encontrada';

    const resultado = {
      sucesso: true,
      chave,
      cStat,
      xMotivo,
      situacao,
      nProt,
      dhRecBto,
      chNFe,
      evento: tpEvento ? { tpEvento, xEvento, nSeqEvento } : undefined,
      ambiente: isHomolog ? 'homologacao' : 'producao',
      uf: config.nfe.uf,
      endpoint: url,
      httpStatus: resp.status,
    };

    // Atualiza protocolo no Odoo se for diferente
    if (moveId && nProt) {
      try {
        const moves = await read<any>('account.move', [moveId], ['x_mgbp_nfe_protocolo']);
        if (moves && moves[0] && moves[0].x_mgbp_nfe_protocolo !== nProt) {
          await write('account.move', [moveId], { x_mgbp_nfe_protocolo: nProt });
          console.log(`[CONSULTA-SEFAZ] Protocolo atualizado no Odoo: ${nProt}`);
        }
      } catch (e) {
        console.warn('[CONSULTA-SEFAZ] Falha ao atualizar protocolo no Odoo:', (e as Error).message);
      }
    }

    return jsonOrHtml(redirect, resultado, 200);
  } catch (err) {
    console.error('[CONSULTA-SEFAZ] Erro:', (err as Error).message);
    return jsonOrHtml(redirect, { sucesso: false, erro: (err as Error).message }, 500);
  }
}

function jsonOrHtml(redirect: string, data: any, status: number): NextResponse {
  if (redirect) {
    const title = data.sucesso ? (data.situacao ? `NF-e: ${data.situacao}` : 'Consulta SEFAZ') : 'Erro na consulta';
    const bodyClass = data.sucesso ? (data.situacao === 'autorizada' ? 'ok' : 'info') : 'erro';
    const msg = data.sucesso
      ? `<b>Chave:</b> ${data.chave}<br/>` +
        `<b>cStat:</b> ${data.cStat} - ${data.xMotivo}<br/>` +
        `<b>Situacao:</b> ${data.situacao}<br/>` +
        (data.nProt ? `<b>Protocolo:</b> ${data.nProt}<br/>` : '') +
        (data.dhRecBto ? `<b>Data:</b> ${data.dhRecBto}<br/>` : '') +
        (data.evento ? `<b>Evento:</b> ${data.evento.tpEvento} - ${data.evento.xEvento}<br/>` : '')
      : `Erro: ${data.erro}`;
    const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${title} - MGBP NF-e</title>
<style>
body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;max-width:700px;margin:50px auto;padding:20px;}
.box{border:1px solid #e0e0e0;border-radius:8px;padding:30px;box-shadow:0 2px 8px rgba(0,0,0,0.06);}
h1{color:#714b94;font-size:22px;margin:0 0 20px 0;}
.ok{background:#e8f5e9;color:#1b5e20;padding:15px;border-radius:5px;margin:15px 0;}
.info{background:#f4f0f8;padding:15px;border-radius:5px;margin:15px 0;}
.erro{background:#fdecea;color:#b71c1c;padding:15px;border-radius:5px;margin:15px 0;}
.btn{display:inline-block;padding:10px 20px;background:#714b94;color:#fff !important;text-decoration:none;border-radius:5px;font-weight:600;margin-top:15px;}
</style></head>
<body><div class="box">
<h1>${title}</h1>
<div class="${bodyClass}">${msg}</div>
<p><a href="${redirect}" class="btn">Voltar para a invoice no Odoo</a></p>
</div></body></html>`;
    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  return NextResponse.json(data, { status });
}
