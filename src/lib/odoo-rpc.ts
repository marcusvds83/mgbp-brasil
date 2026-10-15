/**
 * src/lib/odoo-rpc.ts - Cliente XML-RPC para Odoo (versao MGBP Brasil)
 * ==================================================================
 * Comunicacao com o Odoo via XML-RPC (compativel com Odoo 16/17/18/19).
 * - authenticate(): obtem UID com email + API Key
 * - executeKw(): chamada generica execute_kw
 * - searchRead() / read() / write() / create(): wrappers de conveniencia
 * - filtrarCamposExistentes(): descobre quais campos existem no modelo
 * - descobrirCampoCnpj(): encontra o melhor campo de CNPJ disponivel
 *
 * Importante: usamos o modulo `xmlrpc` (Promise-based via wrappers manuais).
 * O modulo `axios` com JSON-RPC nao funciona em Odoo Online (sistema comum).
 */

import xmlrpc from 'xmlrpc';
import { config, odooConfigured } from './config';

// ============================================================
// Cliente XML-RPC (2 clientes: /common para auth, /object para dados)
// ============================================================

interface OdooClients {
  common: xmlrpc.Client;
  models: xmlrpc.Client;
}

let cachedClients: OdooClients | null = null;
let cachedUid: number | null = null;
let cachedUidExpires = 0;

function createClients(): OdooClients {
  if (cachedClients) return cachedClients;
  const base = config.odoo.url;
  if (!base) throw new Error('ODOO_URL nao configurada');

  const host = base.replace(/^https?:\/\//, '');
  const isSecure = base.startsWith('https');
  const port = isSecure ? 443 : 80;
  const createFn = isSecure ? xmlrpc.createSecureClient : xmlrpc.createClient;

  cachedClients = {
    common: createFn({ host, path: '/xmlrpc/2/common', port }),
    models: createFn({ host, path: '/xmlrpc/2/object', port }),
  };
  return cachedClients;
}

function promisify<T>(
  fn: (cb: (err: Error | null, value: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, value) => {
      if (err) reject(err);
      else resolve(value);
    });
  });
}

/** Autentica no Odoo (com cache de 50 minutos). */
export async function authenticate(): Promise<number> {
  if (cachedUid && Date.now() < cachedUidExpires) return cachedUid;

  const clients = createClients();
  const uid = await promisify<number | false>((cb) =>
    clients.common.methodCall(
      'authenticate',
      [config.odoo.db, config.odoo.user, config.odoo.apiKey, {}],
      cb
    )
  );

  if (uid === false || uid === null) {
    throw new Error('API Key Odoo invalida ou usuario sem acesso a database.');
  }
  cachedUid = uid as number;
  cachedUidExpires = Date.now() + 50 * 60 * 1000;
  console.log(`[ODOO] Autenticado: uid=${uid} db=${config.odoo.db}`);
  return uid;
}

/** Wrapper generico execute_kw. */
export async function executeKw<T = unknown>(
  model: string,
  method: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {}
): Promise<T> {
  const clients = createClients();
  const uid = await authenticate();
  return promisify<T>((cb) =>
    clients.models.methodCall(
      'execute_kw',
      [config.odoo.db, uid, config.odoo.apiKey, model, method, args, kwargs],
      cb
    )
  );
}

/** search_read (Odoo 17+) ou search+read (Odoo 19/20) - wrapper compativel.
 * Odoo 20+ mudou: limit/offset/order DEVEM ser kwargs, NÃO positional args.
 */
