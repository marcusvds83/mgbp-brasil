/**
 * src/lib/nfe-emit.ts - Dispatcher de emissão NF-e (polling Odoo) - MGBP Brasil
 * =====================================================================
 * Processa faturas pendentes no Odoo (campo x_mgbp_nfe_status =
 * 'pendente' ou 'processando'), gera o XML NF-e, assina com certificado A1,
 * envia para a SEFAZ, gera o DANFE PDF e atualiza o chatter do Odoo.
 *
 * Campos customizados no Odoo (account.move):
 *   x_mgbp_nfe_status         (vazio, pendente, processando, autorizada, cancelada, erro)
 *   x_mgbp_nfe_chave          (Char - chave 44 dígitos)
 *   x_mgbp_nfe_protocolo      (Char - número do protocolo)
 *   x_mgbp_nfe_xml            (Text - XML nfeProc)
 *   x_mgbp_nfe_erro           (Text - mensagem de erro)
 *   x_mgbp_nfe_dh_emissao    (Datetime)
 *   x_mgbp_nfe_tipo_operacao  (Selection: venda_consumidor, venda_revenda, entrega_futura)
 *   x_mgbp_nfe_estoque_origem (Many2one stock.location - valida apenas 01/03/11)
 *   x_mgbp_nfe_cfop           (Char - CFOP específico da operação)
 *
 * Campos customizados (res.company):
 *   x_mgbp_nfe_serie          (Char - default "1")
 *   x_mgbp_nfe_numero         (Integer - último número emitido)
 *   x_mgbp_nfe_inscricao_estadual (Char - IE do emitente)
 *
 * Campos customizados (product.product):
 *   x_mgbp_ncm                (Char - NCM específico)
 *   x_mgbp_cfop               (Char - CFOP default)
 *   x_mgbp_descricao_nfe      (Text - descrição para a NF-e)
 *   x_mgbp_unidade_medida     (Char - unidade UNI/UND/etc)
 *   x_mgbp_produto_importado  (Boolean - default True)
 *
 * Campos customizados (stock.location):
 *   x_mgbp_estoque_codigo     (Char - 01, 02, 03, 04, 05, 11)
 *   x_mgbp_emite_nf           (Boolean - apenas 01, 03, 11 = True)
 */

import { config, odooConfigured } from './config';
import {
  authenticate,
  executeKw,
  search,
  read,
  write,
  filtrarCamposExistentes,
  descobrirCampoCnpj,
  extrairCnpj,
  uploadAnexo,
  invalidateUid,
} from './odoo-rpc';
import { gerarXmlNFe, type NFeData, type ProdutoData } from './nfe-xml';
import { autorizarNFe } from './sefaz-client';
import { gerarPdfDanfe } from './danfe-pdf';
import { carregarCertificado } from './firebase-cert';

// ============================================================
// Tipagem interna
// ============================================================

interface PollingResult {
  processed: number;
  sucesso: number;
  erro: number;
  detalhes: Array<{
    move_id: number;
    move_name?: string;
    sucesso: boolean;
    chave?: string;
    protocolo?: string;
    cStat?: string;
    xMotivo?: string;
    erro?: string;
  }>;
}

interface CompanyData {
  id: number;
  name: string;
  street?: string;
  street2?: string;
  city?: string;
  city_id?: [number, string];
  state_id?: [number, string];
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  district?: string;
  country_id?: [number, string];
  vat?: string;
  company_registry?: string;
  cnpj_cpf?: string;
  [key: string]: unknown;
  _cnpj?: string;
  _cidade?: string;
  _uf?: string;
}

interface PartnerData {
  id: number;
  name: string;
  street?: string;
  street2?: string;
  city?: string;
  city_id?: [number, string];
  state_id?: [number, string];
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  district?: string;
  country_id?: [number, string];
  vat?: string;
  cnpj_cpf?: string;
  legal_name?: string;
  l10n_br_ie_code?: string;
  l10n_br_im_code?: string;
  l10n_br_isuf_code?: string;
  [key: string]: unknown;
  _cnpj?: string;
  _cpf?: string;
  _cidade?: string;
  _uf?: string;
  _ie?: string;
}

