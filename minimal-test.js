/**
 * MINIMAL TEST SERVER - para diagnosticar se Render está conseguindo rodar Node.js
 * 
 * RODE: node minimal-test.js
 * Acesse: http://localhost:3000/api/v1/health
 *         http://localhost:3000/admin
 *         http://localhost:3000/
 * 
 * Se isto funcionar no Render, o problema é do Next.js (build/start/import).
 * Se NAO funcionar, o problema é de Node.js/ambiente no Render.
 */

const http = require('http');
const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  const url = req.url;
  console.log(`[${new Date().toISOString()}] ${req.method} ${url}`);
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (url === '/' || url === '/admin') {
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(`
<!DOCTYPE html>
<html><head><title>NF-e MGBP Brasil - TESTE MINIMAL</title></head>
<body style="font-family:Arial;padding:40px;max-width:600px;margin:auto;background:#1a1a1a;color:#d4af37">
<h1>✅ SERVIDOR RODANDO!</h1>
<p>Se você está vendo esta página, o Render está conseguindo rodar Node.js.</p>
<p>O problema está no Next.js (build/start/import).</p>
<hr>
<h3>Endpoints disponíveis:</h3>
<ul>
  <li><a href="/api/v1/health" style="color:#d4af37">/api/v1/health</a> - JSON de status</li>
  <li><a href="/admin" style="color:#d4af37">/admin</a> - esta página</li>
  <li><a href="/" style="color:#d4af37">/</a> - esta página</li>
</ul>
<hr>
<h3>Variáveis de ambiente visíveis:</h3>
<pre style="background:#222;padding:10px;border-radius:5px;overflow:auto">
NODE_ENV: ${process.env.NODE_ENV || '(nao setado)'}
PORT: ${process.env.PORT}
API_KEY: ${process.env.API_KEY ? process.env.API_KEY.substring(0, 10) + '...' : '(nao setado)'}
ODOO_URL: ${process.env.ODOO_URL || '(nao setado)'}
ODOO_DB: ${process.env.ODOO_DB || '(nao setado)'}
ODOO_USER: ${process.env.ODOO_USER || '(nao setado)'}
ODOO_API_KEY: ${process.env.ODOO_API_KEY ? process.env.ODOO_API_KEY.substring(0, 10) + '...' : '(nao setado)'}
FIREBASE_PROJECT_ID: ${process.env.FIREBASE_PROJECT_ID || '(nao setado)'}
FIREBASE_CLIENT_EMAIL: ${process.env.FIREBASE_CLIENT_EMAIL || '(nao setado)'}
FIREBASE_PRIVATE_KEY: ${process.env.FIREBASE_PRIVATE_KEY ? '(setada, ' + process.env.FIREBASE_PRIVATE_KEY.length + ' chars)' : '(nao setada)'}
  - comeca com BEGIN: ${process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.startsWith('-----BEGIN') : 'N/A'}
  - comeca com { (JSON): ${process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.startsWith('{') : 'N/A'}
NFE_UF: ${process.env.NFE_UF || '(nao setado)'}
NFE_TP_AMB: ${process.env.NFE_TP_AMB || '(nao setado)'}
</pre>
</body></html>
    `);
  } else if (url.startsWith('/api/v1/health')) {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({
      servico: 'nfe-mgbp-minimal',
      versao: 'test',
      status: 'OK - servidor rodando',
      timestamp: new Date().toISOString(),
      port: PORT,
      node_version: process.version,
      env: {
        NODE_ENV: process.env.NODE_ENV || '(nao setado)',
        PORT: process.env.PORT,
        API_KEY_setado: !!process.env.API_KEY,
        API_KEY_tamanho: process.env.API_KEY ? process.env.API_KEY.length : 0,
        API_KEY_tem_CHANGE: process.env.API_KEY ? process.env.API_KEY.includes('CHANGE') : false,
        ODOO_URL_setado: !!process.env.ODOO_URL,
        ODOO_API_KEY_setado: !!process.env.ODOO_API_KEY,
        FIREBASE_PROJECT_ID_setado: !!process.env.FIREBASE_PROJECT_ID,
        FIREBASE_CLIENT_EMAIL_setado: !!process.env.FIREBASE_CLIENT_EMAIL,
        FIREBASE_PRIVATE_KEY_setado: !!process.env.FIREBASE_PRIVATE_KEY,
        FIREBASE_PRIVATE_KEY_comeca_com_BEGIN: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.startsWith('-----BEGIN') : false,
        FIREBASE_PRIVATE_KEY_comeca_com_chave_JSON: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.startsWith('{') : false,
        NFE_CERT_KEK_tem_CHANGE: process.env.NFE_CERT_KEK ? process.env.NFE_CERT_KEK.includes('CHANGE') : false,
      },
    }, null, 2));
  } else {
    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end('404 - Use /api/v1/health, /admin ou /');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ MINIMAL TEST SERVER rodando na porta ${PORT}`);
  console.log(`✅ Acesse: http://localhost:${PORT}/api/v1/health`);
  console.log(`✅ Acesse: http://localhost:${PORT}/admin`);
  console.log('');
  console.log('Variáveis de ambiente:');
  console.log(`  NODE_ENV: ${process.env.NODE_ENV || '(nao setado)'}`);
  console.log(`  PORT: ${process.env.PORT}`);
  console.log(`  API_KEY setado: ${!!process.env.API_KEY}`);
  console.log(`  ODOO_URL: ${process.env.ODOO_URL || '(nao setado)'}`);
  console.log(`  FIREBASE_PROJECT_ID: ${process.env.FIREBASE_PROJECT_ID || '(nao setado)'}`);
  console.log(`  FIREBASE_PRIVATE_KEY setado: ${!!process.env.FIREBASE_PRIVATE_KEY}`);
  if (process.env.FIREBASE_PRIVATE_KEY) {
    console.log(`  FIREBASE_PRIVATE_KEY comeca com BEGIN: ${process.env.FIREBASE_PRIVATE_KEY.startsWith('-----BEGIN')}`);
    console.log(`  FIREBASE_PRIVATE_KEY comeca com { (JSON): ${process.env.FIREBASE_PRIVATE_KEY.startsWith('{')}`);
  }
});
