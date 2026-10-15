/**
 * POST /api/v1/nfe/emitir - Emitir NF-e por move_id
 *     Body: { move_id: number }
 * Sem move_id: processa todos pendentes
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { processPendingEmissions, emitirNfeOdoo } from '@/lib/nfe-emit';

export async function POST(req: NextRequest) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  const t0 = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const { move_id } = body;

    if (move_id) {
      console.log(`[NFE-API] Emitir solicitado para move_id=${move_id}`);
      const resultado = await emitirNfeOdoo(move_id);
      return NextResponse.json({
        sucesso: resultado.sucesso,
        chave: resultado.chave,
        protocolo: resultado.protocolo,
        cStat: resultado.cStat,
        xMotivo: resultado.xMotivo,
        erro: resultado.erro,
        duracao_ms: Date.now() - t0,
      });
    }

    console.log('[NFE-API] Processar pendentes (sem move_id)');
    const resultado = await processPendingEmissions();
    return NextResponse.json({
      sucesso: true,
      processadas: resultado.processed,
      autorizadas: resultado.sucesso,
      erros: resultado.erro,
      detalhes: resultado.detalhes,
      duracao_ms: Date.now() - t0,
    });
  } catch (err) {
    console.error('[NFE-API] Erro:', (err as Error).message);
    return NextResponse.json(
      { sucesso: false, erro: (err as Error).message, duracao_ms: Date.now() - t0 },
      { status: 500 }
    );
  }
}
