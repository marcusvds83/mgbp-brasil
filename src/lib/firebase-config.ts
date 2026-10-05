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
  if (_firebaseReady && _db) return true;

  const adminLib = await getAdmin();

  // Strategy 1: usa env vars direto
  const envOk =
    !!process.env.FIREBASE_PROJECT_ID &&
    !!process.env.FIREBASE_CLIENT_EMAIL &&
    !!process.env.FIREBASE_PRIVATE_KEY;

  if (envOk) {
    // Verifica se FIREBASE_PRIVATE_KEY é JSON inteiro (caso comum)
    let projectId = process.env.FIREBASE_PROJECT_ID!;
    let clientEmail = process.env.FIREBASE_CLIENT_EMAIL!;
    let privateKey = config.firebase.privateKey;

    // Se a private key parece ser o JSON inteiro da service account, parseia
    if (privateKey.trim().startsWith('{') && privateKey.includes('"private_key"')) {
      console.log('[FIREBASE-CONFIG] FIREBASE_PRIVATE_KEY contem JSON inteiro, parseando...');
      try {
        const saJson = JSON.parse(privateKey);
        projectId = saJson.project_id || projectId;
        clientEmail = saJson.client_email || clientEmail;
        privateKey = saJson.private_key || '';
        console.log(
          `[FIREBASE-CONFIG] JSON parseado: projectId=${projectId}, email=${clientEmail}, key.length=${privateKey.length}`
        );
      } catch (e) {
        console.error('[FIREBASE-CONFIG] Erro ao parsear JSON da private key:', (e as Error).message);
      }
    }

    // Normaliza \n literal para quebras reais (Firebase exige)
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    // Valida formato
    if (
      !privateKey.includes('-----BEGIN PRIVATE KEY-----') ||
      !privateKey.includes('-----END PRIVATE KEY-----')
    ) {
      console.error(
        '[FIREBASE-CONFIG] PRIVATE_KEY invalida: deve conter "-----BEGIN PRIVATE KEY-----" e "-----END PRIVATE KEY-----"'
      );
      console.error(
        '[FIREBASE-CONFIG] Se colou o JSON inteiro da service account, use o painel web (Setup > Service Account JSON).'
      );
      // Estrategicamente, deixa _firebaseReady = false para tentar strategy 2 abaixo
    } else {
      try {
        // Limpa apps existentes para evitar erro de já inicializado
        adminLib.apps.forEach((app) => app?.delete().catch(() => {}));
        adminLib.initializeApp({
          credential: adminLib.credential.cert({
            projectId,
            privateKey,
            clientEmail,
          }),
        });
        _db = adminLib.firestore();
        _firebaseReady = true;
        cachedSA = { projectId, clientEmail, privateKey };
        console.log(
          `[FIREBASE-CONFIG] Firebase inicializado via ENV VARS. Project: ${projectId}`
        );
        return true;
      } catch (e: any) {
        console.error(
          '[FIREBASE-CONFIG] Falha ao inicializar Firebase via env vars:',
          e.message
        );
        // Continua para strategy 2
      }
    }
  }

  // Strategy 2: carrega service account persistida do Firestore
  // Mas pra isso precisa ter o Firebase inicializado... quebra de ciclo.
  // Solução: se houver arquivo config/firebase-service-account.json local
  // ou variável FIREBASE_SERVICE_ACCOUNT_JSON, usa.
  const saJsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJsonEnv) {
    try {
      const sa = JSON.parse(saJsonEnv);
      adminLib.apps.forEach((app) => app?.delete().catch(() => {}));
      adminLib.initializeApp({
        credential: adminLib.credential.cert({
          projectId: sa.project_id,
          privateKey: sa.private_key.replace(/\\n/g, '\n'),
          clientEmail: sa.client_email,
        }),
      });
      _db = adminLib.firestore();
      _firebaseReady = true;
      cachedSA = {
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        privateKey: sa.private_key.replace(/\\n/g, '\n'),
      };
      console.log(
        `[FIREBASE-CONFIG] Firebase inicializado via FIREBASE_SERVICE_ACCOUNT_JSON. Project: ${sa.project_id}`
      );
      return true;
    } catch (e: any) {
      console.error(
        '[FIREBASE-CONFIG] Falha ao inicializar via FIREBASE_SERVICE_ACCOUNT_JSON:',
        e.message
      );
    }
  }

  return false;
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

  await _db.collection('config').doc('firebase-service-account').set({
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
    const snap = await _db.collection('config').doc('firebase-service-account').get();
    if (!snap.exists) {
      return { configurado: false, erro: 'Nenhuma service account persistida no Firestore' };
    }
    const d = snap.data()!;
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
  await _db.collection('config').doc('mgbp-logo').set({
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
    const snap = await _db.collection('config').doc('mgbp-logo').get();
    if (!snap.exists) {
      return null;
    }
    const d = snap.data()!;
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
    const snap = await _db.collection('config').doc('mgbp-logo').get();
    if (!snap.exists) {
      return { configurado: false, erro: 'Nenhuma logo no Firestore' };
    }
    const d = snap.data()!;
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
      await _db.collection('config').doc('mgbp-logo').delete();
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
  if (_firebaseReady && _db) return _db;
  const ok = await initFirebase();
  return ok ? _db : null;
}
