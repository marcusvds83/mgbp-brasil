/**
 * src/lib/firebase-cert.ts - Cofre do certificado A1 no Firebase
 * ===============================================================
 * Armazena o certificado digital (.pfx em base64) + senha cifrada (AES-256-GCM)
 * no Firestore do Firebase. Vantagens do Firebase como cofre:
 *   - Sobrevive deploys/reinicios no Render
 *   - Nao precisa de disco persistente
 *   - Acesso seguro via service account
 *
 * Tambem suporta fallback para variaveis de ambiente
 * (NFE_CERT_PFX_BASE64 + NFE_CERT_SENHA) caso o Firebase nao esteja
 * configurado.
 */

import crypto from 'crypto';
import { config, firebaseConfigured } from './config';
import { openPfx, infoFromCertPem, type ParsedCert } from './pfx';

// Lazy-load firebase-admin (evita crash no startup se env vars estiverem erradas)
let _admin: typeof import('firebase-admin') | null = null;
async function getAdmin() {
  if (_admin) return _admin;
  try {
    _admin = await import('firebase-admin');
    return _admin;
  } catch (e) {
    console.error('[FIREBASE-CERT] Erro ao importar firebase-admin:', (e as Error).message);
    throw e;
  }
}

// === Cache em memoria ===
interface CachedCert {
  pfx: Buffer;
  senha: string;
  privateKeyPem: string;
  certPem: string;
  chainPem: string[];
  info: ParsedCert['info'];
}
let cache: CachedCert | null = null;

// === Inicializacao do Firebase ===
let db: any = null;
let firebaseReady = false;

async function initFirebase(): Promise<void> {
  if (firebaseReady) return;
  if (!firebaseConfigured()) {
    console.warn(
      '[FIREBASE-CERT] Firebase nao configurado. Defina FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY.'
    );
    return;
  }
  try {
    const adminLib = await getAdmin();
    if (adminLib.apps.length === 0) {
      adminLib.initializeApp({
        credential: adminLib.credential.cert({
          projectId: config.firebase.projectId,
          privateKey: config.firebase.privateKey,
          clientEmail: config.firebase.clientEmail,
        }),
      });
    }
    db = adminLib.firestore();
    firebaseReady = true;
    console.log(`[FIREBASE-CERT] Firebase inicializado. Projeto: ${config.firebase.projectId}`);
  } catch (e) {
    console.error('[FIREBASE-CERT] Falha ao inicializar Firebase:', (e as Error).message);
    // Nao lanca erro - deixa o app continuar rodando sem Firebase
  }
}

// === Cifragem da senha (AES-256-GCM) ===
function deriveKey(): Buffer {
  return crypto
    .createHash('sha256')
    .update(String(config.nfe.certKek))
    .digest();
}

