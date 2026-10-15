/**
 * POST /api/v1/nfe/dashboard/reenviar-xml
 *     Body: { move_id: number } | Query: ?move_id=2
 *
 * Re-anexa o XML NF-e (nfeProc) no chatter da invoice a partir do campo
 * x_mgbp_nfe_xml do Odoo. Caso de uso: XML foi perdido do chatter (anexo
 * deletado por engano, ou bug do uploadAnexo que usava campo 'datas' errado
 * em Odoo 20). Re-anexa com nome NFe-CHAVE.xml usando campo 'raw' (Odoo 20).
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { read, executeKw, uploadAnexo } from '@/lib/odoo-rpc';

export async function POST(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const moveId = parseInt(body.move_id || req.nextUrl.searchParams.get('move_id') || '0', 10);

    if (!moveId) {
      return NextResponse.json({ erro: 'move_id obrigatorio' }, { status: 400 });
    }

    // 1. Lê o XML do campo x_mgbp_nfe_xml
    const moves = await read<any>('account.move', [moveId], [
      'name', 'x_mgbp_nfe_chave', 'x_mgbp_nfe_xml',
    ]);
    if (!moves || !moves.length) {
      return NextResponse.json({ erro: 'Fatura nao encontrada' }, { status: 404 });
    }
    const move = moves[0];
    const xmlContent = move.x_mgbp_nfe_xml;
    if (!xmlContent) {
      return NextResponse.json({
        sucesso: false,
        erro: 'XML NF-e nao disponivel no campo x_mgbp_nfe_xml. Apenas NF-e autorizada tem XML armazenado.',
      }, { status: 400 });
    }

    const chave = move.x_mgbp_nfe_chave || 'unknown';

    // 2. Apaga anexos XML antigos (NFe-CHAVE.xml)
    try {
      const oldIds = await executeKw<number[]>('ir.attachment', 'search', [
        [['res_model', '=', 'account.move'], ['res_id', '=', moveId], ['name', 'like', 'NFe-']]
      ]);
      if (oldIds && oldIds.length) {
        await executeKw('ir.attachment', 'unlink', [oldIds]);
        console.log(`[REENVIAR-XML] ${oldIds.length} anexo(s) XML antigo(s) removido(s)`);
      }
    } catch (e) {
      console.warn('[REENVIAR-XML] Falha ao remover antigos:', (e as Error).message);
    }

    // 3. Anexa o XML completo no chatter
    const xmlNome = `NFe-${chave}.xml`;
    const attachmentId = await uploadAnexo(
      'account.move', moveId,
      xmlNome, xmlContent, 'application/xml',
      'XML NF-e ' + chave
    );

    // 4. Posta mensagem no chatter (texto plain com <br/> para Odoo renderizar)
    try {
      await executeKw('mail.message', 'create', [{
        model: 'account.move',
        res_id: moveId,
        body: 'XML NF-e re-enviado para o Odoo<br/>Data: ' +
              new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + '<br/>' +
              'Tamanho: ' + xmlContent.length + ' bytes<br/>' +
              'Anexo: ' + xmlNome,
        message_type: 'comment',
        attachment_ids: [[6, 0, [attachmentId]]],
      }]);
    } catch (e) {
      console.warn('[REENVIAR-XML] Falha ao postar mensagem:', (e as Error).message);
    }

    return NextResponse.json({
      sucesso: true,
      move_id: moveId,
      chave,
      anexo_nome: xmlNome,
      anexo_id: attachmentId,
      tamanho_bytes: xmlContent.length,
      mensagem: 'XML NF-e re-enviado e anexado no chatter da invoice no Odoo.',
    });
  } catch (err) {
    console.error('[REENVIAR-XML] Erro:', (err as Error).message);
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

  // Chama POST internamente
  const result = await POST(req);
  const json = await result.json();

  if (redirect) {
    const title = json.sucesso ? 'XML re-enviado!' : 'Erro ao re-enviar XML';
    const bodyClass = json.sucesso ? 'ok' : 'erro';
    const msg = json.sucesso
      ? `XML NF-e re-enviado para o Odoo (move ${moveId})<br/>Tamanho: ${json.tamanho_bytes} bytes<br/>Anexo: ${json.anexo_nome}`
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

  return NextResponse.json(json);
}
