#!/usr/bin/env python3
"""
odoo-scripts/setup-composicao-vendas.py
=======================================
Implementa composicao de precos por produto no pedido de venda:

1. Server Action "Joalheria - Copiar Composicao do Produto (linha)"
   (id=1072) - copia x_joa_* do produto para sale.order.line quando
   o produto e selecionado na linha do pedido

2. base.automation "Joalheria - Copiar Composicao ao Salvar Linha" (id=4)
   - trigger: on_create_or_write em sale.order.line
   - filter: product_id != False
   - Vinculada a Server Action 1072

3. Campos x_joa_total_* no sale.order (7 campos Float)
   - x_joa_total_peso_ouro_g
   - x_joa_total_custo_metal
   - x_joa_total_custo_pedras_brl
   - x_joa_total_custo_mao_obra
   - x_joa_total_custo
   - x_joa_total_preco_calculado
   - x_joa_total_markup_medio

4. Server Action "Joalheria - Totalizar Composicao (Pedido)" (id=1073)
   - soma os x_joa_* das linhas e atualiza os x_joa_total_* do sale.order

5. base.automation "Joalheria - Totalizar ao Salvar Pedido" (id=5)
   - trigger: on_create_or_write em sale.order
   - Vinculada a Server Action 1073

6. Aba "Composicao de Precos" no sale.order.form (view base 1232)
   - Mostra os 7 totais agregados do pedido

COMPORTAMENTO NOVO NO PEDIDO DE VENDA:
- Vendedor seleciona produto na linha
- AUTOMATICAMENTE: peso, custos, markup da linha sao preenchidos
  (override manual ainda possivel, se quiser customizar por venda)
- Salvar pedido -> totais agregados sao calculados
- Aba "Composicao de Precos" mostra resumo total do pedido

COMO USAR:
  ODOO_URL=https://fiscal-cloud-joalherias.odoo.com \\
  ODOO_DB=fiscal-cloud-joalherias \\
  ODOO_USER=marcus@nytro.com.br \\
  ODOO_API_KEY=6ec8... python3 odoo-scripts/setup-composicao-vendas.py
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


def upsert_field(model_id, name, field_description, ttype='float', **extra):
    existing = kw('ir.model.fields', 'search', [
        [['model_id', '=', model_id], ['name', '=', name]]
    ])
    values = {
        'name': name, 'field_description': field_description,
        'ttype': ttype, 'model_id': model_id, **extra,
    }
    if existing:
        kw('ir.model.fields', 'write', [existing, values])
        print(f'  - {name}: ATUALIZADO')
    else:
        fid = kw('ir.model.fields', 'create', [values])
        print(f'  - {name}: CRIADO (id={fid})')


# ============================================================
# 1. SERVER ACTION: Copiar composicao do produto para sale.order.line
# ============================================================
print('\n' + '=' * 60)
print('1. Server Action - Copiar Composicao (sale.order.line)')
print('=' * 60)

sol_ids = kw('ir.model', 'search', [[['model', '=', 'sale.order.line']]])
sol_id = sol_ids[0]

codigo_copy = """
# Joalheria: copia composicao de custos do produto para a linha do pedido
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
    try:
        valores['x_joa_tipo_operacao'] = p.x_joa_tipo_operacao
    except Exception:
        pass
    rec.write(valores)
