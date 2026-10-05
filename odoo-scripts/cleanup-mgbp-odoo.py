"""Limpa o que foi criado nas execuções anteriores do setup-mgbp-odoo.py
para podermos re-executar limpo."""
import xmlrpc.client
URL = "https://mgbp-brasil.odoo.com"
DB = "mgbp-brasil"
USER = "marcus@nytro.com.br"
API_KEY = "985d27b5ddd9bf9117b1abbc422c492f5cc7041d"

common = xmlrpc.client.ServerProxy(f"{URL}/xmlrpc/2/common", allow_none=True)
uid = common.authenticate(DB, USER, API_KEY, {})
models = xmlrpc.client.ServerProxy(f"{URL}/xmlrpc/2/object", allow_none=True)

def kw(m, meth, args):
    return models.execute_kw(DB, uid, API_KEY, m, meth, args)

# 1. Apagar estoques MGBP criados (todos filhos de MGBP view)
print("Limpando estoques MGBP...")
view_ids = kw("stock.location", "search", [[["name", "=", "MGBP"], ["usage", "=", "view"]]])
print(f"  views MGBP encontradas: {view_ids}")

# Apaga filhos diretos dessas views
for vid in view_ids:
    filhos = kw("stock.location", "search", [[["location_id", "=", vid]]])
    if filhos:
        print(f"  apagando filhos da view {vid}: {filhos}")
        kw("stock.location", "unlink", [filhos])

# Apaga a própria view
if view_ids:
    print(f"  apagando views MGBP: {view_ids}")
    kw("stock.location", "unlink", [view_ids])

# 2. Apagar parceiros criados (Cristinne, CA Comercial, Escala, TRANSTOCHA, Topcon)
print("Limpando parceiros exemplo...")
partner_names = ["Cristinne Leus Tome", "CA Comercial Eireli", "Escala Global Comercio Varejista Ltda",
                 "TRANSTOCHA Ltda", "Topcon Express Transporte e Logistica Ltda"]
for n in partner_names:
    pids = kw("res.partner", "search", [[["name", "=", n]]])
    if pids:
        print(f"  apagando parceiro: {n} (id={pids})")
        try:
            kw("res.partner", "unlink", [pids])
        except Exception as e:
            print(f"    -> não pode apagar (pode ter dependência): {e}")

# 3. Apagar categoria Eletrodomésticos Importados
print("Limpando categoria de produto...")
cat_ids = kw("product.category", "search", [[["name", "=", "Eletrodomésticos Importados"]]])
if cat_ids:
    print(f"  apagando categoria: {cat_ids}")
    try:
        kw("product.category", "unlink", [cat_ids])
    except Exception as e:
        print(f"    -> não pode apagar (pode ter produtos): {e}")

# 4. Apagar produtos criados
print("Limpando produtos exemplo...")
for code in ["GLMMQ661", "LNTP952DI", "LNTR3659F"]:
    pids = kw("product.template", "search", [[["default_code", "=", code]]])
    if pids:
        print(f"  apagando produto: {code} (id={pids})")
        kw("product.template", "unlink", [pids])

# 5. Apagar impostos MGBP
print("Limpando impostos MGBP...")
tax_names = ["4% ICMS I (MGBP)", "4% ICMS E (MGBP)", "3.25% IPI (MGBP)"]
for n in tax_names:
    tids = kw("account.tax", "search", [[["name", "=", n]]])
    if tids:
        print(f"  apagando imposto: {n} (id={tids})")
        kw("account.tax", "unlink", [tids])

# 6. Apagar campos customizados x_mgbp_*
print("Limpando campos customizados x_mgbp_*...")
field_ids = kw("ir.model.fields", "search", [[["name", "like", "x_mgbp_"]]])
if field_ids:
    print(f"  apagando {len(field_ids)} campos x_mgbp_*")
    kw("ir.model.fields", "unlink", [field_ids])

# 7. Apagar Server Actions
print("Limpando Server Actions MGBP...")
action_ids = kw("ir.actions.server", "search", [[["name", "in", ["Emitir NF-e (MGBP)", "Cancelar NF-e (MGBP)"]]]])
if action_ids:
    print(f"  apagando actions: {action_ids}")
    kw("ir.actions.server", "unlink", [action_ids])

print("\n✅ Limpeza concluída. Pode re-executar setup-mgbp-odoo.py.")
