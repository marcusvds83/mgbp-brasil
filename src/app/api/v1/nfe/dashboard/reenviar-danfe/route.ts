/**
 * POST /api/v1/nfe/dashboard/reenviar-danfe
 *     Body: { move_id: number } | Query: ?move_id=2
 *
 * Re-gera o DANFE a partir do XML NF-e autorizado (campo x_mgbp_nfe_xml no
 * Odoo), substitui o anexo DANFE antigo no chatter da invoice e posta uma
 * mensagem de texto plain com o tamanho do PDF.
 *
 * Caso de uso: DANFE antigo ficou vazio/bugado/corrompido. Re-envia o novo
 * com layout oficial atualizado.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { read, executeKw, uploadAnexo, filtrarCamposExistentes, create } from '@/lib/odoo-rpc';
import { gerarPdfDanfe, DanfeData } from '@/lib/danfe-pdf';

export async function POST(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const moveId = parseInt(body.move_id || req.nextUrl.searchParams.get('move_id') || '0', 10);

    if (!moveId) {
      return NextResponse.json({ erro: 'move_id obrigatorio' }, { status: 400 });
    }

    return await reenviarDanfe(moveId);
  } catch (err) {
    console.error('[REENVIAR-DANFE] Erro:', (err as Error).message);
    return NextResponse.json(
      { sucesso: false, erro: (err as Error).message },
      { status: 500 }
    );
  }
}

/** Também aceita GET para chamar via URL action do Odoo. */
export async function GET(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  const moveId = parseInt(req.nextUrl.searchParams.get('move_id') || '0', 10);
  const redirect = req.nextUrl.searchParams.get('redirect') || '';

  if (!moveId) {
    return NextResponse.json({ erro: 'move_id obrigatorio' }, { status: 400 });
  }

  const result = await reenviarDanfe(moveId);

  if (redirect) {
    // Modo redirect (chamado via URL action do Odoo)
    const json = await result.json();
    const title = json.sucesso ? 'DANFE re-enviado!' : 'Erro ao re-enviar DANFE';
    const bodyClass = json.sucesso ? 'ok' : 'erro';
    const msg = json.sucesso
      ? `DANFE re-enviado para o Odoo (move ${moveId})<br/>Tamanho: ${json.tamanho_bytes} bytes<br/>Anexo: ${json.anexo_nome}`
      : `Erro: ${json.erro}`;
    const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title>
<style>
body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;max-width:700px;margin:50px auto;padding:20px;}
.box{border:1px solid #e0e0e0;border-radius:8px;padding:30px;box-shadow:0 2px 8px rgba(0,0,0,0.06);}
h1{color:#714b94;font-size:22px;margin:0 0 20px 0;}
.ok{background:#e8f5e9;color:#1b5e20;padding:15px;border-radius:5px;margin:15px 0;}
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

  return result;
}

async function reenviarDanfe(moveId: number) {
  // 1. Lê XML autorizado do Odoo
  const moves = await read<any>('account.move', [moveId], [
    'name', 'partner_id', 'company_id', 'amount_total',
    'x_mgbp_nfe_chave', 'x_mgbp_nfe_protocolo',
    'x_mgbp_nfe_dh_emissao', 'x_mgbp_nfe_xml',
  ]);
  if (!moves || !moves.length) {
    return NextResponse.json({ erro: 'Fatura nao encontrada' }, { status: 404 });
  }
  const move = moves[0];
  const nfeXml = move.x_mgbp_nfe_xml;
  if (!nfeXml) {
    return NextResponse.json({
      sucesso: false,
      erro: 'XML NF-e nao disponivel para esta fatura (soh pode re-enviar DANFE de NF autorizada)',
    }, { status: 400 });
  }

  // 2. Apaga anexos DANFE antigos
  try {
    const oldIds = await executeKw<number[]>('ir.attachment', 'search', [
      [['res_model', '=', 'account.move'], ['res_id', '=', moveId], ['name', 'like', 'DANFE']]
    ]);
    if (oldIds && oldIds.length) {
      await executeKw('ir.attachment', 'unlink', [oldIds]);
      console.log(`[REENVIAR-DANFE] ${oldIds.length} anexo(s) antigo(s) removido(s)`);
    }
  } catch (e) {
    console.warn('[REENVIAR-DANFE] Falha ao remover antigos:', (e as Error).message);
  }

  // 3. Extrai dados do XML autorizado (igual ao /pdf route)
  const tag = (name: string): string => {
    const m = nfeXml.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i'));
    return m ? m[1].trim() : '';
  };
  const tagIn = (xml: string, name: string): string => {
    const m = xml.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i'));
    return m ? m[1].trim() : '';
  };
  const tagAll = (name: string): string[] => {
    const re = new RegExp('<' + name + '[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'gi');
    const out: string[] = [];
    let m;
    while ((m = re.exec(nfeXml)) !== null) out.push(m[1].trim());
    return out;
  };

  const chave = (nfeXml.match(/Id="(NFe\d{44})"/) || [])[1]?.slice(3) || move.x_mgbp_nfe_chave || '';
  const nNF = tag('nNF');
  const serie = tag('serie');
  const dhEmi = tag('dhEmi') || move.x_mgbp_nfe_dh_emissao || new Date().toISOString();
  const nProt = tag('nProt') || move.x_mgbp_nfe_protocolo;
  const dhRecBto = tag('dhRecBto');
  const natOp = tag('natOp');
  const tpNF = tag('tpNF') || '1';
  const infCpl = tag('infCpl');

  const emitXml = nfeXml.match(/<emit>([\s\S]*?)<\/emit>/i)?.[1] || '';
  const destXml = nfeXml.match(/<dest>([\s\S]*?)<\/dest>/i)?.[1] || '';
  const transpXml = nfeXml.match(/<transp>([\s\S]*?)<\/transp>/i)?.[1] || '';

  const valOrNull = (s: string) => s ? parseFloat(s) : undefined;

  const dupsXml = tagAll('dup');
  const duplicatas = dupsXml.map((dupXml) => {
    const dVenc = tagIn(dupXml, 'dVenc');
    let vencBR = dVenc;
    try {
      if (dVenc) {
        const d = new Date(dVenc);
        if (!isNaN(d.getTime())) vencBR = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      }
    } catch {}
    return {
      numero: tagIn(dupXml, 'nDup'),
      vencimento: vencBR,
      valor: parseFloat(tagIn(dupXml, 'vDup') || '0'),
    };
  });

  const icmsTotXml = nfeXml.match(/<ICMSTot>([\s\S]*?)<\/ICMSTot>/i)?.[1] || '';
  const detXml = tagAll('det');
  const produtos = detXml.map((det) => {
    const prodXml = tagIn(det, 'prod');
    const impostoXml = tagIn(det, 'imposto');
    const icmsXml = impostoXml.match(/<ICMS>[\s\S]*?<\/ICMS>/i)?.[0] || '';
    const ipiXml = impostoXml.match(/<IPI>[\s\S]*?<\/IPI>/i)?.[0] || '';
    const icmsInner = icmsXml.match(/<ICMS\w+>([\s\S]*?)<\/ICMS\w+>/i)?.[1] || '';
    const ipiInner = ipiXml.match(/<IPITrib>([\s\S]*?)<\/IPITrib>/i)?.[1]
                  || ipiXml.match(/<IPINT>([\s\S]*?)<\/IPINT>/i)?.[1] || '';
    return {
      codProd: tagIn(prodXml, 'cProd'),
      descricao: tagIn(prodXml, 'xProd'),
      ncm: tagIn(prodXml, 'NCM'),
      cst: tagIn(icmsInner, 'CST') || tagIn(icmsInner, 'CSOSN') || '',
      cfop: tagIn(prodXml, 'CFOP'),
      unidade: tagIn(prodXml, 'uCom'),
      quantidade: parseFloat(tagIn(prodXml, 'qCom') || '0'),
      valorUnit: parseFloat(tagIn(prodXml, 'vUnCom') || '0'),
      valorTotal: parseFloat(tagIn(prodXml, 'vProd') || '0'),
      bcIcms: parseFloat(tagIn(icmsInner, 'vBC') || '0'),
      valorIcms: parseFloat(tagIn(icmsInner, 'vICMS') || '0'),
      valorIpi: parseFloat(tagIn(ipiInner, 'vIPI') || '0'),
      aliquotaIcms: parseFloat(tagIn(icmsInner, 'pICMS') || '0'),
      aliquotaIpi: parseFloat(tagIn(ipiInner, 'pIPI') || '0'),
    };
  });

  const danfeData: DanfeData = {
    chave,
    nNF,
    serie,
    dhEmi,
    folhaAtual: 1,
    folhaTotal: 1,
    tpNF,
    natOp,
    emit: {
      nome: tagIn(emitXml, 'xNome') || tagIn(emitXml, 'xFant') || '',
      cnpj: tagIn(emitXml, 'CNPJ'),
      ie: tagIn(emitXml, 'IE'),
      iest: tagIn(emitXml, 'IEST'),
      im: tagIn(emitXml, 'IM'),
      endereco: tagIn(emitXml, 'xLgr'),
      numero: tagIn(emitXml, 'nro'),
      complemento: tagIn(emitXml, 'xCpl'),
      bairro: tagIn(emitXml, 'xBairro'),
      cidade: tagIn(emitXml, 'xMun'),
      uf: tagIn(emitXml, 'UF'),
      cep: tagIn(emitXml, 'CEP'),
      fone: tagIn(emitXml, 'fone'),
    },
    dest: destXml ? {
      nome: tagIn(destXml, 'xNome'),
      cnpj: tagIn(destXml, 'CNPJ'),
      cpf: tagIn(destXml, 'CPF'),
      ie: tagIn(destXml, 'IE'),
      endereco: tagIn(destXml, 'xLgr'),
      numero: tagIn(destXml, 'nro'),
      complemento: tagIn(destXml, 'xCpl'),
      bairro: tagIn(destXml, 'xBairro'),
      cidade: tagIn(destXml, 'xMun'),
      uf: tagIn(destXml, 'UF'),
      cep: tagIn(destXml, 'CEP'),
      fone: tagIn(destXml, 'fone'),
    } : undefined,
    transportadora: transpXml ? {
      nome: tagIn(transpXml, 'xNome'),
      fretePorConta: tagIn(transpXml, 'modFrete') || '0',
      cnpj: tagIn(transpXml, 'CNPJ') || tagIn(transpXml, 'CPF'),
      ie: tagIn(transpXml, 'IE'),
      endereco: tagIn(transpXml, 'xEnder'),
      cidade: tagIn(transpXml, 'xMun'),
      uf: tagIn(transpXml, 'UF'),
      antt: tagIn(transpXml, 'RNTC'),
      placa: tagIn(transpXml, 'placa'),
      ufVeiculo: tagIn(transpXml, 'UF'),
      quantidade: tagIn(transpXml, 'qVol') ? parseFloat(tagIn(transpXml, 'qVol')) : undefined,
      especie: tagIn(transpXml, 'esp'),
      marca: tagIn(transpXml, 'marca'),
      numero: tagIn(transpXml, 'nVol'),
      pesoBruto: tagIn(transpXml, 'pesoB') ? parseFloat(tagIn(transpXml, 'pesoB')) : undefined,
      pesoLiquido: tagIn(transpXml, 'pesoL') ? parseFloat(tagIn(transpXml, 'pesoL')) : undefined,
    } : undefined,
    duplicatas,
    vProd: valOrNull(tagIn(icmsTotXml, 'vProd')),
    vFrete: valOrNull(tagIn(icmsTotXml, 'vFrete')),
    vSeg: valOrNull(tagIn(icmsTotXml, 'vSeg')),
    vDesc: valOrNull(tagIn(icmsTotXml, 'vDesc')),
    vOutro: valOrNull(tagIn(icmsTotXml, 'vOutro')),
    vIPI: valOrNull(tagIn(icmsTotXml, 'vIPI')),
    vNF: valOrNull(tagIn(icmsTotXml, 'vNF')) || move.amount_total,
    vBC: valOrNull(tagIn(icmsTotXml, 'vBC')),
    vICMS: valOrNull(tagIn(icmsTotXml, 'vICMS')),
    vBCST: valOrNull(tagIn(icmsTotXml, 'vBCST')),
    vST: valOrNull(tagIn(icmsTotXml, 'vST')),
    vTotTrib: valOrNull(tagIn(icmsTotXml, 'vTotTrib')),
    produtos,
    protocolo: nProt,
    dhAutorizacao: dhRecBto || dhEmi,
    infCpl,
    infCplFisco: nfeXml.match(/<infAdFisco>([\s\S]*?)<\/infAdFisco>/i)?.[1] || '',
  };

  // 4. Gera o PDF
  const pdfBuf = await gerarPdfDanfe(danfeData);
  console.log(`[REENVIAR-DANFE] PDF gerado: ${pdfBuf.length} bytes`);

  // 5. Anexa no chatter
  const anexoNome = `DANFE-${String(nNF).padStart(6, '0')}.pdf`;
  const attachmentId = await uploadAnexo(
    'account.move', moveId,
    anexoNome, pdfBuf, 'application/pdf',
    'DANFE ' + nNF + ' (re-enviado)'
  );

  // 6. Posta mensagem no chatter (texto plain)
  try {
    await executeKw('mail.message', 'create', [{
      model: 'account.move',
      res_id: moveId,
      body: 'DANFE re-enviado para o Odoo <br>\n' +
            'Data: ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' <br>\n' +
            'Tamanho: ' + pdfBuf.length + ' bytes <br>\n' +
            'Anexo: ' + anexoNome,
      message_type: 'comment',
      attachment_ids: [[6, 0, [attachmentId]]],
    }]);
  } catch (e) {
    console.warn('[REENVIAR-DANFE] Falha ao postar mensagem:', (e as Error).message);
  }

  return NextResponse.json({
    sucesso: true,
    move_id: moveId,
    chave,
    nNF,
    anexo_nome: anexoNome,
    anexo_id: attachmentId,
    tamanho_bytes: pdfBuf.length,
    mensagem: 'DANFE re-enviado e anexado no chatter da invoice no Odoo.',
  });
}
