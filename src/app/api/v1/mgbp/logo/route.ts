/**
 * /api/v1/mgbp/logo - Upload + status + download da logo MGBP para DANFE
 * POST:   multipart/form-data com arquivo PNG/JPG -> Salva no Firebase
 * GET:    retorna status da logo (sem buffer)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import {
  salvarLogo,
  statusLogo,
  removerLogo,
  invalidateConfigCache,
} from '@/lib/firebase-config';

export async function POST(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  try {
    const formData = await req.formData();
    const file = formData.get('logo') as File | null;
    if (!file) {
      return NextResponse.json(
        { erro: 'Arquivo "logo" obrigatorio (multipart/form-data)' },
        { status: 400 }
      );
    }

    const mimetype = file.type;
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(mimetype)) {
      return NextResponse.json(
        { erro: `Mimetype ${mimetype} nao suportado. Use PNG ou JPEG.` },
        { status: 400 }
      );
    }

    if (file.size > 500 * 1024) {
      return NextResponse.json(
        { erro: `Arquivo muito grande: ${file.size} bytes (max 500KB)` },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const info = await salvarLogo(buffer, mimetype);
    invalidateConfigCache();

    return NextResponse.json({
      sucesso: true,
      message: 'Logo salva no Firebase com sucesso',
      info,
    });
  } catch (err) {
    console.error('[LOGO] Erro ao salvar:', (err as Error).message);
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
    const status = await statusLogo();
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { erro: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  try {
    await removerLogo();
    invalidateConfigCache();
    return NextResponse.json({ sucesso: true, mensagem: 'Logo removida.' });
  } catch (err) {
    return NextResponse.json(
      { erro: (err as Error).message },
      { status: 500 }
    );
  }
}
