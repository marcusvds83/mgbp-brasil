/**
 * scripts/enviar-certificado.js
 * =============================================
 * Envia o certificado .pfx para o middleware NF-e MGBP Brasil.
 *
 * Uso:
 *   node scripts/enviar-certificado.js ./CNPJ.pfx "SENHA_DO_PFX" \
 *     https://nfe-mgbp.onrender.com SUA_API_KEY
 */

const fs = require('fs');
const path = require('path');

const [, , pfxPath, senha, baseUrl, apiKey] = process.argv;

if (!pfxPath || !senha || !baseUrl || !apiKey) {
  console.error('Uso: node scripts/enviar-certificado.js <arquivo.pfx> <senha> <base_url> <api_key>');
  console.error('Exemplo: node scripts/enviar-certificado.js ./MGBP-Brasil.pfx "minhaSenha" https://nfe-mgbp.onrender.com abc123');
  process.exit(1);
}

if (!fs.existsSync(pfxPath)) {
  console.error(`Arquivo nao encontrado: ${pfxPath}`);
  process.exit(1);
}

(async () => {
  const buf = fs.readFileSync(pfxPath);
  const pfxBase64 = buf.toString('base64');

  console.log(`Enviando certificado: ${path.basename(pfxPath)} (${buf.length} bytes)`);
  console.log(`Destino: ${baseUrl}/api/v1/nfe/certificado`);

  const resp = await fetch(`${baseUrl}/api/v1/nfe/certificado`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pfxBase64, senha }),
  });

  const data = await resp.json();

  if (resp.ok && data.sucesso) {
    console.log('\nCertificado enviado com sucesso!');
    console.log(`  Titular: ${data.info.titular}`);
    console.log(`  CNPJ:    ${data.info.cnpj}`);
    console.log(`  Emissor: ${data.info.emissor}`);
    console.log(`  Valido:  ${data.info.validoDe?.substring(0, 10)} a ${data.info.validoAte?.substring(0, 10)}`);
    console.log(`  Dias restantes: ${data.info.diasRestantes}`);
  } else {
    console.error('\nFalha ao enviar certificado:');
    console.error(data.erro || `HTTP ${resp.status}`);
    process.exit(1);
  }
})();
