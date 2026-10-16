/**
 * GET /api/v1/nfe/emitir-web - Emitir NF-e por move_id via redirect de browser
 *     ?move_id=2&api_key=KEY&redirect=https://mgbp-brasil.odoo.com/odoo/invoices/2
 *
 * Esta rota existe porque Odoo SaaS Online BLOQUEIA `import requests` em Server
 * Actions (erro "forbidden opcode(s): IMPORT_NAME"). Portanto, o botão "Emitir
 * NF-e (MGBP)" no Odoo é um ir.actions.act_url que abre esta URL no browser do
 * usuário. O middleware processa a emissão síncrona (até 90s) e redireciona
 * de volta para a invoice no Odoo com query string indicando sucesso/erro.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { read, write } from '@/lib/odoo-rpc';
import { emitirNfeOdoo } from '@/lib/nfe-emit';

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

/** Página HTML de redirecionamento com mensagem (evita blank screen). */
function htmlRedirect(targetUrl: string, title: string, body: string, autoRefreshMs = 0): NextResponse {
  const refresh = autoRefreshMs > 0 ? `<meta http-equiv="refresh" content="${Math.ceil(autoRefreshMs / 1000)};url=${targetUrl}">` : '';
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
${refresh}
<title>${title} - MGBP NF-e</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; max-width: 700px; margin: 50px auto; padding: 20px; color: #1a1a1a; }
  .box { border: 1px solid #e0e0e0; border-radius: 8px; padding: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
  h1 { margin: 0 0 20px 0; font-size: 22px; color: #714b94; }
  .info { background: #f4f0f8; padding: 15px; border-radius: 5px; margin: 15px 0; word-break: break-all; }
  .erro { background: #fdecea; padding: 15px; border-radius: 5px; margin: 15px 0; word-break: break-all; color: #b71c1c; }
  .ok { background: #e8f5e9; padding: 15px; border-radius: 5px; margin: 15px 0; word-break: break-all; color: #1b5e20; }
  .btn { display: inline-block; padding: 10px 20px; background: #714b94; color: #fff !important; text-decoration: none; border-radius: 5px; font-weight: 600; margin-top: 15px; }
  .progress { display: inline-block; padding: 2px 8px; background: #fef3c7; color: #92400e; border-radius: 3px; font-size: 11px; margin-left: 8px; }
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

/** Mensagem de erro padronizada com botão voltar. */
function errorRedirect(redirectUrl: string, errMsg: string): NextResponse {
  // Se tem redirect real (chamado via URL action do Odoo), faz 302 redirect direto
  if (redirectUrl && redirectUrl.startsWith('https://mgbp-brasil.odoo.com/odoo/invoices/')) {
    return redirectBack(redirectUrl, { sucesso: false, msg: errMsg });
  }
  const body = `<div class="erro"><b>Erro:</b><br/>${errMsg.replace(/</g, '&lt;')}</div>`;
  return htmlRedirect(redirectUrl, 'Erro na emissão NF-e', body);
}

export async function GET(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  const { searchParams } = req.nextUrl;
  const moveIdStr = searchParams.get('move_id');
  const moveId = parseInt(moveIdStr || '0', 10);
  const redirectUrl = searchParams.get('redirect') || 'https://mgbp-brasil.odoo.com/odoo/invoices';
  const isAsync = searchParams.get('async') === '1';

  if (!moveId) {
    return errorRedirect(redirectUrl, 'Parâmetro move_id inválido ou ausente.');
  }

  // Página de "processando" para evitar timeout no Render free tier (100s)
  // Usuário pode clicar 2x no botão: 1ª dispara async e mostra página processando,
  // 2ª consulta status (já autorizada).
  if (isAsync) {
    return htmlRedirect(redirectUrl, 'Emissão em andamento',
      `<div class="info"><b>Emissão da NF-e em processamento no background.</b><br/>` +
      `Aguarde 15-30 segundos e atualize a página da invoice no Odoo.<br/>` +
      `move_id: ${moveId}</div>`);
  }

  try {
    // Pré-checagem: já está autorizada?
    const moves = await read<any>('account.move', [moveId], ['name', 'x_mgbp_nfe_status']);
    if (!moves || !moves.length) {
      return errorRedirect(redirectUrl, `Fatura move_id=${moveId} não encontrada no Odoo.`);
    }
    const move = moves[0];
    const statusAtual = move.x_mgbp_nfe_status;

    if (statusAtual === 'autorizada') {
      return htmlRedirect(redirectUrl, 'NF-e já autorizada',
        `<div class="ok"><b>NF-e já está autorizada.</b><br/>Fatura: ${move.name}<br/>Status: ${statusAtual}</div>`);
    }

    // Marca como pendente (caso esteja em outro estado)
    if (statusAtual !== 'pendente' && statusAtual !== 'processando') {
      await write('account.move', [moveId], { x_mgbp_nfe_status: 'pendente' });
    }

    // Tenta emissão síncrona (timeout 90s - Render free tier aceita 100s)
    const t0 = Date.now();
    console.log(`[NFE-WEB] Emitir solicitado para move_id=${moveId} via redirect Odoo`);

    const resultado = (await Promise.race([
      emitirNfeOdoo(moveId),
      new Promise<{ sucesso: false; erro: string; cStat?: string; xMotivo?: string }>((resolve) =>
        setTimeout(() => resolve({ sucesso: false, erro: 'Timeout: emissão demorou mais de 85s. Tente novamente.' }), 85000)
      ),
    ])) as { sucesso: boolean; chave?: string; protocolo?: string; cStat?: string; xMotivo?: string; erro?: string };

    const duracao = Date.now() - t0;
    console.log(`[NFE-WEB] Resultado move_id=${moveId}: sucesso=${resultado.sucesso} em ${duracao}ms`);

    if (resultado.sucesso) {
      return redirectBack(redirectUrl, {
        sucesso: true,
        msg: `NF-e ${move.name} AUTORIZADA na SEFAZ. cStat: ${resultado.cStat} - ${resultado.xMotivo}. Protocolo: ${resultado.protocolo || '-'}`,
      });
    }

    return errorRedirect(redirectUrl,
      `SEFAZ rejeitou: ${resultado.cStat || 's/cStat'} - ${resultado.xMotivo || 'sem motivo'}<br/>` +
      `Detalhe: ${resultado.erro || 'sem detalhe'}<br/>` +
      `Status atual no Odoo: verifique o chatter da invoice.`);
  } catch (err) {
    console.error(`[NFE-WEB] Erro ao processar move_id=${moveId}:`, (err as Error).message);
    return errorRedirect(redirectUrl, `Erro interno do middleware: ${(err as Error).message}`);
  }
}
