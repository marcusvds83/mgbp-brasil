#!/usr/bin/env python3
"""
setup-mgbp-odoo.py - Setup COMPLETO do Odoo MGBP do Brasil
============================================================
Script IDEMPOTENTE que cria/atualiza tudo no Odoo MGBP:

  1. Empresa MGBP (CNPJ, IE, IM, endereço)
  2. 6 Estoques MGBP (01, 02, 03, 04, 05, 11) + flag x_mgbp_emite_nf
  3. Categoria de produto Eletrodomésticos Importados
  4. Impostos MGBP (ICMS 4% interestadual, IPI 3,25%, etc)
  5. 3 Parceiros exemplo (Cristinne, CA Comercial, Escala Global)
  6. 3 Produtos exemplo (com NCM, CFOP, tracking=serial)
  7. Campos customizados x_mgbp_nfe_* (account.move, res.company, product.product, stock.location)
  8. Server Actions: "Emitir NF-e" e "Cancelar NF-e" (com validação de estoque)

Uso:
  python3 scripts/setup-mgbp-odoo.py

  (credenciais hardcoded abaixo - ajustar se necessário)
"""
import os
import sys
import xmlrpc.client

# ============================================================
# CONFIGURAÇÃO (credenciais MGBP)
# ============================================================
ODOO_URL = "https://mgbp-brasil.odoo.com"
ODOO_DB = "mgbp-brasil"
ODOO_USER = "marcus@nytro.com.br"
ODOO_API_KEY = os.environ.get("ODOO_API_KEY", "985d27b5ddd9bf9117b1abbc422c492f5cc7041d")
MIDDLEWARE_URL = os.environ.get("MIDDLEWARE_URL", "https://mgbp-brasil.onrender.com")

# ============================================================
# AUTENTICAÇÃO
# ============================================================
print(f"Conectando em {ODOO_URL} (DB: {ODOO_DB})...")
common = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/common", allow_none=True)
uid = common.authenticate(ODOO_DB, ODOO_USER, OODO_API_KEY := ODOO_API_KEY, {})
if not uid:
    print("ERRO: Autenticação falhou.")
    sys.exit(1)
print(f"✅ Autenticado (uid={uid})")

models = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/object", allow_none=True)


def kw(model, method, args=None, kwargs=None):
    return models.execute_kw(ODOO_DB, uid, ODOO_API_KEY, model, method, args or [], kwargs or {})


def find(model, domain, limit=1):
    # IMPORTANTE: limit deve ser kwarg, NÃO arg posicional (segundo arg posicional de search() é offset)
    if limit:
        res = kw(model, "search", [domain], {"limit": limit})
    else:
        res = kw(model, "search", [domain])
    return res[0] if res else False


def find_or_create(model, domain, vals):
    rid = find(model, domain)
    if rid:
        kw(model, "write", [[rid], vals])
        print(f"  ↪ ATUALIZADO {model} id={rid}: {vals.get('name', domain)}")
        return rid
    rid = kw(model, "create", [vals])
    print(f"  ✚ CRIADO {model} id={rid}: {vals.get('name', domain)}")
    return rid


def upsert_field(model_id, name, field_description, ttype="char", **extra):
    existing = kw("ir.model.fields", "search", [[["model_id", "=", model_id], ["name", "=", name]]])
    values = {
        "name": name,
        "field_description": field_description,
        "ttype": ttype,
        "model_id": model_id,
        **extra,
    }
    if existing:
        kw("ir.model.fields", "write", [existing, values])
        print(f"  ↪ campo {name}: ATUALIZADO")
        return existing[0]
    fid = kw("ir.model.fields", "create", [values])
    print(f"  ✚ campo {name}: CRIADO (id={fid})")
    return fid


# ============================================================
# ETAPA 1: EMPRESA MGBP (res.company id=1)
# ============================================================
print("\n" + "=" * 60)
print("ETAPA 1: Atualizando empresa MGBP Brasil")
print("=" * 60)

# IDs fixos
COMPANY_ID = 1  # já existe
PR_STATE_ID = find("res.country.state", [["code", "=", "PR"]])
BR_COUNTRY_ID = find("res.country", [["code", "=", "BR"]])