function encryptSenha(senha: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const enc = Buffer.concat([c.update(senha, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

function decryptSenha(blob: string): string {
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const d = crypto.createDecipheriv('aes-256-gcm', deriveKey(), iv);
  d.setAuthTag(Buffer.from(tag));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

// === CRUD do Firestore ===

/** Salva o certificado no Firebase e carrega em memoria. */
export async function salvarCertificado(
  pfxBuffer: Buffer,
  senha: string
): Promise<ParsedCert['info']> {
  if (!pfxBuffer || !pfxBuffer.length) throw new Error('Arquivo .pfx vazio.');
  if (!senha) throw new Error('Senha do certificado obrigatoria.');

  // Valida a senha antes de persistir
  const aberto = openPfx(pfxBuffer, senha);

  // Tenta Firebase primeiro
  await initFirebase();
  if (db) {
    const doc = {
      pfxBase64: pfxBuffer.toString('base64'),
      senhaCifrada: encryptSenha(senha),
      info: aberto.info,
      uploadEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
    };
    await db.collection(config.firebase.collection).doc(config.firebase.docId).set(doc);
    console.log(
      `[FIREBASE-CERT] Certificado salvo no Firebase. Titular: ${aberto.info.titular} | CNPJ: ${aberto.info.cnpj}`
    );
  } else {
    console.warn(
      '[FIREBASE-CERT] Firebase indisponivel. Certificado carregado apenas em memoria (NAO persiste em reinicios).'
    );
  }

  cache = {
    pfx: pfxBuffer,
    senha,
    privateKeyPem: aberto.privateKeyPem,
    certPem: aberto.certPem,
    chainPem: aberto.chainPem,
    info: aberto.info,
  };
  return aberto.info;
}

/** Carrega o certificado do cache, Firebase ou env vars. */
export async function carregarCertificado(): Promise<CachedCert | null> {
  if (cache) return cache;

  // 1) Variaveis de ambiente (fallback quando Firebase nao configurado)
  const b64 = process.env.NFE_CERT_PFX_BASE64;
  const envSenha = process.env.NFE_CERT_SENHA;
  if (b64 && envSenha) {
    try {
      const buf = Buffer.from(b64, 'base64');
      const ab = openPfx(buf, envSenha);
      cache = {
        pfx: buf,
        senha: envSenha,
        privateKeyPem: ab.privateKeyPem,
        certPem: ab.certPem,
        chainPem: ab.chainPem,
        info: ab.info,
      };
      console.log(`[FIREBASE-CERT] Certificado carregado via env vars. Titular: ${ab.info.titular}`);
      return cache;
    } catch (e) {
      console.error(`[FIREBASE-CERT] Falha ao abrir certificado das env vars: ${(e as Error).message}`);
    }
  }

  // 2) Firebase Firestore
  await initFirebase();
  if (!db) {
    console.warn('[FIREBASE-CERT] Firebase indisponivel. Nenhum certificado carregado.');
    return null;
  }
  try {
    const snap = await db.collection(config.firebase.collection).doc(config.firebase.docId).get();
    if (!snap.exists) {
      console.warn('[FIREBASE-CERT] Nenhum certificado encontrado no Firebase.');
      return null;
    }
    const doc = snap.data()!;
    if (!doc.pfxBase64 || !doc.senhaCifrada) {
      console.error('[FIREBASE-CERT] Documento do Firebase esta incompleto.');
      return null;
    }
    const pfx = Buffer.from(doc.pfxBase64, 'base64');
    const senha = decryptSenha(doc.senhaCifrada);
    const aberto = openPfx(pfx, senha);
    cache = {
      pfx,
      senha,
      privateKeyPem: aberto.privateKeyPem,
      certPem: aberto.certPem,
      chainPem: aberto.chainPem,
      info: aberto.info,
    };
    console.log(`[FIREBASE-CERT] Certificado carregado do Firebase. Titular: ${aberto.info.titular}`);
    return cache;
  } catch (e) {
    console.error('[FIREBASE-CERT] Erro ao carregar do Firebase:', (e as Error).message);
    return null;
  }
}

/** Retorna o status do certificado (sem carregar PEM). */
export async function statusCertificado(): Promise<Record<string, unknown>> {
  // Cache em memoria -> retorna imediatamente
  if (cache) {
    return { configurado: true, origem: 'cache', ...cache.info };
  }

  // Tenta Firebase
  await initFirebase();
  if (!db) {
    // Verifica env vars
    if (process.env.NFE_CERT_PFX_BASE64 && process.env.NFE_CERT_SENHA) {
      try {
        const c = await carregarCertificado();
        if (c) return { configurado: true, origem: 'env', ...c.info };
      } catch (e) {
        return { configurado: false, erro: (e as Error).message };
      }
    }
    return { configurado: false, erro: 'Firebase nao configurado e env vars ausentes' };
  }
  try {
    const snap = await db.collection(config.firebase.collection).doc(config.firebase.docId).get();
    if (!snap.exists) {
      return { configurado: false, mensagem: 'Nenhum certificado A1 no Firebase.' };
    }
    const doc = snap.data()!;
    return {
      configurado: true,
      origem: 'firebase',
      uploadEm: doc.uploadEm,
      ...(doc.info || {}),
    };
  } catch (e) {
    return { configurado: false, erro: (e as Error).message };
  }
}

/** Remove o certificado do Firebase e do cache. */
export async function removerCertificado(): Promise<boolean> {
  await initFirebase();
  if (db) {
    try {
      await db.collection(config.firebase.collection).doc(config.firebase.docId).delete();
    } catch (e) {
      console.warn('[FIREBASE-CERT] Falha ao deletar do Firebase:', (e as Error).message);
    }
  }
  cache = null;
  console.log('[FIREBASE-CERT] Certificado removido.');
  return true;
}

/** Invalida cache (usado apos upload/remocao). */
export function invalidateCertCache() {
  cache = null;
}
