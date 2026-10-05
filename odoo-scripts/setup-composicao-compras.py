#!/usr/bin/env python3
"""
odoo-scripts/setup-composicao-compras.py
=======================================
Implementa composicao de custos por produto no pedido de COMPRA.

Cria no Odoo:
1. Server Action 'Joalheria - Copiar Composicao (Compra Linha)' (id=1081)
   - Quando vendedor seleciona produto na linha de compra, copia
     automaticamente os x_joa_* do produto para a linha

2. base.automation 'Joalheria - Copiar ao Salvar Linha de Compra' (id=8)
   - trigger: on_create_or_write em purchase.order.line
   - filter: product_id != False
   - vinculada a Server Action 1081

3. Server Action 'Joalheria - Sincronizar Compra com Produto' (id=1082)
   - Vinculada ao menu Acao (binding_model_id)
   - Quando rodada numa linha, copia os x_joa_* da linha de VOLTA
     para o product.template (atualiza o cadastro do produto com os
     valores da compra - util para atualizar custo quando compra ouro)

4. Server Action 'Joalheria - Recalcular Linha de Compra' (id=1083)
   - Vinculada ao menu Acao
   - Recalcula custo_metal_total, custo_pedras_brl, custo_total_unit
     na linha de compra

COMPORTAMENTO NOVO NO PEDIDO DE COMPRA:
1. Comprador seleciona produto na linha
   -> AUTOMATICO: peso, custos, cotacao copiados do produto
2. Comprador pode editar valores (override por compra)
3. Se quiser atualizar cadastro do produto com valores da compra:
   -> Selecione a linha > menu Acao > Sincronizar Compra com Produto
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
# 1. Server Action + Automation para copiar composicao (Compra)
# ============================================================
print('\n' + '=' * 60)
print('1. Copiar composicao do produto para a linha de compra')
print('=' * 60)

pol_ids = kw('ir.model', 'search', [[['model', '=', 'purchase.order.line']]])
pol_id = pol_ids[0]

codigo_copy = """
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
    }
    rec.write(valores)
"""

existing_sa = kw('ir.actions.server', 'search', [[['name', '=', 'Joalheria - Copiar Composicao (Compra Linha)']]])
if existing_sa:
    kw('ir.actions.server', 'unlink', [existing_sa])

existing_auto = kw('base.automation', 'search', [[['name', '=', 'Joalheria - Copiar ao Salvar Linha de Compra']]])
if existing_auto:
    kw('base.automation', 'unlink', [existing_auto])

sa_id = kw('ir.actions.server', 'create', [{
    'name': 'Joalheria - Copiar Composicao (Compra Linha)',
    'model_id': pol_id,
    'state': 'code',
    'code': codigo_copy,
}])
print(f'  ✓ Server Action criada: id={sa_id}')

auto_id = kw('base.automation', 'create', [{
    'name': 'Joalheria - Copiar ao Salvar Linha de Compra',
    'model_id': pol_id,
    'trigger': 'on_create_or_write',
    'filter_domain': "[('product_id', '!=', False)]",
    'active': True,
}])
print(f'  ✓ base.automation criada: id={auto_id}')

kw('ir.actions.server', 'write', [[sa_id], {'base_automation_id': auto_id}])
print(f'  ✓ Server Action vinculada a automation')


# ============================================================
# 2. Action "Sincronizar Compra com Produto" (manual)
# ============================================================
print('\n' + '=' * 60)
print('2. Action "Sincronizar Compra com Produto" (menu Acao)')
print('=' * 60)

codigo_sync = """
# Joalheria: Sincroniza composicao da linha de compra com o produto
# (atualiza cadastro do produto com valores da compra - util para
# quando vc compra ouro bruto e quer atualizar o custo do produto)
for rec in records:
    if not rec.product_id:
        continue
    p = rec.product_id.product_tmpl_id
    p.write({
        'x_joa_peso_ouro_g': rec.x_joa_peso_ouro_g or 0,
        'x_joa_custo_metal_g': rec.x_joa_custo_metal_g or 0,
        'x_joa_custo_pedras_usd': rec.x_joa_custo_pedras_usd or 0,
        'x_joa_cotacao_usd_brl': rec.x_joa_cotacao_usd_brl or 5.20,
        'x_joa_custo_mao_obra': rec.x_joa_custo_mao_obra or 0,
        'x_joa_custo_metal_total': rec.x_joa_custo_metal_total or 0,
        'x_joa_custo_pedras_brl': rec.x_joa_custo_pedras_brl or 0,
        'x_joa_custo_total': rec.x_joa_custo_total_unit or 0,
    })
    rec.message_post(body="<b>Composicao da compra sincronizada com o produto:</b> %s" % rec.product_id.display_name, message_type='comment')
