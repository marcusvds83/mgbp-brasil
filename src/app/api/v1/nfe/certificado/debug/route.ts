/**
 * /api/v1/nfe/certificado/debug - Debug detalhado do Firebase
 * Apenas admin (usa x-api-key) - mostra estado das env vars mascaradas
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { config, firebaseConfigured } from '@/lib/config';

export async function GET(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  const mask = (s: string | undefined, keepStart = 4, keepEnd = 4) => {
    if (!s) return '<vazio>';
    if (s.length <= keepStart + keepEnd + 3) return s.replace(/./g, '*');
    return s.substring(0, keepStart) + '...(' + s.length + ' chars)...' + s.substring(s.length - keepEnd);
  };

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY || '';
  const privateKeyParsed = config.firebase.privateKey;

  // Verifica formato da private key
  const hasLiteralBackslashN = privateKeyRaw.includes('\\n');
  const hasRealNewlines = privateKeyRaw.includes('\n');
  const startsWithBegin = privateKeyParsed.trim().startsWith('-----BEGIN PRIVATE KEY-----');
  const endsWithEnd = privateKeyParsed.trim().endsWith('-----END PRIVATE KEY-----');

  // Tenta inicializar Firebase manualmente para pegar o erro exato
  let initTentativa: { sucesso: boolean; erro?: string } = { sucesso: false };
  if (firebaseConfigured()) {
    try {
      const admin = await import('firebase-admin');
      // Limpa apps existentes
      admin.apps.forEach((app) => app?.delete().catch(() => {}));
      await admin.initializeApp({
        credential: admin.credential.cert({
          projectId: config.firebase.projectId,
          privateKey: config.firebase.privateKey,
          clientEmail: config.firebase.clientEmail,
        }),
      });
      const firestore = admin.firestore();
      // Testa uma leitura simples
      const testSnap = await firestore.collection('certificados').limit(1).get();
      initTentativa = {
        sucesso: true,
        erro: `Conectado! Coleção certificados lida com ${testSnap.size} docs.`,
      };
    } catch (e: any) {
      initTentativa = { sucesso: false, erro: e.message || String(e) };
      // Log completo no console do servidor
      console.error('[DEBUG-FIREBASE] Erro completo:', e);
    }
  }

  return NextResponse.json({
    firebaseConfigured: firebaseConfigured(),
    projectId,
    clientEmail,
    privateKeyDebug: {
      rawLength: privateKeyRaw.length,
      parsedLength: privateKeyParsed.length,
      hasLiteralBackslashN,
      hasRealNewlines,
      startsWithBegin,
      endsWithEnd,
      rawSample: mask(privateKeyRaw, 30, 30),
      parsedSample: mask(privateKeyParsed, 30, 30),
    },
    firebaseConfig: {
      projectId: config.firebase.projectId,
      collection: config.firebase.collection,
      docId: config.firebase.docId,
    },
    initTentativa,
    sugestoes: [
      hasLiteralBackslashN
        ? 'PRIVATE_KEY tem \\n literal - config.ts converte automaticamente'
        : !hasRealNewlines
        ? 'AVISO: PRIVATE_KEY sem quebras de linha (nem \\n literal nem \\n real). Provavel erro de colagem.'
        : 'PRIVATE_KEY tem quebras de linha reais (OK)',
      !startsWithBegin || !endsWithEnd
        ? 'AVISO: PRIVATE_KEY deve comecar com "-----BEGIN PRIVATE KEY-----" e terminar com "-----END PRIVATE KEY-----"'
        : 'Formato BEGIN/END correto (OK)',
      !initTentativa.sucesso
        ? `ERRO de inicializacao: ${initTentativa.erro}`
        : 'Firebase inicializado e leu collection certificados! (OK)',
    ],
  }, { status: 200 });
}
