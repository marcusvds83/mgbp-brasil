/**
 * src/lib/pfx.ts - Parser de certificado PFX/PKCS#12
 * ====================================================
 * Extrai chave privada + cadeia PEM de um arquivo .pfx.
 * Estrategia: tenta node-forge primeiro; se falhar (PFX PBES2/AES-256 dos
 * certificados ICP-Brasil recentes), cai para OpenSSL do sistema.
 */

import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';
import fs from 'fs';
import forge from 'node-forge';

export interface CertInfo {
  titular: string;
  cnpj: string;
  emissor: string;
  validoDe: string;
  validoAte: string;
  diasRestantes: number;
  expirado: boolean;
  serial: string;
}

export interface ParsedCert {
  privateKeyPem: string;
  certPem: string;
  chainPem: string[];
  info: CertInfo;
}

function onlyNum(s: string | undefined | null): string {
  return String(s || '').replace(/\D/g, '');
}

/** Monta infos publicas a partir do certificado do titular em PEM. */
export function infoFromCertPem(certPem: string): CertInfo {
  const leaf = forge.pki.certificateFromPem(certPem);
  let cn = '';
  try {
    cn = (leaf.subject.getField('CN') || { value: '' }).value || '';
  } catch {
    cn = '';
  }
  const cnpj = onlyNum((cn.split(':')[1] || ''));
  const cnpjFinal =
    cnpj.length === 14 ? cnpj : (cn.match(/(\d{14})/) || [])[1] || '';

  let emissor = '';
  try {
    emissor = (leaf.issuer.getField('CN') || { value: '' }).value || '';
  } catch {
    emissor = '';
  }

  return {
    titular: cn.split(':')[0] || cn,
    cnpj: cnpjFinal,
    emissor,
    validoDe: leaf.validity.notBefore.toISOString(),
    validoAte: leaf.validity.notAfter.toISOString(),
    diasRestantes: Math.floor(
      (leaf.validity.notAfter.getTime() - Date.now()) / 86400000
    ),
    expirado: leaf.validity.notAfter.getTime() < Date.now(),
    serial: leaf.serialNumber,
  };
}

/** Leitura via node-forge. */
function openPfxForge(pfxBuffer: Buffer, senha: string): ParsedCert {
  const der = forge.util.createBuffer(pfxBuffer.toString('binary'));
  const asn1 = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, String(senha));

  let keyBags =
    (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag }) as any)[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] || [];
  if (!keyBags.length) {
    keyBags = (p12.getBags({ bagType: forge.pki.oids.keyBag }) as any)[
      forge.pki.oids.keyBag
    ] || [];
  }
  if (!keyBags.length || !keyBags[0].key) {
    throw new Error('Chave privada nao encontrada no certificado A1.');
  }
  const privateKeyPem = forge.pki.privateKeyToPem(keyBags[0].key);

  const certBags =
    (p12.getBags({ bagType: forge.pki.oids.certBag }) as any)[
      forge.pki.oids.certBag
    ] || [];
  if (!certBags.length) {
    throw new Error('Certificado nao encontrado no arquivo .pfx.');
  }

  let leaf: forge.pki.Certificate | null = null;
  const chainPem: string[] = [];
  for (const c of certBags) {
    if (!c.cert) continue;
    chainPem.push(forge.pki.certificateToPem(c.cert));
    let isCa = false;
    try {
      const bc = c.cert.getExtension('basicConstraints');
      isCa = !!(bc && (bc as any).cA);
    } catch {
      isCa = false;
    }
    if (!isCa && !leaf) leaf = c.cert;
  }
  if (!leaf) leaf = certBags[0].cert;
  const certPem = forge.pki.certificateToPem(leaf);

  return { privateKeyPem, certPem, chainPem, info: infoFromCertPem(certPem) };
}

/**
 * Fallback OpenSSL - para certificados PFX com algoritmos que node-forge
 * nao suporta (PBES2/AES-256 dos certificados ICP-Brasil recentes).
 */
function openPfxWithOpenssl(pfxBuffer: Buffer, senha: string): ParsedCert {
  const tmpDir = tmpdir();
  const pfxPath = path.join(tmpDir, `nfe-pfx-${Date.now()}.pfx`);
  const keyPath = path.join(tmpDir, `nfe-key-${Date.now()}.pem`);
  const certPath = path.join(tmpDir, `nfe-cert-${Date.now()}.pem`);
  const chainPath = path.join(tmpdir(), `nfe-chain-${Date.now()}.pem`);

  try {
    fs.writeFileSync(pfxPath, pfxBuffer, { mode: 0o600 });
    // Extrai chave privada sem DES
    execFileSync('openssl', [
      'pkcs12', '-in', pfxPath, '-nocerts', '-nodes', '-passin', `pass:${senha}`,
      '-out', keyPath,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    // Extrai todos os certificados da cadeia
    execFileSync('openssl', [
      'pkcs12', '-in', pfxPath, '-nokeys', '-passin', `pass:${senha}`,
      '-out', chainPath,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const keyContent = fs.readFileSync(keyPath, 'utf-8');
    const certContent = fs.readFileSync(chainPath, 'utf-8');

    // Quebra em certificados individuais
    const matches = certContent.match(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g
    ) || [];
    if (!matches.length) {
      throw new Error('OpenSSL extraiu PEM vazio');
    }
    const certPem = matches[0];
    const chainPem = matches;

    return {
      privateKeyPem: keyContent,
      certPem,
      chainPem,
      info: infoFromCertPem(certPem),
    };
  } finally {
    [pfxPath, keyPath, certPath, chainPath].forEach((f) => {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    });
  }
}

/**
 * Abre o PKCS#12, valida a senha e extrai chave privada + cadeia em PEM.
 * Tenta node-forge e, quando o PFX usa algoritmos que ele nao suporta,
 * cai para o OpenSSL do sistema.
 */
export function openPfx(pfxBuffer: Buffer, senha: string): ParsedCert {
  if (!Buffer.isBuffer(pfxBuffer) || !pfxBuffer.length) {
    throw new Error('Arquivo de certificado invalido.');
  }
  let forgeErr: Error | null = null;
  try {
    return openPfxForge(pfxBuffer, senha);
  } catch (e) {
    forgeErr = e as Error;
    const msg = String((e as Error).message || e);
    if (/mac|password|senha/i.test(msg) && !/unsupported/i.test(msg)) {
      throw new Error('Senha do certificado incorreta ou arquivo .pfx invalido.');
    }
    console.warn(`[PFX] node-forge falhou (${msg}). Tentando OpenSSL...`);
  }

  try {
    const viaSsl = openPfxWithOpenssl(pfxBuffer, senha);
    console.log('[PFX] PFX lido via OpenSSL.');
    return viaSsl;
  } catch (e2) {
    throw new Error(
      String((e2 as Error).message || e2) +
      ' (node-forge: ' + String((forgeErr as Error).message || forgeErr) + ')'
    );
  }
}
