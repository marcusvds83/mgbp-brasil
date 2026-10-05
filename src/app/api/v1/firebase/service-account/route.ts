/**
 * /api/v1/firebase/service-account - Upload + status do JSON da service account
 * POST:  { serviceAccountJson: string }  -> Salva no Firestore
 * GET:   retorna status da config Firebase
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import {
  salvarServiceAccount,
  statusServiceAccount,
  initFirebase,
} from '@/lib/firebase-config';

export async function POST(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  try {
    const body = await req.json();
    const { serviceAccountJson } = body;
    if (!serviceAccountJson) {
      return NextResponse.json(
        { erro: 'serviceAccountJson obrigatorio (cole TODO conteudo do arquivo JSON)' },
        { status: 400 }
      );
    }

    let sa: any;
    try {
      sa = typeof serviceAccountJson === 'string'
        ? JSON.parse(serviceAccountJson)
        : serviceAccountJson;
    } catch (e) {
      return NextResponse.json(
        { erro: 'JSON invalido. Cole TODO o conteudo do arquivo .json da service account.' },
        { status: 400 }
      );
    }

    // Validacao dos campos obrigatorios
    const missing = ['project_id', 'client_email', 'private_key'].filter(
      (f) => !sa[f]
    );
    if (missing.length) {
      return NextResponse.json(
        { erro: `Campos obrigatorios ausentes: ${missing.join(', ')}` },
        { status: 400 }
      );
    }

    if (!sa.private_key.includes('-----BEGIN PRIVATE KEY-----')) {
      return NextResponse.json(
        { erro: 'private_key invalida (deve conter BEGIN PRIVATE KEY)' },
        { status: 400 }
      );
    }

    // Para salvar no Firestore, precisa ter Firebase inicializado (via env vars,
    // idealmente apontando para o MESMO projeto)
    const ok = await initFirebase();
    if (!ok) {
      return NextResponse.json(
        {
          erro:
            'Firebase ainda nao inicializado. Configure as env vars FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY no Render (pode usar esta mesma service account) para depois persistir via esta rota.',
        },
        { status: 500 }
      );
    }

    const info = await salvarServiceAccount(sa);
    return NextResponse.json({
      sucesso: true,
      message: 'Service account salva no Firestore com sucesso',
      info,
    });
  } catch (err) {
    console.error('[SERVICE-ACCOUNT] Erro ao salvar:', (err as Error).message);
    return NextResponse.json(
      { sucesso: false, erro: (err as Error).message },
      { status: 400 }
    );
  }
}

export async function GET(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  try {
    const status = await statusServiceAccount();
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { erro: (err as Error).message },
      { status: 500 }
    );
  }
}
