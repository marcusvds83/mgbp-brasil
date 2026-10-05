/**
 * src/lib/config.ts - Configurações central do middleware NF-e MGBP Brasil
 * ====================================================================
 * Middleware para emissão própria de NF-e para MGBP Brasil Importação e Comércio.
 * Setor: Eletrodomésticos importados (fogões, refrigeradores, cooktops, coifas).
 *
 * Todas as configurações são lidas de variáveis de ambiente.
 * No Render, defina-as no painel Environment Variables.
 */

export const config = {
  // === Servidor ===
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  apiKey: process.env.API_KEY || '',

  // === Odoo (autenticação via email + API Key) ===
  odoo: {
    enabled: process.env.ODOO_ENABLED === '1',
    url: (process.env.ODOO_URL || '').replace(/\/+$/, ''),
    db: process.env.ODOO_DB || '',
    user: process.env.ODOO_USER || '',
    apiKey: process.env.ODOO_API_KEY || '',
    pollingIntervalMs: parseInt(process.env.ODOO_POLLING_MS || '20000', 10),
  },

  // === Firebase (cofre do certificado A1) ===
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    collection: process.env.FIREBASE_CERT_COLLECTION || 'certificados',
    docId: process.env.FIREBASE_CERT_DOC_ID || 'mgbp-a1',
  },

  // === NF-e (SEFAZ - emissão própria com certificado A1) ===
  nfe: {
    modo: process.env.NFE_EMISSAO_MODO || 'proprio', // 'proprio' | 'sieg'
    uf: (process.env.NFE_UF || 'PR').toUpperCase(),
    tpAmb: process.env.NFE_TP_AMB || '2', // 1=produção, 2=homologação
    certDir: process.env.NFE_CERT_DIR || '/var/data',
    certKek: process.env.NFE_CERT_KEK || process.env.API_KEY || 'mgbp-nfe-local-kek',
    danfeProvider: process.env.NFE_DANFE_PROVIDER || 'local',
    tlsInsecure: process.env.NFE_TLS_INSECURE === '1',
    statusOnError: process.env.NFE_STATUS_ON_ERROR || 'erro',
    versao: '4.00',
    seriePadrao: '1',
  },

  // === Setor Eletrodomésticos Importados MGBP - regras de negócio específicas ===
  mgbp: {
    // Regime tributário default (simples_nacional | lucro_presumido | lucro_real)
    // MGBP é Lucro Presumido (visto nas NFs: CST 00 ICMS + CST 100 Simples LC 118/22)
    regimeTributario: process.env.MGBP_REGIME_TRIBUTARIO || 'lucro_presumido',
    // NCM padrão para eletrodomésticos (85166000 = fogões/fornos elétricos)
    ncmPadrao: process.env.MGBP_NCM_PADRAO || '85166000',
    // CFOP defaults (operações mais comuns para MGBP)
    cfop: {
      // Venda interna (dentro do PR) - consumidor ou revenda
      vendaInternaConsumidor: '5102',  // Venda dentro do estado p/ consumidor final
      vendaInternaRevenda: '5102',      // Venda dentro do estado p/ contribuinte (revenda)
      // Venda interestadual (PR -> fora do estado)
      vendaForaConsumidor: '6108',      // Venda interestadual p/ não contribuinte (DIFAL)
      vendaForaRevenda: '6102',         // Venda interestadual p/ contribuinte (revenda)
      // Entrega futura com simples faturamento (não há circulação da mercadoria)
      entregaFuturaInterna: '5922',
      entregaFuturaFora: '6922',
    },
    // Estoques permitidos para emissão de NF-e (apenas 01, 03 e 11)
    // 01 - Produto Acabado (Novo)
    // 02 - Canibalizado (NÃO emite NF)
    // 03 - Venda no Estado
    // 04 - Showroom (NÃO emite NF)
    // 05 - Homologação (NÃO emite NF)
    // 11 - Partes e Peças
    estoquesEmiteNf: ['01', '03', '11'],
    // Unidades de medida padrão
    unidades: {
      produto: 'UNI', // Eletrodomésticos vendidos por unidade
      peca: 'UNI',    // Partes e peças por unidade
    },
    // Todos os produtos são importados
    todosProdutosImportados: true,
    // CNPJ do emitente (MGBP Brasil Importação e Comércio Ltda)
    cnpjEmitente: '20.728.251/0001-02',
    // Inscrição Estadual do emitente
    ieEmitente: '9067039715',
    // Inscrição Municipal do emitente
    imEmitente: '10 02 699.157-6',
    // Código IBGE do município do emitente (Curitiba-PR)
    codMunEmitente: '4106902',
  },

  // === Logs ===
  logLevel: process.env.LOG_LEVEL || 'info',
} as const;

/** Helper: ambiente é produção? */
export const isProd = config.nodeEnv === 'production';

/** Helper: ambiente é homologação? */
export const isHomolog = config.nfe.tpAmb === '2';

/** Helper: Odoo está configurado corretamente? */
export const odooConfigured = (): boolean =>
  config.odoo.enabled &&
  !!config.odoo.url &&
  !!config.odoo.db &&
  !!config.odoo.user &&
  !!config.odoo.apiKey;

/** Helper: Firebase está configurado? */
export const firebaseConfigured = (): boolean =>
  !!config.firebase.projectId &&
  !!config.firebase.clientEmail &&
  !!config.firebase.privateKey;
