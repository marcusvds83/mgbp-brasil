/**
 * src/lib/nfe-xml.ts - Gerador de XML NF-e v4.00 para MGBP Brasil
 * =====================================================================
 * Gera o XML <NFe> a partir de dados da fatura Odoo.
 *
 * Especificidades do setor MGBP (Eletrodomésticos Importados):
 *   - Suporte a 3 tipos de operação principais:
 *       1. Venda para Consumidor Final (CFOP 6108 interestadual + DIFAL)
 *       2. Venda para Revenda (CFOP 6102 interestadual B2B)
 *       3. Entrega Futura com Simples Faturamento (CFOP 6922, sem circulação)
 *   - Produtos importados (sempre orig=1 - estrangeira importação direta)
 *   - Regime tributário: Lucro Presumido (CST 00 ICMS + IPI)
 *       - Para entrega futura: CST 141 (Isento)
 *       - Para não contribuinte fora do estado: DIFAL aplicado
 *   - Rastreamento por número de série único (sem lote)
 *   - ICMS 4% interestadual (produtos importados com alíquota específica)
 *   - IPI 3,25% (produtos importados - NCM 85166000/84181000)
 *   - Campo customizado x_mgbp_descricao_nfe no product.product
 */

import { config } from './config';

const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';

// ============================================================
// Helpers de endereço (parse de street + número, normalização)
// ============================================================

function onlyNum(s: string | undefined | null): string {
  return String(s || '').replace(/\D/g, '');
}

function parseStreetNumber(street: string, number?: string): { street: string; number: string } {
  if (!street) return { street: '', number: number || 'S/N' };
  if (number && number !== 'S/N' && String(number).trim() !== '') {
    return { street, number: String(number) };
  }
  let m = street.match(/^(.+?),\s*(\d+[\w]?(?:\s*[A-Za-zÀ-ÿ]+)?)\s*$/);
  if (m) return { street: m[1].trim(), number: m[2].trim() };
  m = street.match(/^(.+?),\s*(\d+)\s+(.+)$/);
  if (m) return { street: m[1].trim(), number: m[2].trim() };
  m = street.match(/^(.+?)\s+(\d+)\s*$/);
  if (m) return { street: m[1].trim(), number: m[2].trim() };
  return { street, number: number || 'S/N' };
}

// ============================================================
// Cálculo de chave de acesso NF-e (44 dígitos)
// ============================================================

function calcDV(chave43: string): string {
  let soma = 0;
  let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) {
    const n = parseInt(chave43[i], 10);
    soma += n * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const mod = soma % 11;
  if (mod === 0 || mod === 1) return '0';
  return String(11 - mod);
}

export function montarChave(params: {
  cUF: string;
  aamm: string;
  cnpjEmit: string;
  modelo: string;
  serie: string;
  numero: number;
  tpEmis: string;
  cnf: string;
}): string {
  const base =
    params.cUF +
    params.aamm +
    onlyNum(params.cnpjEmit).padStart(14, '0') +
    params.modelo +
    String(params.serie).padStart(3, '0') +
    String(params.numero).padStart(9, '0') +
    params.tpEmis +
    String(params.cnf).padStart(8, '0');
  const dv = calcDV(base);
  return base + dv;
}

function gerarCNF(): string {
  return String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
}

// ============================================================
// Tags de endereço (emit e dest)
// ============================================================

interface EnderecoData {
  cnpj?: string;
  cpf?: string;
  xNome?: string;
  xLgr?: string;
  nro?: string;
  xCpl?: string;
  xBairro?: string;
  cMun?: string;
  xMun?: string;
  uf?: string;
  cep?: string;
  cPais?: string;
  xPais?: string;
  fone?: string;
  ie?: string;
  iest?: string;
  im?: string;
  email?: string;
  // Indicador de IE do destinatário (1=contribuinte, 2=isento, 9=não contribuinte)
  indIEDest?: string;
}

