/**
 * GET /api/v1/nfe/dashboard/[id]/pdf - Gerar e baixar DANFE PDF
 *     ?api_key=KEY
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { read } from '@/lib/odoo-rpc';
import { gerarPdfDanfe } from '@/lib/danfe-pdf';
import { carregarCertificado } from '@/lib/firebase-cert';

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
    // Le dados da fatura
    const moves = await read<any>('account.move', [moveId], [
      'name', 'partner_id', 'company_id', 'amount_total', 'invoice_line_ids',
      'x_mgbp_nfe_chave', 'x_mgbp_nfe_protocolo',
      'x_mgbp_nfe_dh_emissao', 'x_mgbp_nfe_xml',
    ]);
    if (!moves || !moves.length) {
      return NextResponse.json({ erro: 'Fatura nao encontrada' }, { status: 404 });
    }
    const move = moves[0];
    const nfeXml = move.x_mgbp_nfe_xml;
    if (!nfeXml) {
      return NextResponse.json({ erro: 'XML NF-e nao disponivel para gerar DANFE' }, { status: 404 });
    }

    // Le linhas e produtos
    const lines = await read<any>('account.move.line', move.invoice_line_ids || [], [
      'name', 'quantity', 'price_unit', 'price_subtotal', 'product_id',
    ]);
    const lineData = lines.filter((l: any) => l.price_subtotal > 0);

    const productIds = lineData.map((l: any) => l.product_id?.[0]).filter(Boolean);
    const products = productIds.length
      ? await read<any>('product.product', productIds, ['name', 'default_code'])
      : [];
    const productMap: any = {};
    products.forEach((p: any) => { productMap[p.id] = p; });

    // Le empresa e parceiro para dados do DANFE
    const [company] = await read<any>('res.company', [move.company_id[0]], ['name', 'vat', 'street', 'city', 'state_id', 'zip', 'phone']);
    const [partner] = await read<any>('res.partner', [move.partner_id[0]], ['name', 'vat', 'street', 'city', 'state_id', 'zip', 'phone']);

    // Extrai dados do XML para o DANFE
    const tag = (name: string): string => {
      const m = nfeXml.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i'));
      return m ? m[1].trim() : '';
    };

    const chave = (nfeXml.match(/Id="(NFe\d{44})"/) || [])[1]?.slice(3) || move.x_mgbp_nfe_chave || '';
    const nNF = tag('nNF') || String(move.id);
    const serie = tag('serie') || '1';
    const dhEmi = tag('dhEmi') || move.x_mgbp_nfe_dh_emissao || new Date().toISOString();

    const danfeData = {
      chave,
      nNF,
      serie,
      dhEmi,
      emit: {
        nome: company.name,
        cnpj: company.vat || '',
        ie: '',
        endereco: company.street,
        cidade: company.city,
        uf: company.state_id ? company.state_id[1] : '',
        cep: company.zip,
        fone: company.phone,
      },
      dest: {
        nome: partner.name,
        cnpj: partner.vat,
        endereco: partner.street,
        cidade: partner.city,
        uf: partner.state_id ? partner.state_id[1] : '',
        cep: partner.zip,
        fone: partner.phone,
      },
      valorTotal: move.amount_total,
      produtos: lineData.map((l: any, i: number) => {
        const prod = l.product_id ? productMap[l.product_id[0]] : null;
        return {
          codProd: prod?.default_code || String(i + 1),
          descricao: prod?.name || l.name || 'Produto',
          ncm: tag('NCM') || '',
          cfop: tag('CFOP') || '',
          unidade: 'UND',
          quantidade: l.quantity,
          valorUnit: l.price_unit,
          valorTotal: l.price_subtotal,
        };
      }),
      protocolo: move.x_mgbp_nfe_protocolo || tag('nProt'),
      dhAutorizacao: tag('dhRecBto') || dhEmi,
      infCpl: tag('infCpl'),
    };

    const pdfBuf = await gerarPdfDanfe(danfeData);

    const pdfNome = `DANFE-${String(nNF).padStart(6, '0')}.pdf`;
    return new NextResponse(new Uint8Array(pdfBuf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${pdfNome}"`,
        'Content-Length': String(pdfBuf.length),
      },
    });
  } catch (err) {
    console.error('[PDF-DOWN] Erro:', (err as Error).message);
    return NextResponse.json({ erro: (err as Error).message }, { status: 500 });
  }
}