# Empresa
company_vals = {
    "name": "MGBP Brasil Importação e Comércio Ltda",
    "vat": "20.728.251/0001-02",
    "street": "Rua O Brasil para Cristo, 2756",
    "city": "Curitiba",
    "state_id": PR_STATE_ID,
    "country_id": BR_COUNTRY_ID,
    "zip": "81730-070",
    "phone": "(41) 3387-8889",
    "email": "contato@mgbp.com.br",
}
kw("res.company", "write", [[COMPANY_ID], company_vals])
print(f"  ✅ Empresa atualizada: {company_vals['name']} (CNPJ {company_vals['vat']})")

# Partner vinculado (res.partner id=1 normalmente é o da empresa)
PARTNER_COMPANY_ID = find("res.partner", [["id", "=", 1]])
if PARTNER_COMPANY_ID:
    partner_vals = {
        **company_vals,
        "is_company": True,
        "l10n_br_ie_code": "9067039715",
        "l10n_br_im_code": "10 02 699.157-6",
        "company_id": COMPANY_ID,
    }
    kw("res.partner", "write", [[PARTNER_COMPANY_ID], partner_vals])
    print(f"  ✅ Parceiro vinculado (id={PARTNER_COMPANY_ID}) com IE={partner_vals['l10n_br_ie_code']}, IM={partner_vals['l10n_br_im_code']}")


# ============================================================
# ETAPA 2: ESTOQUES MGBP (6 localizações + flag x_mgbp_emite_nf)
# ============================================================
print("\n" + "=" * 60)
print("ETAPA 2: Criando 6 estoques MGBP")
print("=" * 60)

WH_ID = find("stock.warehouse", [["company_id", "=", COMPANY_ID]])
WH_LOC_ID = find("stock.location", [["id", "=", 6]])  # WH/Stock (pai)

# Buscar ou criar view "MGBP" sob o WH (usa barcode único MGBP-ROOT)
mgbp_view_id = find("stock.location", [
    ["barcode", "=", "MGBP-ROOT"],
    ["usage", "=", "view"],
])
if not mgbp_view_id:
    mgbp_view_id = kw("stock.location", "create", [{
        "name": "MGBP",
        "location_id": WH_LOC_ID,
        "usage": "view",
        "company_id": COMPANY_ID,
        "barcode": "MGBP-ROOT",
    }])
    print(f"  ✚ View MGBP criada: id={mgbp_view_id}")
else:
    print(f"  ↪ View MGBP já existe: id={mgbp_view_id}")

ESTOQUES = [
    {"code": "01", "name": "Estoque 01 - Produto Acabado (Novo)", "emite_nf": True},
    {"code": "02", "name": "Estoque 02 - Canibalizado", "emite_nf": False},
    {"code": "03", "name": "Estoque 03 - Venda no Estado", "emite_nf": True},
    {"code": "04", "name": "Estoque 04 - Showroom", "emite_nf": False},
    {"code": "05", "name": "Estoque 05 - Homologação", "emite_nf": False},
    {"code": "11", "name": "Estoque 11 - Partes e Peças", "emite_nf": True},
]

estoque_ids = {}
for est in ESTOQUES:
    # Busca por barcode único (est['code'])
    loc_id = find("stock.location", [["barcode", "=", est["code"]]])
    loc_vals = {
        "name": est["name"],
        "location_id": mgbp_view_id,
        "usage": "internal",
        "company_id": COMPANY_ID,
        "barcode": est["code"],
    }
    if loc_id:
        kw("stock.location", "write", [[loc_id], loc_vals])
        print(f"  ↪ {est['name']} (id={loc_id}) - atualizado - emite NF: {est['emite_nf']}")
    else:
        loc_id = kw("stock.location", "create", [loc_vals])
        print(f"  ✚ {est['name']} (id={loc_id}) - criado - emite NF: {est['emite_nf']}")
    estoque_ids[est["code"]] = loc_id


# ============================================================
# ETAPA 3: CATEGORIA DE PRODUTO
# ============================================================
print("\n" + "=" * 60)
print("ETAPA 3: Criando categoria de produto")
print("=" * 60)

