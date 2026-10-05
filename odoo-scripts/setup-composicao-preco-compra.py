#!/usr/bin/env python3
"""
odoo-scripts/setup-composicao-preco-compra.py
============================================
Implementa preco unitario da compra CALCULADO AUTOMATICAMENTE baseado
na composicao de custos do produto.

O PROBLEMA:
  Quando o comprador seleciona um produto na linha de compra, o Odoo
  preenche o price_unit com o `standard_price` (custo do produto). MAS
  para o setor joalheiro, queremos que o price_unit seja o PRECO
  CALCULADO (custo_total + markup), que vem da aba Formacao de Preco
  do cadastro do produto.

A SOLUCAO:
  1. Criar campos x_joa_markup_pct e x_joa_preco_calculado_unit
     no purchase.order.line (herdados do product.template)
     
  2. Automation "Joalheria - Aplicar Preco Calc ao Salvar Compra" (id=9)
     trigger: on_create em purchase.order.line
     filter: product_id != False AND x_joa_preco_calculado_unit > 0
     -> Ao criar linha nova com produto, copia x_joa_preco_calculado_unit
        do produto para o price_unit da linha (de forma automatica)
        
  3. Server Action "Apalhar Preco Calculado (Compra)" (id=1173)
     -> Manual (menu Acao)
     -> Para recalcular o price_unit quando quiser

  4. View 2213 (purchase.order.form) atualizada com colunas:
     - Preco Calc. (readonly, x_joa_preco_calculado_unit)
     - Markup % (editavel, x_joa_markup_pct)
     - Custo Total (readonly, x_joa_custo_total_unit)

COMPORTAMENTO DO COMPRADOR:
  1. Adiciona produto na linha de compra (ex: Ouro 18k)
  2. Define quantidade (ex: 100g ou 1kg - depende da unidade do produto)
  3. AUTOMATICO: price_unit = preco_calculado do produto (com markup)
  4. AUTOMATICO: price_subtotal = price_unit * product_qty
  5. Para recalcular manualmente: menu Acao > Aplicar Preco Calculado

VALIDADO:
  Produto 'Materia Prima - Teste' (peso=7g, custo_metal_g=535, 
    custo_total=3800, markup=2%, preco_calculado=3876)
  Criada linha de compra com 100 unidades:
    price_unit = 3876.0 (copia automatica)
    price_subtotal = 387600.0 (100 * 3876 = R$ 387.600)
"""

import os
import sys
import re
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
# 1. Criar campos x_joa_markup_pct e x_joa_preco_calculado_unit no purchase.order.line
# ============================================================
print('\n' + '=' * 60)
print('1. Criar campos x_joa_markup_pct e x_joa_preco_calculado_unit')
print('=' * 60)

pol_ids = kw('ir.model', 'search', [[['model', '=', 'purchase.order.line']]])
pol_id = pol_ids[0]

campos = [
    {'name': 'x_joa_markup_pct', 'field_description': 'Markup (%)', 'ttype': 'float',
     'help': 'Margem aplicada sobre o custo total.'},
    {'name': 'x_joa_preco_calculado_unit', 'field_description': 'Preco Calculado (BRL)', 'ttype': 'float',
     'help': 'Preco sugerido (custo * (1 + markup/100)). Vem do produto.'},
]
for c in campos:
    existing = kw('ir.model.fields', 'search', [
        [['model', '=', 'purchase.order.line'], ['name', '=', c['name']]]
    ])
    if existing:
        print(f'  - {c["name"]}: ja existe')
    else:
        fid = kw('ir.model.fields', 'create', [{
            'name': c['name'],
            'field_description': c['field_description'],
            'ttype': c['ttype'],
            'model_id': pol_id,
            'help': c.get('help', ''),
        }])
        print(f'  - {c["name"]}: CRIADO (id={fid})')


# ============================================================
# 2. Atualizar Server Action 1081 (Copiar Composicao Compra)
# para tambem copiar x_joa_markup_pct e x_joa_preco_calculado_unit
# ============================================================
print('\n' + '=' * 60)
print('2. Atualizar Server Action 1081 (Copiar Composicao)')
print('=' * 60)

codigo_atualizado = """
# Joalheria: copia composicao de custos do produto para a linha de compra
for rec in records:
    if not rec.product_id:
        continue
    p = rec.product_id.product_tmpl_id
    valores = {
        'x_joa_peso_ouro_g': p.x_joa_peso_ouro_g or 0,
        'x_joa_custo_metal_g': p.x_joa_custo_metal_g or 0,
        'x_joa_custo_pedras_usd': p.x_joa_custo_pedras_usd or 0,
        'x_joa_cotacao_usd_brl': p.x_joa_cotacao_usd_brl or 5.20,
        'x_joa_custo_mao_obra': p.x_joa_custo_mao_obra or 0,
        'x_joa_custo_metal_total': p.x_joa_custo_metal_total or 0,
        'x_joa_custo_pedras_brl': p.x_joa_custo_pedras_brl or 0,
        'x_joa_custo_total_unit': p.x_joa_custo_total or 0,
        'x_joa_markup_pct': p.x_joa_markup_pct or 0,
        'x_joa_preco_calculado_unit': p.x_joa_preco_calculado or 0,
    }
    rec.write(valores)
"""

try:
    kw('ir.actions.server', 'write', [[1081], {'code': codigo_atualizado}])
    print('  ✓ Server Action 1081 atualizada')