function tagEnder(ender: EnderecoData, tagPrefix: 'emit' | 'dest'): string {
  if (!ender) return '';
  const { street, number } = parseStreetNumber(ender.xLgr || '', ender.nro);
  const cnpj = onlyNum(ender.cnpj);
  const cpf = onlyNum(ender.cpf);

  let docTag = '';
  if (cnpj && cnpj.length === 14) {
    docTag = `<CNPJ>${cnpj}</CNPJ>`;
  } else if (cpf && cpf.length === 11) {
    docTag = `<CPF>${cpf}</CPF>`;
  }

  const ie = onlyNum(ender.ie);
  // indIEDest: 1=contribuinte com IE, 2=isento, 9=não contribuinte
  let indIETag = '';
  if (tagPrefix === 'dest') {
    const indIEDest = ender.indIEDest || (ie ? '1' : cpf ? '9' : '2');
    indIETag = `<indIEDest>${indIEDest}</indIEDest>`;
  }
  const im = ender.im ? `<IM>${ender.im}</IM>` : '';

  const enderTag =
    tagPrefix === 'emit' ? `<enderEmit>` : `<enderDest>`;
  const enderClose =
    tagPrefix === 'emit' ? `</enderEmit>` : `</enderDest>`;

  const endereco = `${enderTag}` +
    `<xLgr>${street || 'NAO INFORMADO'}</xLgr>` +
    `<nro>${number || 'S/N'}</nro>` +
    (ender.xCpl ? `<xCpl>${ender.xCpl}</xCpl>` : '') +
    (ender.xBairro ? `<xBairro>${ender.xBairro}</xBairro>` : '') +
    `<cMun>${ender.cMun || '9999999'}</cMun>` +
    `<xMun>${ender.xMun || 'EXTERIOR'}</xMun>` +
    `<UF>${ender.uf || 'EX'}</UF>` +
    (ender.cep ? `<CEP>${onlyNum(ender.cep).padStart(8, '0')}</CEP>` : '') +
    (ender.cPais ? `<cPais>${ender.cPais}</cPais>` : '') +
    (ender.xPais ? `<xPais>${ender.xPais}</xPais>` : '') +
    (ender.fone ? `<fone>${onlyNum(ender.fone).padStart(6, '0')}</fone>` : '') +
    `${enderClose}`;

  const xNome = ender.xNome
    ? `<xNome>${escapeXml(ender.xNome)}</xNome>`
    : '';

  return `<${tagPrefix}>` +
    docTag +
    xNome +
    indIETag +
    (ie ? `<IE>${ie}</IE>` : '') +
    (ender.iest ? `<IEST>${onlyNum(ender.iest)}</IEST>` : '') +
    im +
    endereco +
    (ender.email ? `<email>${escapeXml(ender.email)}</email>` : '') +
    `</${tagPrefix}>`;
}

// ============================================================
// Tags de produto (det + prod + impostos)
// ============================================================

export interface ProdutoData {
  nItem: number;
  cProd?: string;
  cEan?: string;
  xProd: string;
  ncm: string;
  cest?: string;
  cfop: string;
  uCom: string;
  qCom: number;
  vUnCom: number;
  vProd: number;
  // Número de série único (MGBP rastreia por serial, sem lote)
  numeroSerie?: string;
  // Impostos
  icmsCst?: string;
  icmsPRedBC?: number;
  icmsVICMS?: number;
  icmsPICMS?: number;
  icmsVBC?: number;
  // DIFAL (venda para não contribuinte fora do estado)
  icmsVBCUFDest?: number;
  icmsPICMSUFDest?: number;
  icmsPICMSInter?: number;
  icmsPICMSInterPart?: number;
  icmsVFCPUFDest?: number;
  icmsVICMSUFDest?: number;
  icmsVICMSUFRemet?: number;
  pisCst?: string;
  cofinsCst?: string;
  ipiCst?: string;
  ipiVBC?: number;
  ipiPIPI?: number;
  ipiVIPI?: number;
  // Origem do produto (1 = estrangeira - importação direta)
  orig?: string;
}

