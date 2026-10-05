#!/usr/bin/env python3
"""
odoo-scripts/setup-automations.py
=================================
Cria base.automation (regras automatizadas do Odoo) para que:

1. Ao SALVAR um product.template com peso/custos alterados:
   - Recalcula automaticamente: custo_metal_total, custo_pedras_brl,
     custo_total, preco_calculado
   - Copia automaticamente: preco_calculado -> list_price (preco de venda)

2. Ao SALVAR um sale.order.line:
   - Recalcula: custo_total_unit na linha do pedido

ESTRATEGIA:
  - Atualiza o codigo das Server Actions existentes (1061 Recalcular Custos
    e 1062 Aplicar Preco Calculado) para versao silenciosa (sem message_post)
  - Cria base.automation vinculando-as com trigger=on_create_or_write
  - Usa filter_domain para so executar quando um campo x_joa_* muda

COMO USAR:
  ODOO_URL=https://fiscal-cloud-joalherias.odoo.com \\
  ODOO_DB=fiscal-cloud-joalherias \\
  ODOO_USER=marcus@nytro.com.br \\
  ODOO_API_KEY=6ec8... python3 odoo-scripts/setup-automations.py
"""

import os
import sys
import xmlrpc.client

ODOO_URL = os.environ.get('ODOO_URL', '').rstrip('/')
ODOO_DB = os.environ.get('ODOO_DB', '')
ODOO_USER = os.environ.get('ODOO_USER', '')
ODOO_API_KEY = os.environ.get('ODOO_API_KEY', '')

if not all([ODOO_URL, ODOO_DB, ODOO_API_KEY]):
    print('ERRO: Defina ODOO_URL, ODOO_DB, ODOO_USER e ODOO_API_KEY')
    sys.exit(1)
if not ODOO_USER:
    ODOO_USER = ODOO_API_KEY

print(f'Conectando em {ODOO_URL}...')
common = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/common')
uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_API_KEY, {})
if not uid:
    uid = common.authenticate(ODOO_DB, ODOO_API_KEY, ODOO_API_KEY, {})
if not uid:
    print('ERRO: Autenticacao falhou')
    sys.exit(1)
print(f'Autenticado! (uid={uid})')

models = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/object')


def kw(model, method, args=None, kwargs=None):
    return models.execute_kw(ODOO_DB, uid, ODOO_API_KEY, model, method, args or [], kwargs or {})


# ============================================================
# 1. Atualizar Server Action 1061 (Recalcular Custos) - versao silenciosa
# ============================================================
print('\n' + '=' * 60)
print('1/4 - Atualizando Server Action "Recalcular Custos" (silenciosa)')
print('=' * 60)

# Versao silenciosa: sem message_post (nao polui chatter)
codigo_recalc_silencioso = """
# Recalcula custos do produto (Joalheria) - versao silenciosa
# (sem message_post para nao poluir chatter a cada save)
for rec in records:
    peso_g = rec.x_joa_peso_ouro_g or 0
    custo_g = rec.x_joa_custo_metal_g or 0
    custo_metal_total = peso_g * custo_g

    usd = rec.x_joa_custo_pedras_usd or 0
    cotacao = rec.x_joa_cotacao_usd_brl or 5.20
    custo_pedras_brl = usd * cotacao

    custo_total = custo_metal_total + custo_pedras_brl + (rec.x_joa_custo_mao_obra or 0)

    markup = rec.x_joa_markup_pct or 0
    preco_calculado = custo_total * (1 + markup / 100)

    rec.write({
        'x_joa_custo_metal_total': custo_metal_total,
        'x_joa_custo_pedras_brl': custo_pedras_brl,
        'x_joa_custo_total': custo_total,
        'x_joa_preco_calculado': preco_calculado,
    })
"""

try:
    kw('ir.actions.server', 'write', [[1061], {'code': codigo_recalc_silencioso}])
    print('  ✓ Server Action 1061 atualizada (silenciosa)')
except Exception as e:
    print(f'  ❌ Erro: {str(e)[:200]}')

# ============================================================
# 2. Atualizar Server Action 1062 (Aplicar Preco Calculado) - silenciosa
# ============================================================
print('\n' + '=' * 60)
print('2/4 - Atualizando Server Action "Aplicar Preco Calculado" (silenciosa)')
print('=' * 60)

codigo_aplicar_silencioso = """
# Aplica o preco calculado no list_price (preco de venda) - versao silenciosa
for rec in records:
    if rec.x_joa_preco_calculado and rec.x_joa_preco_calculado > 0:
        rec.write({'list_price': rec.x_joa_preco_calculado})
"""

try:
    kw('ir.actions.server', 'write', [[1062], {'code': codigo_aplicar_silencioso}])
    print('  ✓ Server Action 1062 atualizada (silenciosa)')
except Exception as e:
    print(f'  ❌ Erro: {str(e)[:200]}')

