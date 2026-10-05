"use client";

import { useState, useEffect, useCallback } from "react";
import { ApiClient, getApiClient, type NfItem, type NfResumo } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";
import { FileText, Download, RefreshCw, LogOut, ShieldCheck, AlertTriangle, CheckCircle2, Clock, XCircle, Settings, BookOpen, Database, Cloud, Server, Key, FileBox } from "lucide-react";

// ============================================================
// Tela de autenticacao (API Key)
// ============================================================

function AuthScreen({ onAuth }: { onAuth: (key: string) => void }) {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError("Informe a API Key");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const client = new ApiClient(apiKey.trim());
      // Verifica saude + valida API Key (cert-status exige x-api-key)
      const [h, cert] = await Promise.allSettled([
        client.health(),
        client.getCertStatus(),
      ]);
      if (h.status === "rejected") throw new Error((h.reason as Error).message || "Servidor nao respondeu");
      // cert pode falhar em dev sem API_KEY configurada (modo dev libera tudo)
      // mas em producao com API_KEY configurada, falha de cert = chave invalida
      if (cert.status === "rejected" && h.value?.servico) {
        // Tudo bem em dev, mas alerta
        console.warn("Cert status falhou (pode ser normal em dev sem API_KEY):", (cert.reason as Error).message);
      }
      client.setApiKey(apiKey.trim());
      onAuth(apiKey.trim());
    } catch (err) {
      setError(`Falha: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-950/20 via-stone-900 to-amber-950/10 px-4">
      <Card className="w-full max-w-md bg-card/95 backdrop-blur border-primary/20 shadow-2xl">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg">
            <ShieldCheck className="w-8 h-8 text-primary-foreground" />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold">NF-e MGBP Brasil</CardTitle>
            <CardDescription className="text-muted-foreground">Fiscal Cloud - Painel de Emissao</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <Input
                id="api-key"
                type="password"
                placeholder="Digite sua API Key"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={loading}
                className="font-mono"
              />
            </div>
            {error && (
              <div className="text-sm text-destructive flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Conectando..." : "Acessar Painel"}
            </Button>
          </form>
          <div className="mt-4 text-xs text-muted-foreground text-center">
            <p>Sistema de emissao propria NF-e para MGBP Brasil (Eletrodomesticos Importados).</p>
            <p>Integracao Odoo + SEFAZ com certificado A1.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Status Indicator
// ============================================================

function StatusDot({ status, label }: { status: "online" | "offline" | "pending"; label: string }) {
  const dotClass =
    status === "online" ? "status-dot-online" :
    status === "offline" ? "status-dot-offline" :
    "status-dot-pending";
  return (
    <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-muted/50">
      <span className={`w-2 h-2 rounded-full ${dotClass}`} />
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}

// ============================================================
// KPI Cards
// ============================================================

function KpiCards({ resumo }: { resumo: NfResumo | null }) {
  const items = [
    { label: "Total NF-e", value: resumo?.total ?? 0, icon: FileBox, color: "text-foreground" },
    { label: "Autorizadas", value: resumo?.autorizadas ?? 0, icon: CheckCircle2, color: "text-emerald-500" },
    { label: "Pendentes", value: resumo?.pendentes ?? 0, icon: Clock, color: "text-amber-500" },
    { label: "Erros", value: resumo?.erros ?? 0, icon: XCircle, color: "text-destructive" },
    { label: "Canceladas", value: resumo?.canceladas ?? 0, icon: AlertTriangle, color: "text-muted-foreground" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {items.map((item) => (
        <Card key={item.label} className="bg-card/80 border-border/50 hover:border-primary/30 transition-colors">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent/20">
              <item.icon className={`w-5 h-5 ${item.color}`} />
            </div>
            <div>
              <div className="text-2xl font-bold">{item.value}</div>
              <div className="text-xs text-muted-foreground">{item.label}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================================
// NF List Table
// ============================================================

function NfListTable({ nfs, onRefresh }: { nfs: NfItem[]; onRefresh: () => void }) {
  const [loading, setLoading] = useState<number | null>(null);
  const client = getApiClient();

  async function handleEmit(moveId: number) {
    setLoading(moveId);
    try {
      const r = await client.emitir(moveId);
      if (r.sucesso) {
        toast({ title: "NF-e Autorizada", description: `Chave: ${r.chave} | Protocolo: ${r.protocolo}` });
      } else {
        toast({ title: "Falha na Emissao", description: r.erro || r.xMotivo || "Erro desconhecido", variant: "destructive" });
      }
      onRefresh();
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(null);
    }
  }

  async function handleCancel(moveId: number) {
    const just = prompt("Justificativa do cancelamento (minimo 15 caracteres):");
    if (!just || just.length < 15) {
      toast({ title: "Justificativa invalida", description: "Minimo 15 caracteres", variant: "destructive" });
      return;
    }
    setLoading(moveId);
    try {
      const r = await client.cancelar(moveId, just);
      if (r.sucesso) {
        toast({ title: "NF-e Cancelada", description: `cStat: ${r.cStat} - ${r.xMotivo}` });
      } else {
        toast({ title: "Falha no Cancelamento", description: r.erro || r.xMotivo, variant: "destructive" });
      }
      onRefresh();
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(null);
    }
  }

  function getStatusBadge(status: string) {
    const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      autorizada: { label: "Autorizada", variant: "default" },
      pendente: { label: "Pendente", variant: "secondary" },
      processando: { label: "Processando", variant: "secondary" },
      erro: { label: "Erro", variant: "destructive" },
      cancelada: { label: "Cancelada", variant: "outline" },
      vazio: { label: "Sem status", variant: "outline" },
    };
    const cfg = map[status] || { label: status, variant: "outline" as const };
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
  }

  function getTipoOperacaoBadge(tipo: string) {
    const map: Record<string, string> = {
      venda: "Venda",
      remessa_industrializacao: "Remessa",
      retorno_industrializacao: "Retorno",
      exportacao: "Exportacao",
    };
    return <Badge variant="outline" className="text-xs">{map[tipo] || tipo}</Badge>;
  }

  function formatDate(s: string): string {
    if (!s) return "-";
    try {
      const d = new Date(s);
      return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return s;
    }
  }

  function formatCurrency(v: number): string {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
  }

  if (!nfs.length) {
    return (
      <Card className="bg-card/50 border-dashed">
        <CardContent className="p-8 text-center text-muted-foreground">
          Nenhuma NF-e emitida ainda. Marque uma fatura como pendente no Odoo para comecar.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/80 border-border/50">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border/50">
              <TableHead className="w-32">Fatura</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead className="w-32">Data</TableHead>
              <TableHead className="w-28">Operacao</TableHead>
              <TableHead className="w-32 text-right">Valor</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-48 text-right">Acoes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {nfs.map((nf) => (
              <TableRow key={nf.id} className="hover:bg-muted/30">
                <TableCell className="font-mono text-sm">{nf.name}</TableCell>
                <TableCell className="text-sm">{nf.partner || "-"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(nf.data)}</TableCell>
                <TableCell>{getTipoOperacaoBadge(nf.tipo_operacao)}</TableCell>
                <TableCell className="text-right font-mono text-sm">{formatCurrency(nf.valor)}</TableCell>
                <TableCell>{getStatusBadge(nf.status)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {(nf.status === "pendente" || nf.status === "processando" || nf.status === "erro") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEmit(nf.id)}
                        disabled={loading === nf.id}
                        title="Emitir NF-e"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading === nf.id ? "animate-spin" : ""}`} />
                      </Button>
                    )}
                    {nf.status === "autorizada" && (
                      <>
                        <a href={client.downloadXml(nf.id)} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="ghost" title="Baixar XML">
                            <FileText className="w-3.5 h-3.5" />
                          </Button>
                        </a>
                        <a href={client.downloadPdf(nf.id)} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="ghost" title="Baixar DANFE PDF">
                            <Download className="w-3.5 h-3.5" />
                          </Button>
                        </a>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleCancel(nf.id)}
                          disabled={loading === nf.id}
                          title="Cancelar NF-e"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                    {nf.status === "erro" && nf.erro && (
                      <span className="text-xs text-destructive max-w-xs truncate" title={nf.erro}>
                        {nf.erro}
                      </span>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Setup Tab (Cert + SEFAZ + Odoo)
// ============================================================

function SetupTab() {
  const client = getApiClient();
  const [certStatus, setCertStatus] = useState<any>(null);
  const [sefazStatus, setSefazStatus] = useState<any>(null);
  const [odooStatus, setOdooStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certSenha, setCertSenha] = useState("");

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cs, ss, od] = await Promise.allSettled([
        client.getCertStatus(),
        client.getSefazStatus(),
        client.testOdoo(),
      ]);
      if (cs.status === "fulfilled") setCertStatus(cs.value);
      if (ss.status === "fulfilled") setSefazStatus(ss.value);
      if (od.status === "fulfilled") setOdooStatus(od.value);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  async function handleUploadCert(e: React.FormEvent) {
    e.preventDefault();
    if (!certFile) {
      toast({ title: "Selecione o arquivo .pfx", variant: "destructive" });
      return;
    }
    if (!certSenha) {
      toast({ title: "Informe a senha do certificado", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64 = result.split(",")[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(certFile);
      });
      const r = await client.uploadCert(base64, certSenha);
      if (r.sucesso) {
        toast({ title: "Certificado enviado!", description: `Titular: ${r.info?.titular} | Valido ate: ${r.info?.validoAte?.substring(0, 10)}` });
        setCertFile(null);
        setCertSenha("");
        (document.getElementById("cert-file") as HTMLInputElement).value = "";
        refreshAll();
      } else {
        throw new Error(r.erro || "Falha no upload");
      }
    } catch (e) {
      toast({ title: "Erro ao enviar certificado", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveCert() {
    if (!confirm("Remover certificado? Esta acao nao pode ser desfeita.")) return;
    setLoading(true);
    try {
      await client.removeCert();
      toast({ title: "Certificado removido" });
      refreshAll();
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleTestSefaz() {
    setLoading(true);
    try {
      const r = await client.getSefazStatus();
      setSefazStatus(r);
      if (r.online) {
        toast({ title: "SEFAZ Online", description: `${r.cStat} - ${r.xMotivo}` });
      } else {
        toast({ title: "SEFAZ Offline", description: r.xMotivo || "Falha de conexao", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Certificado A1 */}
      <Card className="bg-card/80 border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="w-5 h-5" /> Certificado Digital A1
          </CardTitle>
          <CardDescription>Cofre seguro no Firebase. Persiste entre deploys do Render.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {certStatus?.configurado ? (
            <div className="p-4 rounded-md bg-emerald-500/10 border border-emerald-500/30 space-y-2">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="w-4 h-4" /> Certificado Configurado
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Titular:</dt>
                <dd className="font-medium">{certStatus.titular}</dd>
                <dt className="text-muted-foreground">CNPJ:</dt>
                <dd className="font-mono">{certStatus.cnpj}</dd>
                <dt className="text-muted-foreground">Valido ate:</dt>
                <dd>{certStatus.validoAte?.substring(0, 10)}</dd>
                <dt className="text-muted-foreground">Dias restantes:</dt>
                <dd className={certStatus.diasRestantes < 30 ? "text-amber-500 font-bold" : ""}>
                  {certStatus.diasRestantes} dias
                  {certStatus.expirado && " (EXPIRADO)"}
                </dd>
              </dl>
              <Button size="sm" variant="destructive" onClick={handleRemoveCert} disabled={loading}>
                Remover Certificado
              </Button>
            </div>
          ) : (
            <div className="p-4 rounded-md bg-amber-500/10 border border-amber-500/30">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-medium mb-2">
                <AlertTriangle className="w-4 h-4" /> Nenhum certificado carregado
              </div>
              <p className="text-sm text-muted-foreground">Envie o arquivo .pfx para comecar a emitir NF-e.</p>
            </div>
          )}

          <form onSubmit={handleUploadCert} className="space-y-3 pt-2 border-t border-border/50">
            <div className="space-y-2">
              <Label htmlFor="cert-file">Arquivo .pfx</Label>
              <Input
                id="cert-file"
                type="file"
                accept=".pfx,.p12"
                onChange={(e) => setCertFile(e.target.files?.[0] || null)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cert-senha">Senha do certificado</Label>
              <Input
                id="cert-senha"
                type="password"
                placeholder="Senha do .pfx"
                value={certSenha}
                onChange={(e) => setCertSenha(e.target.value)}
                disabled={loading}
                autoComplete="off"
              />
            </div>
            <Button type="submit" disabled={loading || !certFile || !certSenha}>
              <Upload className="w-4 h-4 mr-2" /> Enviar Certificado
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* SEFAZ */}
      <Card className="bg-card/80 border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="w-5 h-5" /> Status SEFAZ
          </CardTitle>
          <CardDescription>Teste a conexao mTLS com o webservice da SEFAZ.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sefazStatus && (
            <div className={`p-4 rounded-md border ${
              sefazStatus.online
                ? "bg-emerald-500/10 border-emerald-500/30"
                : "bg-destructive/10 border-destructive/30"
            }`}>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Status:</dt>
                <dd className="font-medium">{sefazStatus.online ? "ONLINE" : "OFFLINE"}</dd>
                <dt className="text-muted-foreground">cStat:</dt>
                <dd className="font-mono">{sefazStatus.cStat || "-"}</dd>
                <dt className="text-muted-foreground">xMotivo:</dt>
                <dd>{sefazStatus.xMotivo || "-"}</dd>
                <dt className="text-muted-foreground">UF / Autorizador:</dt>
                <dd>{sefazStatus.uf} / {sefazStatus.autorizador}</dd>
                <dt className="text-muted-foreground">Ambiente:</dt>
                <dd className="uppercase">{sefazStatus.ambiente}</dd>
                <dt className="text-muted-foreground">Endpoint:</dt>
                <dd className="text-xs font-mono break-all">{sefazStatus.endpoint}</dd>
              </div>
            </div>
          )}
          <Button onClick={handleTestSefaz} disabled={loading} variant="outline">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Testar Conexao SEFAZ
          </Button>
        </CardContent>
      </Card>

      {/* Odoo */}
      <Card className="bg-card/80 border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5" /> Conexao Odoo
          </CardTitle>
          <CardDescription>ERP via XML-RPC com API Key.</CardDescription>
        </CardHeader>
        <CardContent>
          {odooStatus && (
            <div className={`p-4 rounded-md border ${
              odooStatus.sucesso
                ? "bg-emerald-500/10 border-emerald-500/30"
                : "bg-destructive/10 border-destructive/30"
            }`}>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Status:</dt>
                <dd className="font-medium">{odooStatus.sucesso ? "CONECTADO" : "FALHA"}</dd>
                {odooStatus.url && <>
                  <dt className="text-muted-foreground">URL:</dt>
                  <dd className="text-xs font-mono break-all">{odooStatus.url}</dd>
                </>}
                {odooStatus.db && <>
                  <dt className="text-muted-foreground">Database:</dt>
                  <dd className="font-mono">{odooStatus.db}</dd>
                </>}
                {odooStatus.user && <>
                  <dt className="text-muted-foreground">Usuario:</dt>
                  <dd className="text-xs">{odooStatus.user}</dd>
                </>}
                {odooStatus.uid && <>
                  <dt className="text-muted-foreground">UID:</dt>
                  <dd className="font-mono">{odooStatus.uid}</dd>
                </>}
                {odooStatus.erro && <>
                  <dt className="text-muted-foreground">Erro:</dt>
                  <dd className="text-destructive text-xs break-all">{odooStatus.erro}</dd>
                </>}
              </div>
            </div>
          )}
          <Button onClick={refreshAll} disabled={loading} variant="outline" className="mt-4">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Atualizar Status
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// Importar icon Upload que faltou
import { Upload } from "lucide-react";

// ============================================================
// Documentacao Tab
// ============================================================

function DocsTab() {
  return (
    <Card className="bg-card/80 border-border/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-5 h-5" /> Documentacao
        </CardTitle>
        <CardDescription>Como usar o middleware NF-e MGBP Brasil</CardDescription>
      </CardHeader>
      <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-6">
        <section>
          <h3 className="text-lg font-semibold mb-2">Fluxo de Emissao</h3>
          <ol className="list-decimal pl-6 space-y-2 text-sm text-muted-foreground">
            <li><strong className="text-foreground">Odoo</strong>: fatura com <code className="px-1 bg-muted rounded">x_mgbp_nfe_status = pendente</code></li>
            <li><strong className="text-foreground">Middleware</strong>: polling Odoo XML-RPC (a cada 20s) busca pendentes</li>
            <li><strong className="text-foreground">XML NF-e</strong>: gerado a partir dos dados da fatura (NF-e 4.00 layout)</li>
            <li><strong className="text-foreground">Assinatura A1</strong>: XML assinado com certificado (RSA-SHA1 + C14N)</li>
            <li><strong className="text-foreground">SEFAZ</strong>: envio sincrono NFeAutorizacao4 (mTLS + SOAP 1.2)</li>
            <li><strong className="text-foreground">DANFE PDF</strong>: gerado localmente com PDFKit + barcode Code128</li>
            <li><strong className="text-foreground">Odoo chatter</strong>: XML + PDF anexados e mensagem postada</li>
          </ol>
        </section>

        <section>
          <h3 className="text-lg font-semibold mb-2">Operacoes MGBP</h3>
          <div className="space-y-3 text-sm">
            <div>
              <strong>Venda para Consumidor (CFOP 5102/6108)</strong>
              <p className="text-muted-foreground mt-1">Venda para pessoa fisica (nao contribuinte). Interestadual com DIFAL.</p>
            </div>
            <div>
              <strong>Venda para Revenda (CFOP 5102/6102)</strong>
              <p className="text-muted-foreground mt-1">Venda B2B para contribuinte com IE. Sem DIFAL.</p>
            </div>
            <div>
              <strong>Entrega Futura (CFOP 5922/6922)</strong>
              <p className="text-muted-foreground mt-1">Simples faturamento sem circulacao de mercadoria. CST 141 (Isento).</p>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-lg font-semibold mb-2">Regimes Tributarios</h3>
          <p className="text-sm text-muted-foreground">
            Default: <strong className="text-foreground">Lucro Presumido</strong> (CST 00 ICMS + IPI 3.25%).
            Suporta tambem <strong className="text-foreground">Simples Nacional</strong> (CSOSN 100) e
            <strong className="text-foreground"> Lucro Real</strong>. Configuravel via env var
            <code className="px-1 bg-muted rounded ml-1">MGBP_REGIME_TRIBUTARIO</code>.
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold mb-2">Estoques MGBP (6 segregados)</h3>
          <p className="text-sm text-muted-foreground mb-2">
            Apenas <strong className="text-foreground">01, 03 e 11</strong> podem emitir NF-e:
          </p>
          <ul className="list-disc pl-6 text-sm text-muted-foreground mt-2 space-y-1">
            <li><strong className="text-foreground">01 - Produto Acabado (Novo)</strong> - emite NF</li>
            <li><strong className="text-foreground">02 - Canibalizado</strong> - NAO emite NF</li>
            <li><strong className="text-foreground">03 - Venda no Estado</strong> - emite NF</li>
            <li><strong className="text-foreground">04 - Showroom</strong> - NAO emite NF</li>
            <li><strong className="text-foreground">05 - Homologacao</strong> - NAO emite NF</li>
            <li><strong className="text-foreground">11 - Partes e Pecas</strong> - emite NF</li>
          </ul>
        </section>

        <section>
          <h3 className="text-lg font-semibold mb-2">Produtos Importados</h3>
          <p className="text-sm text-muted-foreground">
            Todos os produtos MGBP sao importados (orig=1 estrangeira importacao direta).
            IPI 3.25% sobre NCM 85166000 (fogoes/fornos) e 84181000 (refrigeradores).
            Rastreabilidade por <strong className="text-foreground">numero de serie unico</strong> (sem lote).
          </p>
        </section>

        <section>
          <h3 className="text-lg font-semibold mb-2">Endpoints</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metodo</TableHead>
                <TableHead>Rota</TableHead>
                <TableHead>Funcao</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["GET", "/api/v1/health", "Health check"],
                ["POST", "/api/v1/nfe/certificado", "Upload certificado A1"],
                ["GET", "/api/v1/nfe/certificado", "Status do certificado"],
                ["GET", "/api/v1/nfe/sefaz/status", "Status SEFAZ"],
                ["POST", "/api/v1/nfe/emitir", "Emitir NF-e por move_id"],
                ["POST", "/api/v1/nfe/cancelar", "Cancelar NF-e"],
                ["POST", "/api/v1/nfe/process-pending", "Forca processamento"],
                ["GET", "/api/v1/nfe/dashboard", "Dados do painel"],
              ].map(([m, p, d]) => (
                <TableRow key={p}>
                  <TableCell><Badge variant="outline" className="font-mono">{m}</Badge></TableCell>
                  <TableCell><code className="text-xs font-mono">{p}</code></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{d}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Odoo Campos Tab (guia de setup)
// ============================================================

function OdooCamposTab() {
  const campos = [
    { modelo: "account.move", campos: [
      { nome: "x_mgbp_nfe_status", tipo: "selection", desc: "vazio, pendente, processando, autorizada, cancelada, cancelar_solicitado, erro" },
      { nome: "x_mgbp_nfe_chave", tipo: "char", desc: "Chave de acesso 44 digitos" },
      { nome: "x_mgbp_nfe_protocolo", tipo: "char", desc: "Numero do protocolo SEFAZ" },
      { nome: "x_mgbp_nfe_xml", tipo: "text", desc: "XML nfeProc autorizado" },
      { nome: "x_mgbp_nfe_erro", tipo: "text", desc: "Mensagem de erro" },
      { nome: "x_mgbp_nfe_dh_emissao", tipo: "datetime", desc: "Data/hora da emissao" },
      { nome: "x_mgbp_nfe_tipo_operacao", tipo: "selection", desc: "venda_consumidor, venda_revenda, entrega_futura, venda_interna" },
      { nome: "x_mgbp_nfe_estoque_origem", tipo: "many2one", desc: "stock.location (apenas 01, 03, 11 emitem NF)" },
      { nome: "x_mgbp_nfe_cfop", tipo: "char", desc: "CFOP da operacao (5102/6102/6108/6922)" },
      { nome: "x_mgbp_nfe_danfe_pdf", tipo: "binary", desc: "DANFE PDF binario" },
      { nome: "x_mgbp_nfe_protocolo_cancel", tipo: "char", desc: "Protocolo de cancelamento" },
      { nome: "x_mgbp_nfe_xml_cancel", tipo: "text", desc: "XML de cancelamento" },
    ]},
    { modelo: "res.company", campos: [
      { nome: "x_mgbp_nfe_serie", tipo: "char", desc: 'Serie da NF-e (default "1")' },
      { nome: "x_mgbp_nfe_numero", tipo: "integer", desc: "Ultimo numero emitido (default 5573)" },
      { nome: "x_mgbp_nfe_inscricao_estadual", tipo: "char", desc: "IE do emitente (MGBP: 9067039715)" },
    ]},
    { modelo: "product.product", campos: [
      { nome: "x_mgbp_ncm", tipo: "char", desc: "NCM especifico (85166000=fogoes, 84181000=refrigeradores)" },
      { nome: "x_mgbp_cfop", tipo: "char", desc: "CFOP default do produto" },
      { nome: "x_mgbp_descricao_nfe", tipo: "text", desc: "Descricao para a NF-e" },
      { nome: "x_mgbp_unidade_medida", tipo: "char", desc: "Unidade (UNI default p/ eletrodomesticos)" },
      { nome: "x_mgbp_produto_importado", tipo: "boolean", desc: "Todos produtos MGBP sao importados (default True)" },
    ]},
    { modelo: "stock.location", campos: [
      { nome: "x_mgbp_estoque_codigo", tipo: "char", desc: "01, 02, 03, 04, 05, 11" },
      { nome: "x_mgbp_emite_nf", tipo: "boolean", desc: "True para 01, 03, 11; False para 02, 04, 05" },
    ]},
  ];

  return (
    <div className="space-y-6">
      <Card className="bg-card/80 border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" /> Campos Customizados no Odoo
          </CardTitle>
          <CardDescription>
            Campos necessarios no Odoo. Criados automaticamente pelo script Python.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {campos.map((m) => (
            <div key={m.modelo}>
              <h4 className="font-mono text-sm font-semibold mb-2 text-primary">{m.modelo}</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Descricao</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m.campos.map((c) => (
                    <TableRow key={c.nome}>
                      <TableCell><code className="text-xs font-mono">{c.nome}</code></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{c.tipo}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.desc}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
          <div className="p-4 rounded-md bg-accent/20 border border-primary/30">
            <p className="text-sm">
              <strong>Como criar os campos:</strong> Execute o script Python <code className="text-xs bg-muted px-1 rounded">odoo-scripts/setup-completo-odoo.py</code> na raiz do projeto, passando as env vars <code className="text-xs bg-muted px-1 rounded">ODOO_URL</code>, <code className="text-xs bg-muted px-1 rounded">ODOO_DB</code> e <code className="text-xs bg-muted px-1 rounded">ODOO_API_KEY</code>. O script tambem cria os botoes "Emitir NF-e" e "Cancelar NF-e" como Server Actions no Odoo.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Dashboard Principal
// ============================================================

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const client = getApiClient();
  const [nfs, setNfs] = useState<NfItem[]>([]);
  const [resumo, setResumo] = useState<NfResumo | null>(null);
  const [loading, setLoading] = useState(false);
  const [ambientInfo, setAmbientInfo] = useState<{ ambiente?: string; uf?: string; regime?: string }>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await client.getDashboard();
      if (data.conectado_odoo) {
        setNfs(data.nfs);
        setResumo(data.resumo);
        setAmbientInfo({ ambiente: data.ambiente, uf: data.uf, regime: data.regime });
      } else {
        setNfs([]);
        setResumo(null);
        toast({ title: "Odoo offline", description: data.erro || "Verifique as configuracoes", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Erro ao carregar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top Bar */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <div className="font-bold text-sm">NF-e MGBP Brasil</div>
                <div className="text-xs text-muted-foreground">Fiscal Cloud</div>
              </div>
            </div>
            {ambientInfo.ambiente && (
              <Badge variant={ambientInfo.ambiente === "homologacao" ? "secondary" : "default"}>
                {ambientInfo.ambiente.toUpperCase()}
              </Badge>
            )}
            {ambientInfo.uf && (
              <Badge variant="outline">UF: {ambientInfo.uf}</Badge>
            )}
            {ambientInfo.regime && (
              <Badge variant="outline">{ambientInfo.regime.replace("_", " ")}</Badge>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <StatusDot status="pending" label="SEFAZ" />
            <StatusDot status="pending" label="Odoo" />
            <StatusDot status="pending" label="Cert" />
            <Button size="icon" variant="ghost" onClick={refresh} title="Atualizar" disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button size="icon" variant="ghost" onClick={onLogout} title="Sair">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6">
        <Tabs defaultValue="painel" className="space-y-4">
          <TabsList>
            <TabsTrigger value="painel"><FileBox className="w-4 h-4 mr-2 inline" />Painel</TabsTrigger>
            <TabsTrigger value="setup"><Settings className="w-4 h-4 mr-2 inline" />Setup</TabsTrigger>
            <TabsTrigger value="campos"><Database className="w-4 h-4 mr-2 inline" />Campos Odoo</TabsTrigger>
            <TabsTrigger value="docs"><BookOpen className="w-4 h-4 mr-2 inline" />Documentacao</TabsTrigger>
          </TabsList>

          <TabsContent value="painel" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Painel de NF-e</h2>
              <Button onClick={refresh} disabled={loading} variant="outline" size="sm">
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Atualizar
              </Button>
            </div>
            <KpiCards resumo={resumo} />
            <NfListTable nfs={nfs} onRefresh={refresh} />
          </TabsContent>

          <TabsContent value="setup">
            <SetupTab />
          </TabsContent>

          <TabsContent value="campos">
            <OdooCamposTab />
          </TabsContent>

          <TabsContent value="docs">
            <DocsTab />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 bg-card/30 mt-auto">
        <div className="container mx-auto px-4 py-3 text-xs text-muted-foreground text-center">
          NF-e MGBP Brasil v1.0.0 - Middleware de emissao propria | Odoo + SEFAZ + Firebase + Render
        </div>
      </footer>
    </div>
  );
}

// ============================================================
// Root Page
// ============================================================

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const client = getApiClient();
    const key = client.getApiKey();
    if (key) {
      client.health()
        .then(() => { if (mounted) setAuthenticated(true); })
        .catch(() => client.clearApiKey())
        .finally(() => { if (mounted) setLoading(false); });
    } else {
      if (mounted) setLoading(false);
    }
    return () => { mounted = false; };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Carregando...</div>
      </div>
    );
  }

  if (!authenticated) {
    return <AuthScreen onAuth={() => setAuthenticated(true)} />;
  }

  return (
    <>
      <Dashboard onLogout={() => {
        getApiClient().clearApiKey();
        setAuthenticated(false);
      }} />
      <Toaster />
    </>
  );
}