GOODS_CAT_ID = find("product.category", [["name", "=", "Goods"]])
cat_id = find("product.category", [["name", "=", "Eletrodomésticos Importados"]])
cat_vals = {
    "name": "Eletrodomésticos Importados",
    "parent_id": GOODS_CAT_ID,
    "property_cost_method": "standard",
    "property_valuation": "periodic",
}
if cat_id:
    kw("product.category", "write", [[cat_id], cat_vals])
    print(f"  ↪ Categoria atualizada (id={cat_id})")
else:
    cat_id = kw("product.category", "create", [cat_vals])
    print(f"  ✚ Categoria criada (id={cat_id})")


# ============================================================
# ETAPA 4: IMPOSTOS MGBP
# ============================================================
print("\n" + "=" * 60)
print("ETAPA 4: Criando/ajustando impostos MGBP")
print("=" * 60)

# Criar impostos que faltam (ICMS 4% interestadual + IPI 3,25%)
# Nota: impostos existentes já cobrem ICMS 0/7/12/17% e IPI 0/10%
TAXES_TO_CREATE = [
    # ICMS 4% interestadual (produto importado com Alíquota Específica) - SALE
    {"name": "4% ICMS I - Venda (MGBP)", "amount": 4.0, "amount_type": "percent", "type_tax_use": "sale"},
    {"name": "4% ICMS E - Venda (MGBP)", "amount": 4.0, "amount_type": "percent", "type_tax_use": "sale"},
    # ICMS 4% - PURCHASE
    {"name": "4% ICMS I - Compra (MGBP)", "amount": 4.0, "amount_type": "percent", "type_tax_use": "purchase"},
    {"name": "4% ICMS E - Compra (MGBP)", "amount": 4.0, "amount_type": "percent", "type_tax_use": "purchase"},
    # IPI 3,25% (eletrodomésticos importados) - SALE
    {"name": "3.25% IPI - Venda (MGBP)", "amount": 3.25, "amount_type": "percent", "type_tax_use": "sale"},
    # IPI 3,25% - PURCHASE
    {"name": "3.25% IPI - Compra (MGBP)", "amount": 3.25, "amount_type": "percent", "type_tax_use": "purchase"},
]

for t in TAXES_TO_CREATE:
    tid = find("account.tax", [["name", "=", t["name"]]])
    if tid:
        print(f"  ↪ Imposto já existe: {t['name']} (id={tid})")
    else:
        tid = kw("account.tax", "create", [{**t, "active": True, "company_id": COMPANY_ID}])
        print(f"  ✚ Imposto criado: {t['name']} (id={tid})")


# ============================================================
# ETAPA 5: PARCEIROS EXEMPLO (das 3 NFs)
# ============================================================
print("\n" + "=" * 60)
print("ETAPA 5: Criando 3 parceiros exemplo das NFs")
print("=" * 60)

RS_STATE_ID = find("res.country.state", [["code", "=", "RS"]])
SP_STATE_ID = find("res.country.state", [["code", "=", "SP"]])
PA_STATE_ID = find("res.country.state", [["code", "=", "PA"]])

PARCEIROS = [
    # NF 5515 - Consumidor final (pessoa física)
    {
        "name": "Cristinne Leus Tome",
        "vat": "508.570.610-20",
        "is_company": False,
        "street": "Rua Sete, 450",
        "city": "Torres",
        "state_id": RS_STATE_ID,
        "country_id": BR_COUNTRY_ID,
        "zip": "94725-424",
        "phone": "(66) 99635-3387",
        "customer_rank": 1,
        "supplier_rank": 0,
    },
    # NF 5560 - Revenda (empresa SP)
    {
        "name": "CA Comercial Eireli",
        "vat": "08.890.804/0001-15",
        "is_company": True,
        "street": "Rua Azevedo Soares, 2669",
        "city": "São Paulo",
        "state_id": SP_STATE_ID,
        "country_id": BR_COUNTRY_ID,
        "zip": "03322-002",
        "phone": "(11) 2227-3020",
        "l10n_br_ie_code": "149.714.407.114",
        "customer_rank": 1,
        "supplier_rank": 0,
    },
    # NF 5573 - Entrega futura (empresa PA)
    {
        "name": "Escala Global Comercio Varejista Ltda",
        "vat": "40.706.758/0001-64",
        "is_company": True,
        "street": "Rodovia Paulo Sergio Frota e Silva, 1500, Bloco 1",
        "city": "Belém",
        "state_id": PA_STATE_ID,
        "country_id": BR_COUNTRY_ID,
        "zip": "66617-640",
        "phone": "(91) 98154-1000",
        "l10n_br_ie_code": "159304938",
        "customer_rank": 1,
        "supplier_rank": 0,
    },
]

