/**
 * src/lib/firebase-config.ts - Gerenciador de Service Account + Logo no Firebase
 * =================================================================================
 * Resolve dois problemas:
 *
 * 1. Service Account JSON: em vez de colar 3 env vars separadas
 *    (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY),
 *    o usuario pode colar TODO o JSON da service account em um textarea
 *    no painel web. Middleware valida, persiste no Firestore (collection
 *    'config', doc 'firebase-service-account') e usa para initFirebase().
 *
 * 2. Logo MGBP: upload de PNG/JPG (max 500KB) para o DANFE.
 *    Persiste no Firestore (collection 'config', doc 'mgbp-logo').
 *    Carregado automaticamente no danfe-pdf.ts.
 *
 * Estrutura no Firestore:
 *   config/firebase-service-account:
 *     - projectId: string
 *     - clientEmail: string
 *     - privateKeyCifrada: string (AES-256-GCM cifrada com NFE_CERT_KEK)
 *     - uploadedAt: ISO date
 *
 *   config/mgbp-logo:
 *     - logoBase64: string (base64 do PNG/JPG)
 *     - mimetype: 'image/png' | 'image/jpeg'
 *     - width, height: number (em pontos PDF)
 *     - uploadedAt: ISO date
 */

import crypto from 'crypto';
import { config } from './config';
import { firebaseRest } from './firebase-rest';

// === Cache em memória ===
interface CachedServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  uploadedAt?: string;
}
interface CachedLogo {
  buffer: Buffer;
  mimetype: string;
  width?: number;
  height?: number;
  uploadedAt?: string;
}
let cachedSA: CachedServiceAccount | null = null;
let cachedLogo: CachedLogo | null = null;

// === DB Firestore (lazy) ===
let _admin: typeof import('firebase-admin') | null = null;
async function getAdmin() {
  if (_admin) return _admin;
  try {
    _admin = await import('firebase-admin');
    return _admin;
  } catch (e) {
    console.error('[FIREBASE-CONFIG] Erro ao importar firebase-admin:', (e as Error).message);
    throw e;
  }
}

let _db: any = null;
let _firebaseReady = false;

/**
 * Inicializa Firebase usando:
 * 1. Env vars (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)
 * 2. Service account persistida no Firestore
 *
 * Padrão: tenta 1 primeiro, se falhar, tenta 2 (mas 2 precisa de 1 para funcionar,
 * exceto se houver arquivo config/firebase-service-account.json local).
 */
export async function initFirebase(): Promise<boolean> {
  // REST API é stateless - só verifica se env vars estão preenchidas
  // Não precisa de firebase-admin SDK (evita bugs de gRPC/OpenSSL/apps.forEach)
  if (_firebaseReady) return true;

  const envOk =
    !!process.env.FIREBASE_PROJECT_ID &&
    !!process.env.FIREBASE_CLIENT_EMAIL &&
    !!process.env.FIREBASE_PRIVATE_KEY;

  if (!envOk) {
    console.warn('[FIREBASE-CONFIG] Env vars ausentes');
    return false;
  }

  _firebaseReady = true;
  console.log('[FIREBASE-CONFIG] Firebase PRONTO (REST API). Project: ' + process.env.FIREBASE_PROJECT_ID);
  return true;
}

/**
 * Salva a service account JSON no Firestore (cifrando a private key).
 * Retorna info básica (sem expor a private key).
 */
export async function salvarServiceAccount(saJson: any): Promise<{
  projectId: string;
  clientEmail: string;
  uploadedAt: string;
}> {
  if (!saJson || typeof saJson !== 'object') {
    throw new Error('JSON da service account invalido');
  }
  const required = ['project_id', 'client_email', 'private_key'];
  for (const f of required) {
    if (!saJson[f]) {
      throw new Error(`Campo obrigatorio ausente no JSON: ${f}`);
    }
  }
  if (!saJson.private_key.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('private_key invalida: deve conter "-----BEGIN PRIVATE KEY-----"');
  }

  // Tenta inicializar Firebase
  const ok = await initFirebase();
  if (!ok || !_db) {
    throw new Error(
      'Firebase nao inicializado. Para salvar a service account, configure FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY nas env vars primeiro (pode ser a mesma service account que vai persistir).'
    );
  }

  // Cifra a private key antes de persistir
  const privateKeyCifrada = encryptSenha(saJson.private_key);
  const uploadedAt = new Date().toISOString();

  await firebaseRest.setDoc('config', 'firebase-service-account', {
    projectId: saJson.project_id,
    clientEmail: saJson.client_email,
    privateKeyCifrada,
    uploadedAt,
  });

  // Atualiza cache
  cachedSA = {
    projectId: saJson.project_id,
    clientEmail: saJson.client_email,
    privateKey: saJson.private_key.replace(/\\n/g, '\n'),
    uploadedAt,
  };

  console.log(
    `[FIREBASE-CONFIG] Service account salva. Project: ${saJson.project_id}`
  );

  return {
    projectId: saJson.project_id,
    clientEmail: saJson.client_email,
    uploadedAt,
  };
}

