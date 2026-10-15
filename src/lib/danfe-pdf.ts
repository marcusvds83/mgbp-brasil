/**
 * src/lib/danfe-pdf.ts - Gerador de DANFE (PDF) para NF-e MGBP Brasil
 * =====================================================================
 * Layout fiel ao DANFE oficial emitido pelo eDocs/Senior.
 * A4 retrato (595x842 pts), 1 página, fonte Helvetica compacta.
 *
 * Estrutura vertical (de cima para baixo), todas as alturas em pts:
 *   1. RECEBEMOS (28) + NF-e + número + série
 *   2. Cabeçalho (110): logo + nome empresa + DANFE + barcode + chave + nº/serie/folha
 *   3. Natureza operação + protocolo (20)
 *   4. IE emitente + IEST + CNPJ (14)
 *   5. DESTINATÁRIO (52): 3 linhas com nome/cnpj/data, end/bairro/cep, munic/fone/uf/ie/hora
 *   6. FATURA/DUPLICATAS (28)
 *   7. CÁLCULO IMPOSTO (32): 2 linhas x 6 colunas
 *   8. TRANSPORTADOR (38): 3 linhas x 6 colunas
 *   9. ISSQN (14)
 *  10. DADOS DOS PRODUTOS (80): cabeçalho + itens
 *  11. DADOS ADICIONAIS (80): info compl + fisco
 *  12. Rodapé
 * Total: ~600 pts + margens = 1 página A4
 */

import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import { carregarLogo } from './firebase-config';

export interface DanfeProduto {
  codProd: string;
  descricao: string;
  ncm: string;
  cst: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnit: number;
  valorTotal: number;
  bcIcms: number;
  valorIcms: number;
  valorIpi: number;
  aliquotaIcms: number;
  aliquotaIpi: number;
}

export interface DanfeDuplicata {
  numero: string;
  vencimento: string;
  valor: number;
}

export interface DanfeEndereco {
  nome: string;
  cnpj?: string;
  cpf?: string;
  ie?: string;
  iest?: string;
  im?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  fone?: string;
  pais?: string;
}

export interface DanfeTransportadora {
  nome?: string;
  fretePorConta?: string;
  cnpj?: string;
  ie?: string;
  endereco?: string;
  cidade?: string;
  uf?: string;
  antt?: string;
  placa?: string;
  ufVeiculo?: string;
  quantidade?: number;
  especie?: string;
  marca?: string;
  numero?: string;
  pesoBruto?: number;
  pesoLiquido?: number;
}