partner_ids = {}
for p in PARCEIROS:
    pid = find("res.partner", [["name", "=", p["name"]]])
    if pid:
        kw("res.partner", "write", [[pid], p])
        print(f"  ↪ Parceiro atualizado: {p['name']} (id={pid})")
    else:
        pid = kw("res.partner", "create", [p])
        print(f"  ✚ Parceiro criado: {p['name']} (id={pid})")
    partner_ids[p["name"]] = pid

# Transportadoras
TRANS = [
    {"name": "TRANSTOCHA Ltda", "vat": "18.499.500/0001-85", "street": "Rua Carlos Essenfelder, 1151, Boqueirão",
     "city": "Curitiba", "state_id": PR_STATE_ID, "country_id": BR_COUNTRY_ID, "l10n_br_ie_code": "910.281.526.0",
     "is_company": True, "supplier_rank": 1},
    {"name": "Topcon Express Transporte e Logistica Ltda", "vat": "14.222.849/0001-14",
     "street": "Rua Amalia Strapasson de Souza, 509, Mauá", "city": "Colombo",
     "state_id": PR_STATE_ID, "country_id": BR_COUNTRY_ID, "l10n_br_ie_code": "911.111.594.7",
     "is_company": True, "supplier_rank": 1},
]
for t in TRANS:
    tid = find("res.partner", [["name", "=", t["name"]]])
    if not tid:
        tid = kw("res.partner", "create", [t])
        print(f"  ✚ Transportadora criada: {t['name']} (id={tid})")


# ============================================================
# ETAPA 6: PRODUTOS EXEMPLO (das 3 NFs)
# ============================================================
print("\n" + "=" * 60)
print("ETAPA 6: Criando 3 produtos exemplo das NFs")
print("=" * 60)

UNI_UOM_ID = find("uom.uom", [["name", "=", "Units"]]) or find("uom.uom", [["name", "ilike", "Unit"]])

PRODUTOS = [
    # NF 5515
    {
        "default_code": "GLMMQ661",
        "name": "Fogão Glem MTX 60cm 4 Queimador + Forno Elétrico MF",
        "type": "consu",  # consu = produto consumível (não serviço)
        "categ_id": cat_id,
        "tracking": "serial",
        "list_price": 10490.00,
        "standard_price": 8500.00,  # custo estimado
        "taxes_id": [(6, 0, [
            find("account.tax", [["name", "=", "4% ICMS I - Venda (MGBP)"]]),
            find("account.tax", [["name", "=", "3.25% IPI - Venda (MGBP)"]]),
        ])],
        "uom_id": UNI_UOM_ID,

    },
    # NF 5560
    {
        "default_code": "LNTP952DI",
        "name": "Elanto Nero Argento Raise Cooktop + Coifa 90cm 220V",
        "type": "consu",
        "categ_id": cat_id,
        "tracking": "serial",
        "list_price": 13926.21,
        "standard_price": 11000.00,
        "taxes_id": [(6, 0, [
            find("account.tax", [["name", "=", "4% ICMS E - Venda (MGBP)"]]),
            find("account.tax", [["name", "=", "3.25% IPI - Venda (MGBP)"]]),
        ])],
        "uom_id": UNI_UOM_ID,

    },
    # NF 5573
    {
        "default_code": "LNTR3659F",
        "name": "Refrigerador Professionale 36inch 590l French Door Freestanding Inox 220V",
        "type": "consu",
        "categ_id": cat_id,
        "tracking": "serial",
        "list_price": 14706.99,  # 44.106,98 / 3 = 14.702,33 (preço unit)
        "standard_price": 11500.00,
        "taxes_id": [(6, 0, [
            find("account.tax", [["name", "=", "0% ICMS I"]]),
            find("account.tax", [["name", "=", "0% IPI"]]),
        ])],
        "uom_id": UNI_UOM_ID,

    },
]