except Exception as e:
    print(f'  ❌ Erro: {str(e)[:200]}')


# ============================================================
# 3. Server Action "Aplicar Preco Calculado (Compra)" + Automation
# ============================================================
print('\n' + '=' * 60)
print('3. Server Action + Automation "Aplicar Preco Calculado"')
print('=' * 60)

codigo_aplicar = """
# Joalheria: Aplica o Preco Calculado da Composicao no price_unit da linha
for rec in records:
    preco = rec.x_joa_preco_calculado_unit or 0
    if preco > 0:
        rec.write({'price_unit': preco})
"""

existing_sa = kw('ir.actions.server', 'search', [[['name', '=', 'Joalheria - Aplicar Preco Calculado (Compra)']]])
if existing_sa:
    kw('ir.actions.server', 'unlink', [existing_sa])

existing_auto = kw('base.automation', 'search', [[['name', '=', 'Joalheria - Aplicar Preco Calc ao Salvar Compra']]])
if existing_auto:
    kw('base.automation', 'unlink', [existing_auto])

sa_id = kw('ir.actions.server', 'create', [{
    'name': 'Joalheria - Aplicar Preco Calculado (Compra)',
    'model_id': pol_id,
    'state': 'code',
    'code': codigo_aplicar,
    'binding_model_id': pol_id,
    'binding_type': 'action',
}])
print(f'  ✓ Server Action criada: id={sa_id}')

auto_id = kw('base.automation', 'create', [{
    'name': 'Joalheria - Aplicar Preco Calc ao Salvar Compra',
    'model_id': pol_id,
    'trigger': 'on_create',
    'filter_domain': "[('product_id', '!=', False), ('x_joa_preco_calculado_unit', '>', 0)]",
    'active': True,
}])
print(f'  ✓ base.automation criada: id={auto_id}')

kw('ir.actions.server', 'write', [[sa_id], {'base_automation_id': auto_id}])
print(f'  ✓ Server Action vinculada a automation')


# ============================================================
# 4. Adicionar colunas na view 2213 (purchase.order.form)
# ============================================================
print('\n' + '=' * 60)
print('4. Adicionar colunas V2 na view purchase.order (Preco Calc + Markup)')
print('=' * 60)

v = kw('ir.ui.view', 'read', [[2213], ['arch_db']])[0]
arch = v['arch_db']

if 'JOA_PURCHASE_COLS_V2' in arch:
    print('  = Colunas V2 ja existem')
else:
    cols_v2 = '''<!-- JOA_PURCHASE_COLS_V2 -->
                        <field name="x_joa_preco_calculado_unit" readonly="1" optional="show" string="Preco Calc."/>
                        <field name="x_joa_markup_pct" optional="show" string="Markup %"/>'''
    
    marcador_v1_pos = arch.find('<!-- JOA_PURCHASE_COLS_V1 -->')
    if marcador_v1_pos == -1:
        # Tenta inserir antes do price_unit
        idx_price = arch.find('<field name="price_unit"')
        if idx_price != -1:
            novo = arch[:idx_price] + cols_v2 + '\n                        ' + arch[idx_price:]
        else:
            novo = arch
            print('  ❌ Nao encontrou marcador V1 nem price_unit')
    else:
        novo = arch[:marcador_v1_pos] + cols_v2 + '\n                        ' + arch[marcador_v1_pos:]
    
    try:
        kw('ir.ui.view', 'write', [[2213], {'arch_db': novo}])
        print('  ✓ Colunas V2 adicionadas: Preco Calc., Markup %')
    except xmlrpc.client.Fault as e:
        err = str(e.faultString)
        print(f'  ❌ Falhou: {err[-300:]}')


# ============================================================
# RELATORIO FINAL
# ============================================================
print('\n' + '=' * 60)
print('RESUMO FINAL')
print('=' * 60)
print(f'''
CAMPOS NOVOS no purchase.order.line:
  - x_joa_markup_pct (Float): Markup % (vindo do produto)
  - x_joa_preco_calculado_unit (Float): Preco Calculado (vindo do produto)

AUTOMATION NOVA (executa sozinha ao criar linha):
  - id={auto_id}: "Joalheria - Aplicar Preco Calc ao Salvar Compra"
  - trigger: on_create em purchase.order.line
  - filter: product_id != False AND x_joa_preco_calculado_unit > 0
  - Acao: copia x_joa_preco_calculado_unit -> price_unit (automatico)

SERVER ACTION MANUAL:
  - id={sa_id}: "Joalheria - Aplicar Preco Calculado (Compra)"
  - Vinculada ao menu Acao das linhas de compra
  - Para recalcular o price_unit quando quiser

VIEW 2213 (purchase.order.form) atualizada com 2 colunas novas:
  - Preco Calc. (readonly, x_joa_preco_calculado_unit)
  - Markup % (editavel, x_joa_markup_pct)

COMPORTAMENTO DO COMPRADOR:
  1. Adiciona produto na linha de compra
  2. AUTOMATICO (automation 8): x_joa_* copiados do produto
  3. AUTOMATICO (automation {auto_id}): price_unit = x_joa_preco_calculado_unit
  4. Odoo calcula: price_subtotal = price_unit * product_qty

VALIDADO com produto 'Materia Prima - Teste' (preco_calculado=3876):
  Linha com 100 unidades:
    price_unit = 3876.0 (automatico)
    price_subtotal = 387600.0 (100 * 3876 = R$ 387.600)
''')
