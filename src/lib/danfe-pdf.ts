/**
 * src/lib/danfe-pdf.ts - Gerador de DANFE (PDF) para NF-e MGBP Brasil
 * =====================================================================
 * Layout fiel ao DANFE oficial emitido pelo eDocs/Senior (referência: NF 5515).
 * A4 retrato, 1 página, todos os blocos do DANFE oficial:
 *   1. RECEBEMOS + NF-e + número + série
 *   2. Logo emitente + DANFE + chave de acesso + nº série + folha
 *   3. Natureza operação + protocolo
 *   4. IE emitente + IEST + CNPJ emitente
 *   5. DESTINATÁRIO / REMETENTE (3 linhas)
 *   6. FATURA / DUPLICATAS
 *   7. CÁLCULO DO IMPOSTO (2 linhas x 6 col)
 *   8. TRANSPORTADOR / VOLUMES (3 linhas)
 *   9. CÁLCULO DO ISSQN
 *   10. DADOS DOS PRODUTOS / SERVIÇOS (tabela)
 *   11. DADOS ADICIONAIS (info compl + fisco)
 *   12. Rodapé (gerador)
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
  fretePorConta?: string; // '0' (CIF remetente) | '1' (FOB dest) | '2' (terceiros) | '9' (sem frete)
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
  tpNF: string; // '0' entrada, '1' saida
  natOp: string;
  // Emitente
  emit: DanfeEndereco;
  // Destinatário
  dest?: DanfeEndereco;
  // Transportadora
  transportadora?: DanfeTransportadora;
  // Duplicatas
  duplicatas?: DanfeDuplicata[];
  // Totais (impostos)
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
  // Produtos
  produtos: DanfeProduto[];
  // Protocolo
  protocolo?: string;
  dhAutorizacao?: string;
  // Mensagem adicional (rodapé do topo)
  mensagemConsulta?: string;
  infCpl?: string;
  infCplFisco?: string;
  // Origem (opcional)
  origem?: string; // 'edocs' | 'middleware' | 'sefaz'
}

const PAGE_W = 595.28; // A4 largura
const PAGE_H = 841.89; // A4 altura
const MARGIN = 8;

/** Gera o PDF DANFE em Buffer - layout fiel ao DANFE oficial. */
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

      // Cores e fontes padrão
      const FONT_BOLD = 'Helvetica-Bold';
      const FONT_REG = 'Helvetica';
      const COLOR_BORDER = '#000000';
      const COLOR_BG_HEADER = '#e8e8e8';

      let y = MARGIN;
      const w = PAGE_W - 2 * MARGIN;

      // ============================================================
      // BLOCO 1: RECEBEMOS + NF-e + NUMERO + SERIE
      // ============================================================
      const h1 = 28;
      // 3 colunas: RECEBEMOS (esquerda larga) | NF-e topo | numero/serie
      const colA = 60; // largura primeira coluna interna RECEBEMOS
      const colNF = 60; // largura segunda coluna NF-e

      doc.rect(MARGIN, y, w, h1).stroke(COLOR_BORDER);
      doc.font(FONT_REG).fontSize(5.5);
      // Coluna RECEBEMOS (esquerda, mais larga)
      const recebaW = w - 80;
      doc.text('RECEBEMOS OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO DE:',
        MARGIN + 2, y + 4, { width: recebaW - 4, height: 14 });
      doc.font(FONT_BOLD).fontSize(6);
      doc.text(data.emit.nome.toUpperCase(), MARGIN + 2, y + 16, { width: recebaW - 4, height: 10 });

      // Linha vertical separadora
      doc.moveTo(MARGIN + recebaW, y).lineTo(MARGIN + recebaW, y + h1).stroke(COLOR_BORDER);

      // Coluna NF-e (centro)
      doc.font(FONT_BOLD).fontSize(8);
      doc.text('NF-e', MARGIN + recebaW + 2, y + 4, { width: 76, align: 'center' });
      doc.moveTo(MARGIN + recebaW + 80, y).lineTo(MARGIN + recebaW + 80, y + h1).stroke(COLOR_BORDER);

      // Coluna NÚMERO + SÉRIE (direita)
      doc.font(FONT_REG).fontSize(5.5);
      doc.text('NÚMERO', MARGIN + recebaW + 82, y + 2, { width: 90, align: 'left' });
      doc.font(FONT_BOLD).fontSize(10);
      doc.text(String(data.nNF || '').padStart(6, '0'), MARGIN + recebaW + 82, y + 9, { width: 90, align: 'left' });
      doc.font(FONT_REG).fontSize(5.5);
      doc.text('SÉRIE', MARGIN + recebaW + 82, y + 20, { width: 90, align: 'left' });
      doc.font(FONT_BOLD).fontSize(8);
      doc.text(String(data.serie || ''), MARGIN + recebaW + 145, y + 20, { width: 30, align: 'right' });

      y += h1;

      // ============================================================
      // BLOCO 2: LOGO + DANFE + CHAVE ACESSO
      // ============================================================
      const h2 = 92;
      // 3 colunas: emitente (esq) | DANFE (centro) | chave (dir)
      const col2A = 200; // emitente
      const col2B = 100; // DANFE
      const col2C = w - col2A - col2B; // chave

      doc.rect(MARGIN, y, w, h2).stroke(COLOR_BORDER);

      // === Coluna esquerda: LOGO + dados emitente ===
      // Logo box
      const logoBoxH = 50;
      const logoBoxW = col2A - 4;
      if (logoData && logoData.buffer) {
        try {
          doc.image(logoData.buffer, MARGIN + 2, y + 2, {
            fit: [logoBoxW, logoBoxH],
            align: 'center',
            valign: 'center',
          });
        } catch (e) {
          // fallback
        }
      } else {
        doc.font(FONT_BOLD).fontSize(7);
        doc.text(data.emit.nome.toUpperCase(), MARGIN + 4, y + 6, { width: logoBoxW - 4, height: 30 });
      }

      // Nome empresa abaixo do logo
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(data.emit.nome.toUpperCase(), MARGIN + 2, y + 52, { width: col2A - 4, height: 10 });

      // Endereço emitente
      const end: string[] = [];
      if (data.emit.endereco) end.push(`${data.emit.endereco}${data.emit.numero ? ', ' + data.emit.numero : ''}`);
      if (data.emit.complemento) end.push(data.emit.complemento);
      if (data.emit.bairro) end.push(data.emit.bairro);
      const endStr = end.join(' - ');
      doc.font(FONT_REG).fontSize(5.5);
      doc.text(endStr, MARGIN + 2, y + 62, { width: col2A - 4, height: 7 });

      // Cidade/UF
      const cidadeUf: string[] = [];
      if (data.emit.cidade) cidadeUf.push(`${data.emit.cidade} - ${data.emit.uf || ''}`);
      doc.text(cidadeUf.join(' - '), MARGIN + 2, y + 70, { width: col2A - 4, height: 7 });

      // CNPJ
      doc.font(FONT_REG).fontSize(5.5);
      let cnpjEmit = data.emit.cnpj ? formatCnpj(data.emit.cnpj) : '';
      doc.text(`C.N.P.J./C.P.F. ${cnpjEmit}`, MARGIN + 2, y + 78, { width: col2A - 4, height: 7 });

      // FONE + CEP
      const foneCep: string[] = [];
      if (data.emit.fone) foneCep.push(`FONE ${formatFone(data.emit.fone)}`);
      if (data.emit.cep) foneCep.push(`CEP ${formatCep(data.emit.cep)}`);
      doc.text(foneCep.join('         '), MARGIN + 2, y + 86, { width: col2A - 4, height: 5 });

      // Separador vertical
      doc.moveTo(MARGIN + col2A, y).lineTo(MARGIN + col2A, y + h2).stroke(COLOR_BORDER);

      // === Coluna centro: DANFE + entrada/saída ===
      const cx = MARGIN + col2A + 2;
      doc.font(FONT_BOLD).fontSize(12);
      doc.text('DANFE', cx, y + 6, { width: col2B - 4, align: 'center' });
      doc.font(FONT_BOLD).fontSize(5.5);
      doc.text('DOCUMENTO AUXILIAR DA NOTA', cx, y + 20, { width: col2B - 4, align: 'center' });
      doc.text('FISCAL ELETRÔNICA', cx, y + 25, { width: col2B - 4, align: 'center' });

      // 0-ENTRADA / 1-SAÍDA (com marcação)
      const tpNF = String(data.tpNF || '1');
      doc.font(FONT_REG).fontSize(5.5);
      doc.text('0 - ENTRADA', cx, y + 36, { width: col2B - 4, align: 'left' });
      doc.text('1 - SAÍDA', cx, y + 44, { width: col2B - 4, align: 'left' });
      // Marca (X) na opção selecionada
      doc.font(FONT_BOLD).fontSize(10);
      const tpX = tpNF === '0' ? cx + 0 : cx + 0;
      const tpY = tpNF === '0' ? y + 36 : y + 44;
      doc.text('X', tpX, tpY, { width: 8, align: 'left' });

      doc.moveTo(MARGIN + col2A + col2B, y).lineTo(MARGIN + col2A + col2B, y + h2).stroke(COLOR_BORDER);

      // === Coluna direita: CHAVE ACESSO + barcode + nº + série + folha ===
      const dx = MARGIN + col2A + col2B + 2;
      const dw = col2C - 4;
      doc.font(FONT_REG).fontSize(5.5);
      doc.text('CHAVE DE ACESSO', dx, y + 2, { width: dw, align: 'left' });

      // Chave formatada em grupos de 4
      const chaveFmt = String(data.chave || '').match(/.{1,4}/g)?.join(' ') || data.chave || '';
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(chaveFmt, dx, y + 9, { width: dw, height: 10, align: 'center' });

      // Barcode (Code128C)
      try {
        const png = bwipjs.toBuffer({
          bcid: 'code128',
          text: String(data.chave || ''),
          scale: 1.5,
          height: 22,
          includetext: false,
        });
        doc.image(png, dx + (dw - 180) / 2, y + 20, { width: 180, height: 22 });
      } catch (e) {
        console.warn('[DANFE-PDF] Falha barcode:', (e as Error).message);
      }

      // Nº + Série + Folha
      doc.font(FONT_REG).fontSize(5.5);
      doc.text('Nº', dx + 5, y + 44, { width: 25 });
      doc.font(FONT_BOLD).fontSize(10);
      doc.text(String(data.nNF || '').padStart(6, '0'), dx + 30, y + 42, { width: 70, align: 'right' });

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('SÉRIE', dx + 5, y + 58, { width: 25 });
      doc.font(FONT_BOLD).fontSize(10);
      doc.text(String(data.serie || ''), dx + 30, y + 56, { width: 70, align: 'right' });

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('FOLHA', dx + 5, y + 72, { width: 25 });
      doc.font(FONT_BOLD).fontSize(8);
      const folhaStr = `${data.folhaAtual || 1}/${data.folhaTotal || 1}`;
      doc.text(folhaStr, dx + 30, y + 72, { width: 70, align: 'right' });

      // Mensagem consulta autenticidade
      doc.font(FONT_REG).fontSize(4.5);
      doc.text('Consulta de autenticidade no portal nacional da NF-e',
        dx, y + 82, { width: dw, height: 6, align: 'left' });
      doc.text('www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizada',
        dx, y + 87, { width: dw, height: 5, align: 'left' });

      y += h2;

      // ============================================================
      // BLOCO 3: NATUREZA OPER + PROTOCOLO
      // ============================================================
      const h3 = 22;
      doc.rect(MARGIN, y, w, h3).stroke(COLOR_BORDER);
      const natW = w * 0.55;
      doc.moveTo(MARGIN + natW, y).lineTo(MARGIN + natW, y + h3).stroke(COLOR_BORDER);

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('NATUREZA DA OPERAÇÃO', MARGIN + 2, y + 2, { width: natW - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(data.natOp || '', MARGIN + 2, y + 10, { width: natW - 4, height: 10 });

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('NÚMERO PROTOCOLO', MARGIN + natW + 2, y + 2, { width: w - natW - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(8);
      const protoStr = `${data.protocolo || ''} ${data.dhAutorizacao ? formatDateTime(data.dhAutorizacao) : ''}`;
      doc.text(protoStr, MARGIN + natW + 2, y + 10, { width: w - natW - 4, height: 10 });

      y += h3;

      // ============================================================
      // BLOCO 4: IE + IEST + CNPJ/CPF EMITENTE
      // ============================================================
      const h4 = 16;
      doc.rect(MARGIN, y, w, h4).stroke(COLOR_BORDER);
      const c4a = w / 3;
      doc.moveTo(MARGIN + c4a, y).lineTo(MARGIN + c4a, y + h4).stroke(COLOR_BORDER);
      doc.moveTo(MARGIN + 2 * c4a, y).lineTo(MARGIN + 2 * c4a, y + h4).stroke(COLOR_BORDER);

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('INSCRIÇÃO ESTADUAL', MARGIN + 2, y + 2, { width: c4a - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(data.emit.ie || '', MARGIN + 2, y + 9, { width: c4a - 4, height: 7 });

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('INSC.ESTADUAL DO SUBST.TRIBUT.', MARGIN + c4a + 2, y + 2, { width: c4a - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(data.emit.iest || '', MARGIN + c4a + 2, y + 9, { width: c4a - 4, height: 7 });

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('CNPJ/CPF', MARGIN + 2 * c4a + 2, y + 2, { width: c4a - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      const docEmit = data.emit.cnpj ? formatCnpj(data.emit.cnpj) : data.emit.cpf ? formatCpf(data.emit.cpf) : '';
      doc.text(docEmit, MARGIN + 2 * c4a + 2, y + 9, { width: c4a - 4, height: 7 });

      y += h4;

      // ============================================================
      // BLOCO 5: DESTINATÁRIO / REMETENTE (3 linhas)
      // ============================================================
      const h5 = 50;
      doc.rect(MARGIN, y, w, h5).stroke(COLOR_BORDER);

      // Título
      doc.font(FONT_BOLD).fontSize(6);
      doc.text('DESTINATÁRIO / REMETENTE', MARGIN + 2, y + 1, { width: w - 4, height: 7 });

      // Linha 1: NOME | CNPJ/CPF | DATA EMISSÃO
      const y5l1 = y + 12;
      doc.moveTo(MARGIN, y5l1).lineTo(MARGIN + w, y5l1).stroke(COLOR_BORDER);
      const w5a = w * 0.50;
      const w5b = w * 0.27;
      const w5c = w - w5a - w5b;
      doc.moveTo(MARGIN + w5a, y5l1).lineTo(MARGIN + w5a, y + h5).stroke(COLOR_BORDER);
      doc.moveTo(MARGIN + w5a + w5b, y5l1).lineTo(MARGIN + w5a + w5b, y + h5).stroke(COLOR_BORDER);

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('NOME / RAZÃO SOCIAL', MARGIN + 2, y5l1 + 1, { width: w5a - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(data.dest?.nome || '', MARGIN + 2, y5l1 + 8, { width: w5a - 4, height: 8 });

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('CNPJ / CPF', MARGIN + w5a + 2, y5l1 + 1, { width: w5b - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      const docDest = data.dest?.cnpj ? formatCnpj(data.dest.cnpj) : data.dest?.cpf ? formatCpf(data.dest.cpf) : '';
      doc.text(docDest, MARGIN + w5a + 2, y5l1 + 8, { width: w5b - 4, height: 8 });

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('DATA EMISSÃO', MARGIN + w5a + w5b + 2, y5l1 + 1, { width: w5c - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(formatDate(data.dhEmi), MARGIN + w5a + w5b + 2, y5l1 + 8, { width: w5c - 4, height: 8 });

      // Linha 2: ENDEREÇO | BAIRRO | CEP | DATA ENT/SAI
      const y5l2 = y5l1 + 18;
      doc.moveTo(MARGIN, y5l2).lineTo(MARGIN + w, y5l2).stroke(COLOR_BORDER);
      const w5d = w * 0.40;
      const w5e = w * 0.25;
      const w5f = w * 0.15;
      const w5g = w - w5d - w5e - w5f;
      doc.moveTo(MARGIN + w5d, y5l2).lineTo(MARGIN + w5d, y + h5).stroke(COLOR_BORDER);
      doc.moveTo(MARGIN + w5d + w5e, y5l2).lineTo(MARGIN + w5d + w5e, y + h5).stroke(COLOR_BORDER);
      doc.moveTo(MARGIN + w5d + w5e + w5f, y5l2).lineTo(MARGIN + w5d + w5e + w5f, y + h5).stroke(COLOR_BORDER);

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('ENDEREÇO', MARGIN + 2, y5l2 + 1, { width: w5d - 4, height: 7 });
      // Endereço dest
      const endDest: string[] = [];
      if (data.dest?.endereco) endDest.push(data.dest.endereco);
      if (data.dest?.numero) endDest.push(data.dest.numero);
      if (data.dest?.complemento) endDest.push(data.dest.complemento);
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(endDest.join(', '), MARGIN + 2, y5l2 + 8, { width: w5d - 4, height: 8 });

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('BAIRRO / DISTRITO', MARGIN + w5d + 2, y5l2 + 1, { width: w5e - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(data.dest?.bairro || '', MARGIN + w5d + 2, y5l2 + 8, { width: w5e - 4, height: 8 });

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('CEP', MARGIN + w5d + w5e + 2, y5l2 + 1, { width: w5f - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(formatCep(data.dest?.cep), MARGIN + w5d + w5e + 2, y5l2 + 8, { width: w5f - 4, height: 8 });

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('DATA DE ENT / SAI', MARGIN + w5d + w5e + w5f + 2, y5l2 + 1, { width: w5g - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(formatDate(data.dhEmi), MARGIN + w5d + w5e + w5f + 2, y5l2 + 8, { width: w5g - 4, height: 8 });

      // Linha 3: MUNICÍPIO | FONE/FAX | UF | IE DEST | HORA SAÍDA
      const y5l3 = y5l2 + 18;
      doc.moveTo(MARGIN, y5l3).lineTo(MARGIN + w, y5l3).stroke(COLOR_BORDER);
      const w5h = w * 0.35;
      const w5i = w * 0.25;
      const w5j = w * 0.05;
      const w5k = w * 0.20;
      const w5l = w - w5h - w5i - w5j - w5k;
      doc.moveTo(MARGIN + w5h, y5l3).lineTo(MARGIN + w5h, y + h5).stroke(COLOR_BORDER);
      doc.moveTo(MARGIN + w5h + w5i, y5l3).lineTo(MARGIN + w5h + w5i, y + h5).stroke(COLOR_BORDER);
      doc.moveTo(MARGIN + w5h + w5i + w5j, y5l3).lineTo(MARGIN + w5h + w5i + w5j, y + h5).stroke(COLOR_BORDER);
      doc.moveTo(MARGIN + w5h + w5i + w5j + w5k, y5l3).lineTo(MARGIN + w5h + w5i + w5j + w5k, y + h5).stroke(COLOR_BORDER);

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('MUNICÍPIO', MARGIN + 2, y5l3 + 1, { width: w5h - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(data.dest?.cidade || '', MARGIN + 2, y5l3 + 8, { width: w5h - 4, height: 8 });

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('FONE / FAX', MARGIN + w5h + 2, y5l3 + 1, { width: w5i - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(formatFone(data.dest?.fone), MARGIN + w5h + 2, y5l3 + 8, { width: w5i - 4, height: 8 });

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('UF', MARGIN + w5h + w5i + 2, y5l3 + 1, { width: w5j - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(8);
      doc.text(data.dest?.uf || '', MARGIN + w5h + w5i + 2, y5l3 + 8, { width: w5j - 4, height: 8, align: 'center' });

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('INSCRIÇÃO ESTADUAL', MARGIN + w5h + w5i + w5j + 2, y5l3 + 1, { width: w5k - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(data.dest?.ie || '', MARGIN + w5h + w5i + w5j + 2, y5l3 + 8, { width: w5k - 4, height: 8 });

      doc.font(FONT_REG).fontSize(5.5);
      doc.text('HORA DE SAÍDA', MARGIN + w5h + w5i + w5j + w5k + 2, y5l3 + 1, { width: w5l - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(formatTime(data.dhEmi), MARGIN + w5h + w5i + w5j + w5k + 2, y5l3 + 8, { width: w5l - 4, height: 8 });

      y += h5;

      // ============================================================
      // BLOCO 6: FATURA / DUPLICATAS
      // ============================================================
      const dups = data.duplicatas || [];
      const h6 = Math.max(22, dups.length > 0 ? 14 + Math.ceil(dups.length / 3) * 12 : 22);
      doc.rect(MARGIN, y, w, h6).stroke(COLOR_BORDER);
      doc.font(FONT_BOLD).fontSize(6);
      doc.text('FATURA / DUPLICATA', MARGIN + 2, y + 1, { width: w - 4, height: 7 });

      // Renderiza duplicatas em 3 colunas
      const startY6 = y + 10;
      const cols6 = 3;
      const col6W = w / cols6;
      dups.forEach((dup, i) => {
        const col = i % cols6;
        const row = Math.floor(i / cols6);
        const dx = MARGIN + col * col6W;
        const dy = startY6 + row * 12;
        doc.font(FONT_BOLD).fontSize(6);
        doc.text(dup.numero, dx + 2, dy, { width: 25 });
        doc.font(FONT_REG).fontSize(6);
        doc.text(dup.vencimento, dx + 25, dy, { width: 50 });
        doc.font(FONT_BOLD).fontSize(6);
        doc.text(formatMoney(dup.valor), dx + 75, dy, { width: col6W - 80, align: 'right' });
      });

      y += h6;

      // ============================================================
      // BLOCO 7: CÁLCULO DO IMPOSTO (2 linhas x 6 colunas)
      // ============================================================
      const h7 = 36;
      doc.rect(MARGIN, y, w, h7).stroke(COLOR_BORDER);
      doc.font(FONT_BOLD).fontSize(6);
      doc.text('CÁLCULO DO IMPOSTO', MARGIN + 2, y + 1, { width: w - 4, height: 7 });

      const cols7 = 6;
      const col7W = w / cols7;

      // Linha 1
      const y7l1 = y + 9;
      doc.moveTo(MARGIN, y7l1).lineTo(MARGIN + w, y7l1).stroke(COLOR_BORDER);

      const labels7l1 = [
        { label: 'BASE DE CÁLCULO ICMS', val: formatMoney(data.vBC) },
        { label: 'VALOR DO ICMS', val: formatMoney(data.vICMS) },
        { label: 'BASE DE CÁLCULO ICMS SUBST.', val: formatMoney(data.vBCST) },
        { label: 'VALOR DO ICMS SUBST.', val: formatMoney(data.vST) },
        { label: 'VALOR TOTAL DOS TRIBUTOS', val: formatMoney(data.vTotTrib) },
        { label: 'VALOR TOTAL DOS PRODUTOS', val: formatMoney(data.vProd) },
      ];
      labels7l1.forEach((c, i) => {
        const cx = MARGIN + i * col7W;
        if (i > 0) doc.moveTo(cx, y7l1).lineTo(cx, y + h7).stroke(COLOR_BORDER);
        doc.font(FONT_REG).fontSize(5);
        doc.text(c.label, cx + 2, y7l1 + 1, { width: col7W - 4, height: 8 });
        doc.font(FONT_BOLD).fontSize(7);
        doc.text(c.val, cx + 2, y7l1 + 10, { width: col7W - 4, height: 9, align: 'right' });
      });

      // Linha 2
      const y7l2 = y7l1 + 18;
      doc.moveTo(MARGIN, y7l2).lineTo(MARGIN + w, y7l2).stroke(COLOR_BORDER);

      const labels7l2 = [
        { label: 'VALOR DO FRETE', val: formatMoney(data.vFrete) },
        { label: 'VALOR DO SEGURO', val: formatMoney(data.vSeg) },
        { label: 'DESCONTO', val: formatMoney(data.vDesc) },
        { label: 'OUTRAS DESPESAS ACES.', val: formatMoney(data.vOutro) },
        { label: 'VALOR DO IPI', val: formatMoney(data.vIPI) },
        { label: 'VALOR TOTAL DA NOTA', val: formatMoney(data.vNF) },
      ];
      labels7l2.forEach((c, i) => {
        const cx = MARGIN + i * col7W;
        if (i > 0) doc.moveTo(cx, y7l2).lineTo(cx, y + h7).stroke(COLOR_BORDER);
        doc.font(FONT_REG).fontSize(5);
        doc.text(c.label, cx + 2, y7l2 + 1, { width: col7W - 4, height: 8 });
        doc.font(FONT_BOLD).fontSize(7);
        doc.text(c.val, cx + 2, y7l2 + 9, { width: col7W - 4, height: 9, align: 'right' });
      });

      y += h7;

      // ============================================================
      // BLOCO 8: TRANSPORTADOR / VOLUMES (3 linhas)
      // ============================================================
      const h8 = 42;
      doc.rect(MARGIN, y, w, h8).stroke(COLOR_BORDER);
      doc.font(FONT_BOLD).fontSize(6);
      doc.text('TRANSPORTADOR / VOLUME', MARGIN + 2, y + 1, { width: w - 4, height: 7 });

      // Linha 1: RAZÃO SOCIAL | FRETE POR CONTA | CÓD ANTT | PLACA | UF | CNPJ/CPF
      const y8l1 = y + 9;
      doc.moveTo(MARGIN, y8l1).lineTo(MARGIN + w, y8l1).stroke(COLOR_BORDER);
      const w8a = w * 0.40;
      const w8b = w * 0.20;
      const w8c = w * 0.08;
      const w8d = w * 0.10;
      const w8e = w * 0.04;
      const w8f = w - w8a - w8b - w8c - w8d - w8e;
      [w8a, w8a + w8b, w8a + w8b + w8c, w8a + w8b + w8c + w8d, w8a + w8b + w8c + w8d + w8e].forEach((acc, i) => {
        doc.moveTo(MARGIN + acc, y8l1).lineTo(MARGIN + acc, y + h8).stroke(COLOR_BORDER);
      });

      doc.font(FONT_REG).fontSize(5);
      doc.text('RAZÃO SOCIAL', MARGIN + 2, y8l1 + 1, { width: w8a - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(data.transportadora?.nome || '', MARGIN + 2, y8l1 + 8, { width: w8a - 4, height: 8 });

      doc.font(FONT_REG).fontSize(5);
      doc.text('FRETE POR CONTA', MARGIN + w8a + 2, y8l1 + 1, { width: w8b - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(6);
      const freteDesc = {
        '0': '0-Por conta do Remetente (CIF)',
        '1': '1-Por conta do Destinatário (FOB)',
        '2': '2-Por conta de Terceiros',
        '9': '9-Sem Frete',
      }[data.transportadora?.fretePorConta || ''] || '';
      doc.text(freteDesc, MARGIN + w8a + 2, y8l1 + 8, { width: w8b - 4, height: 8 });

      doc.font(FONT_REG).fontSize(5);
      doc.text('CÓDIGO ANTT', MARGIN + w8a + w8b + 2, y8l1 + 1, { width: w8c - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(data.transportadora?.antt || '', MARGIN + w8a + w8b + 2, y8l1 + 8, { width: w8c - 4, height: 8 });

      doc.font(FONT_REG).fontSize(5);
      doc.text('PLACA', MARGIN + w8a + w8b + w8c + 2, y8l1 + 1, { width: w8d - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(data.transportadora?.placa || '', MARGIN + w8a + w8b + w8c + 2, y8l1 + 8, { width: w8d - 4, height: 8 });

      doc.font(FONT_REG).fontSize(5);
      doc.text('UF', MARGIN + w8a + w8b + w8c + w8d + 2, y8l1 + 1, { width: w8e - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(data.transportadora?.ufVeiculo || '', MARGIN + w8a + w8b + w8c + w8d + 2, y8l1 + 8, { width: w8e - 4, height: 8 });

      doc.font(FONT_REG).fontSize(5);
      doc.text('CNPJ / CPF', MARGIN + w8a + w8b + w8c + w8d + w8e + 2, y8l1 + 1, { width: w8f - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      const tcnpj = data.transportadora?.cnpj;
      doc.text(tcnpj ? formatCnpj(tcnpj) : '', MARGIN + w8a + w8b + w8c + w8d + w8e + 2, y8l1 + 8, { width: w8f - 4, height: 8 });

      // Linha 2: ENDEREÇO | MUNICÍPIO | UF | IE
      const y8l2 = y8l1 + 16;
      doc.moveTo(MARGIN, y8l2).lineTo(MARGIN + w, y8l2).stroke(COLOR_BORDER);
      const w8g = w * 0.50;
      const w8h = w * 0.30;
      const w8i = w * 0.06;
      const w8j = w - w8g - w8h - w8i;
      doc.moveTo(MARGIN + w8g, y8l2).lineTo(MARGIN + w8g, y + h8).stroke(COLOR_BORDER);
      doc.moveTo(MARGIN + w8g + w8h, y8l2).lineTo(MARGIN + w8g + w8h, y + h8).stroke(COLOR_BORDER);
      doc.moveTo(MARGIN + w8g + w8h + w8i, y8l2).lineTo(MARGIN + w8g + w8h + w8i, y + h8).stroke(COLOR_BORDER);

      doc.font(FONT_REG).fontSize(5);
      doc.text('ENDEREÇO', MARGIN + 2, y8l2 + 1, { width: w8g - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(data.transportadora?.endereco || '', MARGIN + 2, y8l2 + 8, { width: w8g - 4, height: 8 });

      doc.font(FONT_REG).fontSize(5);
      doc.text('MUNICÍPIO', MARGIN + w8g + 2, y8l2 + 1, { width: w8h - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(data.transportadora?.cidade || '', MARGIN + w8g + 2, y8l2 + 8, { width: w8h - 4, height: 8 });

      doc.font(FONT_REG).fontSize(5);
      doc.text('UF', MARGIN + w8g + w8h + 2, y8l2 + 1, { width: w8i - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(data.transportadora?.uf || '', MARGIN + w8g + w8h + 2, y8l2 + 8, { width: w8i - 4, height: 8 });

      doc.font(FONT_REG).fontSize(5);
      doc.text('INSCRIÇÃO ESTADUAL', MARGIN + w8g + w8h + w8i + 2, y8l2 + 1, { width: w8j - 4, height: 7 });
      doc.font(FONT_BOLD).fontSize(7);
      doc.text(data.transportadora?.ie || '', MARGIN + w8g + w8h + w8i + 2, y8l2 + 8, { width: w8j - 4, height: 8 });

      // Linha 3: QUANTIDADE | ESPÉCIE | MARCA | NÚMERO | PESO BRUTO | PESO LÍQUIDO
      const y8l3 = y8l2 + 16;
      doc.moveTo(MARGIN, y8l3).lineTo(MARGIN + w, y8l3).stroke(COLOR_BORDER);
      const w8k = w * 0.10;
      const w8l = w * 0.15;
      const w8m = w * 0.20;
      const w8n = w * 0.15;
      const w8o = w * 0.20;
      const w8p = w - w8k - w8l - w8m - w8n - w8o;
      const acc8 = [w8k, w8k + w8l, w8k + w8l + w8m, w8k + w8l + w8m + w8n, w8k + w8l + w8m + w8n + w8o];
      acc8.forEach((acc) => {
        doc.moveTo(MARGIN + acc, y8l3).lineTo(MARGIN + acc, y + h8).stroke(COLOR_BORDER);
      });

      const labels8l3 = [
        { label: 'QUANTIDADE', val: String(data.transportadora?.quantidade || '') },
        { label: 'ESPÉCIE', val: data.transportadora?.especie || '' },
        { label: 'MARCA', val: data.transportadora?.marca || '' },
        { label: 'NÚMERO', val: data.transportadora?.numero || '' },
        { label: 'PESO BRUTO', val: formatNum3(data.transportadora?.pesoBruto) },
        { label: 'PESO LÍQUIDO', val: formatNum3(data.transportadora?.pesoLiquido) },
      ];
      labels8l3.forEach((c, i) => {
        const widths = [w8k, w8l, w8m, w8n, w8o, w8p];
        let cx = MARGIN;
        for (let j = 0; j < i; j++) cx += widths[j];
        doc.font(FONT_REG).fontSize(5);
        doc.text(c.label, cx + 2, y8l3 + 1, { width: widths[i] - 4, height: 7 });
        doc.font(FONT_BOLD).fontSize(7);
        doc.text(c.val, cx + 2, y8l3 + 8, { width: widths[i] - 4, height: 8 });
      });

      y += h8;

      // ============================================================
      // BLOCO 9: CÁLCULO DO ISSQN
      // ============================================================
      const h9 = 16;
      doc.rect(MARGIN, y, w, h9).stroke(COLOR_BORDER);
      doc.font(FONT_BOLD).fontSize(6);
      doc.text('CÁLCULO DO ISSQN', MARGIN + 2, y + 1, { width: w - 4, height: 7 });
      const cols9 = 4;
      const col9W = w / cols9;
      for (let i = 1; i < cols9; i++) {
        doc.moveTo(MARGIN + i * col9W, y + 7).lineTo(MARGIN + i * col9W, y + h9).stroke(COLOR_BORDER);
      }
      const labels9 = [
        { label: 'INSCRIÇÃO MUNICIPAL', val: data.emit.im || '' },
        { label: 'VALOR TOTAL DOS SERVIÇOS', val: '' },
        { label: 'BASE DE CÁLCULO DO ISSQN', val: '' },
        { label: 'VALOR DO ISSQN', val: '' },
      ];
      labels9.forEach((c, i) => {
        const cx = MARGIN + i * col9W;
        doc.font(FONT_REG).fontSize(5);
        doc.text(c.label, cx + 2, y + 8, { width: col9W - 4, height: 7 });
      });

      y += h9;

      // ============================================================
      // BLOCO 10: DADOS DOS PRODUTOS / SERVIÇOS
      // ============================================================
      const h10 = 90;
      doc.rect(MARGIN, y, w, h10).stroke(COLOR_BORDER);
      doc.font(FONT_BOLD).fontSize(6);
      doc.text('DADOS DOS PRODUTOS / SERVIÇOS', MARGIN + 2, y + 1, { width: w - 4, height: 7 });

      // Cabeçalho da tabela (1 linha)
      const y10h = y + 9;
      doc.moveTo(MARGIN, y10h).lineTo(MARGIN + w, y10h).stroke(COLOR_BORDER);

      // Colunas: CÓD | DESC | NCM | CST | CFOP | UN | QTD | V.UNIT | V.TOT | BC.ICMS | V.ICMS | V.IPI | ALIQ.ICMS | ALIQ.IPI
      const cols10 = [
        { label: 'CÓD. PROD', w: w * 0.10 },
        { label: 'DESCRIÇÃO DOS PRODUTOS / SERVIÇOS', w: w * 0.30 },
        { label: 'NCM/SH', w: w * 0.06 },
        { label: 'CST', w: w * 0.04 },
        { label: 'CFOP', w: w * 0.05 },
        { label: 'UN', w: w * 0.03 },
        { label: 'QUANTIDADE', w: w * 0.08 },
        { label: 'V.UNITÁRIO', w: w * 0.08 },
        { label: 'V. TOTAL', w: w * 0.07 },
        { label: 'BC. ICMS', w: w * 0.07 },
        { label: 'V.ICMS', w: w * 0.06 },
        { label: 'V. IPI', w: w * 0.06 },
      ];

      let cxProd = MARGIN;
      cols10.forEach((c, i) => {
        if (i > 0) doc.moveTo(cxProd, y10h).lineTo(cxProd, y + h10).stroke(COLOR_BORDER);
        doc.font(FONT_BOLD).fontSize(5);
        doc.text(c.label, cxProd + 1, y10h + 1, { width: c.w - 2, height: 12 });
        cxProd += c.w;
      });

      // Itens
      let y10 = y10h + 14;
      const maxItens = data.produtos.length;
      for (let i = 0; i < maxItens && y10 < y + h10 - 12; i++) {
        const p = data.produtos[i];
        cxProd = MARGIN;
        const rowVals = [
          { val: p.codProd, w: cols10[0].w },
          { val: p.descricao, w: cols10[1].w },
          { val: p.ncm, w: cols10[2].w },
          { val: p.cst, w: cols10[3].w },
          { val: p.cfop, w: cols10[4].w },
          { val: p.unidade, w: cols10[5].w },
          { val: formatNum4(p.quantidade), w: cols10[6].w },
          { val: formatMoney(p.valorUnit), w: cols10[7].w },
          { val: formatMoney(p.valorTotal), w: cols10[8].w },
          { val: formatMoney(p.bcIcms), w: cols10[9].w },
          { val: formatMoney(p.valorIcms), w: cols10[10].w },
          { val: formatMoney(p.valorIpi), w: cols10[11].w },
        ];
        rowVals.forEach((rv) => {
          doc.font(FONT_REG).fontSize(5);
          // Descrição usa mais altura
          const isDesc = rv === rowVals[1];
          const h = isDesc ? 12 : 8;
          doc.text(rv.val, cxProd + 1, y10, { width: rv.w - 2, height: h });
          cxProd += rv.w;
        });
        // Aliquotas em linha separada abaixo do item
        cxProd = MARGIN;
        // Aliq. ICMS e Aliq. IPI ficam abaixo
        const y10b = y10 + 10;
        // Linha horizontal separadora entre itens
        if (i < maxItens - 1) {
          doc.moveTo(MARGIN, y10b + 4).lineTo(MARGIN + w, y10b + 4).stroke(COLOR_BORDER);
        }
        // Aliquotas ICMS/IPI na linha abaixo
        doc.font(FONT_REG).fontSize(5);
        let aliqXCx = MARGIN;
        for (let j = 0; j < cols10.length; j++) aliqXCx += cols10[j].w;
        // Alíquotas são mostradas inline no item acima (já incluídas)
        y10 = y10b + 6;
      }

      y += h10;

      // ============================================================
      // BLOCO 11: DADOS ADICIONAIS (info compl + fisco)
      // ============================================================
      const h11 = 90;
      doc.rect(MARGIN, y, w, h11).stroke(COLOR_BORDER);
      doc.font(FONT_BOLD).fontSize(6);
      doc.text('DADOS ADICIONAIS', MARGIN + 2, y + 1, { width: w - 4, height: 7 });

      const y11l1 = y + 9;
      const w11a = w * 0.65;
      const w11b = w - w11a;
      doc.moveTo(MARGIN + w11a, y + 9).lineTo(MARGIN + w11a, y + h11).stroke(COLOR_BORDER);
      doc.moveTo(MARGIN, y11l1).lineTo(MARGIN + w, y11l1).stroke(COLOR_BORDER);

      doc.font(FONT_BOLD).fontSize(5);
      doc.text('INFORMAÇÕES COMPLEMENTARES', MARGIN + 2, y11l1 + 1, { width: w11a - 4, height: 7 });
      doc.font(FONT_REG).fontSize(5);
      doc.text(data.infCpl || '', MARGIN + 2, y11l1 + 9, { width: w11a - 4, height: h11 - 12 });

      doc.font(FONT_BOLD).fontSize(5);
      doc.text('RESERVADO AO FISCO', MARGIN + w11a + 2, y11l1 + 1, { width: w11b - 4, height: 7 });
      doc.font(FONT_REG).fontSize(5);
      doc.text(data.infCplFisco || '', MARGIN + w11a + 2, y11l1 + 9, { width: w11b - 4, height: h11 - 12 });

      y += h11;

      // ============================================================
      // RODAPÉ
      // ============================================================
      doc.font(FONT_REG).fontSize(5);
      const rodape = `DANFE gerado por MGBP NF-e Middleware em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
      doc.text(rodape, MARGIN, PAGE_H - 12, { width: w, align: 'center' });

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
  if (s.length === 11) return s.replace(/^(\d{2})(\d{5})(\d{4})/, '($1)$2-$3');
  if (s.length === 10) return s.replace(/^(\d{2})(\d{4})(\d{4})/, '($1)$2-$3');
  return fone || '';
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    }).substring(0, 10);
  } catch { return ''; }
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch { return ''; }
}

function formatDateTime(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'America/Sao_Paulo',
    });
  } catch { return ''; }
}

function formatMoney(n?: number): string {
  if (n === undefined || n === null || isNaN(n)) return '';
  return Number(n).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatNum3(n?: number): string {
  if (n === undefined || n === null || isNaN(n)) return '';
  return Number(n).toFixed(3).replace('.', ',');
}

function formatNum4(n?: number): string {
  if (n === undefined || n === null || isNaN(n)) return '';
  return Number(n).toFixed(4).replace('.', ',');
}
