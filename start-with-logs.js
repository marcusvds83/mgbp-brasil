/**
 * start-with-logs.js
 * ==================
 * Wrapper do Next.js standalone com logs detalhados.
 * 
 * Render Start Command: node start-with-logs.js
 * 
 * Mostra:
 * - Variaveis de ambiente no startup
 * - Cada request HTTP recebido
 * - Erros de inicializacao
 * - Polling automático de emissões/cancelamentos pendentes
 */

const http = require('http');

console.log('');
console.log('=========================================================');
console.log('  NFE-MGBP-BRASIL - CUSTOM START WITH LOGS');
console.log('=========================================================');
console.log('  Time:', new Date().toISOString());
console.log('  Node version:', process.version);
console.log('  CWD:', process.cwd());
console.log('  ENV VARS:');
console.log('    NODE_ENV:', process.env.NODE_ENV);
console.log('    PORT:', process.env.PORT);
console.log('    HOSTNAME:', process.env.HOSTNAME || '(default 0.0.0.0)');
console.log('    API_KEY setado:', !!process.env.API_KEY);
console.log('    ODOO_URL:', process.env.ODOO_URL || '(nao setado)');
console.log('    ODOO_DB:', process.env.ODOO_DB || '(nao setado)');
console.log('    ODOO_USER:', process.env.ODOO_USER || '(nao setado)');
console.log('    ODOO_ENABLED:', process.env.ODOO_ENABLED);
console.log('    FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID || '(nao setado)');
console.log('    NFE_UF:', process.env.NFE_UF);
console.log('    NFE_TP_AMB:', process.env.NFE_TP_AMB, '(1=producao, 2=homologacao)');
console.log('    POLLING_INTERVAL_MS:', process.env.POLLING_INTERVAL_MS || '60000 (default)');
console.log('=========================================================');
console.log('');

// === Intercepta requests HTTP para logar ===
const originalRequest = http.request;
let requestCount = 0;
http.request = function(...args) {
  requestCount++;
  const opts = typeof args[0] === 'string' ? new URL(args[0]) : args[0];
  const method = (opts && opts.method) || 'GET';
  const host = (opts && opts.hostname) || (opts && opts.host) || 'unknown';
  const path = (opts && opts.path) || '/';
  if (requestCount % 100 !== 0 || requestCount < 10) {
    console.log(`[HTTP] #${requestCount} ${method} ${host}${path}`);
  } else {
    if (requestCount % 1000 === 0) {
      console.log(`[HTTP] ${requestCount} requests processados`);
    }
  }
  return originalRequest.apply(this, args);
};

// === Captura erros não tratados ===
process.on('uncaughtException', (err) => {
  console.error('!!! UNCAUGHT EXCEPTION !!!');
  console.error('Message:', err.message);
  console.error('Stack:', err.stack);
  console.error('=========================================================');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('!!! UNHANDLED REJECTION !!!');
  console.error('Reason:', reason);
  console.error('=========================================================');
});

// Verifica se .next/standalone/server.js existe
const fs = require('fs');
const path = require('path');
const standalonePath = path.join(process.cwd(), '.next', 'standalone', 'server.js');
console.log('');
console.log('Verificando:', standalonePath);
if (!fs.existsSync(standalonePath)) {
  console.error('!!! ARQUIVO NAO ENCONTRADO !!!');
  console.error('O build do Next.js nao gerou .next/standalone/server.js');
  console.error('Verifique o Build Command: npm install --legacy-peer-deps && npm run build');
  process.exit(1);
}
console.log('✓ Arquivo encontrado:', fs.statSync(standalonePath).size, 'bytes');
console.log('');

// Carrega o standalone server
console.log('Carregando Next.js standalone server...');
console.log('Aguardando "Ready" do Next.js...');
console.log('');

try {
  require(standalonePath);
  console.log('Server carregado com sucesso');
} catch (e) {
  console.error('!!! ERRO AO CARREGAR SERVER !!!');
  console.error('Message:', e.message);
  console.error('Stack:', e.stack);
  process.exit(1);
}

// === POLLING AUTOMÁTICO (emissões + cancelamentos pendentes) ===
// Render free tier dorme após 15 min de inatividade. Quando acordado,
// este setInterval roda a cada 60s processando pendências no Odoo.
// Para garantir polling 24/7 mesmo com serviço dormindo, configurar
// cron externo em cron-job.org chamando /api/v1/health a cada minuto.
const POLLING_INTERVAL_MS = parseInt(process.env.POLLING_INTERVAL_MS || '60000', 10);
const POLLING_API_KEY = process.env.API_KEY || '';
const POLLING_PORT = process.env.PORT || 10000;
let pollingRunning = false;

async function pollingTick() {
  if (pollingRunning) return; // evita overlap
  pollingRunning = true;
  try {
    // Processa emissões pendentes
    const r1 = await fetch(`http://localhost:${POLLING_PORT}/api/v1/nfe/process-pending?api_key=${POLLING_API_KEY}`, {
      method: 'GET',
      signal: AbortSignal.timeout(90000),
    });
    const d1 = await r1.json().catch(() => ({}));
    if (d1?.processed > 0 || d1?.autorizadas > 0 || d1?.erros > 0) {
      console.log(`[POLLING] Emissões: ${d1.processed} processadas, ${d1.autorizadas} autorizadas, ${d1.erros} erros`);
    }
  } catch (e) {
    console.warn('[POLLING] Erro em process-pending:', e.message);
  }
  try {
    // Processa cancelamentos pendentes
    const r2 = await fetch(`http://localhost:${POLLING_PORT}/api/v1/nfe/process-cancellations?api_key=${POLLING_API_KEY}`, {
      method: 'GET',
      signal: AbortSignal.timeout(90000),
    });
    const d2 = await r2.json().catch(() => ({}));
    if (d2?.processadas > 0 || d2?.canceladas > 0 || d2?.erros > 0) {
      console.log(`[POLLING] Cancelamentos: ${d2.processadas} processados, ${d2.canceladas} canceladas, ${d2.erros} erros`);
    }
  } catch (e) {
    console.warn('[POLLING] Erro em process-cancellations:', e.message);
  }
  pollingRunning = false;
}

// Inicia polling 10s após o server subir
if (process.env.NODE_ENV === 'production' && POLLING_API_KEY) {
  console.log(`[POLLING] Iniciando polling automático a cada ${POLLING_INTERVAL_MS / 1000}s`);
  setTimeout(pollingTick, 10000);
  setInterval(pollingTick, POLLING_INTERVAL_MS);
} else {
  console.log('[POLLING] Polling desabilitado (NODE_ENV != production ou API_KEY ausente)');
}