function tagProduto(p: ProdutoData): string {
  // Produto base
  let prod = `<prod>` +
    `<cProd>${escapeXml(p.cProd || String(p.nItem).padStart(3, '0'))}</cProd>` +
    (p.cEan && p.cEan !== 'SEM GTIN' ? `<cEAN>${p.cEan}</cEAN>` : `<cEAN/>`) +
    `<xProd>${escapeXml(p.xProd)}</xProd>` +
    `<NCM>${onlyNum(p.ncm)}</NCM>` +
    (p.cest ? `<CEST>${onlyNum(p.cest)}</CEST>` : '') +
    `<CFOP>${onlyNum(p.cfop)}</CFOP>` +
    `<uCom>${escapeXml(p.uCom)}</uCom>` +
    `<qCom>${formatNum(p.qCom, 4)}</qCom>` +
    `<vUnCom>${formatNum(p.vUnCom, 10)}</vUnCom>` +
    `<vProd>${formatNum(p.vProd, 2)}</vProd>` +
    `<indTot>1</indTot>` +
    `</prod>`;

  // Rastreabilidade - número de série único (sem lote)
  if (p.numeroSerie) {
    prod += `<rastro>` +
      `<nLote/>` +
      `<qLote>0</qLote>` +
      `<dFab>${new Date().toISOString().substring(0, 10)}</dFab>` +
      `<dVal>${new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().substring(0, 10)}</dVal>` +
      `<cAgreg>${escapeXml(p.numeroSerie)}</cAgreg>` +
      `</rastro>`;
  }

  // Impostos
  const impostos = gerarImpostos(p);

  // Info adicional (número de série para produtos eletrônicos)
  let infAdProd = '';
  if (p.numeroSerie) {
    infAdProd = `<infAdProd>SÉRIE: ${p.numeroSerie}</infAdProd>`;
  }

  return `<det nItem="${p.nItem}">${prod}${impostos}${infAdProd}</det>`;
}

/**
 * Gera bloco <imposto> baseado no regime tributário e tipo de operação.
 * MGBP usa Lucro Presumido (default) com:
 *   - CST 00 ICMS (tributada integralmente) para vendas normais
 *   - CST 100 (CSOSN 100 Simples LC 118/22) quando Simples Nacional
 *   - CST 141 (Isento) para entrega futura
 *   - DIFAL aplicado quando venda interestadual para não contribuinte
 *   - IPI 3,25% para produtos importados (NCM 85166000/84181000)
 */
