/**
 * src/lib/auth.ts - Middleware de autenticacao via API Key
 * =======================================================
 * Todas as rotas /api/v1/* exigem o header x-api-key (ou query api_key para
 * download de arquivos no navegador).
 */

import { NextRequest, NextResponse } from 'next/server';
import { config } from './config';

/** Verifica se a requisicao tem API Key valida. */
export function verifyApiKey(req: NextRequest): NextResponse | null {
  const key =
    req.headers.get('x-api-key') ||
    req.nextUrl.searchParams.get('api_key') ||
    '';

  // Em desenvolvimento sem API_KEY configurada, libera
  if (!config.apiKey && config.nodeEnv === 'development') {
    return null;
  }

  if (!key || key !== config.apiKey) {
    return NextResponse.json(
      { erro: 'API Key invalida ou nao informada. Envie o header x-api-key.' },
      { status: 401 }
    );
  }
  return null;
}