interface MoveData {
  id: number;
  name: string;
  partner_id: [number, string];
  company_id: [number, string];
  invoice_date?: string;
  amount_total: number;
  amount_untaxed: number;
  amount_tax: number;
  narration?: string;
  payment_reference?: string;
  invoice_line_ids: number[];
  [key: string]: unknown;
}

interface LineData {
  id: number;
  name?: string;
  quantity: number;
  price_unit: number;
  price_subtotal: number;
  product_id?: [number, string];
  tax_ids: number[];
  display_type?: string | boolean;
  // Número de série do produto vendido (MGBP rastreia por serial único)
  x_mgbp_numero_serie?: string;
  [key: string]: unknown;
}

interface ProductData {
  id: number;
  name: string;
  default_code?: string;
  barcode?: string;
  weight?: number;
  [key: string]: unknown;
}

// ============================================================
// Processamento de emissões pendentes (polling)
// ============================================================

export async function processPendingEmissions(): Promise<PollingResult> {
  const result: PollingResult = { processed: 0, sucesso: 0, erro: 0, detalhes: [] };

  if (!odooConfigured()) {
    console.warn('[NFE-EMIT] Odoo não configurado. Pulando polling.');
    return { ...result, processed: 0 } as any;
  }

  let uid: number;
  try {
    uid = await authenticate();
  } catch (e) {
    console.error('[NFE-EMIT] Falha na autenticação Odoo:', (e as Error).message);
    return { ...result, processed: 0 } as any;
  }

  // Busca faturas pendentes (apenas out_invoice posted com x_mgbp_nfe_status pendente/processando)
  let moveIds: number[];
  try {
    moveIds = await search('account.move', [
      ['move_type', '=', 'out_invoice'],
      ['state', '=', 'posted'],
      ['x_mgbp_nfe_status', 'in', ['pendente', 'processando']],
    ]);
  } catch (e) {
    console.error('[NFE-EMIT] Erro ao buscar pendentes:', (e as Error).message);
    return { ...result, processed: 0 } as any;
  }

  if (!moveIds.length) {
    return result;
  }

  console.log(`[NFE-EMIT] ${moveIds.length} fatura(s) pendente(s).`);

  for (const moveId of moveIds) {
    try {
      const r = await emitirNfeOdoo(moveId);
      result.detalhes.push({
        move_id: moveId,
        sucesso: r.sucesso,
        chave: r.chave,
        protocolo: r.protocolo,
        cStat: r.cStat,
        xMotivo: r.xMotivo,
        erro: r.erro,
      });
      if (r.sucesso) result.sucesso++;
      else result.erro++;
      result.processed++;
    } catch (e) {
      console.error(`[NFE-EMIT] Erro move_id=${moveId}:`, (e as Error).message);
      await safeUpdateError(moveId, (e as Error).message);
      result.detalhes.push({
        move_id: moveId,
        sucesso: false,
        erro: (e as Error).message,
      });
      result.erro++;
      result.processed++;
    }
  }

  return result;
}

// ============================================================
// Emissão de uma fatura
// ============================================================

interface EmissionResult {
  sucesso: boolean;
  chave?: string;
  protocolo?: string;
  cStat?: string;
  xMotivo?: string;
  erro?: string;
}