function gerarImpostos(p: ProdutoData): string {
  const regime = config.mgbp.regimeTributario;
  const vProd = p.vProd || 0;
  // Origem: 1 = estrangeira - importação direta (todos produtos MGBP são importados)
  const orig = p.orig || '1';

  // ICMS - default por regime
  let icms = '';
  if (regime === 'simples_nacional') {
    // Simples Nacional - CSOSN 100 (MGBP pode usar Simples + LC 118)
    // Visto na NF 5515 e 5560 com CST=100
    icms = `<ICMS><ICMSSN102>` +
      `<orig>${orig}</orig>` +
      `<CSOSN>${p.icmsCst || '102'}</CSOSN>` +
      `</ICMSSN102></ICMS>`;
  } else if (regime === 'lucro_presumido') {
    // Lucro Presumido - CST 00 (tributada integralmente) - default para MGBP
    const vBC = p.icmsVBC ?? vProd;
    const pICMS = p.icmsPICMS ?? 4.0; // 4% interestadual (visto nas NFs MGBP)
    const vICMS = p.icmsVICMS ?? +((vBC * pICMS) / 100).toFixed(2);
    // Se há DIFAL (venda interestadual para não contribuinte), usa ICMSUFDest
    if (p.icmsVBCUFDest && p.icmsPICMSUFDest) {
      // Partilha ICMS - DIFAL
      icms = `<ICMS><ICMSUFDest>` +
        `<orig>${orig}</orig>` +
        `<CST>${p.icmsCst || '00'}</CST>` +
        `<vBCUFDest>${formatNum(p.icmsVBCUFDest, 2)}</vBCUFDest>` +
        (p.icmsVBCUFRemet ? `<vBCUFRemet>${formatNum(p.icmsVBCUFRemet, 2)}</vBCUFRemet>` : '') +
        `<pICMSUFDest>${formatNum(p.icmsPICMSUFDest, 4)}</pICMSUFDest>` +
        `<pICMSInter>${formatNum(p.icmsPICMSInter || 4, 4)}</pICMSInter>` +
        `<pICMSInterPart>${formatNum(p.icmsPICMSInterPart || 100, 4)}</pICMSInterPart>` +
        (p.icmsVFCPUFDest ? `<vFCPUFDest>${formatNum(p.icmsVFCPUFDest, 2)}</vFCPUFDest>` : '') +
        `<vICMSUFDest>${formatNum(p.icmsVICMSUFDest || 0, 2)}</vICMSUFDest>` +
        `<vICMSUFRemet>${formatNum(p.icmsVICMSUFRemet || 0, 2)}</vICMSUFRemet>` +
        `</ICMSUFDest></ICMS>`;
    } else {
      // ICMS normal sem DIFAL
      icms = `<ICMS><ICMS00>` +
        `<orig>${orig}</orig>` +
        `<CST>${p.icmsCst || '00'}</CST>` +
        `<modBC>3</modBC>` +
        `<vBC>${formatNum(vBC, 2)}</vBC>` +
        `<pICMS>${formatNum(pICMS, 4)}</pICMS>` +
        `<vICMS>${formatNum(vICMS, 2)}</vICMS>` +
        `<pFCP>0.0000</pFCP>` +
        `<vFCP>0.00</vFCP>` +
        `</ICMS00></ICMS>`;
    }
  } else {
    // Lucro Real - mesmo CST 00
    const vBC = p.icmsVBC ?? vProd;
    const pICMS = p.icmsPICMS ?? 4.0;
    const vICMS = p.icmsVICMS ?? +((vBC * pICMS) / 100).toFixed(2);
    icms = `<ICMS><ICMS00>` +
      `<orig>${orig}</orig>` +
      `<CST>${p.icmsCst || '00'}</CST>` +
      `<modBC>3</modBC>` +
      `<vBC>${formatNum(vBC, 2)}</vBC>` +
      `<pICMS>${formatNum(pICMS, 4)}</pICMS>` +
      `<vICMS>${formatNum(vICMS, 2)}</vICMS>` +
      `</ICMS00></ICMS>`;
  }

  // IPI - CST 50 (tributado) para produtos importados em Lucro Presumido
  // MGBP usa IPI 3,25% (visto nas NFs)
  let ipi = '';
  if (regime !== 'simples_nacional') {
    const vBCIPI = p.ipiVBC ?? vProd;
    const pIPI = p.ipiPIPI ?? 3.25; // 3,25% IPI para eletrodomésticos importados
    const vIPI = p.ipiVIPI ?? +((vBCIPI * pIPI) / 100).toFixed(2);
    ipi = `<IPI>` +
      `<cEnq>999</cEnq>` +
      `<IPITrib>` +
      `<CST>${p.ipiCst || '50'}</CST>` +
      `<vBC>${formatNum(vBCIPI, 2)}</vBC>` +
      `<pIPI>${formatNum(pIPI, 4)}</pIPI>` +
      `<vIPI>${formatNum(vIPI, 2)}</vIPI>` +
      `</IPITrib>` +
      `</IPI>`;
  }

  // PIS - CST 08 (não tributado) para Simples Nacional
  // Para Lucro Presumido: CST 01 (tributado com alíquota 0,65%)
  const pis = `<PIS>` +
    (regime === 'simples_nacional'
      ? `<PISNT><CST>${p.pisCst || '08'}</CST></PISNT>`
      : `<PISAliq><CST>${p.pisCst || '01'}</CST><vBC>${formatNum(vProd, 2)}</vBC><pPIS>0.6500</pPIS><vPIS>${formatNum(vProd * 0.0065, 2)}</vPIS></PISAliq>`) +
    `</PIS>`;

  // COFINS - CST 08 (não tributado) para Simples
  // Para Lucro Presumido: CST 01 (tributado com alíquota 3%)
  const cofins = `<COFINS>` +
    (regime === 'simples_nacional'
      ? `<COFINSNT><CST>${p.cofinsCst || '08'}</CST></COFINSNT>`
      : `<COFINSAliq><CST>${p.cofinsCst || '01'}</CST><vBC>${formatNum(vProd, 2)}</vBC><pCOFINS>3.0000</pCOFINS><vCOFINS>${formatNum(vProd * 0.03, 2)}</vCOFINS></COFINSAliq>`) +
    `</COFINS>`;

  // Tributos aproximados (19% default para eletrodomésticos importados)
  const vTotTrib = +(vProd * 0.19).toFixed(2);

  return `<imposto>` +
    `<vTotTrib>${formatNum(vTotTrib, 2)}</vTotTrib>` +
    icms +
    ipi +
    pis +
    cofins +
    `</imposto>`;
}