product_ids = {}
for p in PRODUTOS:
    pid = find("product.template", [["default_code", "=", p["default_code"]]])
    if pid:
        kw("product.template", "write", [[pid], p])
        print(f"  ↪ Produto atualizado: {p['default_code']} - {p['name'][:40]}... (id={pid})")
    else:
        pid = kw("product.template", "create", [p])
        print(f"  ✚ Produto criado: {p['default_code']} - {p['name'][:40]}... (id={pid})")
    product_ids[p["default_code"]] = pid


# ============================================================
# ETAPA 7: CAMPOS CUSTOMIZADOS x_mgbp_*
# ============================================================
print("\n" + "=" * 60)
print("ETAPA 7: Criando campos customizados x_mgbp_*")
print("=" * 60)

# account.move
move_model_id = kw("ir.model", "search", [[["model", "=", "account.move"]]])[0]
campos_move = [
    {
        "name": "x_mgbp_nfe_status",
        "field_description": "NF-e Status (MGBP)",
        "ttype": "selection",
        "selection": "[('vazio','Vazio'),('pendente','Pendente'),('processando','Processando'),('autorizada','Autorizada'),('cancelada','Cancelada'),('cancelar_solicitado','Cancelamento Solicitado'),('erro','Erro')]",
    },
    {"name": "x_mgbp_nfe_chave", "field_description": "NF-e Chave de Acesso (MGBP)", "ttype": "char"},
    {"name": "x_mgbp_nfe_protocolo", "field_description": "NF-e Protocolo (MGBP)", "ttype": "char"},
    {"name": "x_mgbp_nfe_xml", "field_description": "NF-e XML nfeProc (MGBP)", "ttype": "text"},
    {"name": "x_mgbp_nfe_erro", "field_description": "NF-e Erro (MGBP)", "ttype": "text"},
    {"name": "x_mgbp_nfe_dh_emissao", "field_description": "NF-e Data Emissão (MGBP)", "ttype": "datetime"},
    {
        "name": "x_mgbp_nfe_tipo_operacao",
        "field_description": "NF-e Tipo Operação (MGBP)",
        "ttype": "selection",
        "selection": "[('venda_consumidor','Venda p/ Consumidor (6108)'),('venda_revenda','Venda p/ Revenda (6102)'),('entrega_futura','Entrega Futura (6922)'),('venda_interna','Venda Interna (5102)')]",
    },
    {"name": "x_mgbp_nfe_estoque_origem", "field_description": "Estoque Origem NF-e (MGBP)", "ttype": "many2one", "relation": "stock.location"},
    {"name": "x_mgbp_nfe_cfop", "field_description": "NF-e CFOP (MGBP)", "ttype": "char"},
    {"name": "x_mgbp_nfe_danfe_pdf", "field_description": "DANFE PDF (MGBP)", "ttype": "binary"},
    {"name": "x_mgbp_nfe_protocolo_cancel", "field_description": "Protocolo Cancelamento (MGBP)", "ttype": "char"},
    {"name": "x_mgbp_nfe_xml_cancel", "field_description": "XML Cancelamento (MGBP)", "ttype": "text"},
]
for c in campos_move:
    upsert_field(move_model_id, **c)

# res.company
company_model_id = kw("ir.model", "search", [[["model", "=", "res.company"]]])[0]
campos_company = [
    {"name": "x_mgbp_nfe_serie", "field_description": "NF-e Série (MGBP)", "ttype": "char"},
    {"name": "x_mgbp_nfe_numero", "field_description": "NF-e Último Número (MGBP)", "ttype": "integer"},
    {"name": "x_mgbp_nfe_inscricao_estadual", "field_description": "NF-e IE Emitente (MGBP)", "ttype": "char"},
]
for c in campos_company:
    upsert_field(company_model_id, **c)