export async function emitirNfeOdoo(moveId: number): Promise<EmissionResult> {
  // 1. Marca como processando
  await write('account.move', [moveId], {
    x_mgbp_nfe_status: 'processando',
  });

  // 2. Carrega certificado A1
  const cert = await carregarCertificado();
  if (!cert || (!cert.pfx && !cert.privateKeyPem)) {
    throw new Error(
      'Certificado A1 não encontrado no Firebase. Faça upload via POST /api/v1/nfe/certificado'
    );
  }

  // 3. Descobre campos dinâmicos
  const campoCnpjCompany = await descobrirCampoCnpj('res.company');
  const campoCnpjPartner = await descobrirCampoCnpj('res.partner');
  console.log(`[NFE-EMIT] CNPJ: company=${campoCnpjCompany} partner=${campoCnpjPartner}`);

  // 4. Leitura da fatura (com campos customizados MGBP)
  const moves = await read<MoveData>('account.move', [moveId], [
    'name', 'partner_id', 'company_id', 'invoice_date', 'amount_total', 'amount_untaxed',
    'amount_tax', 'narration', 'payment_reference', 'invoice_line_ids',
    'x_mgbp_nfe_tipo_operacao',
    'x_mgbp_nfe_estoque_origem',
    'x_mgbp_nfe_cfop',
  ]);
  const move = moves[0];

  // 5. Validação do estoque origem (apenas 01, 03, 11 podem emitir NF)
  const estoqueId = move.x_mgbp_nfe_estoque_origem as number | undefined;
  if (!estoqueId) {
    throw new Error('Estoque de origem NF-e não preenchido. Selecione um dos estoques 01, 03 ou 11.');
  }
  const estoque = (await read<{ x_mgbp_emite_nf?: boolean; x_mgbp_estoque_codigo?: string; name: string }>(
    'stock.location', [estoqueId], ['name', 'x_mgbp_emite_nf', 'x_mgbp_estoque_codigo']
  ))[0];
  if (!estoque.x_mgbp_emite_nf) {
    throw new Error(`Estoque ${estoque.name} (código ${estoque.x_mgbp_estoque_codigo}) não pode emitir NF-e. Apenas estoques 01, 03 e 11 são autorizados.`);
  }
  console.log(`[NFE-EMIT] Estoque origem: ${estoque.name} (código ${estoque.x_mgbp_estoque_codigo})`);

  // 6. Leitura da empresa (campos MGBP)
  const camposCompanyDesejados = [
    'name', 'street', 'street2', 'city', 'city_id', 'state_id', 'state',
    'zip', 'phone', 'email', 'district', 'country_id', 'l10n_br_city_id',
    'company_registry', 'vat', 'website',
    'x_mgbp_nfe_serie', 'x_mgbp_nfe_numero',
    'x_mgbp_nfe_inscricao_estadual',
  ];
  const camposCompany = await filtrarCamposExistentes('res.company', camposCompanyDesejados);
  const companies = await read<CompanyData>('res.company', [move.company_id[0]], camposCompany);
  const company = companies[0];

  company._cnpj = extrairCnpj(company, campoCnpjCompany, config.mgbp.cnpjEmitente);
  if (company.city_id) {
    company._cidade = company.city_id[1] || '';
  } else if (company.city) {
    company._cidade = company.city;
  }
  if (company.state_id) {
    company._uf = company.state_id[1] || '';
  } else if (company.state) {
    company._uf = company.state;
  }

  console.log(
    `[NFE-EMIT] Empresa: ${company.name} CNPJ=${company._cnpj} Cidade=${company._cidade}/${company._uf}`
  );

  // 7. Leitura do parceiro (destinatário)
  const camposPartnerDesejados = [
    'name', 'street', 'street2', 'city', 'city_id', 'state_id', 'state',
    'zip', 'phone', 'email', 'district', 'country_id', 'country_code',
    'legal_name', 'company_name', 'vat', 'cnpj_cpf', 'l10n_br_city_id',
    'l10n_br_ie_code', 'l10n_br_im_code', 'l10n_br_isuf_code',
    'x_mgbp_cnpj',
  ];
  const camposPartner = await filtrarCamposExistentes('res.partner', camposPartnerDesejados);
  const partners = await read<PartnerData>('res.partner', [move.partner_id[0]], camposPartner);
  const partner = partners[0];

  // Distinção CNPJ vs CPF (consumidor final = CPF)
  const cnpjPartner = extrairCnpj(partner, campoCnpjPartner, '');
  if (cnpjPartner.length === 11) {
    partner._cpf = cnpjPartner;
    partner._cnpj = '';
    partner._ie = '';
  } else {
    partner._cnpj = cnpjPartner;
    partner._cpf = '';
    partner._ie = partner.l10n_br_ie_code || (partner.vat ? String(partner.vat) : '');
  }
  if (partner.city_id) {
    partner._cidade = partner.city_id[1] || '';
  } else if (partner.city) {
    partner._cidade = partner.city;
  }
  if (partner.state_id) {
    partner._uf = partner.state_id[1] || '';
  } else if (partner.state) {
    partner._uf = partner.state;
  }

  console.log(
    `[NFE-EMIT] Destinatário: ${partner.name} CNPJ=${partner._cnpj} CPF=${partner._cpf} IE=${partner._ie} Cidade=${partner._cidade}/${partner._uf}`
  );

  // 8. Leitura das linhas
  const allLines = await read<LineData & Record<string, unknown>>('account.move.line', move.invoice_line_ids, [
    'name', 'quantity', 'price_unit', 'price_subtotal', 'product_id', 'tax_ids', 'display_type',
    // Número de série do produto vendido (MGBP)
    'x_mgbp_numero_serie',
    'x_mgbp_cfop',
    'x_mgbp_ncm',
    'x_mgbp_descricao_nfe',
    'x_mgbp_unidade_medida',
  ]);
  const serviceLines = allLines.filter((l) => !l.display_type && l.price_subtotal > 0);

  // 9. Leitura dos produtos (com campos MGBP)
  const productIds = serviceLines
    .filter((l) => l.product_id)
    .map((l) => l.product_id![0])
    .filter(Boolean);
  const camposProdutoDesejados = [
    'name', 'default_code', 'barcode', 'weight',
    // Campos customizados MGBP
    'x_mgbp_ncm', 'x_mgbp_cfop', 'x_mgbp_descricao_nfe',
    'x_mgbp_unidade_medida', 'x_mgbp_produto_importado',
  ];
  const camposProduto = await filtrarCamposExistentes('product.product', camposProdutoDesejados);
  const products = productIds.length
    ? await read<ProductData>('product.product', productIds, camposProduto)
    : [];
  const productMap: Record<number, ProductData> = {};
  products.forEach((p) => { productMap[p.id] = p; });

  // 10. Incrementa numeração na empresa (próxima NF-e)
  const ultimoNumero = (company.x_mgbp_nfe_numero as number) || 5573; // default 5573 (última NF MGBP)
  const proximoNumero = ultimoNumero + 1;
  await write('res.company', [company.id], {
    x_mgbp_nfe_numero: proximoNumero,
  });

  // 11. Define tipo de operação MGBP
  const tipoOperacaoRaw = (move.x_mgbp_nfe_tipo_operacao as string) || 'venda_revenda';
  const tipoOperacao = ['venda_consumidor', 'venda_revenda', 'entrega_futura', 'venda_interna']
    .includes(tipoOperacaoRaw) ? tipoOperacaoRaw as any : 'venda_revenda';

  // 12. Monta lista de produtos para a NF-e
  const produtos: ProdutoData[] = serviceLines.map((line, idx) => {
    const product = line.product_id ? productMap[line.product_id[0]] : null;

    // CFOP - prioridade: linha > produto > calculado pelo tipo operação
    const cfopDefault = pickCfopMgbp(
      tipoOperacao,
      company._uf,
      partner._uf,
      !!partner._ie
    );
    const cfop = (line.x_mgbp_cfop as string) ||
                 (product?.x_mgbp_cfop as string) ||
                 (move.x_mgbp_nfe_cfop as string) ||
                 cfopDefault;

    // NCM - linha > produto > config default
    const ncm = (line.x_mgbp_ncm as string) ||
                (product?.x_mgbp_ncm as string) ||
                config.mgbp.ncmPadrao;

    // Descrição para a NF-e
    const xProd = (product?.x_mgbp_descricao_nfe as string) ||
                  (line.x_mgbp_descricao_nfe as string) ||
                  product?.name ||
                  line.name ||
                  'Produto sem descrição';

    // Unidade de medida
    const uCom = (line.x_mgbp_unidade_medida as string) ||
                 (product?.x_mgbp_unidade_medida as string) ||
                 'UNI';

    // Número de série do produto (MGBP rastreia por serial único)
    const numeroSerie = (line.x_mgbp_numero_serie as string) || undefined;

    // CST ICMS - depende do tipo de operação e regime
    // Venda normal: CST 00 (Lucro Presumido) ou CSOSN 100 (Simples LC 118)
    // Entrega futura: CST 141 (Isento)
    // Venda não contribuinte fora do estado: CST 00 com DIFAL
    let icmsCst = '00';
    if (tipoOperacao === 'entrega_futura') {
      icmsCst = '141'; // Isento
    } else if (config.mgbp.regimeTributario === 'simples_nacional') {
      icmsCst = '102'; // CSOSN 102 (não tributada pelo Simples)
      // Mas vimos CST 100 nas NFs MGBP - pode ser Simples + LC 118 com CSOSN 100
      icmsCst = '100';
    }

    // Cálculo do IPI 3,25% (visto nas NFs MGBP)
    const vProdLine = line.price_subtotal || 0;
    const pIPI = 3.25;
    const vIPI = +(vProdLine * pIPI / 100).toFixed(2);

    // Cálculo do ICMS 4% interestadual (visto nas NFs MGBP)
    // Para entrega futura: 0 (CST 141)
    const pICMS = tipoOperacao === 'entrega_futura' ? 0 : 4.0;
    const vICMS = tipoOperacao === 'entrega_futura' ? 0 : +(vProdLine * pICMS / 100).toFixed(2);
    const vBC = tipoOperacao === 'entrega_futura' ? 0 : vProdLine;

    // DIFAL - se venda interestadual para não contribuinte (CPF)
    const isDifal = tipoOperacao === 'venda_consumidor' &&
                    company._uf !== partner._uf &&
                    !partner._ie; // Não contribuinte (CPF sem IE)

    return {
      nItem: idx + 1,
      cProd: product?.default_code || String(idx + 1).padStart(3, '0'),
      cEan: product?.barcode || 'SEM GTIN',
      xProd,
      ncm,
      cfop,
      uCom,
      qCom: line.quantity,
      vUnCom: line.price_unit,
      vProd: line.price_subtotal,
      numeroSerie,
      // Impostos
      icmsCst,
      icmsVBC: vBC,
      icmsPICMS: pICMS,
      icmsVICMS: vICMS,
      ipiCst: tipoOperacao === 'entrega_futura' ? '51' : '50', // 50=tributado, 51=isento
      ipiVBC: tipoOperacao === 'entrega_futura' ? 0 : vProdLine,
      ipiPIPI: tipoOperacao === 'entrega_futura' ? 0 : pIPI,
      ipiVIPI: tipoOperacao === 'entrega_futura' ? 0 : vIPI,
      // DIFAL aplicado
      ...(isDifal ? {
        icmsVBCUFDest: vProdLine + vIPI, // BC DIFAL = valor produtos + IPI
        icmsPICMSUFDest: 17, // 17% UF destino (exemplo RS)
        icmsPICMSInter: 4, // 4% interestadual
        icmsPICMSInterPart: 100, // 100% para UF remetente no ano 1
        icmsVICMSUFDest: +((vProdLine + vIPI) * (17 - 4) * 0.40).toFixed(2), // 40% para UF dest
        icmsVICMSUFRemet: +((vProdLine + vIPI) * (17 - 4) * 0.60).toFixed(2), // 60% para UF origem
      } : {}),
      // Origem = 1 (estrangeira - importação direta)
      orig: '1',
    } as any;
  });

  // 13. Monta dados do NFe
  const serie = (company.x_mgbp_nfe_serie as string) || config.nfe.seriePadrao;
  const dhEmi = new Date().toISOString();
  const totalNF = move.amount_total;

  // Extrai IE do emitente
  const ieEmitente = (company.x_mgbp_nfe_inscricao_estadual as string) ||
                     (company.company_registry as string) ||
                     config.mgbp.ieEmitente;

  // Extrai IM do emitente
  const imEmitente = config.mgbp.imEmitente;

  const nfeData: NFeData = {
    emit: {
      cnpj: company._cnpj,
      xNome: company.name,
      xLgr: company.street,
      nro: company.street2,
      xBairro: (company.district as string),
      cMun: getMunicipioCode(company._cidade || '', company._uf || ''),
      xMun: company._cidade,
      uf: company._uf,
      cep: company.zip,
      cPais: '1058',
      xPais: 'Brasil',
      fone: company.phone,
      ie: ieEmitente,
      im: imEmitente,
    },
    dest: {
      cnpj: partner._cnpj,
      cpf: partner._cpf,
      xName: partner.legal_name || partner.name,
      xLgr: partner.street,
      nro: partner.street2,
      xBairro: (partner.district as string),
      cMun: getMunicipioCode(partner._cidade || '', partner._uf || ''),
      xMun: partner._cidade,
      uf: partner._uf,
      cep: partner.zip,
      cPais: '1058',
      xPais: 'Brasil',
      fone: partner.phone,
      email: partner.email,
      ie: partner._ie,
      indIEDest: partner._ie ? '1' : partner._cpf ? '9' : '2',
    },
    produtos,
    serie,
    numero: proximoNumero,
    dhEmi,
    tipoOperacao,
    infCpl: (move.narration as string) || '',
  };

  console.log('=============================================================');
  console.log(`[NFE-EMIT] INÍCIO - Fatura ${move.name} (move_id=${moveId})`);
  console.log(`[NFE-EMIT]   nNF: ${proximoNumero} (último=${ultimoNumero}) série=${serie}`);
  console.log(`[NFE-EMIT]   Empresa: ${company.name} CNPJ=${company._cnpj}`);
  console.log(`[NFE-EMIT]   Dest: ${partner.name} CNPJ/CPF=${partner._cnpj || partner._cpf}`);
  console.log(`[NFE-EMIT]   Estoque origem: ${estoque.name} (${estoque.x_mgbp_estoque_codigo})`);
  console.log(`[NFE-EMIT]   Valor: R$ ${totalNF}`);
  console.log(`[NFE-EMIT]   Operação: ${tipoOperacao}`);
  console.log(`[NFE-EMIT]   Ambiente: ${config.nfe.tpAmb === '2' ? 'HOMOLOGAÇÃO' : 'PRODUÇÃO'}`);

  // 14. Gera XML NF-e
  console.log('[NFE-EMIT] Etapa 1/4: Gerando XML NF-e...');
  const xmlNFe = gerarXmlNFe(nfeData);
  console.log(`[NFE-EMIT] XML gerado: ${xmlNFe.length} bytes`);

  // 15. Assina e autoriza na SEFAZ
  console.log('[NFE-EMIT] Etapa 2/4: Assinando e autorizando na SEFAZ...');
  const resultado = await autorizarNFe(xmlNFe);
  console.log(
    `[NFE-EMIT] Etapa 3/4: Resultado SEFAZ: sucesso=${resultado.autorizada} | cStat=${resultado.cStat}`
  );

  if (resultado.autorizada && resultado.nfeProc) {
    // Atualiza Odoo com sucesso
    let dataEmissao = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const updateData: Record<string, unknown> = {
      x_mgbp_nfe_status: 'autorizada',
      x_mgbp_nfe_chave: resultado.chave,
      x_mgbp_nfe_protocolo: resultado.protocolo,
      x_mgbp_nfe_dh_emissao: dataEmissao,
      x_mgbp_nfe_erro: false,
    };
    if (resultado.nfeProc && resultado.nfeProc.length < 50000) {
      updateData.x_mgbp_nfe_xml = resultado.nfeProc;
    }
    await write('account.move', [moveId], updateData);

    // Mensagem no chatter
    await executeKw('mail.message', 'create', [{
      model: 'account.move',
      res_id: moveId,
      body: `<b>NF-e Autorizada!</b><br/>` +
            `Chave: ${resultado.chave}<br/>` +
            `Protocolo: ${resultado.protocolo}<br/>` +
            `cStat: ${resultado.cStat} - ${resultado.xMotivo}`,
      message_type: 'comment',
    }]);

    // Anexa XML no chatter
    try {
      const xmlNome = `NFe-${resultado.chave}.xml`;
      await uploadAnexo(
        'account.move', moveId,
        xmlNome,
        resultado.nfeProc,
        'application/xml',
        `<b>XML NF-e ${proximoNumero}</b>`
      );
    } catch (e) {
      console.error('[NFE-EMIT] Falha ao anexar XML:', (e as Error).message);
    }

    // Anexa DANFE PDF no chatter
    console.log('[NFE-EMIT] Etapa 4/4: Gerando DANFE PDF...');
    try {
      const danfeData = extrairDadosDanfe(resultado.nfeProc, nfeData, totalNF);
      const pdfBuf = await gerarPdfDanfe(danfeData);
      const pdfNome = `DANFE-${String(proximoNumero).padStart(6, '0')}.pdf`;
      await uploadAnexo(
        'account.move', moveId,
        pdfNome, pdfBuf, 'application/pdf',
        `<b>DANFE ${proximoNumero}</b>`
      );
    } catch (e) {
      console.error('[NFE-EMIT] Falha ao gerar/anexar DANFE:', (e as Error).message);
    }

    console.log(`[NFE-EMIT] NF-e ${proximoNumero} autorizada para ${move.name}`);
    return {
      sucesso: true,
      chave: resultado.chave,
      protocolo: resultado.protocolo,
      cStat: resultado.cStat,
      xMotivo: resultado.xMotivo,
    };
  } else {
    // Atualiza erro no Odoo
    const errMsg = `SEFAZ rejeitou: ${resultado.cStat || 's/cStat'} - ${resultado.xMotivo || 'sem motivo'}`;
    await safeUpdateError(moveId, errMsg);
    return {
      sucesso: false,
      chave: resultado.chave,
      cStat: resultado.cStat,
      xMotivo: resultado.xMotivo,
      erro: errMsg,
    };
  }
}

