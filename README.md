# NF-e MGBP Brasil - Middleware Fiscal

Middleware de emissão própria de **NF-e** para MGBP Brasil Importação e Comércio, integrando **Odoo** (ERP) com a **SEFAZ** (autorização de NF-e via mTLS) com certificado A1 armazenado no **Firebase** (cofre seguro).

## Sobre a MGBP Brasil

A MGBP Brasil Importação e Comércio Ltda é uma importadora de eletrodomésticos de alto padrão (fogões, cooktops, coifas, refrigeradores, etc.), sediada em Curitiba-PR (CNPJ 20.728.251/0001-02, IE 9067039715, IM 10 02 699.157-6).

### Estoques MGBP (Controle rígido de segregação)

A MGBP trabalha com 6 estoques segregados:

| Código | Nome | Pode emitir NF-e? |
|---|---|---|
| 01 | Produto Acabado (Novo) | ✅ SIM |
| 02 | Canibalizado (peças removidas, danificado no transporte) | ❌ NÃO |
| 03 | Venda no Estado (pequenos detalhes: risco, amassado) | ✅ SIM |
| 04 | Showroom (instalados em showroom) | ❌ NÃO |
| 05 | Homologação (testes/contra-prova) | ❌ NÃO |
| 11 | Partes e Peças | ✅ SIM |

**Apenas os estoques 01, 03 e 11 podem emitir NF-e.** A validação é feita no botão "Emitir NF-e (MGBP)" do Odoo via campo customizado `x_mgbp_emite_nf` na localização de estoque.

### Operações Suportadas (CFOPs)

Baseado nas 3 NFs de exemplo recebidas:

| Tipo de Operação | CFOP Interno | CFOP Interestadual | CST ICMS | Descrição |
|---|---|---|---|---|
| Venda p/ Consumidor (PF) | 5102 | 6108 | 00 (com DIFAL) | Venda interestadual p/ não contribuinte, com DIFAL |
| Venda p/ Revenda (B2B) | 5102 | 6102 | 00 | Venda interestadual p/ contribuinte com IE |
| Entrega Futura | 5922 | 6922 | 141 (Isento) | Simples faturamento sem circulação da mercadoria |

### Regime Tributário

- **Default:** Lucro Presumido (CST 00 ICMS + IPI 50 tributado a 3,25%)
- Configurável via env var `MGBP_REGIME_TRIBUTARIO` (lucro_presumido / simples_nacional / lucro_real)
- ICMS 4% interestadual (alíquota específica para produtos importados)
- IPI 3,25% (produtos importados - NCM 85166000 e 84181000)
- DIFAL aplicado em vendas interestaduais para não contribuintes

### Rastreabilidade

- **Sem rastreamento por lote** (todos os produtos são unitários)
- Apenas controle por **número de série único** (campo `x_mgbp_numero_serie` na linha da fatura)
- XML NF-e usa `<rastro>` com `cAgreg` (número de série único)

### Produtos Importados

- Todos os produtos MGBP são importados
- Tag `<orig>1</orig>` no XML NF-e (estrangeira - importação direta)
- `x_mgbp_produto_importado = True` no `product.product`

## Arquitetura

```
Odoo (fatura com x_mgbp_nfe_status = "pendente")
    | XML-RPC (polling a cada 20s)
Next.js API (Render) - este middleware
    | certificado A1 (cofre Firebase)
    | XML NF-e 4.00 assinado (RSA-SHA1 + C14N)
SEFAZ (NFeAutorizacao4 SOAP 1.2 + mTLS)
    | autorizada (cStat 100)
DANFE PDF gerado localmente (PDFKit + barcode Code128)
    | anexa XML + PDF + posta mensagem no chatter
Odoo (fatura atualizada)
```

## Stack Tecnológica

- **Frontend**: Next.js 16 + TypeScript + Tailwind CSS 4 + shadcn/ui
- **Backend**: Next.js API Routes (App Router)
- **Odoo**: XML-RPC (compatível com Odoo 16/17/18/19/20 SaaS e Online)
- **SEFAZ**: SOAP 1.2 com mTLS (PEM extraído do PFX via node-forge/OpenSSL fallback)
- **Firebase**: Firestore como cofre do certificado A1 (sobrevive a deploys)
- **PDFKit**: Geração local do DANFE
- **xml-crypto**: Assinatura XMLDSig (RSA-SHA1, C14N)

## Estrutura do Projeto