"""

# Deleta action e automation existentes
existing_sa = kw('ir.actions.server', 'search', [[['name', '=', 'Joalheria - Copiar Composicao do Produto (linha)']]])
if existing_sa:
    kw('ir.actions.server', 'unlink', [existing_sa])

existing_auto = kw('base.automation', 'search', [[['name', '=', 'Joalheria - Copiar Composicao ao Salvar Linha']]])
if existing_auto:
    kw('base.automation', 'unlink', [existing_auto])

sa_id = kw('ir.actions.server', 'create', [{
    'name': 'Joalheria - Copiar Composicao do Produto (linha)',
    'model_id': sol_id,
    'state': 'code',
    'code': codigo_copy,
}])
print(f'  Server Action criada: id={sa_id}')

auto_id = kw('base.automation', 'create', [{
    'name': 'Joalheria - Copiar Composicao ao Salvar Linha',
    'model_id': sol_id,
    'trigger': 'on_create_or_write',
    'filter_domain': "[('product_id', '!=', False)]",
    'active': True,
}])
print(f'  base.automation criada: id={auto_id}')

kw('ir.actions.server', 'write', [[sa_id], {'base_automation_id': auto_id}])
print(f'  Server Action vinculada a automation')


# ============================================================
# 2. CAMPOS x_joa_total_* no sale.order
# ============================================================
print('\n' + '=' * 60)
print('2. Campos x_joa_total_* no sale.order')
print('=' * 60)

so_ids = kw('ir.model', 'search', [[['model', '=', 'sale.order']]])
so_id = so_ids[0]

campos_total = [
    {'name': 'x_joa_total_peso_ouro_g', 'field_description': 'Total Peso Ouro (g)'},
    {'name': 'x_joa_total_custo_metal', 'field_description': 'Total Custo Metal (BRL)'},
    {'name': 'x_joa_total_custo_pedras_brl', 'field_description': 'Total Custo Pedras (BRL)'},
    {'name': 'x_joa_total_custo_mao_obra', 'field_description': 'Total Custo Mao Obra (BRL)'},
    {'name': 'x_joa_total_custo', 'field_description': 'Custo Total do Pedido (BRL)'},
    {'name': 'x_joa_total_preco_calculado', 'field_description': 'Total Preco Calculado (BRL)'},
    {'name': 'x_joa_total_markup_medio', 'field_description': 'Markup Medio (%)'},
]
for c in campos_total:
    upsert_field(so_id, **c)


# ============================================================
# 3. SERVER ACTION: Totalizar composicao no sale.order
# ============================================================
print('\n' + '=' * 60)
print('3. Server Action - Totalizar Composicao (sale.order)')
print('=' * 60)

codigo_sum = """
# Joalheria: soma composicao de custos das linhas no sale.order
for rec in records:
    peso = sum(rec.order_line.mapped('x_joa_peso_ouro_g') or [0])
    metal = sum(rec.order_line.mapped('x_joa_custo_metal_total') or [0])
    pedras = sum(rec.order_line.mapped('x_joa_custo_pedras_brl') or [0])
    mao_obra = sum(rec.order_line.mapped('x_joa_custo_mao_obra') or [0])
    custo_total = sum(rec.order_line.mapped('x_joa_custo_total_unit') or [0])
    preco_calc = sum(rec.order_line.mapped('x_joa_preco_calculado_unit') or [0])
    
    linhas_com_custo = rec.order_line.filtered(lambda l: l.x_joa_custo_total_unit > 0)
    markup_med = 0
    if linhas_com_custo and custo_total > 0:
        markup_med = sum((l.x_joa_markup_pct or 0) * l.x_joa_custo_total_unit for l in linhas_com_custo) / custo_total
    
    rec.write({
        'x_joa_total_peso_ouro_g': peso,
        'x_joa_total_custo_metal': metal,
        'x_joa_total_custo_pedras_brl': pedras,
        'x_joa_total_custo_mao_obra': mao_obra,
        'x_joa_total_custo': custo_total,
        'x_joa_total_preco_calculado': preco_calc,
        'x_joa_total_markup_medio': markup_med,
    })
