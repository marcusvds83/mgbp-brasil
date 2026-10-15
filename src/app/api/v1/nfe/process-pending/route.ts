/**
 * POST /api/v1/nfe/process-pending - Forca processamento de pendentes
 * GET  - Idem (util para cron do Render)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { processPendingEmissions } from '@/lib/nfe-emit';

export async function POST(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  try {
    const resultado = await processPendingEmissions();
    return NextResponse.json({
      sucesso: true,
      processadas: resultado.processed,
      autorizadas: resultado.sucesso,
      erros: resultado.erro,
      detalhes: resultado.detalhes,
    });
  } catch (err) {
    console.error('[NFE-PENDING] Erro:', (err as Error).message);
    return NextResponse.json({ sucesso: false, erro: (err as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  const resultado = await processPendingEmissions();
  return NextResponse.json({ sucesso: true, ...resultado });
}
