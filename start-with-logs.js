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
console.log('    ODOO_API_KEY setado:', !!process.env.ODOO_API_KEY);
console.log('    FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID || '(nao setado)');
console.log('    FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL || '(nao setado)');
console.log('    FIREBASE_PRIVATE_KEY setado:', !!process.env.FIREBASE_PRIVATE_KEY);
if (process.env.FIREBASE_PRIVATE_KEY) {
  console.log('    FIREBASE_PRIVATE_KEY length:', process.env.FIREBASE_PRIVATE_KEY.length);
  console.log('    FIREBASE_PRIVATE_KEY comeca com:', JSON.stringify(process.env.FIREBASE_PRIVATE_KEY.substring(0, 30)));
}
console.log('    NFE_UF:', process.env.NFE_UF || '(nao setado)');
console.log('    NFE_TP_AMB:', process.env.NFE_TP_AMB || '(nao setado)');
console.log('=========================================================');
console.log('');

// Forca 0.0.0.0 (acessivel externamente)
process.env.HOSTNAME = '0.0.0.0';

// Intercepta erros nao tratados
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
