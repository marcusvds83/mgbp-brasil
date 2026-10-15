/**
 * GET /api/v1/nfe/dashboard - Dados do painel BI (KPIs + lista NF-e)
 * GET /api/v1/nfe/dashboard/cert-status - Status do certificado
 * GET /api/v1/nfe/dashboard/sefaz-status - Status conexao SEFAZ
 * GET /api/v1/nfe/dashboard/[id]/xml - Download XML de uma NF-e
 * GET /api/v1/nfe/dashboard/[id]/pdf - Gerar e baixar PDF DANFE
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { config, odooConfigured } from '@/lib/config';
import { search, read } from '@/lib/odoo-rpc';
import { statusCertificado } from '@/lib/firebase-cert';
import { statusServico } from '@/lib/sefaz-client';

// === Cache em memoria ===
let dashboardCache: { data: any; ts: number } | null = null;
const CACHE_TTL = 8000; // 8s

export async function GET(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  // Cache
  const now = Date.now();
  if (dashboardCache && (now - dashboardCache.ts) < CACHE_TTL) {
    return NextResponse.json(dashboardCache.data);
  }

  if (!odooConfigured()) {
    const data = {
      conectado_odoo: false,
      nfs: [],
      resumo: { total: 0, autorizadas: 0, pendentes: 0, erros: 0, canceladas: 0 },
    };
    dashboardCache = { data, ts: now };
    return NextResponse.json(data);
  }

  try {
    // Busca todas as NF-e dos ultimos 30 dias (max 100)
    const moveIds = await search('account.move', [
      ['move_type', '=', 'out_invoice'],
      ['x_mgbp_nfe_status', '!=', false],
    ], { limit: 100, order: 'create_date desc' });

    if (!moveIds.length) {
      const data = {
        conectado_odoo: true,
        nfs: [],
        resumo: { total: 0, autorizadas: 0, pendentes: 0, erros: 0, canceladas: 0 },
      };
      dashboardCache = { data, ts: now };
      return NextResponse.json(data);
    }

    const moves = await read<any>('account.move', moveIds, [
      'id', 'name', 'partner_id', 'invoice_date', 'amount_total',
      'x_mgbp_nfe_status', 'x_mgbp_nfe_chave', 'x_mgbp_nfe_protocolo',
      'x_mgbp_nfe_dh_emissao', 'x_mgbp_nfe_erro',
      'x_mgbp_nfe_tipo_operacao',
    ]);

    const nfs = moves.map((m: any) => ({
      id: m.id,
      name: m.name,
      partner: m.partner_id ? m.partner_id[1] : '',
      data: m.invoice_date || m.x_mgbp_nfe_dh_emissao || '',
      valor: m.amount_total || 0,
      status: m.x_mgbp_nfe_status || 'vazio',
      chave: m.x_mgbp_nfe_chave || '',
      protocolo: m.x_mgbp_nfe_protocolo || '',
      tipo_operacao: m.x_mgbp_nfe_tipo_operacao || 'venda',
      erro: m.x_mgbp_nfe_erro || '',
    }));

    const resumo = {
      total: nfs.length,
      autorizadas: nfs.filter((n: any) => n.status === 'autorizada').length,
      pendentes: nfs.filter((n: any) => ['pendente', 'processando'].includes(n.status)).length,
      erros: nfs.filter((n: any) => n.status === 'erro').length,
      canceladas: nfs.filter((n: any) => n.status === 'cancelada').length,
    };

    const data = {
      conectado_odoo: true,
      nfs,
      resumo,
      ambiente: config.nfe.tpAmb === '2' ? 'homologacao' : 'producao',
      uf: config.nfe.uf,
      regime: config.mgbp.regimeTributario,
      atualizado_em: new Date().toISOString(),
    };

    dashboardCache = { data, ts: now };
    return NextResponse.json(data);
  } catch (err) {
    console.error('[DASHBOARD] Erro:', (err as Error).message);
    return NextResponse.json({
      conectado_odoo: false,
      erro: (err as Error).message,
      nfs: [],
      resumo: { total: 0, autorizadas: 0, pendentes: 0, erros: 0, canceladas: 0 },
    });
  }
}
