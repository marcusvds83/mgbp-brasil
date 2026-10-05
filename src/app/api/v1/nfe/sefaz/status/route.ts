/**
 * GET /api/v1/nfe/sefaz/status - Status do servico da SEFAZ (testa mTLS)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { statusServico } from '@/lib/sefaz-client';

export async function GET(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  try {
    const status = await statusServico();
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      {
        erro: (err as Error).message,
        cStat: '',
        xMotivo: 'Falha ao consultar status SEFAZ',
        online: false,
      },
      { status: 500 }
    );
  }
}