/** Retorna status da service account (sem expor a private key). */
export async function statusServiceAccount(): Promise<{
  configurado: boolean;
  origem?: string;
  projectId?: string;
  clientEmail?: string;
  uploadedAt?: string;
  erro?: string;
}> {
  // 1. Verifica env vars
  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    let origem = 'env-vars';
    let privateKey = config.firebase.privateKey;
    if (privateKey.trim().startsWith('{') && privateKey.includes('"private_key"')) {
      origem = 'env-vars (JSON inteiro detectado - parseado em runtime)';
    }
    return {
      configurado: true,
      origem,
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    };
  }
  // 2. Verifica service account persistida no Firestore
  const ok = await initFirebase();
  if (!ok || !_db) {
    return {
      configurado: false,
      erro: 'Firebase nao inicializado e env vars ausentes',
    };
  }
  try {
    const snap = await firebaseRest.getDoc('config', 'firebase-service-account');
    if (!snap || !snap.logoBase64) {
      return { configurado: false, erro: 'Nenhuma service account persistida no Firestore' };
    }
    const d = snap || {};
    return {
      configurado: true,
      origem: 'firestore-persistido',
      projectId: d.projectId,
      clientEmail: d.clientEmail,
      uploadedAt: d.uploadedAt,
    };
  } catch (e: any) {
    return { configurado: false, erro: e.message };
  }
}

// ============================================================
// Logo MGBP (upload + carregamento)
// ============================================================

/**
 * Salva a logo no Firestore. Recebe o buffer PNG/JPG.
 * Persiste em base64 (nao cifrado - é só uma imagem, nao é segredo).
 */
export async function salvarLogo(
  logoBuffer: Buffer,
  mimetype: string
): Promise<{ uploadedAt: string; size: number; mimetype: string }> {
  if (!logoBuffer || !logoBuffer.length) {
    throw new Error('Buffer da logo vazio');
  }
  if (logoBuffer.length > 500 * 1024) {
    throw new Error('Logo muito grande (max 500KB). Redimensione antes do upload.');
  }
  if (!['image/png', 'image/jpeg', 'image/jpg'].includes(mimetype)) {
    throw new Error(`Mimetype nao suportado: ${mimetype}. Use PNG ou JPEG.`);
  }

  const ok = await initFirebase();
  if (!ok || !_db) {
    throw new Error('Firebase nao inicializado');
  }

  const uploadedAt = new Date().toISOString();
  await firebaseRest.setDoc('config', 'mgbp-logo', {
    logoBase64: logoBuffer.toString('base64'),
    mimetype,
    size: logoBuffer.length,
    uploadedAt,
  });

  cachedLogo = {
    buffer: logoBuffer,
    mimetype,
    uploadedAt,
  };

  console.log(`[FIREBASE-CONFIG] Logo salva: ${logoBuffer.length} bytes (${mimetype})`);
  return { uploadedAt, size: logoBuffer.length, mimetype };
}

/** Carrega a logo do Firestore. Retorna Buffer + mimetype ou null. */
export async function carregarLogo(): Promise<CachedLogo | null> {
  if (cachedLogo) return cachedLogo;

  const ok = await initFirebase();
  if (!ok || !_db) return null;

  try {
    const snap = await firebaseRest.getDoc('config', 'mgbp-logo');
    if (!snap || !snap.logoBase64) {
      return null;
    }
    const d = snap || {};
    if (!d.logoBase64) return null;
    const buffer = Buffer.from(d.logoBase64, 'base64');
    cachedLogo = {
      buffer,
      mimetype: d.mimetype || 'image/png',
      uploadedAt: d.uploadedAt,
    };
    return cachedLogo;
  } catch (e: any) {
    console.error('[FIREBASE-CONFIG] Erro ao carregar logo:', e.message);
    return null;
  }
}

/** Status da logo (sem retornar o buffer). */
export async function statusLogo(): Promise<{
  configurado: boolean;
  size?: number;
  mimetype?: string;
  uploadedAt?: string;
  erro?: string;
}> {
  if (cachedLogo) {
    return {
      configurado: true,
      size: cachedLogo.buffer.length,
      mimetype: cachedLogo.mimetype,
      uploadedAt: cachedLogo.uploadedAt,
    };
  }
  const ok = await initFirebase();
  if (!ok || !_db) {
    return { configurado: false, erro: 'Firebase nao inicializado' };
  }
  try {
    const snap = await firebaseRest.getDoc('config', 'mgbp-logo');
    if (!snap || !snap.logoBase64) {
      return { configurado: false, erro: 'Nenhuma logo no Firestore' };
    }
    const d = snap || {};
    return {
      configurado: true,
      size: d.size,
      mimetype: d.mimetype,
      uploadedAt: d.uploadedAt,
    };
  } catch (e: any) {
    return { configurado: false, erro: e.message };
  }
}

/** Remove a logo do Firestore e do cache. */
export async function removerLogo(): Promise<boolean> {
  const ok = await initFirebase();
  if (ok && _db) {
    try {
      await firebaseRest.deleteDoc('config', 'mgbp-logo');
    } catch (e) {
      console.warn('[FIREBASE-CONFIG] Falha ao deletar logo:', (e as Error).message);
    }
  }
  cachedLogo = null;
  return true;
}

// ============================================================
// Cifragem (mesma lógica do firebase-cert.ts)
// ============================================================

function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(String(config.nfe.certKek)).digest();
}

function encryptSenha(senha: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const enc = Buffer.concat([c.update(senha, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

/** Invalida cache (depois de upload/remoção). */
export function invalidateConfigCache() {
  cachedSA = null;
  cachedLogo = null;
}

/** Expose db getter para outros módulos (firebase-cert.ts usa). */
export async function getFirestoreDb(): Promise<any> {
  const ok = await initFirebase();
  return ok ? firebaseRest : null;
}