export interface DanfeData {
  chave: string;
  nNF: string;
  serie: string;
  dhEmi: string;
  folhaAtual: number;
  folhaTotal: number;
  tpNF: string;
  natOp: string;
  emit: DanfeEndereco;
  dest?: DanfeEndereco;
  transportadora?: DanfeTransportadora;
  duplicatas?: DanfeDuplicata[];
  vProd?: number;
  vFrete?: number;
  vSeg?: number;
  vDesc?: number;
  vOutro?: number;
  vIPI?: number;
  vNF?: number;
  vBC?: number;
  vICMS?: number;
  vBCST?: number;
  vST?: number;
  vTotTrib?: number;
  produtos: DanfeProduto[];
  protocolo?: string;
  dhAutorizacao?: string;
  mensagemConsulta?: string;
  infCpl?: string;
  infCplFisco?: string;
  origem?: string;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 5;

const FONT_BOLD = 'Helvetica-Bold';
const FONT_REG = 'Helvetica';

/** Gera o PDF DANFE em Buffer - layout compacto em 1 página. */
export async function gerarPdfDanfe(data: DanfeData): Promise<Buffer> {
  const logoData = await carregarLogo();
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: [PAGE_W, PAGE_H],
        margin: MARGIN,
        info: {
          Title: `DANFE ${data.nNF}/${data.serie}`,
          Author: 'MGBP NF-e Middleware',
          Subject: `DANFE NF-e ${data.chave}`,
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      let y = MARGIN;
      const w = PAGE_W - 2 * MARGIN;
      const BORDER = '#000000';

      // Helper para desenhar bloco com borda + linhas verticais + labels + valores
      const drawCell = (
        x: number, yTop: number, cellW: number, cellH: number,
        label: string, value: string,
        opts: { labelFont?: typeof FONT_BOLD; valFont?: typeof FONT_BOLD; labelSize?: number; valSize?: number; align?: 'left' | 'right' | 'center'; multiline?: boolean } = {}
      ) => {
        const lf = opts.labelFont || FONT_REG;
        const vf = opts.valFont || FONT_BOLD;
        const ls = opts.labelSize || 5;
        const vs = opts.valSize || 7;
        const align = opts.align || 'left';
        doc.font(lf).fontSize(ls);
        doc.text(label, x + 1, yTop + 1, { width: cellW - 2, height: 7, align: 'left' });
        doc.font(vf).fontSize(vs);
        const valY = yTop + 7;
        const valH = cellH - 8;
        if (opts.multiline) {
          doc.text(value, x + 1, valY, { width: cellW - 2, height: valH, align: 'left' });
        } else {
          doc.text(value, x + 1, valY, { width: cellW - 2, height: valH, align });
        }
      };

      // Helper para divisórias verticais dentro de um bloco
      const vDividers = (x: number, yTop: number, yBottom: number, xs: number[]) => {
        for (const px of xs) {
          doc.moveTo(x + px, yTop).lineTo(x + px, yBottom).stroke(BORDER);
        }
      };

      // Helper para divisória horizontal
      const hDivider = (x: number, y: number, w: number) => {
        doc.moveTo(x, y).lineTo(x + w, y).stroke(BORDER);
      };

      // ============================================================
      // BLOCO 1: RECEBEMOS + NF-e + NUMERO + SERIE (28 pts)
      // ============================================================
      const h1 = 28;
      doc.rect(MARGIN, y, w, h1).stroke(BORDER);
      const w1a = w * 0.78; // RECEBEMOS
      const w1b = 22; // NF-e
      // Linha vertical
      doc.moveTo(MARGIN + w1a, y).lineTo(MARGIN + w1a, y + h1).stroke(BORDER);
      doc.moveTo(MARGIN + w1a + w1b, y).lineTo(MARGIN + w1a + w1b, y + h1).stroke(BORDER);

      // RECEBEMOS
      doc.font(FONT_REG).fontSize(5);
      doc.text('RECEBEMOS OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO DE:',
        MARGIN + 2, y + 2, { width: w1a - 4, height: 8 });
      doc.font(FONT_BOLD).fontSize(6);
      doc.text((data.emit.nome || '').toUpperCase(), MARGIN + 2, y + 11, { width: w1a - 4, height: 10 });
      doc.font(FONT_REG).fontSize(5);
      doc.text('DATA DE RECEBIMENTO', MARGIN + 2, y + 22, { width: w1a - 4, height: 5 });
      doc.text('IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR', MARGIN + 80, y + 22, { width: w1a - 80, height: 5 });

      // NF-e
      doc.font(FONT_BOLD).fontSize(9);
      doc.text('NF-e', MARGIN + w1a + 2, y + 4, { width: w1b - 4, align: 'center' });

      // NÚMERO + SÉRIE
      doc.font(FONT_REG).fontSize(5);
      doc.text('NÚMERO', MARGIN + w1a + w1b + 2, y + 3, { width: 60, height: 6 });
      doc.font(FONT_BOLD).fontSize(11);
      doc.text(String(data.nNF || '').padStart(6, '0'), MARGIN + w1a + w1b + 2, y + 9, { width: 60, align: 'left' });
      doc.font(FONT_REG).fontSize(5);
      doc.text('SÉRIE', MARGIN + w1a + w1b + 75, y + 3, { width: 30, height: 6 });
      doc.font(FONT_BOLD).fontSize(11);
      doc.text(String(data.serie || ''), MARGIN + w1a + w1b + 75, y + 9, { width: 30, align: 'right' });

      y += h1;

      // ============================================================
      // BLOCO 2: LOGO + DANFE + CHAVE ACESSO (110 pts)
      // ============================================================
      const h2 = 110;
      doc.rect(MARGIN, y, w, h2).stroke(BORDER);
      // 3 colunas: emitente (esq) | DANFE (centro) | chave (dir)
      const col2A = 220;
      const col2B = 90;
      const col2C = w - col2A - col2B;
      doc.moveTo(MARGIN + col2A, y).lineTo(MARGIN + col2A, y + h2).stroke(BORDER);
      doc.moveTo(MARGIN + col2A + col2B, y).lineTo(MARGIN + col2A + col2B, y + h2).stroke(BORDER);

      // === Coluna esquerda: LOGO + dados emitente ===
      // Logo: tamanho menor (máx 80x30 pts)
      const logoBoxH = 30;
      const logoBoxW = 120;
      if (logoData && logoData.buffer) {
        try {
          doc.image(logoData.buffer, MARGIN + 4, y + 2, {
            fit: [logoBoxW, logoBoxH],
            align: 'left',
            valign: 'top',
          });
        } catch (e) { /* fallback abaixo */ }
      }
      // Nome empresa abaixo do logo
      doc.font(FONT_BOLD).fontSize(7);
      doc.text((data.emit.nome || '').toUpperCase(),
        MARGIN + 2, y + 36, { width: col2A - 4, height: 12 });

      // Endereço
      const endParts: string[] = [];
      if (data.emit.endereco) {
        const n = data.emit.numero ? `, ${data.emit.numero}` : '';
        const c = data.emit.complemento ? ` - ${data.emit.complemento}` : '';
        endParts.push(`${data.emit.endereco}${n}${c}`);
      }
      if (data.emit.bairro) endParts.push(data.emit.bairro);
      doc.font(FONT_REG).fontSize(6);
      doc.text(endParts.join(' - '), MARGIN + 2, y + 50, { width: col2A - 4, height: 8 });

      // Cidade/UF/CEP
      const cidadeUfCep: string[] = [];
      if (data.emit.cidade) cidadeUfCep.push(`${data.emit.cidade} - ${data.emit.uf || ''}`);
      if (data.emit.cep) cidadeUfCep.push(`CEP ${formatCep(data.emit.cep)}`);
      doc.text(cidadeUfCep.join('  '), MARGIN + 2, y + 60, { width: col2A - 4, height: 8 });

      // CNPJ/IE/IM
      const docs: string[] = [];
      if (data.emit.cnpj) docs.push(`CNPJ: ${formatCnpj(data.emit.cnpj)}`);
      if (data.emit.ie) docs.push(`IE: ${data.emit.ie}`);
      if (data.emit.im) docs.push(`IM: ${data.emit.im}`);
      doc.font(FONT_REG).fontSize(6);
      doc.text(docs.join('  '), MARGIN + 2, y + 72, { width: col2A - 4, height: 8 });

      // Fone
      if (data.emit.fone) {
        doc.text(`FONE: ${formatFone(data.emit.fone)}`, MARGIN + 2, y + 84, { width: col2A - 4, height: 8 });
      }

      // === Coluna centro: DANFE + 0/1 + Nº + SÉRIE + FOLHA ===
      const cx = MARGIN + col2A + 2;
      doc.font(FONT_BOLD).fontSize(14);
      doc.text('DANFE', cx, y + 4, { width: col2B - 4, align: 'center', lineBreak: false });
      doc.font(FONT_BOLD).fontSize(6);
      doc.text('DOCUMENTO AUXILIAR DA', cx, y + 22, { width: col2B - 4, align: 'center', lineBreak: false });
      doc.text('NOTA FISCAL ELETRÔNICA', cx, y + 28, { width: col2B - 4, align: 'center', lineBreak: false });

      // 0-ENTRADA / 1-SAÍDA com X marcando a opção correta
      const tpNF = String(data.tpNF || '1');
      // Desenha 'X' dentro de cada opção (vazio para não selecionada)
      doc.font(FONT_REG).fontSize(6);
      // Opção 0 (Entrada)
      doc.text('[ ]', cx + 4, y + 40, { width: 12, lineBreak: false });
      doc.text('0-ENTRADA', cx + 16, y + 40, { width: col2B - 20, lineBreak: false });
      // Opção 1 (Saída)
      doc.text('[ ]', cx + 4, y + 48, { width: 12, lineBreak: false });
      doc.text('1-SAÍDA', cx + 16, y + 48, { width: col2B - 20, lineBreak: false });
      // Marca X dentro da opção selecionada
      doc.font(FONT_BOLD).fontSize(7);
      const selX = cx + 5;
      const selY = tpNF === '0' ? y + 41 : y + 49;
      doc.text('X', selX, selY, { width: 10, lineBreak: false });

      // === Coluna direita: CHAVE ACESSO + barcode + consulta ===
      const dx = MARGIN + col2A + col2B + 2;
      const dw = col2C - 4;
      doc.font(FONT_REG).fontSize(5);
      doc.text('CHAVE DE ACESSO', dx, y + 2, { width: dw, align: 'left' });

      // Chave formatada em 4 grupos de 11 dígitos
      const chaveFmt = String(data.chave || '').match(/.{1,4}/g)?.join(' ') || '';
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(chaveFmt, dx, y + 9, { width: dw, height: 8, align: 'center' });

      // Barcode
      try {
        const png = bwipjs.toBuffer({
          bcid: 'code128',
          text: String(data.chave || ''),
          scale: 1.5,
          height: 28,
          includetext: false,
        });
        const barW = Math.min(220, dw);
        doc.image(png, dx + (dw - barW) / 2, y + 20, { width: barW, height: 28 });
      } catch (e) {
        console.warn('[DANFE-PDF] Falha barcode:', (e as Error).message);
      }

      // Mensagem consulta autenticidade
      doc.font(FONT_REG).fontSize(4.5);
      doc.text('Consulta de autenticidade no portal nacional da NF-e',
        dx, y + 52, { width: dw, height: 5, align: 'left' });
      doc.text('www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizada',
        dx, y + 57, { width: dw, height: 5, align: 'left' });

      // Nº + SÉRIE + FOLHA
      doc.font(FONT_REG).fontSize(5);
      doc.text('Nº', dx, y + 68, { width: 15 });
      doc.font(FONT_BOLD).fontSize(11);
      doc.text(String(data.nNF || '').padStart(6, '0'), dx + 18, y + 65, { width: 70, align: 'right' });

      doc.font(FONT_REG).fontSize(5);
      doc.text('SÉRIE', dx + 90, y + 68, { width: 25 });
      doc.font(FONT_BOLD).fontSize(11);
      doc.text(String(data.serie || ''), dx + 115, y + 65, { width: 35, align: 'right' });

      doc.font(FONT_REG).fontSize(5);
      doc.text('FOLHA', dx, y + 90, { width: 25 });
      doc.font(FONT_BOLD).fontSize(8);
      doc.text(`${data.folhaAtual || 1}/${data.folhaTotal || 1}`, dx + 28, y + 90, { width: 70, align: 'right' });

      y += h2;

      // ============================================================
      // BLOCO 3: NATUREZA OP + PROTOCOLO (20 pts)
      // ============================================================
      const h3 = 20;
      doc.rect(MARGIN, y, w, h3).stroke(BORDER);
      const w3a = w * 0.55;
      doc.moveTo(MARGIN + w3a, y).lineTo(MARGIN + w3a, y + h3).stroke(BORDER);

      drawCell(MARGIN, y, w3a, h3, 'NATUREZA DA OPERAÇÃO', data.natOp || '', { valSize: 7, multiline: true });
      drawCell(MARGIN + w3a, y, w - w3a, h3,
        'NÚMERO PROTOCOLO',
        `${data.protocolo || ''} ${data.dhAutorizacao ? formatDateTime(data.dhAutorizacao) : ''}`.trim(),
        { valSize: 8 });

      y += h3;

      // ============================================================
      // BLOCO 4: IE + IEST + CNPJ (14 pts)
      // ============================================================
      const h4 = 14;
      doc.rect(MARGIN, y, w, h4).stroke(BORDER);
      const c4 = w / 3;
      vDividers(MARGIN, y, y + h4, [c4, 2 * c4]);

      drawCell(MARGIN, y, c4, h4, 'INSCRIÇÃO ESTADUAL', data.emit.ie || '');
      drawCell(MARGIN + c4, y, c4, h4, 'INSC.ESTADUAL DO SUBST.TRIBUT.', data.emit.iest || '');
      drawCell(MARGIN + 2 * c4, y, c4, h4, 'CNPJ/CPF',
        data.emit.cnpj ? formatCnpj(data.emit.cnpj) : data.emit.cpf ? formatCpf(data.emit.cpf) : '');

      y += h4;

      // ============================================================
      // BLOCO 5: DESTINATÁRIO / REMETENTE (52 pts)
      // ============================================================
      const h5 = 52;
      doc.rect(MARGIN, y, w, h5).stroke(BORDER);
      doc.font(FONT_BOLD).fontSize(6);
      doc.text('DESTINATÁRIO / REMETENTE', MARGIN + 2, y + 1, { width: w - 4, height: 7 });

      // Linha 1: NOME (50%) | CNPJ/CPF (27%) | DATA EMISSÃO (resto)
      const y5l1 = y + 9;
      hDivider(MARGIN, y5l1, w);
      const w5a = w * 0.50, w5b = w * 0.27, w5c = w - w5a - w5b;
      vDividers(MARGIN, y5l1, y + h5, [w5a, w5a + w5b]);

      drawCell(MARGIN, y5l1, w5a, h5 - 9, 'NOME / RAZÃO SOCIAL', data.dest?.nome || '', { valSize: 7, multiline: true });
      drawCell(MARGIN + w5a, y5l1, w5b, h5 - 9, 'CNPJ / CPF',
        data.dest?.cnpj ? formatCnpj(data.dest.cnpj) : data.dest?.cpf ? formatCpf(data.dest.cpf) : '');
      drawCell(MARGIN + w5a + w5b, y5l1, w5c, h5 - 9, 'DATA EMISSÃO', formatDate(data.dhEmi));

      // Linha 2: ENDEREÇO (40%) | BAIRRO (25%) | CEP (15%) | DATA ENT/SAI (resto)
      const y5l2 = y5l1 + 18;
      hDivider(MARGIN, y5l2, w);
      const w5d = w * 0.40, w5e = w * 0.25, w5f = w * 0.15, w5g = w - w5d - w5e - w5f;
      vDividers(MARGIN, y5l2, y + h5, [w5d, w5d + w5e, w5d + w5e + w5f]);

      const endDest: string[] = [];
      if (data.dest?.endereco) endDest.push(data.dest.endereco);
      if (data.dest?.numero) endDest.push(data.dest.numero);
      if (data.dest?.complemento) endDest.push(data.dest.complemento);
      drawCell(MARGIN, y5l2, w5d, 17, 'ENDEREÇO', endDest.join(', '), { valSize: 6, multiline: true });
      drawCell(MARGIN + w5d, y5l2, w5e, 17, 'BAIRRO / DISTRITO', data.dest?.bairro || '');
      drawCell(MARGIN + w5d + w5e, y5l2, w5f, 17, 'CEP', formatCep(data.dest?.cep));
      drawCell(MARGIN + w5d + w5e + w5f, y5l2, w5g, 17, 'DATA DE ENT/SAI', formatDate(data.dhEmi));

      // Linha 3: MUNICÍPIO (35%) | FONE (25%) | UF (5%) | IE (20%) | HORA SAÍDA (resto)
      const y5l3 = y5l2 + 17;
      hDivider(MARGIN, y5l3, w);
      const w5h = w * 0.35, w5i = w * 0.25, w5j = w * 0.05, w5k = w * 0.20, w5l = w - w5h - w5i - w5j - w5k;
      vDividers(MARGIN, y5l3, y + h5, [w5h, w5h + w5i, w5h + w5i + w5j, w5h + w5i + w5j + w5k]);

      drawCell(MARGIN, y5l3, w5h, 17, 'MUNICÍPIO', data.dest?.cidade || '');
      drawCell(MARGIN + w5h, y5l3, w5i, 17, 'FONE / FAX', formatFone(data.dest?.fone));
      drawCell(MARGIN + w5h + w5i, y5l3, w5j, 17, 'UF', data.dest?.uf || '', { align: 'center', valSize: 8 });
      drawCell(MARGIN + w5h + w5i + w5j, y5l3, w5k, 17, 'INSCRIÇÃO ESTADUAL', data.dest?.ie || '');
      drawCell(MARGIN + w5h + w5i + w5j + w5k, y5l3, w5l, 17, 'HORA DE SAÍDA', formatTime(data.dhEmi));

      y += h5;

      // ============================================================
      // BLOCO 6: FATURA / DUPLICATAS (28 pts)
      // ============================================================
      const dups = data.duplicatas || [];
      const h6 = 28;
      doc.rect(MARGIN, y, w, h6).stroke(BORDER);
      doc.font(FONT_BOLD).fontSize(6);
      doc.text('FATURA / DUPLICATA', MARGIN + 2, y + 1, { width: w - 4, height: 7 });

      // Renderiza duplicatas em grid 3 colunas x N linhas
      const cols6 = 3;
      const col6W = w / cols6;
      const startY6 = y + 9;
      dups.slice(0, 6).forEach((dup, i) => {
        const col = i % cols6;
        const row = Math.floor(i / cols6);
        const dx = MARGIN + col * col6W;
        const dy = startY6 + row * 9;
        doc.font(FONT_BOLD).fontSize(6);
        doc.text(dup.numero, dx + 1, dy, { width: 30 });
        doc.font(FONT_REG).fontSize(6);
        doc.text(dup.vencimento, dx + 30, dy, { width: 60 });
        doc.font(FONT_BOLD).fontSize(6);
        doc.text(formatMoney(dup.valor), dx + col6W - 51, dy, { width: 50, align: 'right' });
      });

      y += h6;

      // ============================================================
      // BLOCO 7: CÁLCULO DO IMPOSTO (32 pts, 2 linhas x 6 col)
      // ============================================================
      const h7 = 32;
      doc.rect(MARGIN, y, w, h7).stroke(BORDER);
      doc.font(FONT_BOLD).fontSize(6);
      doc.text('CÁLCULO DO IMPOSTO', MARGIN + 2, y + 1, { width: w - 4, height: 7 });

      const col7W = w / 6;
      const y7l1 = y + 8;
      hDivider(MARGIN, y7l1, w);
      const y7l2 = y7l1 + 12;
      hDivider(MARGIN, y7l2, w);
      vDividers(MARGIN, y7l1, y + h7, [col7W, 2*col7W, 3*col7W, 4*col7W, 5*col7W]);

      const row1 = [
        { label: 'BASE DE CÁLCULO ICMS', val: formatMoney(data.vBC) },
        { label: 'VALOR DO ICMS', val: formatMoney(data.vICMS) },
        { label: 'BASE DE CÁLCULO ICMS SUBST.', val: formatMoney(data.vBCST) },
        { label: 'VALOR DO ICMS SUBST.', val: formatMoney(data.vST) },
        { label: 'VALOR TOTAL DOS TRIBUTOS', val: formatMoney(data.vTotTrib) },
        { label: 'VALOR TOTAL DOS PRODUTOS', val: formatMoney(data.vProd) },
      ];
      row1.forEach((c, i) => {
        drawCell(MARGIN + i * col7W, y7l1, col7W, 11, c.label, c.val, { valSize: 7, align: 'right' });
      });

      const row2 = [
        { label: 'VALOR DO FRETE', val: formatMoney(data.vFrete) },
        { label: 'VALOR DO SEGURO', val: formatMoney(data.vSeg) },
        { label: 'DESCONTO', val: formatMoney(data.vDesc) },
        { label: 'OUTRAS DESPESAS ACES.', val: formatMoney(data.vOutro) },
        { label: 'VALOR DO IPI', val: formatMoney(data.vIPI) },
        { label: 'VALOR TOTAL DA NOTA', val: formatMoney(data.vNF) },
      ];
      row2.forEach((c, i) => {
        drawCell(MARGIN + i * col7W, y7l2, col7W, 12, c.label, c.val, { valSize: 7, align: 'right' });
      });

      y += h7;

      // ============================================================
      // BLOCO 8: TRANSPORTADOR / VOLUMES (38 pts, 3 linhas)
      // ============================================================
      const h8 = 38;
      doc.rect(MARGIN, y, w, h8).stroke(BORDER);
      doc.font(FONT_BOLD).fontSize(6);
      doc.text('TRANSPORTADOR / VOLUME', MARGIN + 2, y + 1, { width: w - 4, height: 7 });

      const y8l1 = y + 8;
      hDivider(MARGIN, y8l1, w);
      const y8l2 = y8l1 + 10;
      hDivider(MARGIN, y8l2, w);
      const y8l3 = y8l2 + 10;
      hDivider(MARGIN, y8l3, w);

      // Linha 1: RAZÃO SOCIAL | FRETE POR CONTA | ANTT | PLACA | UF | CNPJ/CPF
      const w8a = w * 0.32, w8b = w * 0.22, w8c = w * 0.10, w8d = w * 0.10, w8e = w * 0.04;
      const w8f = w - w8a - w8b - w8c - w8d - w8e;
      vDividers(MARGIN, y8l1, y8l2, [w8a, w8a+w8b, w8a+w8b+w8c, w8a+w8b+w8c+w8d, w8a+w8b+w8c+w8d+w8e]);

      const freteDesc = {
        '0': '0-Por conta do Remetente (CIF)',
        '1': '1-Por conta do Destinatário (FOB)',
        '2': '2-Por conta de Terceiros',
        '9': '9-Sem Frete',
      }[data.transportadora?.fretePorConta || ''] || '';

      drawCell(MARGIN, y8l1, w8a, 9, 'RAZÃO SOCIAL', data.transportadora?.nome || '', { valSize: 6 });
      drawCell(MARGIN + w8a, y8l1, w8b, 9, 'FRETE POR CONTA', freteDesc, { valSize: 5 });
      drawCell(MARGIN + w8a + w8b, y8l1, w8c, 9, 'CÓD. ANTT', data.transportadora?.antt || '', { valSize: 6 });
      drawCell(MARGIN + w8a + w8b + w8c, y8l1, w8d, 9, 'PLACA', data.transportadora?.placa || '', { valSize: 6 });
      drawCell(MARGIN + w8a + w8b + w8c + w8d, y8l1, w8e, 9, 'UF', data.transportadora?.ufVeiculo || '', { align: 'center' });
      drawCell(MARGIN + w8a + w8b + w8c + w8d + w8e, y8l1, w8f, 9, 'CNPJ / CPF',
        data.transportadora?.cnpj ? formatCnpj(data.transportadora.cnpj) : '', { valSize: 6 });

      // Linha 2: ENDEREÇO | MUNICÍPIO | UF | IE
      const w8g = w * 0.50, w8h = w * 0.35, w8i = w * 0.05;
      const w8j = w - w8g - w8h - w8i;
      vDividers(MARGIN, y8l2, y8l3, [w8g, w8g+w8h, w8g+w8h+w8i]);

      drawCell(MARGIN, y8l2, w8g, 9, 'ENDEREÇO', data.transportadora?.endereco || '', { valSize: 6 });
      drawCell(MARGIN + w8g, y8l2, w8h, 9, 'MUNICÍPIO', data.transportadora?.cidade || '', { valSize: 6 });
      drawCell(MARGIN + w8g + w8h, y8l2, w8i, 9, 'UF', data.transportadora?.uf || '', { align: 'center' });
      drawCell(MARGIN + w8g + w8h + w8i, y8l2, w8j, 9, 'INSCRIÇÃO ESTADUAL', data.transportadora?.ie || '', { valSize: 6 });

      // Linha 3: QUANTIDADE | ESPÉCIE | MARCA | NÚMERO | PESO BRUTO | PESO LÍQUIDO
      const w8k = w * 0.10, w8l = w * 0.15, w8m = w * 0.20, w8n = w * 0.15, w8o = w * 0.20;
      const w8p = w - w8k - w8l - w8m - w8n - w8o;
      vDividers(MARGIN, y8l3, y + h8, [w8k, w8k+w8l, w8k+w8l+w8m, w8k+w8l+w8m+w8n, w8k+w8l+w8m+w8n+w8o]);

      drawCell(MARGIN, y8l3, w8k, 11, 'QUANTIDADE', String(data.transportadora?.quantidade || ''), { valSize: 6 });
      drawCell(MARGIN + w8k, y8l3, w8l, 11, 'ESPÉCIE', data.transportadora?.especie || '', { valSize: 6 });
      drawCell(MARGIN + w8k + w8l, y8l3, w8m, 11, 'MARCA', data.transportadora?.marca || '', { valSize: 6 });
      drawCell(MARGIN + w8k + w8l + w8m, y8l3, w8n, 11, 'NÚMERO', data.transportadora?.numero || '', { valSize: 6 });
      drawCell(MARGIN + w8k + w8l + w8m + w8n, y8l3, w8o, 11, 'PESO BRUTO', formatNum3(data.transportadora?.pesoBruto), { valSize: 6, align: 'right' });
      drawCell(MARGIN + w8k + w8l + w8m + w8n + w8o, y8l3, w8p, 11, 'PESO LÍQUIDO', formatNum3(data.transportadora?.pesoLiquido), { valSize: 6, align: 'right' });

      y += h8;

      // ============================================================
      // BLOCO 9: ISSQN (14 pts)
      // ============================================================
      const h9 = 14;
      doc.rect(MARGIN, y, w, h9).stroke(BORDER);
      doc.font(FONT_BOLD).fontSize(6);
      doc.text('CÁLCULO DO ISSQN', MARGIN + 2, y + 1, { width: w - 4, height: 7 });

      const col9W = w / 4;
      vDividers(MARGIN, y + 8, y + h9, [col9W, 2*col9W, 3*col9W]);

      const row9 = [
        { label: 'INSCRIÇÃO MUNICIPAL', val: data.emit.im || '' },
        { label: 'VALOR TOTAL DOS SERVIÇOS', val: '' },
        { label: 'BASE DE CÁLCULO DO ISSQN', val: '' },
        { label: 'VALOR DO ISSQN', val: '' },
      ];
      row9.forEach((c, i) => {
        drawCell(MARGIN + i * col9W, y + 8, col9W, 6, c.label, c.val, { valSize: 6 });
      });

      y += h9;

      // ============================================================
      // BLOCO 10: DADOS DOS PRODUTOS (80 pts)
      // ============================================================
      const h10 = 80;
      doc.rect(MARGIN, y, w, h10).stroke(BORDER);
      doc.font(FONT_BOLD).fontSize(6);
      doc.text('DADOS DOS PRODUTOS / SERVIÇOS', MARGIN + 2, y + 1, { width: w - 4, height: 7, lineBreak: false });

      // Cabeçalho da tabela (12 pts) - altura maior para labels quebrarem em 2 linhas
      const y10h = y + 8;
      hDivider(MARGIN, y10h, w);

      // Colunas: CÓD | DESC | NCM | CST | CFOP | UN | QTD | V.UNIT | V.TOT | BC.ICMS | V.ICMS | V.IPI | ALIQ.ICMS | ALIQ.IPI
      // alinhamento: código/descrição = left, outros = right, CST/CFOP/UN = center
      // Larguras somam exatamente 1.00 para evitar overflow horizontal
      const cols10 = [
        { label: 'CÓD. PROD', w: w * 0.08, align: 'left' },
        { label: 'DESCRIÇÃO DOS PRODUTOS / SERVIÇOS', w: w * 0.27, align: 'left' },
        { label: 'NCM/SH', w: w * 0.055, align: 'right' },
        { label: 'CST', w: w * 0.035, align: 'center' },
        { label: 'CFOP', w: w * 0.045, align: 'center' },
        { label: 'UN', w: w * 0.025, align: 'center' },
        { label: 'QUANTIDADE', w: w * 0.065, align: 'right' },
        { label: 'V.UNITÁRIO', w: w * 0.065, align: 'right' },
        { label: 'V. TOTAL', w: w * 0.065, align: 'right' },
        { label: 'BC. ICMS', w: w * 0.065, align: 'right' },
        { label: 'V.ICMS', w: w * 0.055, align: 'right' },
        { label: 'V. IPI', w: w * 0.055, align: 'right' },
        { label: 'ALÍQ. ICMS', w: w * 0.06, align: 'right' },
        { label: 'ALÍQ. IPI', w: w * 0.06, align: 'right' },
      ];

      // Desenha bordas verticais + labels do cabeçalho (com quebra de linha natural)
      let xpos: number = MARGIN;
      const col10Xs: number[] = [xpos];
      cols10.forEach((c) => {
        if (col10Xs.length > 1) {
          // Linha vertical do cabeçalho até fim do bloco
          doc.moveTo(xpos, y10h).lineTo(xpos, y + h10).stroke(BORDER);
        }
        doc.font(FONT_BOLD).fontSize(4);
        doc.text(c.label, xpos + 1, y10h + 1, { width: c.w - 2, height: 10, align: c.align as any, lineBreak: true });
        col10Xs.push(xpos + c.w);
        xpos += c.w;
      });

      // Itens - cada item ocupa 18 pts (2 linhas para descrição longa)
      let yItem = y10h + 12;
      const maxItemY = y + h10 - 3;
      const itemH = 18;
      for (let i = 0; i < data.produtos.length && yItem + itemH <= maxItemY + 3; i++) {
        const p = data.produtos[i];
        const rowVals = [
          p.codProd, p.descricao, p.ncm, p.cst, p.cfop, p.unidade,
          formatNum4(p.quantidade), formatMoney(p.valorUnit),
          formatMoney(p.valorTotal), formatMoney(p.bcIcms),
          formatMoney(p.valorIcms), formatMoney(p.valorIpi),
          formatPct(p.aliquotaIcms), formatPct(p.aliquotaIpi),
        ];
        for (let j = 0; j < cols10.length; j++) {
          const cx = col10Xs[j];
          const cw = cols10[j].w;
          const al = cols10[j].align as any;
          doc.font(FONT_REG).fontSize(5);
          const isDesc = j === 1;
          if (isDesc) {
            // Descrição: multiline até 14 pts de altura
            doc.text(rowVals[j], cx + 1, yItem, { width: cw - 2, height: itemH - 2, align: 'left' });
          } else {
            // Outras colunas: 1 linha, alinhamento conforme coluna
            doc.text(rowVals[j], cx + 1, yItem, { width: cw - 2, height: 6, align: al, lineBreak: false });
          }
        }
        yItem += itemH;
        // Linha horizontal divisória entre itens (até final do bloco)
        if (yItem < y + h10) {
          hDivider(MARGIN, yItem, w);
        }
      }

      y += h10;

      // ============================================================
      // BLOCO 11: DADOS ADICIONAIS (80 pts)
      // ============================================================
      const h11 = 80;
      doc.rect(MARGIN, y, w, h11).stroke(BORDER);
      doc.font(FONT_BOLD).fontSize(6);
      doc.text('DADOS ADICIONAIS', MARGIN + 2, y + 1, { width: w - 4, height: 7 });

      const y11l1 = y + 8;
      hDivider(MARGIN, y11l1, w);
      const w11a = w * 0.65, w11b = w - w11a;
      doc.moveTo(MARGIN + w11a, y11l1).lineTo(MARGIN + w11a, y + h11).stroke(BORDER);

      drawCell(MARGIN, y11l1, w11a, h11 - 8, 'INFORMAÇÕES COMPLEMENTARES', data.infCpl || '', { valSize: 5, multiline: true });
      drawCell(MARGIN + w11a, y11l1, w11b, h11 - 8, 'RESERVADO AO FISCO', data.infCplFisco || '', { valSize: 5, multiline: true });

      y += h11;

      // ============================================================
      // RODAPÉ (logo após o último bloco, evita overflow p/ 2ª página)
      // ============================================================
      doc.font(FONT_REG).fontSize(5);
      doc.text(
        `DANFE gerado por MGBP NF-e Middleware em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
        MARGIN, y + 2, { width: w, align: 'center', lineBreak: false }
      );

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ============================================================
// Helpers de formatação
// ============================================================

function formatCnpj(cnpj?: string): string {
  const s = String(cnpj || '').replace(/\D/g, '').padStart(14, '0');
  if (s.length !== 14) return cnpj || '';
  return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function formatCpf(cpf?: string): string {
  const s = String(cpf || '').replace(/\D/g, '').padStart(11, '0');
  if (s.length !== 11) return cpf || '';
  return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function formatCep(cep?: string): string {
  const s = String(cep || '').replace(/\D/g, '').padStart(8, '0');
  if (s.length !== 8) return cep || '';
  return s.replace(/^(\d{5})(\d{3})/, '$1-$2');
}

function formatFone(fone?: string): string {
  const s = String(fone || '').replace(/\D/g, '');
  if (s.length === 11) return s.replace(/^(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (s.length === 10) return s.replace(/^(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return fone || '';
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch { return ''; }
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  } catch { return ''; }
}

function formatDateTime(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch { return ''; }
}

function formatMoney(n?: number): string {
  if (n === undefined || n === null || isNaN(n)) return '';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNum3(n?: number): string {
  if (n === undefined || n === null || isNaN(n)) return '';
  return Number(n).toFixed(3).replace('.', ',');
}

function formatNum4(n?: number): string {
  if (n === undefined || n === null || isNaN(n)) return '';
  return Number(n).toFixed(4).replace('.', ',');
}

function formatPct(n?: number): string {
  if (n === undefined || n === null || isNaN(n) || n === 0) return '';
  return Number(n).toFixed(2).replace('.', ',');
}
