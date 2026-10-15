/**
 * GET /api/v1/nfe/dashboard/sefaz-status - Status da conexao com SEFAZ
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { statusServico } from '@/lib/sefaz-client';

// Cache 30s
let cache: { data: any; ts: number } | null = null;
const TTL = 30000;

export async function GET(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  const now = Date.now();
  if (cache && (now - cache.ts) < TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const status = await statusServico();
    cache = { data: status, ts: now };
    return NextResponse.json(status);
  } catch (err) {
    const data = {
      erro: (err as Error).message,
      online: false,
      cStat: '',
      xMotivo: 'Falha de conexao',
    };
    return NextResponse.json(data);
  }
}