/** Atualiza fatura como erro e posta no chatter. */
async function safeUpdateError(moveId: number, errMsg: string) {
  try {
    await write('account.move', [moveId], {
      x_mgbp_nfe_status: config.nfe.statusOnError,
      x_mgbp_nfe_erro: errMsg.substring(0, 1000),
    });
    await executeKw('mail.message', 'create', [{
      model: 'account.move',
      res_id: moveId,
      body: `<b>Erro na Emissão de NF-e</b><br/>${errMsg.substring(0, 500)}`,
      message_type: 'comment',
    }]);
  } catch (e) {
    console.error('[NFE-EMIT] Falha ao registrar erro:', (e as Error).message);
  }
}

/**
 * Pick CFOP MGBP baseado em tipo de operação, UF origem/destino e ind IE.
 * Regras (conforme NFs exemplo):
 *   - venda_consumidor (não contribuinte, CPF): 5102 (interna) ou 6108 (interestadual)
 *   - venda_revenda (contribuinte, CNPJ com IE): 5102 (interna) ou 6102 (interestadual)
 *   - entrega_futura: 5922 (interna) ou 6922 (interestadual)
 */
function pickCfopMgbp(
  tipoOperacao: string,
  ufOrigem?: string,
  ufDestino?: string,
  isContribuinte?: boolean
): string {
  const cfopConfig = config.mgbp.cfop;
  const isInterna = ufOrigem && ufDestino && ufOrigem === ufDestino;

  if (tipoOperacao === 'entrega_futura') {
    return isInterna ? cfopConfig.entregaFuturaInterna : cfopConfig.entregaFuturaFora;
  }
  if (tipoOperacao === 'venda_consumidor') {
    // Consumidor final (CPF, não contribuinte)
    return isInterna ? cfopConfig.vendaInternaConsumidor : cfopConfig.vendaForaConsumidor;
  }
  if (tipoOperacao === 'venda_revenda') {
    // Revenda (CNPJ com IE - contribuinte)
    return isInterna ? cfopConfig.vendaInternaRevenda : cfopConfig.vendaForaRevenda;
  }
  // Default: venda interna
  return cfopConfig.vendaInternaConsumidor;
}

