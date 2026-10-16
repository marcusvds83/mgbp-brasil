/**
 * src/instrumentation.ts - Inicialização do Next.js
 * ==================================================
 * Este arquivo é executado UMA VEZ quando o servidor Next.js inicia.
 * É o lugar correto para registrar polling em background, independentemente
 * de como o Render inicia o serviço (npm run start, node server.js, etc).
 *
 * Em Next.js 16, a função register() roda no startup do servidor de produção.
 * Ver: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Só roda em produção (não durante build nem dev)
  if (process.env.NODE_ENV !== 'production') {
    console.log('[INSTRUMENTATION] Dev mode - polling desabilitado');
    return;
  }

  const apiKey = process.env.API_KEY || '';
  const port = process.env.PORT || 10000;
  const intervalMs = parseInt(process.env.POLLING_INTERVAL_MS || '60000', 10);

  if (!apiKey) {
    console.log('[INSTRUMENTATION] API_KEY ausente - polling desabilitado');
    return;
  }

  console.log(`[INSTRUMENTATION] Iniciando polling de emissões/cancelamentos a cada ${intervalMs / 1000}s`);

  let pollingRunning = false;

  async function pollingTick() {
    if (pollingRunning) {
      console.log('[POLLING] Tick anterior ainda em andamento, pulando');
      return;
    }
    pollingRunning = true;
    try {
      // Processa emissões pendentes (status='pendente' no Odoo)
      const r1 = await fetch(`http://localhost:${port}/api/v1/nfe/process-pending?api_key=${apiKey}`, {
        method: 'GET',
        signal: AbortSignal.timeout(90000),
      });
      const d1 = await r1.json().catch(() => ({}));
      if (d1?.processed > 0 || d1?.autorizadas > 0 || d1?.erros > 0) {
        console.log(`[POLLING] Emissões: ${d1.processed} processadas, ${d1.autorizadas} autorizadas, ${d1.erros} erros`);
      }
    } catch (e) {
      console.warn('[POLLING] Erro em process-pending:', (e as Error).message);
    }
    try {
      // Processa cancelamentos pendentes (status='cancelar_solicitado' no Odoo)
      const r2 = await fetch(`http://localhost:${port}/api/v1/nfe/process-cancellations?api_key=${apiKey}`, {
        method: 'GET',
        signal: AbortSignal.timeout(90000),
      });
      const d2 = await r2.json().catch(() => ({}));
      if (d2?.processadas > 0 || d2?.canceladas > 0 || d2?.erros > 0) {
        console.log(`[POLLING] Cancelamentos: ${d2.processadas} processados, ${d2.canceladas} canceladas, ${d2.erros} erros`);
      }
    } catch (e) {
      console.warn('[POLLING] Erro em process-cancellations:', (e as Error).message);
    }
    pollingRunning = false;
  }

  // Primeiro tick após 10s (espera o server subir completamente)
  setTimeout(pollingTick, 10000);
  // Depois a cada intervalMs
  setInterval(pollingTick, intervalMs);
}
