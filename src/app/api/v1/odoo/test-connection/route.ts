/**
 * GET /api/v1/odoo/test-connection - Testa conexao com Odoo
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { testarConexao } from '@/lib/odoo-rpc';

export async function GET(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  const result = await testarConexao();
  return NextResponse.json(result, { status: result.sucesso ? 200 : 502 });
}