```
mgbp-brasil-middleware/
  src/
    app/
      api/v1/
        health/                   Health check
        nfe/
          certificado/            Upload/status/remover cert A1 (Firebase)
          sefaz/status/           Status serviço SEFAZ
          emitir/                 Emitir NF-e por move_id
          cancelar/               Cancelar NF-e autorizada
          process-pending/        Polling forçado
          dashboard/              Dados do painel
            [id]/xml/             Download XML NF-e
            [id]/pdf/             Download DANFE PDF
        odoo/test-connection/     Testa conexão Odoo
      page.tsx                    Frontend dashboard (auth + tabs)
    lib/
      config.ts                   Configurações centralizadas MGBP
      auth.ts                     Middleware x-api-key
      odoo-rpc.ts                 Cliente XML-RPC Odoo
      firebase-cert.ts            Cofre A1 no Firestore
      pfx.ts                      Parser PFX (node-forge + OpenSSL)
      nfe-xml.ts                  Gerador XML NF-e 4.00 MGBP
      nfe-signer.ts               Assinatura XMLDSig (RSA-SHA1 + C14N)
      sefaz-client.ts             SOAP 1.2 + mTLS para SEFAZ
      danfe-pdf.ts                Gerador DANFE PDF (PDFKit)
      nfe-emit.ts                 Dispatcher de emissão (polling)
      api-client.ts               Cliente HTTP do frontend
    components/ui/                shadcn/ui components
  odoo-scripts/
    setup-completo-odoo-mgbp.py   Cria campos customizados + botões no Odoo MGBP
  scripts/
    enviar-certificado.js         Upload de .pfx via CLI
  .env.example                    Template de env vars
```

## Deploy no Render

### 1. Variáveis de Ambiente

| Variável | Exemplo | Descrição |
|---|---|---|
| `API_KEY` | `minha-chave-forte-aleatoria` | Chave de acesso ao middleware |
| `ODOO_ENABLED` | `1` | Liga integração Odoo |
| `ODOO_URL` | `https://mgbp-brasil.odoo.com` | URL do Odoo MGBP |
| `ODOO_DB` | `mgbp-brasil` | Database do Odoo |
| `ODOO_USER` | `marcus@nytro.com.br` | Email do usuário Odoo |
| `ODOO_API_KEY` | `985d27b5...` | API Key gerada no Odoo (Preferências > Chaves de API) |
| `ODOO_POLLING_MS` | `20000` | Intervalo do polling (default 20s) |
| `FIREBASE_PROJECT_ID` | `mgbp-brasil` | Project ID do Firebase |
| `FIREBASE_CLIENT_EMAIL` | `firebase-adminsdk@mgbp-brasil.iam.gserviceaccount.com` | Email service account |
| `FIREBASE_PRIVATE_KEY` | `[REDACTED:ssh_private_key]\n...` | Private key (com \n) |
| `NFE_UF` | `PR` | UF do emitente (define webservice) |
| `NFE_TP_AMB` | `2` | 1=produção, 2=homologação |
| `NFE_CERT_KEK` | `chave-forte-para-cifrar-senha-em-disco` | KEK para cifrar senha do cert no Firebase |
| `MGBP_REGIME_TRIBUTARIO` | `lucro_presumido` | Regime tributário default (lucro_presumido / simples_nacional / lucro_real) |
| `MGBP_NCM_PADRAO` | `85166000` | NCM padrão para eletrodomésticos |

### 2. Build & Start

- **Build Command**: `npm install --legacy-peer-deps && npm run build`
- **Start Command**: `npm run start` (Next.js standalone)
- **Disk**: opcional (1 GB em `/var/data`) - o Firebase já substitui a necessidade

### 3. Configurar Cron

Render Cron Jobs podem chamar `GET /api/v1/nfe/process-pending?api_key=KEY` a cada 5 minutos para forçar polling em ambiente serverless. (Já configurado em `render.yaml`.)

## Firebase Setup

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com/) (sugestão de nome: `mgbp-brasil`)
2. Vá em **Project Settings > Service Accounts**
3. Clique em **Generate New Private Key** - baixa um JSON
4. Copie `project_id`, `client_email` e `private_key` para as env vars do Render
5. O Firestore será criado automaticamente no primeiro acesso (regras abertas para service account)

## Setup do Odoo

### 1. Gerar API Key no Odoo

1. Acesse o Odoo MGBP como usuário admin (marcus@nytro.com.br)
2. Clique no avatar (canto superior direito) > **Preferências**
3. Vá em **Conteúdo > Chaves de API** (ou "API Keys")
4. Clique em **Gerar nova chave** e copie o valor
5. Cole nas Environment Variables do Render como `ODOO_API_KEY`

### 2. Criar Campos Customizados + Botões no Odoo

```bash
python3 odoo-scripts/setup-completo-odoo-mgbp.py
```

A Script cria:
- **Empresa MGBP**: CNPJ, IE, IM, endereço completo
- **6 Estoques**: 01, 02, 03, 04, 05, 11 (apenas 01/03/11 com flag `x_mgbp_emite_nf=True`)
- **Categoria**: Eletrodomésticos Importados
- **Impostos**: ICMS 4% interestadual (I/E), IPI 3,25%
- **3 Parceiros exemplo**: Cristinne Leus Tome (PF), CA Comercial Eireli (PJ SP), Escala Global (PJ PA)
- **3 Produtos exemplo**: GLMMQ661 (fogão), LNTP952DI (cooktop+coifa), LNTR3659F (refrigerador)
- **22 Campos customizados x_mgbp_*** em account.move, res.company, product.product, stock.location
- **2 Botões Server Action**: "Emitir NF-e (MGBP)" e "Cancelar NF-e (MGBP)"

