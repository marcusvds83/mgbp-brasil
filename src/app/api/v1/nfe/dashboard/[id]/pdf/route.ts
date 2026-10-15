/**
 * GET /api/v1/nfe/dashboard/[id]/pdf - Gerar e baixar DANFE PDF
 *     ?api_key=KEY
 *
 * Gera o DANFE a partir do XML nfeProc autorizado (campo x_mgbp_nfe_xml no Odoo).
 * O layout segue o modelo oficial do DANFE (referência: NF 5515 da MGBP emitida pelo eDocs/Senior).
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyApiKey } from '@/lib/auth';
import { read } from '@/lib/odoo-rpc';
import { gerarPdfDanfe, DanfeData } from '@/lib/danfe-pdf';

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
    // Lê o XML autorizado do Odoo
    const moves = await read<any>('account.move', [moveId], [
      'name', 'partner_id', 'company_id', 'amount_total',
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

    // Helper: pega primeira ocorrência da tag
    function tag(name: string): string {
      const m = nfeXml.match(
        new RegExp('<' + name + '[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i')
      );
      return m ? m[1].trim() : '';
    }

    // Helper: tag dentro de um trecho XML específico
    function tagIn(xml: string, name: string): string {
      const m = xml.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i'));
      return m ? m[1].trim() : '';
    }

    // Helper: pega TODAS as ocorrências
    function tagAll(name: string, parentXml?: string): string[] {
      const xml = parentXml || nfeXml;
      const re = new RegExp('<' + name + '[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'gi');
      const out: string[] = [];
      let m;
      while ((m = re.exec(xml)) !== null) {
        out.push(m[1].trim());
      }
      return out;
    }

    // === Extrai dados do XML autorizado ===
    const chave = (nfeXml.match(/Id="(NFe\d{44})"/) || [])[1]?.slice(3) || move.x_mgbp_nfe_chave || '';
    const nNF = tag('nNF');
    const serie = tag('serie');
    const dhEmi = tag('dhEmi') || move.x_mgbp_nfe_dh_emissao || new Date().toISOString();
    const nProt = tag('nProt') || move.x_mgbp_nfe_protocolo;
    const dhRecBto = tag('dhRecBto');
    const natOp = tag('natOp');
    const tpNF = tag('tpNF') || '1';
    const infCpl = tag('infCpl');

    // Emitente
    const emitXml = nfeXml.match(/<emit>([\s\S]*?)<\/emit>/i)?.[1] || '';
    const emit = {
      nome: tagIn(emitXml, 'xNome') || tagIn(emitXml, 'xFant') || '',
      cnpj: tagIn(emitXml, 'CNPJ'),
      ie: tagIn(emitXml, 'IE'),
      iest: tagIn(emitXml, 'IEST'),
      im: tagIn(emitXml, 'IM'),
      endereco: tagIn(emitXml, 'xLgr'),
      numero: tagIn(emitXml, 'nro'),
      complemento: tagIn(emitXml, 'xCpl'),
      bairro: tagIn(emitXml, 'xBairro'),
      cidade: tagIn(emitXml, 'xMun'),
      uf: tagIn(emitXml, 'UF'),
      cep: tagIn(emitXml, 'CEP'),
      fone: tagIn(emitXml, 'fone'),
    };

    // Destinatário
    const destXml = nfeXml.match(/<dest>([\s\S]*?)<\/dest>/i)?.[1] || '';
    const dest = destXml ? {
      nome: tagIn(destXml, 'xNome'),
      cnpj: tagIn(destXml, 'CNPJ'),
      cpf: tagIn(destXml, 'CPF'),
      ie: tagIn(destXml, 'IE'),
      endereco: tagIn(destXml, 'xLgr'),
      numero: tagIn(destXml, 'nro'),
      complemento: tagIn(destXml, 'xCpl'),
      bairro: tagIn(destXml, 'xBairro'),
      cidade: tagIn(destXml, 'xMun'),
      uf: tagIn(destXml, 'UF'),
      cep: tagIn(destXml, 'CEP'),
      fone: tagIn(destXml, 'fone'),
    } : undefined;

    // Transportadora
    const transpXml = nfeXml.match(/<transp>([\s\S]*?)<\/transp>/i)?.[1] || '';
    const transportadora = transpXml ? {
      nome: tagIn(transpXml, 'xNome'),
      fretePorConta: tagIn(transpXml, 'modFrete') || '0',
      cnpj: tagIn(transpXml, 'CNPJ') || tagIn(transpXml, 'CPF'),
      ie: tagIn(transpXml, 'IE'),
      endereco: tagIn(transpXml, 'xEnder'),
      cidade: tagIn(transpXml, 'xMun'),
      uf: tagIn(transpXml, 'UF'),
      antt: tagIn(transpXml, 'RNTC'),
      placa: tagIn(transpXml, 'placa'),
      ufVeiculo: tagIn(transpXml, 'UF'),
      quantidade: tagIn(transpXml, 'qVol') ? parseFloat(tagIn(transpXml, 'qVol')) : undefined,
      especie: tagIn(transpXml, 'esp'),
      marca: tagIn(transpXml, 'marca'),
      numero: tagIn(transpXml, 'nVol'),
      pesoBruto: tagIn(transpXml, 'pesoB') ? parseFloat(tagIn(transpXml, 'pesoB')) : undefined,
      pesoLiquido: tagIn(transpXml, 'pesoL') ? parseFloat(tagIn(transpXml, 'pesoL')) : undefined,
    } : undefined;

    // Duplicatas
    const dupsXml = tagAll('dup');
    const duplicatas = dupsXml.map((dupXml) => {
      const dVenc = tagIn(dupXml, 'dVenc');
      let vencBR = dVenc;
      try {
        if (dVenc) {
          const d = new Date(dVenc);
          if (!isNaN(d.getTime())) {
            vencBR = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
          }
        }
      } catch {}
      return {
        numero: tagIn(dupXml, 'nDup'),
        vencimento: vencBR,
        valor: parseFloat(tagIn(dupXml, 'vDup') || '0'),
      };
    });

    // Totais
    const icmsTotXml = nfeXml.match(/<ICMSTot>([\s\S]*?)<\/ICMSTot>/i)?.[1] || '';
    const valOrNull = (s: string) => s ? parseFloat(s) : undefined;

    // Produtos
    const detXml = tagAll('det');
    const produtos = detXml.map((det) => {
      const prodXml = tagIn(det, 'prod');
      const impostoXml = tagIn(det, 'imposto');
      const icmsXml = impostoXml.match(/<ICMS>[\s\S]*?<\/ICMS>/i)?.[0] || '';
      const ipiXml = impostoXml.match(/<IPI>[\s\S]*?<\/IPI>/i)?.[0] || '';
      const icmsInner = icmsXml.match(/<ICMS\w+>([\s\S]*?)<\/ICMS\w+>/i)?.[1] || '';
      const ipiInner = ipiXml.match(/<IPITrib>([\s\S]*?)<\/IPITrib>/i)?.[1]
                    || ipiXml.match(/<IPINT>([\s\S]*?)<\/IPINT>/i)?.[1] || '';

      return {
        codProd: tagIn(prodXml, 'cProd'),
        descricao: tagIn(prodXml, 'xProd'),
        ncm: tagIn(prodXml, 'NCM'),
        cst: tagIn(icmsInner, 'CST') || tagIn(icmsInner, 'CSOSN') || '',
        cfop: tagIn(prodXml, 'CFOP'),
        unidade: tagIn(prodXml, 'uCom'),
        quantidade: parseFloat(tagIn(prodXml, 'qCom') || '0'),
        valorUnit: parseFloat(tagIn(prodXml, 'vUnCom') || '0'),
        valorTotal: parseFloat(tagIn(prodXml, 'vProd') || '0'),
        bcIcms: parseFloat(tagIn(icmsInner, 'vBC') || '0'),
        valorIcms: parseFloat(tagIn(icmsInner, 'vICMS') || '0'),
        valorIpi: parseFloat(tagIn(ipiInner, 'vIPI') || '0'),
        aliquotaIcms: parseFloat(tagIn(icmsInner, 'pICMS') || '0'),
        aliquotaIpi: parseFloat(tagIn(ipiInner, 'pIPI') || '0'),
      };
    });

    const danfeData: DanfeData = {
      chave,
      nNF,
      serie,
      dhEmi,
      folhaAtual: 1,
      folhaTotal: 1,
      tpNF,
      natOp,
      emit,
      dest,
      transportadora,
      duplicatas,
      vProd: valOrNull(tagIn(icmsTotXml, 'vProd')),
      vFrete: valOrNull(tagIn(icmsTotXml, 'vFrete')),
      vSeg: valOrNull(tagIn(icmsTotXml, 'vSeg')),
      vDesc: valOrNull(tagIn(icmsTotXml, 'vDesc')),
      vOutro: valOrNull(tagIn(icmsTotXml, 'vOutro')),
      vIPI: valOrNull(tagIn(icmsTotXml, 'vIPI')),
      vNF: valOrNull(tagIn(icmsTotXml, 'vNF')) || move.amount_total,
      vBC: valOrNull(tagIn(icmsTotXml, 'vBC')),
      vICMS: valOrNull(tagIn(icmsTotXml, 'vICMS')),
      vBCST: valOrNull(tagIn(icmsTotXml, 'vBCST')),
      vST: valOrNull(tagIn(icmsTotXml, 'vST')),
      vTotTrib: valOrNull(tagIn(icmsTotXml, 'vTotTrib')),
      produtos,
      protocolo: nProt,
      dhAutorizacao: dhRecBto || dhEmi,
      infCpl,
      infCplFisco: nfeXml.match(/<infAdFisco>([\s\S]*?)<\/infAdFisco>/i)?.[1] || '',
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