# product.product
product_model_id = kw("ir.model", "search", [[["model", "=", "product.product"]]])[0]
campos_product = [
    {"name": "x_mgbp_ncm", "field_description": "NCM Específico (MGBP)", "ttype": "char"},
    {"name": "x_mgbp_cfop", "field_description": "CFOP Default (MGBP)", "ttype": "char"},
    {"name": "x_mgbp_descricao_nfe", "field_description": "Descrição NF-e (MGBP)", "ttype": "text"},
    {"name": "x_mgbp_unidade_medida", "field_description": "Unidade Medida NF-e (MGBP)", "ttype": "char"},
    {"name": "x_mgbp_produto_importado", "field_description": "Produto Importado (MGBP)", "ttype": "boolean"},
]
for c in campos_product:
    upsert_field(product_model_id, **c)

# stock.location
location_model_id = kw("ir.model", "search", [[["model", "=", "stock.location"]]])[0]
campos_location = [
    {"name": "x_mgbp_estoque_codigo", "field_description": "Código Estoque MGBP (01,02,03...)", "ttype": "char"},
    {"name": "x_mgbp_emite_nf", "field_description": "Pode Emitir NF-e (MGBP)", "ttype": "boolean"},
]
for c in campos_location:
    upsert_field(location_model_id, **c)

# Aplicar valores x_mgbp_emite_nf nos estoques criados
print("\n  Setando x_mgbp_emite_nf nos 6 estoques...")
for est in ESTOQUES:
    loc_id = estoque_ids[est["code"]]
    kw("stock.location", "write", [[loc_id], {
        "x_mgbp_estoque_codigo": est["code"],
        "x_mgbp_emite_nf": est["emite_nf"],
    }])
    print(f"    Estoque {est['code']}: emite_nf={est['emite_nf']}")

# Setar campos nos produtos
print("\n  Setando x_mgbp_* nos 3 produtos...")
prod_extras = [
    {"code": "GLMMQ661", "ncm": "85166000", "cfop": "6108", "descricao": "FOGAO GLEM MTX 60CM 4Q GAS MC 4KW FORNO ELETRICO MF", "importado": True, "un": "UNI"},
    {"code": "LNTP952DI", "ncm": "85166000", "cfop": "6102", "descricao": "ELANTO NERO ARGENTO RAISE COOKTOP+COIFA 90CM 220V", "importado": True, "un": "UNI"},
    {"code": "LNTR3659F", "ncm": "84181000", "cfop": "6922", "descricao": "REFRIGERADOR PROFESSIONALE 36INCH 590l FRENCHDOOR/FREESTANDING INOX 220V", "importado": True, "un": "UNI"},
]
for pe in prod_extras:
    pid = product_ids[pe["code"]]
    # Pega product.product id do template
    pprod_ids = kw("product.product", "search", [[["product_tmpl_id", "=", pid]]])
    if pprod_ids:
        kw("product.product", "write", [pprod_ids, {
            "x_mgbp_ncm": pe["ncm"],
            "x_mgbp_cfop": pe["cfop"],
            "x_mgbp_descricao_nfe": pe["descricao"],
            "x_mgbp_unidade_medida": pe["un"],
            "x_mgbp_produto_importado": pe["importado"],
        }])
        print(f"    {pe['code']}: NCM={pe['ncm']} CFOP={pe['cfop']} importado=True")


# ============================================================
# ETAPA 8: SERVER ACTIONS (botões Emitir/Cancelar NF-e)
# ============================================================
print("\n" + "=" * 60)
print("ETAPA 8: Criando Server Actions (Emitir/Cancelar NF-e)")
print("=" * 60)