// ============================================================
// Helpers XML
// ============================================================

function escapeXml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatNum(n: number, dec: number): string {
  return Number(n || 0).toFixed(dec).replace('.', '.');
}

// ============================================================
// Gerador principal do XML NFe
// ============================================================

export interface NFeData {
  // Emitente
  emit: EnderecoData;
  // Destinatário
  dest?: EnderecoData | null;
  // Produtos
  produtos: ProdutoData[];
  // Numeração
  serie: string;
  numero: number;
  // Datas
  dhEmi: string;
  // Valores
  vFrete?: number;
  vSeg?: number;
  vDesc?: number;
  vOutro?: number;
  // Tipo de operação (0=entrada, 1=saída)
  tpNF?: 0 | 1;
  // Tipo de operação MGBP
  tipoOperacao?: 'venda_consumidor' | 'venda_revenda' | 'entrega_futura' | 'venda_interna';
  // Forma de pagamento (0=à vista, 1=a prazo, 2=outros)
  indPag?: 0 | 1 | 2;
  // Informações complementares (NF 5560 tem pedido + local de entrega)
  pedido?: string;
  localEntrega?: EnderecoData; // Quando local de entrega ≠ destinatário
  infCpl?: string;
}

/**
 * Gera o XML da NF-e (sem assinatura) a partir dos dados da fatura Odoo.
 */
