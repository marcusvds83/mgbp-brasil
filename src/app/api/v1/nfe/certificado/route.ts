/**
 * /api/v1/nfe/certificado - Upload / status / remocao do certificado A1
 * POST:   { pfxBase64, senha } -> Salva no Firebase + cache memoria
 * GET:    Status do certificado (titular, validade, etc)
 * DELETE: Remove certificado
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import {
  salvarCertificado,
  statusCertificado,
  removerCertificado,
  invalidateCertCache,
} from '@/lib/firebase-cert';

export async function POST(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  try {
    const body = await req.json();
    const { pfxBase64, senha } = body;
    if (!pfxBase64) return NextResponse.json({ erro: 'pfxBase64 obrigatorio' }, { status: 400 });
    if (!senha) return NextResponse.json({ erro: 'senha obrigatoria' }, { status: 400 });

    const pfx = Buffer.from(pfxBase64, 'base64');
    const info = await salvarCertificado(pfx, senha);
    return NextResponse.json({ sucesso: true, info });
  } catch (err) {
    console.error('[CERT] Erro ao salvar:', (err as Error).message);
    return NextResponse.json({ sucesso: false, erro: (err as Error).message }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  try {
    const status = await statusCertificado();
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json({ erro: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  try {
    await removerCertificado();
    invalidateCertCache();
    return NextResponse.json({ sucesso: true, mensagem: 'Certificado removido.' });
  } catch (err) {
    return NextResponse.json({ erro: (err as Error).message }, { status: 500 });
  }
}
