/**
 * GET /api/v1/health - Health check do middleware NF-e MGBP Brasil
 * GET /api/v1/health?keepalive=1 - Tambem processa NF-e pendentes (mantem o Render acordado)
 */

import { NextRequest, NextResponse } from 'next/server';
import { config, odooConfigured, firebaseConfigured } from '@/lib/config';

export async function GET(req: NextRequest) {
  const keepalive = req.nextUrl.searchParams.get('keepalive') === '1';

  let pollingResult = null;
  if (keepalive && odooConfigured()) {
    try {
      const { processPendingEmissions } = await import('@/lib/nfe-emit');
      pollingResult = await processPendingEmissions();
    } catch (e) {
      console.error('[HEALTH-KEEPALIVE] Erro polling:', (e as Error).message);
    }
  }

  return NextResponse.json({
    servico: 'mgbp-brasil-middleware',
    versao: '1.0.0',
    ambiente: config.nodeEnv,
    timestamp: new Date().toISOString(),
    odoo: {
      url: config.odoo.url,
      db: config.odoo.db,
      user: config.odoo.user,
      enabled: odooConfigured(),
    },
    firebase: {
      project_id: config.firebase.projectId,
      configurado: firebaseConfigured(),
    },
    nfe: {
      modo: config.nfe.modo,
      uf: config.nfe.uf,
      tp_amb: config.nfe.tpAmb === '2' ? 'homologacao' : 'producao',
      regime: config.mgbp.regimeTributario,
    },
    ...(keepalive && pollingResult ? { keepalive: pollingResult } : {}),
  });
}