export async function searchRead<T = Record<string, unknown>>(
  model: string,
  domain: unknown[],
  fields: string[],
  opts: { limit?: number; offset?: number; order?: string } = {}
): Promise<T[]> {
  // Tenta search_read primeiro (funciona na maioria das versoes)
  try {
    const kwargs: Record<string, unknown> = {};
    if (opts.limit !== undefined && opts.limit > 0) kwargs.limit = opts.limit;
    if (opts.offset !== undefined && opts.offset > 0) kwargs.offset = opts.offset;
    if (opts.order) kwargs.order = opts.order;
    const result = await executeKw<T[]>(model, 'search_read', [
      domain,
      fields,
    ], kwargs);
    return result;
  } catch (e) {
    // Fallback: search + read (Odoo 19+)
    console.warn(`[ODOO] search_read falhou para ${model}, fallback search+read: ${(e as Error).message}`);
    const ids = await search(model, domain, opts);
    if (!ids || !ids.length) return [];
    return await read<T>(model, ids, fields);
  }
}

/** search() - retorna IDs.
 * Odoo 20+: limit/offset DEVEM ser kwargs. Em kwargs, undefined não é enviado ( Odoo ignora). */
export async function search(
  model: string,
  domain: unknown[],
  opts: { limit?: number; offset?: number; order?: string } = {}
): Promise<number[]> {
  const kwargs: Record<string, unknown> = {};
  if (opts.limit !== undefined && opts.limit > 0) kwargs.limit = opts.limit;
  if (opts.offset !== undefined && opts.offset > 0) kwargs.offset = opts.offset;
  if (opts.order) kwargs.order = opts.order;
  return executeKw<number[]>(model, 'search', [domain], kwargs);
}

/** read() - le registros por IDs. */
export async function read<T = Record<string, unknown>>(
  model: string,
  ids: number[],
  fields: string[]
): Promise<T[]> {
  if (!ids.length) return [];
  // stock.location: buscar um por vez com id= (evita bug stock_barcode)
  if (model === 'stock.location') {
    const results: T[] = [];
    for (const id of ids) {
      try {
        const r = await executeKw<T[]>(model, 'search_read', [
          [['id', '=', id]],
          fields,
        ]);
        if (r && r.length) results.push(r[0]);
      } catch (e) { /* ignore */ }
    }
    return results;
  }
  // Outros modelos: search_read com id in
  return await executeKw<T[]>(model, 'search_read', [
    [['id', 'in', ids]],
    fields,
  ]);
}

/** write() - atualiza registros. */
export async function write(
  model: string,
  ids: number[],
  values: Record<string, unknown>
): Promise<boolean> {
  return executeKw<boolean>(model, 'write', [ids, values]);
}

/** create() - cria um novo registro. */
export async function create(
  model: string,
  values: Record<string, unknown>
): Promise<number> {
  return executeKw<number>(model, 'create', [values]);
}

/**
 * Descobre quais campos de uma lista realmente existem no modelo.
 * Usado para compatibilidade com Odoo Online (sem l10n_br) vs comunitario.
 */
export async function filtrarCamposExistentes(
  modelo: string,
  camposDesejados: string[]
): Promise<string[]> {
  if (!camposDesejados.length) return [];
  try {
    const fieldIds = await executeKw<number[]>('ir.model.fields', 'search', [
      [['model', '=', modelo], ['name', 'in', camposDesejados]],
    ], { limit: camposDesejados.length });
    if (!fieldIds || !fieldIds.length) return [];
    const fields = await executeKw<{ name: string }[]>('ir.model.fields', 'read', [
      fieldIds,
      ['name'],
    ]);
    const existentes = new Set(fields.map((f) => f.name));
    return camposDesejados.filter((c) => existentes.has(c));
  } catch (e) {
    console.warn(`[ODOO] Erro ao filtrar campos de ${modelo}:`, (e as Error).message);
    return [];
  }
}

/**
 * Descobre o melhor campo de CNPJ/CPF disponivel no modelo.
 * Prioridade: cnpj_cpf (l10n_br) > x_mgbp_cnpj > vat > company_registry
 */
export async function descobrirCampoCnpj(
  modelo: string
): Promise<string | null> {
  const candidatos = [
    'cnpj_cpf',
    'x_mgbp_cnpj',
    // compatibilidade com mgbp
    'x_nytro_cnpj',
    'vat',
    'company_registry',
  ];
  const validos = await filtrarCamposExistentes(modelo, candidatos);
  return validos[0] || null;
}