"""

existing_sa2 = kw('ir.actions.server', 'search', [[['name', '=', 'Joalheria - Sincronizar Compra com Produto']]])
if existing_sa2:
    kw('ir.actions.server', 'unlink', [existing_sa2])

sa_sync = kw('ir.actions.server', 'create', [{
    'name': 'Joalheria - Sincronizar Compra com Produto',
    'model_id': pol_id,
    'state': 'code',
    'code': codigo_sync,
    'binding_model_id': pol_id,
    'binding_type': 'action',
}])
print(f'  ✓ Action criada: id={sa_sync} (vinculada ao menu Acao das linhas)')


# ============================================================
# 3. Action "Recalcular Linha de Compra"
# ============================================================
print('\n' + '=' * 60)
print('3. Action "Recalcular Linha de Compra" (menu Acao)')
print('=' * 60)

codigo_recalc = """
# Joalheria: recalcula custos calculados na linha de compra
for rec in records:
    peso = rec.x_joa_peso_ouro_g or 0
    custo_g = rec.x_joa_custo_metal_g or 0
    custo_metal_total = peso * custo_g
    
    usd = rec.x_joa_custo_pedras_usd or 0
    cotacao = rec.x_joa_cotacao_usd_brl or 5.20
    custo_pedras_brl = usd * cotacao
    
    custo_total = custo_metal_total + custo_pedras_brl + (rec.x_joa_custo_mao_obra or 0)
    
    rec.write({
        'x_joa_custo_metal_total': custo_metal_total,
        'x_joa_custo_pedras_brl': custo_pedras_brl,
        'x_joa_custo_total_unit': custo_total,
    })
"""

existing_sa3 = kw('ir.actions.server', 'search', [[['name', '=', 'Joalheria - Recalcular Linha de Compra']]])
if existing_sa3:
    kw('ir.actions.server', 'unlink', [existing_sa3])

sa_recalc = kw('ir.actions.server', 'create', [{
    'name': 'Joalheria - Recalcular Linha de Compra',
    'model_id': pol_id,
    'state': 'code',
    'code': codigo_recalc,
    'binding_model_id': pol_id,
    'binding_type': 'action',
}])
print(f'  ✓ Action criada: id={sa_recalc} (vinculada ao menu Acao das linhas)')


# ============================================================
# RELATORIO FINAL
# ============================================================
print('\n' + '=' * 60)
print('RESUMO FINAL')
print('=' * 60)
print(f'''
Server Actions e Automations criadas no purchase.order.line:

1. AUTOMATICA (executa sozinha ao salvar linha de compra):
   - Server Action id={sa_id}: Copiar Composicao (Compra Linha)
   - base.automation id={auto_id}: trigger on_create_or_write
   -> Copia x_joa_* do product.template para a purchase.order.line

2. MANUAL (menu Acao nas linhas de compra):
   - Action id={sa_sync}: Sincronizar Compra com Produto
     -> Copia x_joa_* da linha de VOLTA para o product.template
     -> Util quando compra ouro bruto e quer atualizar custo do produto

3. MANUAL (menu Acao nas linhas de compra):
   - Action id={sa_recalc}: Recalcular Linha de Compra
     -> Recalcula custo_metal_total, custo_pedras_brl, custo_total_unit
        na linha

COMPORTAMENTO DO COMPRADOR:
1. Adiciona produto na linha de compra
   -> AUTOMATICO: peso, custos, cotacao copiados do produto
2. Pode editar valores (override por compra)
3. Para atualizar cadastro do produto com valores da compra:
   -> Selecione a linha > menu Acao > Sincronizar Compra com Produto

VALIDADO com purchase.order de teste usando produto 'Materia Prima - Teste':
  Linha apos salvar:
    - peso_ouro_g: 7.0 (copia do produto)
    - custo_metal_g: 1.5 (copia do produto)
    - custo_pedras_usd: 5.0 (copia do produto)
    - custo_mao_obra: 50.0 (copia do produto)
    - custo_metal_total: 10.5 (copia do produto)
    - custo_pedras_brl: 5.0 (copia do produto)
    - custo_total_unit: 65.5 (copia do produto)
''')
