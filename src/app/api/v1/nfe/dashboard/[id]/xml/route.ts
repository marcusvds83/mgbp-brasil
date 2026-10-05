/**
 * GET /api/v1/nfe/dashboard/[id]/xml - Download XML nfeProc de uma NF-e
 *     ?api_key=KEY&origem=odoo|firebase
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { read } from '@/lib/odoo-rpc';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = verifyApiKey(req);
  if (auth) return auth;

  const { id } = await params;
  const moveId = parseInt(id, 10);

  if (!moveId) {
    return NextResponse.json({ erro: 'id invalido' }, { status: 400 });
  }

  try {
    const moves = await read<any>('account.move', [moveId], [
      'name', 'x_mgbp_nfe_chave', 'x_mgbp_nfe_xml',
    ]);
    if (!moves || !moves.length) {
      return NextResponse.json({ erro: 'Fatura nao encontrada' }, { status: 404 });
    }
    const move = moves[0];
    if (!move.x_mgbp_nfe_xml) {
      return NextResponse.json({ erro: 'XML nao disponivel para esta fatura' }, { status: 404 });
    }

    const chave = move.x_mgbp_nfe_chave || moveId;
    const xmlContent = move.x_mgbp_nfe_xml;
    const xmlNome = `NFe-${chave}.xml`;

    return new NextResponse(xmlContent, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${xmlNome}"`,
      },
    });
  } catch (err) {
    console.error('[XML-DOWN] Erro:', (err as Error).message);
    return NextResponse.json({ erro: (err as Error).message }, { status: 500 });
  }
}
