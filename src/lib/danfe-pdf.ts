/**
 * src/lib/danfe-pdf.ts - Gerador de DANFE (PDF) para NF-e MGBP Brasil
 * =====================================================================
 * Usa PDFKit para gerar o Documento Auxiliar de NF-e (DANFE) localmente.
 * Layout base: modelo oficial A4 retrato (1 pagina por nota simples).
 */

import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';

export interface DanfeData {
  chave: string;
  nNF: string;
  serie: string;
  dhEmi: string;
  emit: {
    nome: string;
    cnpj: string;
    ie?: string;
    endereco?: string;
    cidade?: string;
    uf?: string;
    cep?: string;
    fone?: string;
  };
  dest?: {
    nome: string;
    cnpj?: string;
    cpf?: string;
    endereco?: string;
    cidade?: string;
    uf?: string;
    cep?: string;
    fone?: string;
  };
  valorTotal: number;
  produtos: Array<{
    codProd: string;
    descricao: string;
    ncm: string;
    cfop: string;
    unidade: string;
    quantidade: number;
    valorUnit: number;
    valorTotal: number;
  }>;
  protocolo?: string;
  dhAutorizacao?: string;
  infCpl?: string;
}

/** Gera o PDF DANFE em Buffer. */
export async function gerarPdfDanfe(data: DanfeData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 20 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // === CABECALHO ===
      const pageWidth = 595; // A4 largura em pontos
      const margin = 20;
      const colWidth = (pageWidth - margin * 2) / 4;

      // Logo placeholder (caixa com nome da empresa)
      doc.rect(margin, margin, colWidth * 1.2, 80).stroke();
      doc.fontSize(8).font('Helvetica-Bold');
      doc.text(data.emit.nome.toUpperCase(), margin + 4, margin + 4, { width: colWidth * 1.2 - 8 });
      doc.font('Helvetica').fontSize(7);
      doc.text(`CNPJ: ${data.emit.cnpj}`, margin + 4, margin + 22, { width: colWidth * 1.2 - 8 });
      if (data.emit.ie) doc.text(`IE: ${data.emit.ie}`, margin + 4, margin + 34, { width: colWidth * 1.2 - 8 });
      if (data.emit.endereco) {
        doc.text(data.emit.endereco, margin + 4, margin + 46, { width: colWidth * 1.2 - 8, height: 30 });
      }

      // Titulo DANFE
      doc.fontSize(20).font('Helvetica-Bold');
      doc.text('DANFE', colWidth * 1.2 + margin + 5, margin + 8, { width: colWidth * 1.2, align: 'center' });
      doc.fontSize(8).font('Helvetica');
      doc.text('Documento Auxiliar da NF-e', colWidth * 1.2 + margin + 5, margin + 32, { width: colWidth * 1.2, align: 'center' });

      // Numeracao
      doc.fontSize(9).font('Helvetica-Bold');
      doc.text(`N. ${data.nNF}`, colWidth * 2.4 + margin + 5, margin + 10, { width: colWidth * 1.5 - 10, align: 'center' });
      doc.font('Helvetica').fontSize(8);
      doc.text(`Serie: ${data.serie}`, colWidth * 2.4 + margin + 5, margin + 25, { width: colWidth * 1.5 - 10, align: 'center' });
      doc.text(`Emissao: ${formatDate(data.dhEmi)}`, colWidth * 2.4 + margin + 5, margin + 40, { width: colWidth * 1.5 - 10, align: 'center' });

      // Linha separadora
      doc.moveTo(margin, margin + 100).lineTo(pageWidth - margin, margin + 100).stroke();

      // === CHAVE DE ACESSO + BARCODE ===
      doc.fontSize(8).font('Helvetica-Bold');
      doc.text('Chave de Acesso:', margin, margin + 105, { width: pageWidth - margin * 2 });
      doc.font('Courier-Bold').fontSize(10);
      const chaveFormatada = data.chave.match(/.{1,4}/g)?.join(' ') || data.chave;
      doc.text(chaveFormatada, margin, margin + 120, { width: pageWidth - margin * 2 });

      // Barcode (Code128C)
      try {
        const png = bwipjs.toBuffer({
          bcid: 'code128',
          text: data.chave,
          scale: 2,
          height: 12,
          includetext: false,
        });
        doc.image(png, pageWidth / 2 - 150, margin + 138, { width: 300, height: 40 });
      } catch (e) {
        console.warn('[DANFE-PDF] Falha ao gerar barcode:', (e as Error).message);
      }

      // Protocolo de autorizacao
      doc.font('Helvetica-Bold').fontSize(8);
      doc.text('Protocolo de Autorizacao:', margin, margin + 185);
      doc.font('Helvetica').fontSize(9);
      doc.text(
        data.protocolo
          ? `${data.protocolo} - ${formatDate(data.dhAutorizacao || data.dhEmi)}`
          : 'SEM AUTORIZACAO',
        margin + 110, margin + 185
      );

      // Linha separadora
      doc.moveTo(margin, margin + 200).lineTo(pageWidth - margin, margin + 200).stroke();

      // === DESTINATARIO ===
      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('DESTINATARIO / REMETENTE', margin, margin + 205);

      if (data.dest) {
        doc.font('Helvetica').fontSize(8);
        let y = margin + 220;
        const colW = (pageWidth - margin * 2) / 3;

        // Nome / CNPJ / Data emissao
        doc.font('Helvetica-Bold').text('Nome / Razao Social:', margin, y);
        doc.font('Helvetica').text(data.dest.nome, margin + 100, y, { width: colW * 1.5 });
        doc.font('Helvetica-Bold').text('CNPJ / CPF:', margin + colW * 2, y);
        doc.font('Helvetica').text(
          data.dest.cnpj || data.dest.cpf || '',
          margin + colW * 2 + 60, y
        );

        y += 15;
        doc.font('Helvetica-Bold').text('Endereco:', margin, y);
        doc.font('Helvetica').text(data.dest.endereco || '-', margin + 60, y, { width: colW * 2 });
        doc.font('Helvetica-Bold').text('CEP:', margin + colW * 2, y);
        doc.font('Helvetica').text(data.dest.cep || '', margin + colW * 2 + 30, y);

        y += 15;
        doc.font('Helvetica-Bold').text('Municipio:', margin, y);
        doc.font('Helvetica').text(data.dest.cidade || '-', margin + 60, y, { width: colW });
        doc.font('Helvetica-Bold').text('UF:', margin + colW + 60, y);
        doc.font('Helvetica').text(data.dest.uf || '', margin + colW + 80, y);
        doc.font('Helvetica-Bold').text('Fone:', margin + colW * 2, y);
        doc.font('Helvetica').text(data.dest.fone || '', margin + colW * 2 + 30, y);
      }

      // Linha separadora
      doc.moveTo(margin, margin + 260).lineTo(pageWidth - margin, margin + 260).stroke();

      // === FATURA ===
      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('FATURA / DUPLICATAS', margin, margin + 265);

      // Linha separadora
      doc.moveTo(margin, margin + 285).lineTo(pageWidth - margin, margin + 285).stroke();

      // === ITENS ===
      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('CALCULO DO IMPOSTO', margin, margin + 290);

      // Cabecalho dos itens
      let yItens = margin + 310;
      doc.rect(margin, yItens, pageWidth - margin * 2, 20).stroke();
      doc.fontSize(7).font('Helvetica-Bold');
      const colHeaders = [
        { label: 'COD. PROD', x: margin + 4, w: 80 },
        { label: 'DESCRICAO', x: margin + 86, w: 200 },
        { label: 'NCM/SH', x: margin + 290, w: 60 },
        { label: 'CFOP', x: margin + 354, w: 40 },
        { label: 'UN', x: margin + 398, w: 30 },
        { label: 'QTD', x: margin + 432, w: 50 },
        { label: 'V.UNIT', x: margin + 486, w: 50 },
        { label: 'V.TOT', x: margin + 540, w: 60 },
      ];
      for (const h of colHeaders) {
        doc.text(h.label, h.x, yItens + 5, { width: h.w });
      }
      yItens += 20;

      // Itens
      doc.font('Helvetica').fontSize(6);
      const maxItens = Math.min(data.produtos.length, 15);
      for (let i = 0; i < maxItens; i++) {
        const p = data.produtos[i];
        if (yItens > 700) {
          doc.addPage();
          yItens = margin;
        }
        doc.text(p.codProd, colHeaders[0].x, yItens, { width: colHeaders[0].w });
        doc.text(p.descricao.substring(0, 70), colHeaders[1].x, yItens, { width: colHeaders[1].w });
        doc.text(p.ncm, colHeaders[2].x, yItens, { width: colHeaders[2].w });
        doc.text(p.cfop, colHeaders[3].x, yItens, { width: colHeaders[3].w });
        doc.text(p.unidade, colHeaders[4].x, yItens, { width: colHeaders[4].w });
        doc.text(p.quantidade.toFixed(3), colHeaders[5].x, yItens, { width: colHeaders[5].w });
        doc.text(`R$ ${p.valorUnit.toFixed(2)}`, colHeaders[6].x, yItens, { width: colHeaders[6].w });
        doc.text(`R$ ${p.valorTotal.toFixed(2)}`, colHeaders[7].x, yItens, { width: colHeaders[7].w });
        yItens += 12;
      }

      // Linha separadora
      doc.moveTo(margin, yItens + 2).lineTo(pageWidth - margin, yItens + 2).stroke();

      // === TOTAIS ===
      yItens += 8;
      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('VALOR TOTAL DA NOTA:', pageWidth - margin - 200, yItens, { width: 150, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(11);
      doc.text(`R$ ${data.valorTotal.toFixed(2)}`, pageWidth - margin - 60, yItens, { width: 60 });

      // === INFORMACOES ADICIONAIS ===
      yItens += 25;
      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('INFORMACOES COMPLEMENTARES', margin, yItens);
      yItens += 15;
      doc.font('Helvetica').fontSize(7);
      doc.text(
        data.infCpl || 'Sem informacoes complementares.',
        margin, yItens, { width: pageWidth - margin * 2, height: 50 }
      );

      // === RODAPE ===
      doc.fontSize(7).font('Helvetica');
      doc.text(
        `DANFE gerado por NFE-MGBP-Brasil em ${new Date().toLocaleString('pt-BR')}`,
        margin, 800, { width: pageWidth - margin * 2, align: 'center' }
      );

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

/** Formata data ISO para dd/mm/yyyy hh:mm. */
function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch {
    return iso;
  }
}