/** Retorna o código IBGE (7 dígitos) do município. */
function getMunicipioCode(cidade: string, uf: string): string {
  // Map mínimo - em produção, usar tabela completa IBGE
  // Adicionado municípios das NFs MGBP
  const map: Record<string, string> = {
    'Curitiba': '4106902',
    'São Paulo': '3550308',
    'Sao Paulo': '3550308',
    'Rio de Janeiro': '3304557',
    'Belo Horizonte': '3106200',
    'Porto Alegre': '4314902',
    'Florianopolis': '4205407',
    'Florianópolis': '4205407',
    // Cidades das NFs MGBP
    'Torres': '4321503',  // RS (NF 5515)
    'Belém': '1501402',   // PA (NF 5573)
    'Belem': '1501402',
    'Colombo': '4105803', // PR (Topcon Express)
  };
  return map[cidade] || config.mgbp.codMunEmitente;
}

/** Extrai dados para o DANFE a partir do XML autorizado. */
function extrairDadosDanfe(
  nfeProcXml: string,
  nfeData: NFeData,
  valorTotal: number
): import('./danfe-pdf').DanfeData {
  function tag(name: string): string {
    const m = nfeProcXml.match(
      new RegExp('<' + name + '[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i')
    );
    return m ? m[1].trim() : '';
  }

  const chave = (nfeProcXml.match(/Id="(NFe\d{44})"/) || [])[1]?.slice(3) || '';
  const nNF = tag('nNF');
  const serie = tag('serie');
  const dhEmi = tag('dhEmi');
  const nProt = tag('nProt');

  return {
    chave,
    nNF,
    serie,
    dhEmi,
    emit: {
      nome: nfeData.emit.xNome || '',
      cnpj: nfeData.emit.cnpj || '',
      ie: nfeData.emit.ie,
      endereco: nfeData.emit.xLgr,
      cidade: nfeData.emit.xMun,
      uf: nfeData.emit.uf,
      cep: nfeData.emit.cep,
      fone: nfeData.emit.fone,
    },
    dest: nfeData.dest ? {
      nome: nfeData.dest.xName || '',
      cnpj: nfeData.dest.cnpj,
      cpf: nfeData.dest.cpf,
      endereco: nfeData.dest.xLgr,
      cidade: nfeData.dest.xMun,
      uf: nfeData.dest.uf,
      cep: nfeData.dest.cep,
      fone: nfeData.dest.fone,
    } : undefined,
    valorTotal,
    produtos: nfeData.produtos.map((p) => ({
      codProd: p.cProd || '',
      descricao: p.xProd,
      ncm: p.ncm,
      cfop: p.cfop,
      unidade: p.uCom,
      quantidade: p.qCom,
      valorUnit: p.vUnCom,
      valorTotal: p.vProd,
    })),
    protocolo: nProt,
    dhAutorizacao: dhEmi,
    infCpl: '',
  };
}
