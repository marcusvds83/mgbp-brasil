import { NextResponse } from 'next/server';

/**
 * GET /admin - Redireciona para a pagina principal do painel.
 * Mantido por compatibilidade com o padrao do AJL/Accel.
 * 
 * Usa redirect RELATIVO (Location: /) para funcionar em qualquer host:
 * - O navegador resolve automaticamente para o dominio atual
 * - Funciona em producao (Render) e desenvolvimento (localhost)
 * - Nao depende de headers Host/Origin (que podem estar errados em proxy)
 */

export async function GET() {
  // Redirect simples e robusto: so o caminho relativo "/"
  // O navegador resolve para https://mgbp-brasil-middleware.onrender.com/ automaticamente
  return new NextResponse(null, {
    status: 302,
    headers: {
      'Location': '/',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