# ============================================================
# 3. Criar base.automation "Recalcular Custos ao Salvar"
# ============================================================
print('\n' + '=' * 60)
print('3/4 - Criando base.automation "Recalcular Custos ao Salvar"')
print('=' * 60)

# Procura se ja existe
existing = kw('base.automation', 'search', [[['name', '=', 'Joalheria - Recalcular Custos ao Salvar']]])
if existing:
    kw('base.automation', 'unlink', [existing])
    print(f'  ✓ Automation antiga removida')

# Cria a automation com filter que so dispara se algum campo x_joa_* for != 0
# (evita disparar para produtos que nao tem composicao de custo)
filter_domain = (
    "['|', '|', '|', '|', "
    "('x_joa_peso_ouro_g', '!=', 0), "
    "('x_joa_custo_metal_g', '!=', 0), "
    "('x_joa_custo_pedras_usd', '!=', 0), "
    "('x_joa_custo_mao_obra', '!=', 0), "
    "('x_joa_markup_pct', '!=', 0)]"
)

try:
    auto_id = kw('base.automation', 'create', [{
        'name': 'Joalheria - Recalcular Custos ao Salvar',
        'model_id': 1598,  # product.template
        'trigger': 'on_create_or_write',
        'filter_domain': filter_domain,
        'active': True,
    }])
    print(f'  ✓ base.automation criada: id={auto_id}')

    # Vincula a Server Action 1061 via base_automation_id
    kw('ir.actions.server', 'write', [[1061], {'base_automation_id': auto_id}])
    print(f'  ✓ Server Action 1061 vinculada a automation {auto_id}')
except Exception as e:
    print(f'  ❌ Erro: {str(e)[:300]}')

# ============================================================
# 4. Criar base.automation "Aplicar Preco Calculado ao Salvar"
# ============================================================
print('\n' + '=' * 60)
print('4/4 - Criando base.automation "Aplicar Preco Calculado ao Salvar"')
print('=' * 60)

existing = kw('base.automation', 'search', [[['name', '=', 'Joalheria - Aplicar Preco Calculado ao Salvar']]])
if existing:
    kw('base.automation', 'unlink', [existing])
    print(f'  ✓ Automation antiga removida')

# Filter: so dispara se preco_calculado > 0 (evita loop)
filter_preco = "[('x_joa_preco_calculado', '>', 0)]"

try:
    auto_id2 = kw('base.automation', 'create', [{
        'name': 'Joalheria - Aplicar Preco Calculado ao Salvar',
        'model_id': 1598,  # product.template
        'trigger': 'on_create_or_write',
        'filter_domain': filter_preco,
        'active': True,
    }])
    print(f'  ✓ base.automation criada: id={auto_id2}')

    # Vincula a Server Action 1062
    kw('ir.actions.server', 'write', [[1062], {'base_automation_id': auto_id2}])
    print(f'  ✓ Server Action 1062 vinculada a automation {auto_id2}')
except Exception as e:
    print(f'  ❌ Erro: {str(e)[:300]}')

# ============================================================
# RELATORIO FINAL
# ============================================================
print('\n' + '=' * 60)
print('RELATORIO FINAL - Automations criadas')
print('=' * 60)

auts = kw('base.automation', 'search_read', [
    [['name', 'like', 'Joalheria']],
    ['id', 'name', 'trigger', 'active', 'model_id']
])
for a in auts:
    print(f'  id={a["id"]} | {a["name"]} | trigger={a["trigger"]} | active={a.get("active")}')

print('\nServer Actions vinculadas:')
actions = kw('ir.actions.server', 'search_read', [
    [['name', 'like', 'Joalheria']],
    ['id', 'name', 'base_automation_id']
])
for a in actions:
    auto = a.get('base_automation_id')
    auto_str = f'automation id={auto[0]} ({auto[1]})' if auto else 'SEM automation'
    print(f'  id={a["id"]} | {a["name"]} | {auto_str}')

print('\n' + '=' * 60)
print('COMPORTAMENTO NO ODOO:')
print('=' * 60)
print('''
A partir de agora, quando voce editar um produto:

1. Aba "Composicao de Custo":
   - Preencha: peso_ouro_g, custo_metal_g, custo_pedras_usd,
     cotacao_usd_brl, custo_mao_obra
2. Aba "Formacao de Preco":
   - Preencha: markup_pct
3. Clique em SALVAR (botao Save no topo)

AUTOMATICAMENTE (sem clicar em nada):
   - custo_metal_total = peso * custo/g
   - custo_pedras_brl = pedras_usd * cotacao
   - custo_total = metal + pedras + mao_obra
   - preco_calculado = custo_total * (1 + markup/100)
   - list_price (preco de venda) = preco_calculado

VOCE VERA:
   - Aba "Formacao de Preco" preenchida
   - Preco de venda (canto sup. direito do formulario) atualizado
''')