# Botão "Emitir NF-e (MGBP)" - valida estoque origem e marca pendente
codigo_emitir = """
# Botão Emitir NF-e (MGBP) - valida estoque origem (01,03,11) e marca pendente
ESTOQUES_EMITE = [1, 3, 11]  # codes que podem emitir NF
for move in records:
    if move.x_mgbp_nfe_status in ('autorizada', 'cancelada'):
        move.message_post(body="<b>Não é possível emitir NF-e.</b><br/>Status atual: %s" % move.x_mgbp_nfe_status, message_type='comment')
        continue
    estoque = move.x_mgbp_nfe_estoque_origem
    if not estoque:
        move.message_post(body="<b>Selecione o Estoque de Origem.</b><br/>Apenas estoques 01, 03 e 11 podem emitir NF-e MGBP.", message_type='comment')
        continue
    if not estoque.x_mgbp_emite_nf:
        move.message_post(body="<b>Estoque não autorizado para NF-e.</b><br/>%s não pode emitir NF-e. Apenas 01, 03 e 11." % estoque.name, message_type='comment')
        continue
    move.write({'x_mgbp_nfe_status': 'pendente'})
    move.message_post(body="<b>Emissão de NF-e solicitada.</b><br/>Estoque origem: %s<br/>O middleware MGBP NF-e processará em alguns segundos." % estoque.name, message_type='comment')
"""

# Apaga existente se houver (idempotente)
existing_emitir = kw("ir.actions.server", "search", [[["name", "=", "Emitir NF-e (MGBP)"]]])
if existing_emitir:
    kw("ir.actions.server", "unlink", [existing_emitir])

action_emitir_id = kw("ir.actions.server", "create", [{
    "name": "Emitir NF-e (MGBP)",
    "model_id": move_model_id,
    "state": "code",
    "code": codigo_emitir,
    "binding_model_id": move_model_id,
    "binding_type": "action",
}])
print(f"  ✚ Botão 'Emitir NF-e (MGBP)' criado: id={action_emitir_id}")

# Botão "Cancelar NF-e (MGBP)"
codigo_cancelar = """
# Botão Cancelar NF-e (MGBP)
for move in records:
    if move.x_mgbp_nfe_status != 'autorizada':
        move.message_post(body="<b>Não é possível cancelar NF-e.</b><br/>A fatura precisa estar autorizada. Status atual: %s" % (move.x_mgbp_nfe_status or 'vazio'), message_type='comment')
        continue
    move.write({'x_mgbp_nfe_status': 'cancelar_solicitado'})
    move.message_post(body="<b>Cancelamento solicitado.</b><br/>O middleware MGBP NF-e processará em alguns segundos.", message_type='comment')
"""
existing_cancelar = kw("ir.actions.server", "search", [[["name", "=", "Cancelar NF-e (MGBP)"]]])
if existing_cancelar:
    kw("ir.actions.server", "unlink", [existing_cancelar])

action_cancelar_id = kw("ir.actions.server", "create", [{
    "name": "Cancelar NF-e (MGBP)",
    "model_id": move_model_id,
    "state": "code",
    "code": codigo_cancelar,
    "binding_model_id": move_model_id,
    "binding_type": "action",
}])
print(f"  ✚ Botão 'Cancelar NF-e (MGBP)' criado: id={action_cancelar_id}")

# Setar campos da empresa MGBP (NF-e série e IE)
kw("res.company", "write", [[COMPANY_ID], {
    "x_mgbp_nfe_serie": "1",
    "x_mgbp_nfe_numero": 5573,  # última NF emitida segundo PDFs
    "x_mgbp_nfe_inscricao_estadual": "9067039715",
}])
print(f"\n  ✅ Série NF-e MGBP setada: 1 / Próxima NF: 5574")


print("\n" + "=" * 60)
print("✅ SETUP COMPLETO DO ODOO MGBP CONCLUÍDO!")
print("=" * 60)
print(f"\nAcesse {ODOO_URL}/web#action=account.action_move_out_invoice_type")
print("Em qualquer fatura de cliente:")
print("  1. Preencha 'NF-e Tipo Operação' (venda_consumidor/venda_revenda/entrega_futura)")
print("  2. Selecione 'Estoque Origem NF-e' (apenas 01, 03, 11 liberados)")
print("  3. Clique Ação > 'Emitir NF-e (MGBP)'")
print("\nPara cancelar: Ação > 'Cancelar NF-e (MGBP)'")