Após rodar, em qualquer fatura: **Ação (engrenagem) > Emitir NF-e (MGBP)** ou **Cancelar NF-e (MGBP)**.

## Enviar Certificado A1

### Via painel web

Acesse `https://mgbp-brasil-middleware.onrender.com`, digite a API Key, vá em **Setup > Certificado Digital A1**, escolha o `.pfx` e digite a senha.

### Via CLI (Node)

```bash
node scripts/enviar-certificado.js ./MGBPCert.pfx "SENHA_DO_PFX" \
  https://mgbp-brasil-middleware.onrender.com SUA_API_KEY
```

### Via cURL

```bash
curl -X POST https://mgbp-brasil-middleware.onrender.com/api/v1/nfe/certificado \
  -H "x-api-key: SUA_API_KEY" -H "Content-Type: application/json" \
  -d '{"pfxBase64":"'$(base64 -w0 MGBPCert.pfx)'","senha":"SENHA"}'
```

## Testar Conexão SEFAZ

```bash
curl -H "x-api-key: SUA_API_KEY" \
  https://mgbp-brasil-middleware.onrender.com/api/v1/nfe/sefaz/status
```

`cStat 107` = "Serviço em Operação" - certificado válido e mTLS funcionando.

## Endpoints da API

| Método | Rota | Função |
|---|---|---|
| GET | `/api/v1/health` | Health check |
| POST | `/api/v1/nfe/certificado` | Upload certificado A1 |
| GET | `/api/v1/nfe/certificado` | Status do certificado |
| DELETE | `/api/v1/nfe/certificado` | Remover certificado |
| GET | `/api/v1/nfe/sefaz/status` | Status serviço SEFAZ |
| POST | `/api/v1/nfe/emitir` | Emitir NF-e por move_id (ou todas pendentes) |
| POST | `/api/v1/nfe/cancelar` | Cancelar NF-e autorizada |
| POST | `/api/v1/nfe/process-pending` | Força polling |
| GET | `/api/v1/nfe/dashboard` | Dados do painel BI |
| GET | `/api/v1/nfe/dashboard/[id]/xml` | Download XML NF-e |
| GET | `/api/v1/nfe/dashboard/[id]/pdf` | Download DANFE PDF |
| GET | `/api/v1/odoo/test-connection` | Testa conexão Odoo |

## Roteiro Completo: CRM ao Faturamento com NF-e

1. **CRM**: Lead/Opportunity criado no Odoo CRM
2. **Cotação**: Convertido em cotação (sale.order)
3. **Confirmação**: Sale order confirmada -> delivery order + invoice criada
4. **Estoque**: Produto separado do estoque (01/03/11) com número de série único
5. **Faturamento**: Fatura (account.move) emitida (state=posted)
6. **NF-e**: Operador seleciona:
   - Tipo operação (venda_consumidor / venda_revenda / entrega_futura)
   - Estoque origem (validação: apenas 01, 03, 11)
7. **Botão "Emitir NF-e (MGBP)"**: Marca como pendente no chatter
8. **Middleware (polling 20s)**: Pega a fatura pendente
   - Carrega cert A1 do Firebase
   - Lê fatura, empresa, parceiro, linhas, produtos
   - Gera XML NF-e 4.00 com CFOP/CST/orig/IPI/DIFAL específicos
   - Assina XML (RSA-SHA1 + C14N)
   - Envia para SEFAZ via SOAP 1.2 + mTLS
9. **SEFAZ**: Autoriza (cStat 100) ou Rejeita (cStat != 100)
10. **DANFE PDF**: Gerado localmente e anexado no chatter da fatura
11. **XML Autorização**: Anexado no chatter da fatura
12. **Status no Odoo**: `x_mgbp_nfe_status = autorizada` + chave + protocolo + dh_emissão

## Roadmap MGBP

Próximos passos:

- [ ] Setup Firebase project `mgbp-brasil` no console
- [ ] Setup Render service `mgbp-brasil-middleware` com env vars
- [ ] Push do middleware para GitHub `marcusvds83/mgbp-brasil`
- [ ] Teste de emissão NF-e em homologação (1ª NF-e: 5574)
- [ ] Upload do certificado A1 (PFX) MGBP no painel web
- [ ] Validar `cStat 107` (serviço SEFAZ em operação)
- [ ] Teste com as 3 faturas exemplo (5515, 5560, 5573 em homologação)
- [ ] Mudar `NFE_TP_AMB` para `1` (produção) após testes
- [ ] Integração com CRM MGBP (campo `x_mgbp_nfe_tipo_operacao` automático)
- [ ] Workflow de canibalização (estoque 02 -> 03 após avaliação técnica)

## Licença

MIT License - Livre para uso comercial e modificação.