/** Extrai CNPJ/CPF de um registro, retorna so digitos. */
export function extrairCnpj(
  record: Record<string, unknown>,
  campoCnpj: string | null,
  fallback?: string
): string {
  if (campoCnpj && record[campoCnpj]) {
    return String(record[campoCnpj]).replace(/[^0-9]/g, '');
  }
  if (fallback) return String(fallback).replace(/[^0-9]/g, '');
  return '';
}

/** Invalida UID em caso de erro 401 (permite re-autenticar no proximo uso). */
export function invalidateUid() {
  cachedUid = null;
  cachedUidExpires = 0;
}

/**
 * Cria um ir.attachment e vincula a mail.message no chatter do registro.
 * Retorna o attachment_id criado.
 *
 * Compatibilidade Odoo 16/17/18 (campo `datas`) vs Odoo 19/20 (campo `raw`
 * ou `db_datas`). O campo `datas` foi removido no Odoo 20 - se enviado, o
 * registro é criado mas o conteúdo é ignorado, gerando anexo com
 * file_size=0 (vazio).
 */
export async function uploadAnexo(
  model: string,
  resId: number,
  nome: string,
  conteudo: Buffer | string,
  mimetype: string,
  msgBody: string
): Promise<number> {
  const buf = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'utf-8');
  const base64 = buf.toString('base64');
  console.log(`[ODOO] Criando anexo ${nome} (${Math.round(base64.length * 0.75)} bytes)...`);

  // Detecta o campo binário correto para a versão do Odoo em uso.
  // Ordem preferida: raw (Odoo 19/20) > db_datas (alternativo Odoo 20) > datas (Odoo <=18).
  let campoBinario = 'datas'; // fallback antigo
  try {
    const camposValidos = await filtrarCamposExistentes('ir.attachment', ['raw', 'db_datas', 'datas']);
    if (camposValidos.includes('raw')) {
      campoBinario = 'raw';
    } else if (camposValidos.includes('db_datas')) {
      campoBinario = 'db_datas';
    } else if (camposValidos.includes('datas')) {
      campoBinario = 'datas';
    }
  } catch (e) {
    console.warn(`[ODOO] Falha ao detectar campo binário de ir.attachment, usando 'datas' (fallback antigo):`, (e as Error).message);
  }
  console.log(`[ODOO] Campo binário ir.attachment selecionado: ${campoBinario}`);

  const attachmentId = await create('ir.attachment', {
    name: nome,
    [campoBinario]: base64,
    res_model: model,
    res_id: resId,
    mimetype: mimetype,
  });
  console.log(`[ODOO] ir.attachment criado: id=${attachmentId} (campo ${campoBinario}, ${buf.length} bytes)`);

  try {
    await create('mail.message', {
      model,
      res_id: resId,
      body: msgBody,
      message_type: 'comment',
      attachment_ids: [[6, 0, [attachmentId]]],
    });
    console.log(`[ODOO] mail.message criada com anexo ${nome}`);
  } catch (msgErr) {
    console.warn(
      `[ODOO] mail.message falhou (anexo existe como ir.attachment id=${attachmentId}):`,
      (msgErr as Error).message
    );
  }
  return attachmentId;
}

/** Testa conexao Odoo - retorna {sucesso, uid, db, user}. */
export async function testarConexao(): Promise<{
  sucesso: boolean;
  uid?: number;
  db?: string;
  user?: string;
  url?: string;
  erro?: string;
}> {
  try {
    if (!odooConfigured()) {
      return { sucesso: false, erro: 'Odoo nao configurado (verifique ODOO_URL/DB/USER/API_KEY)' };
    }
    const uid = await authenticate();
    return {
      sucesso: true,
      uid,
      db: config.odoo.db,
      user: config.odoo.user,
      url: config.odoo.url,
    };
  } catch (e) {
    invalidateUid();
    return { sucesso: false, erro: (e as Error).message };
  }
}