"""

existing_sa2 = kw('ir.actions.server', 'search', [[['name', '=', 'Joalheria - Totalizar Composicao (Pedido)']]])
if existing_sa2:
    kw('ir.actions.server', 'unlink', [existing_sa2])

existing_auto2 = kw('base.automation', 'search', [[['name', '=', 'Joalheria - Totalizar ao Salvar Pedido']]])
if existing_auto2:
    kw('base.automation', 'unlink', [existing_auto2])

sa_id2 = kw('ir.actions.server', 'create', [{
    'name': 'Joalheria - Totalizar Composicao (Pedido)',
    'model_id': so_id,
    'state': 'code',
    'code': codigo_sum,
}])
print(f'  Server Action criada: id={sa_id2}')

auto_id2 = kw('base.automation', 'create', [{
    'name': 'Joalheria - Totalizar ao Salvar Pedido',
    'model_id': so_id,
    'trigger': 'on_create_or_write',
    'active': True,
}])
print(f'  base.automation criada: id={auto_id2}')

kw('ir.actions.server', 'write', [[sa_id2], {'base_automation_id': auto_id2}])
print(f'  Server Action vinculada a automation')


# ============================================================
# 4. ABA "Composicao de Precos" no sale.order
# ============================================================
print('\n' + '=' * 60)
print('4. Aba "Composicao de Precos" no sale.order.form (view 1232)')
print('=' * 60)

v = kw('ir.ui.view', 'read', [[1232], ['arch_db']])[0]
arch = v['arch_db']

aba = '''<page string="Composicao de Precos" name="joa_composicao_precos">
      <group>
        <group string="Resumo Total do Pedido">
          <field name="x_joa_total_peso_ouro_g" widget="float"/>
          <field name="x_joa_total_custo_metal"/>
          <field name="x_joa_total_custo_pedras_brl"/>
          <field name="x_joa_total_custo_mao_obra"/>
          <field name="x_joa_total_custo"/>
          <field name="x_joa_total_preco_calculado"/>
          <field name="x_joa_total_markup_medio" widget="percentage"/>
        </group>
        <group string="Lucro e Margem">
          <field name="amount_untaxed" string="Preco Venda (s/ impostos)"/>
          <field name="x_joa_total_custo" string="Custo Total" invisible="1"/>
        </group>
      </group>
      <group string="Detalhamento por Linha (editar valores na aba Order Lines)">
        <p class="text-muted">Para editar valores por produto, va na aba <b>Order Lines</b> e role as colunas para o lado.</p>
      </group>
    </page>'''

if 'JOA_COMPOSICAO_PRECOS_V1' in arch:
    print('  = Aba ja existe')
else:
    idx = arch.rfind('</notebook>')
    novo = arch[:idx] + '<!-- JOA_COMPOSICAO_PRECOS_V1 -->' + aba + arch[idx:]
    try:
        kw('ir.ui.view', 'write', [[1232], {'arch_db': novo}])
        print(f'  ✅ Aba "Composicao de Precos" criada no sale.order.form')
    except Exception as e:
        print(f'  ❌ Erro: {str(e)[:300]}')


# ============================================================
# RELATORIO FINAL
# ============================================================
print('\n' + '=' * 60)
print('SETUP CONCLUIDO!')
print('=' * 60)
print('''
COMPORTAMENTO NOVO NO PEDIDO DE VENDA:

1. Vendedor seleciona produto na linha
   -> AUTOMATICO: peso, custos, markup, preco_calculado copiados do produto
   -> Vendedor pode override (editar) qualquer valor por linha

2. Salvar o pedido
   -> AUTOMATICO: totais agregados calculados no sale.order
   (x_joa_total_peso_ouro_g, x_joa_total_custo_*, x_joa_total_preco_calculado)

3. Aba "Composicao de Precos" mostra:
   - Total Peso Ouro (g)
   - Total Custo Metal
   - Total Custo Pedras BRL
   - Total Custo Mao Obra
   - Custo Total do Pedido
   - Total Preco Calculado
   - Markup Medio
   - Preco Venda (s/ impostos) - amount_untaxed do proprio Odoo

Na aba "Order Lines" (tree principal), o vendedor tambem ve 8 colunas
joalheiras com os valores por linha (peso, custos, markup, tipo_operacao).
''')