export function gerarXmlNFe(data: NFeData): string {
  const cUF = getCodUf(data.emit.uf || 'PR');
  const aamm = data.dhEmi.substring(2, 7).replace('-', '').replace(/-/g, '').substring(0, 4);
  const cnf = gerarCNF();
  const chave = montarChave({
    cUF,
    aamm,
    cnpjEmit: data.emit.cnpj || '',
    modelo: '55',
    serie: data.serie,
    numero: data.numero,
    tpEmis: '1',
    cnf,
  });

  // Totais
  const vProd = data.produtos.reduce((sum, p) => sum + (p.vProd || 0), 0);
  const vIPI = data.produtos.reduce((s, p) => s + (p.ipiVIPI || 0), 0);
  const vICMS = data.produtos.reduce((s, p) => s + (p.icmsVICMS || 0), 0);
  const vNF = vProd + (data.vFrete || 0) + (data.vSeg || 0) +
    (data.vOutro || 0) - (data.vDesc || 0) + vIPI;

  const emitTag = tagEnder(data.emit, 'emit');

  // Tag dest - em entrega futura o dest existe com CNPJ/IE
  let destTag = '';
  if (data.dest) {
    destTag = tagEnder(data.dest, 'dest');
  }

  // Tag entrega (quando local de entrega diferente do destinatário)
  let entregaTag = '';
  if (data.localEntrega) {
    const { street, number } = parseStreetNumber(data.localEntrega.xLgr || '', data.localEntrega.nro);
    const cnpjEntrega = onlyNum(data.localEntrega.cnpj);
    entregaTag = `<entrega>` +
      (cnpjEntrega.length === 14 ? `<CNPJ>${cnpjEntrega}</CNPJ>` : '') +
      (data.localEntrega.xLgr ? `<xLgr>${street}</xLgr>` : '') +
      `<nro>${number || 'S/N'}</nro>` +
      (data.localEntrega.xCpl ? `<xCpl>${data.localEntrega.xCpl}</xCpl>` : '') +
      (data.localEntrega.xBairro ? `<xBairro>${data.localEntrega.xBairro}</xBairro>` : '') +
      `<cMun>${data.localEntrega.cMun || '9999999'}</cMun>` +
      `<xMun>${data.localEntrega.xMun}</xMun>` +
      `<UF>${data.localEntrega.uf}</UF>` +
      (data.localEntrega.cep ? `<CEP>${onlyNum(data.localEntrega.cep).padStart(8, '0')}</CEP>` : '') +
      `</entrega>`;
  }

  // Tag ide
  const tpNF = data.tpNF ?? 1;
  const indPag = data.indPag ?? 0;
  // idDest: 1=interna, 2=interestadual, 3=com exterior
  const idDest = data.dest && data.dest.uf && data.emit.uf && data.dest.uf !== data.emit.uf ? 2 : 1;
  // indFinal: 0=normal (revenda), 1=consumidor final
  const indFinal = data.tipoOperacao === 'venda_consumidor' ? 1 : 0;
  // indPres: 9=não se aplica (presencial)
  const indPres = '1';

  const ide = `<ide>` +
    `<cUF>${cUF}</cUF>` +
    `<cNF>${cnf}</cNF>` +
    `<natOp>${escapeXml(getNaturezaOperacao(data.tipoOperacao))}</natOp>` +
    `<mod>55</mod>` +
    `<serie>${data.serie}</serie>` +
    `<nNF>${data.numero}</nNF>` +
    `<dhEmi>${data.dhEmi}</dhEmi>` +
    `<tpNF>${tpNF}</tpNF>` +
    `<idDest>${idDest}</idDest>` +
    `<cMunFG>${data.emit.cMun || config.mgbp.codMunEmitente}</cMunFG>` +
    `<tpImp>1</tpImp>` + // DANFE normal retrato
    `<tpEmis>1</tpEmis>` + // emissão normal
    `<cDV>${chave[43]}</cDV>` +
    `<tpAmb>${config.nfe.tpAmb}</tpAmb>` +
    `<finNFe>1</finNFe>` + // normal
    `<indFinal>${indFinal}</indFinal>` +
    `<indPres>${indPres}</indPres>` +
    `<procEmi>0</procEmi>` + // emissão com aplicativo do contribuinte
    `<verProc>nfe-mgbp-1.0.0</verProc>` +
    `</ide>`;

  // Produtos
  const det = data.produtos.map((p) => tagProduto(p)).join('');

  // Total
  const total = `<total>` +
    `<ICMSTot>` +
    `<vBC>${formatNum(vProd, 2)}</vBC>` +
    `<vICMS>${formatNum(vICMS, 2)}</vICMS>` +
    `<vICMSDeson>0.00</vICMSDeson>` +
    `<vFCP>0.00</vFCP>` +
    `<vBCST>0.00</vBCST>` +
    `<vST>0.00</vST>` +
    `<vFCPST>0.00</vFCPST>` +
    `<vFCPSTRet>0.00</vFCPSTRet>` +
    `<vProd>${formatNum(vProd, 2)}</vProd>` +
    `<vFrete>${formatNum(data.vFrete || 0, 2)}</vFrete>` +
    `<vSeg>${formatNum(data.vSeg || 0, 2)}</vSeg>` +
    `<vDesc>${formatNum(data.vDesc || 0, 2)}</vDesc>` +
    `<vII>0.00</vII>` +
    `<vIPI>${formatNum(vIPI, 2)}</vIPI>` +
    `<vIPIDevol>0.00</vIPIDevol>` +
    `<vPIS>0.00</vPIS>` +
    `<vCOFINS>0.00</vCOFINS>` +
    `<vOutro>${formatNum(data.vOutro || 0, 2)}</vOutro>` +
    `<vNF>${formatNum(vNF, 2)}</vNF>` +
    `</ICMSTot>` +
    `</total>`;

  // Transporte (default CIF=0)
  const transp = `<transp>` +
    `<modFrete>0</modFrete>` +
    `</transp>`;

  // Pagamento
  const pag = `<pag>` +
    `<detPag>` +
    `<indPag>${indPag}</indPag>` +
    `<tPag>99</tPag>` +
    `<vPag>${formatNum(vNF, 2)}</vPag>` +
    `</detPag>` +
    `</pag>`;

  // Informações adicionais MGBP
  let infCpl = data.infCpl || '';
  let infAdFisco = '';

  if (data.tipoOperacao === 'venda_consumidor') {
    // Venda para consumidor final - DIFAL aplicado
    infCpl = infCpl || 'PRODUTO VENDA NO ESTADO';
  } else if (data.tipoOperacao === 'venda_revenda') {
    // Venda para revenda B2B
    infCpl = infCpl || 'Venda para revenda';
  } else if (data.tipoOperacao === 'entrega_futura') {
    // Entrega futura com simples faturamento
    infCpl = infCpl || 'Lançamento efetuado a título de simples faturamento - entrega futura';
    infAdFisco = 'Operação de entrega futura conforme art. 7º §6º Conv. SF 87/91';
  }

  // Pedido (visto na NF 5560: "Pedido 7001 - Showroom loja Gabriel - concedido 10% de desconto...")
  if (data.pedido) {
    infCpl = (infCpl ? infCpl + ' | ' : '') + `Pedido: ${data.pedido}`;
  }

  // Local de entrega (visto na NF 5560)
  if (data.localEntrega) {
    infCpl = (infCpl ? infCpl + ' | ' : '') + 'LOCAL DE ENTREGA diferente do destinatário (ver tag <entrega>)';
  }

  // Tributos aproximados (IBPT)
  const vTotTrib = +(vProd * 0.19).toFixed(2);
  infCpl = (infCpl ? infCpl + ' | ' : '') +
    `Valor total aproximado de tributos: Federais R$ 0,00 (0%), Estaduais R$ 0,00 (0%), Municipais R$ 0,00 (0%). Fonte IBPT.`;

  const infAdic = (infCpl || infAdFisco) ?
    `<infAdic>` +
    (infAdFisco ? `<infAdFisco>${escapeXml(infAdFisco)}</infAdFisco>` : '') +
    (infCpl ? `<infCpl>${escapeXml(infCpl)}</infCpl>` : '') +
    `</infAdic>` : '';

  // Monta o XML final
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<NFe xmlns="${NFE_NS}">` +
    `<infNFe Id="NFe${chave}" versao="4.00">` +
    ide +
    emitTag +
    destTag +
    entregaTag +
    det +
    total +
    transp +
    pag +
    infAdic +
    `</infNFe>` +
    `</NFe>`;

  return xml;
}

/** Retorna o código IBGE (2 dígitos) da UF. */
function getCodUf(uf: string): string {
  const map: Record<string, string> = {
    AC: '12', AL: '13', AP: '16', AM: '13', BA: '29', CE: '23',
    DF: '53', ES: '32', GO: '52', MA: '21', MT: '51', MS: '50',
    MG: '31', PA: '15', PB: '25', PR: '41', PE: '26', PI: '22',
    RJ: '33', RN: '24', RO: '11', RR: '14', RS: '43', SC: '42',
    SE: '28', SP: '35', TO: '17', EX: '99',
  };
  return map[uf.toUpperCase()] || '41';
}

/** Retorna a natureza da operação conforme tipo MGBP. */
function getNaturezaOperacao(tipo?: string): string {
  switch (tipo) {
    case 'venda_consumidor':
      return 'Vnd de merc. adqu./rec. de terc., dest. a não contribuinte';
    case 'venda_revenda':
      return 'Venda Merc.Adq.e/ou Receb.Terceiros';
    case 'entrega_futura':
      return 'Lancto Efetuado a Título de Simples Fat.';
    case 'venda_interna':
      return 'Venda de mercadoria';
    default:
      return 'Venda de mercadoria';
  }
}
