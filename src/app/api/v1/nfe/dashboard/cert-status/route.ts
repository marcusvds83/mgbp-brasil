/**
 * GET /api/v1/nfe/dashboard/cert-status - Status do certificado A1
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { statusCertificado } from '@/lib/firebase-cert';

export async function GET(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  const status = await statusCertificado();
  return NextResponse.json(status);
}
