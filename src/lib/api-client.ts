/**
 * Cliente HTTP para a API interna do middleware NF-e MGBP Brasil.
 * Encapsula autenticacao via API Key (persistida em localStorage).
 */

export class ApiClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string = '') {
    this.apiKey = apiKey || (typeof localStorage !== 'undefined' ? localStorage.getItem('mgbp-brasil-middleware-api-key') || '' : '');
    this.baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  }

  setApiKey(key: string) {
    this.apiKey = key;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('mgbp-brasil-middleware-api-key', key);
    }
  }

  getApiKey(): string {
    return this.apiKey;
  }

  clearApiKey() {
    this.apiKey = '';
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('mgbp-brasil-middleware-api-key');
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(this.baseUrl + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.request(method, path, body);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ erro: res.statusText }));
      throw new Error(err.erro || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // === Health ===
  health() {
    return this.json<{ servico: string; versao: string; odoo: any; firebase: any; nfe: any }>('GET', '/api/v1/health');
  }

  // === Certificado ===
  getCertStatus() {
    return this.json<{ configurado: boolean; titular?: string; cnpj?: string; validoAte?: string; diasRestantes?: number; expirado?: boolean; erro?: string }>('GET', '/api/v1/nfe/certificado');
  }

  uploadCert(pfxBase64: string, senha: string) {
    return this.json<{ sucesso: boolean; info: any; erro?: string }>('POST', '/api/v1/nfe/certificado', { pfxBase64, senha });
  }

  removeCert() {
    return this.json<{ sucesso: boolean; mensagem: string }>('DELETE', '/api/v1/nfe/certificado');
  }

  // === SEFAZ ===
  getSefazStatus() {
    return this.json<{ online: boolean; cStat: string; xMotivo: string; ambiente: string; uf: string; autorizador: string; endpoint: string }>('GET', '/api/v1/nfe/sefaz/status');
  }

  // === Emissao ===
  emitir(moveId?: number) {
    return this.json<{ sucesso: boolean; chave?: string; protocolo?: string; cStat?: string; xMotivo?: string; erro?: string; processadas?: number; autorizadas?: number; erros?: number; detalhes?: any[]; duracao_ms?: number }>('POST', '/api/v1/nfe/emitir', moveId ? { move_id: moveId } : {});
  }

  cancelar(moveId: number, justificativa?: string) {
    return this.json<{ sucesso: boolean; cStat?: string; xMotivo?: string; erro?: string }>('POST', '/api/v1/nfe/cancelar', { move_id: moveId, justificativa });
  }

  processPending() {
    return this.json<{ sucesso: boolean; processadas: number; autorizadas: number; erros: number; detalhes: any[] }>('POST', '/api/v1/nfe/process-pending');
  }

  // === Dashboard ===
  getDashboard() {
    return this.json<{ conectado_odoo: boolean; nfs: NfItem[]; resumo: NfResumo; ambiente?: string; uf?: string; regime?: string; atualizado_em?: string; erro?: string }>('GET', '/api/v1/nfe/dashboard');
  }

  // === Odoo ===
  testOdoo() {
    return this.json<{ sucesso: boolean; uid?: number; db?: string; user?: string; url?: string; erro?: string }>('GET', '/api/v1/odoo/test-connection');
  }

  // === Firebase Service Account (persistir JSON inteiro no Firestore) ===
  getServiceAccountStatus() {
    return this.json<{ configurado: boolean; origem?: string; projectId?: string; clientEmail?: string; uploadedAt?: string; erro?: string }>('GET', '/api/v1/firebase/service-account');
  }

  uploadServiceAccount(serviceAccountJson: string) {
    return this.json<{ sucesso: boolean; info?: any; message?: string; erro?: string }>('POST', '/api/v1/firebase/service-account', { serviceAccountJson });
  }

  // === Logo MGBP para DANFE ===
  async uploadLogo(file: File) {
    const formData = new FormData();
    formData.append('logo', file);
    const res = await fetch(this.baseUrl + '/api/v1/mgbp/logo', {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ erro: res.statusText }));
      throw new Error(err.erro || `HTTP ${res.status}`);
    }
    return res.json();
  }

  getLogoStatus() {
    return this.json<{ configurado: boolean; size?: number; mimetype?: string; uploadedAt?: string; erro?: string }>('GET', '/api/v1/mgbp/logo');
  }

  removeLogo() {
    return this.json<{ sucesso: boolean; mensagem: string }>('DELETE', '/api/v1/mgbp/logo');
  }

  // === Downloads (blob) ===
  downloadXml(moveId: number) {
    return `${this.baseUrl}/api/v1/nfe/dashboard/${moveId}/xml?api_key=${encodeURIComponent(this.apiKey)}`;
  }

  downloadPdf(moveId: number) {
    return `${this.baseUrl}/api/v1/nfe/dashboard/${moveId}/pdf?api_key=${encodeURIComponent(this.apiKey)}`;
  }
}

export interface NfItem {
  id: number;
  name: string;
  partner: string;
  data: string;
  valor: number;
  status: string;
  chave: string;
  protocolo: string;
  tipo_operacao: string;
  erro?: string;
}

export interface NfResumo {
  total: number;
  autorizadas: number;
  pendentes: number;
  erros: number;
  canceladas: number;
}

let _instance: ApiClient | null = null;
export function getApiClient(): ApiClient {
  if (!_instance) _instance = new ApiClient();
  return _instance;
}
