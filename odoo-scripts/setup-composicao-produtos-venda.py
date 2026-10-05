#!/usr/bin/env python3
"""
odoo-scripts/setup-composicao-produtos-venda.py
===============================================
Implementa composicao de precos por produto no pedido de venda.

DESAFIOS ENCONTRADOS NO SAAS TRIAL:
1. Nao permite criar views herdadas (ir.ui.view com inherit_id)
2. NAO permite ter 2 <field name="order_line"> no mesmo formulario
   (Erro: "product_id nao existe no modelo sale.order")

SOLUCAO ADOTADA:
- Adicionar mais colunas x_joa_* na TREE EXISTENTE (page Order Lines)
  para mostrar TODA a composicao por produto
- Criar uma page "Totais do Pedido" so com GROUP de totais agregados
  (sem tree inline)
- Criar 2 Server Actions manuais:
  - "Sincronizar Composicao com Produto" (copia valores da linha -> produto)
  - "Recalcular Custos da Linha" (recalcula campos readonly na linha)

COMO USAR:
  ODOO_URL=https://fiscal-cloud-joalherias.odoo.com \\
  ODOO_DB=fiscal-cloud-joalherias \\
  ODOO_USER=marcus@nytro.com.br \\
  ODOO_API_KEY=6ec8... python3 odoo-scripts/setup-composicao-produtos-venda.py
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
# 1. SERVER ACTIONS para linhas do pedido de venda
# ============================================================
print('\n' + '=' * 60)
print('1. Server Actions para sale.order.line')
print('=' * 60)

sol_ids = kw('ir.model', 'search', [[['model', '=', 'sale.order.line']]])
sol_id = sol_ids[0]

# 1a. Sincronizar Composicao com Produto
codigo_sync = """
# Joalheria: Sincroniza composicao da linha do pedido com o produto (inventario)
# Cuidado: sobrescreve os valores x_joa_* do produto com os valores da linha
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
        'x_joa_markup_pct': rec.x_joa_markup_pct or 0,
        'x_joa_preco_calculado': rec.x_joa_preco_calculado_unit or 0,
    })
    rec.message_post(body="<b>Composicao sincronizada com o produto:</b> %s<br/>Valores atualizados no cadastro do produto." % rec.product_id.display_name, message_type='comment')
"""

existing = kw('ir.actions.server', 'search', [[['name', '=', 'Joalheria - Sincronizar Composicao com Produto']]])
if existing:
    kw('ir.actions.server', 'unlink', [existing])

sa_sync = kw('ir.actions.server', 'create', [{
    'name': 'Joalheria - Sincronizar Composicao com Produto',
    'model_id': sol_id,
    'state': 'code',
    'code': codigo_sync,
    'binding_model_id': sol_id,
    'binding_type': 'action',
}])
print(f'  ✓ Action "Sincronizar Composicao com Produto" criada: id={sa_sync}')

# 1b. Recalcular Custos da Linha
codigo_recalc_linha = """
# Joalheria: recalcula custos calculados na linha do pedido de venda
for rec in records:
    peso = rec.x_joa_peso_ouro_g or 0
    custo_g = rec.x_joa_custo_metal_g or 0
    custo_metal_total = peso * custo_g
    
    usd = rec.x_joa_custo_pedras_usd or 0
    cotacao = rec.x_joa_cotacao_usd_brl or 5.20
    custo_pedras_brl = usd * cotacao
    
    custo_total = custo_metal_total + custo_pedras_brl + (rec.x_joa_custo_mao_obra or 0)
    
    markup = rec.x_joa_markup_pct or 0
    preco_calc = custo_total * (1 + markup / 100)
    
    rec.write({
        'x_joa_custo_metal_total': custo_metal_total,
        'x_joa_custo_pedras_brl': custo_pedras_brl,
        'x_joa_custo_total_unit': custo_total,
        'x_joa_preco_calculado_unit': preco_calc,
    })
"""

existing2 = kw('ir.actions.server', 'search', [[['name', '=', 'Joalheria - Recalcular Custos da Linha']]])
if existing2:
    kw('ir.actions.server', 'unlink', [existing2])

sa_recalc = kw('ir.actions.server', 'create', [{
    'name': 'Joalheria - Recalcular Custos da Linha',
    'model_id': sol_id,
    'state': 'code',
    'code': codigo_recalc_linha,
    'binding_model_id': sol_id,
    'binding_type': 'action',
}])
print(f'  ✓ Action "Recalcular Custos da Linha" criada: id={sa_recalc}')

# 1c. Action "Sincronizar Composicao no Pedido" (sale.order) - sincroniza TODAS as linhas
so_ids = kw('ir.model', 'search', [[['model', '=', 'sale.order']]])
so_id = so_ids[0]

codigo_sync_pedido = """
# Joalheria: sincroniza TODAS as linhas do pedido com os produtos
for rec in records:
    for line in rec.order_line:
        if not line.product_id:
            continue
        p = line.product_id.product_tmpl_id
        p.write({
            'x_joa_peso_ouro_g': line.x_joa_peso_ouro_g or 0,
            'x_joa_custo_metal_g': line.x_joa_custo_metal_g or 0,
            'x_joa_custo_pedras_usd': line.x_joa_custo_pedras_usd or 0,
            'x_joa_cotacao_usd_brl': line.x_joa_cotacao_usd_brl or 5.20,
            'x_joa_custo_mao_obra': line.x_joa_custo_mao_obra or 0,
            'x_joa_custo_metal_total': line.x_joa_custo_metal_total or 0,
            'x_joa_custo_pedras_brl': line.x_joa_custo_pedras_brl or 0,
            'x_joa_custo_total': line.x_joa_custo_total_unit or 0,
            'x_joa_markup_pct': line.x_joa_markup_pct or 0,
            'x_joa_preco_calculado': line.x_joa_preco_calculado_unit or 0,
        })
        rec.message_post(body="<b>Composicao sincronizada com produtos</b><br/>Todos os valores das linhas foram copiados para os respectivos produtos.", message_type='comment')
"""

existing3 = kw('ir.actions.server', 'search', [[['name', '=', 'Joalheria - Sincronizar Tudo com Produtos']]])
if existing3:
    kw('ir.actions.server', 'unlink', [existing3])

sa_sync_pedido = kw('ir.actions.server', 'create', [{
    'name': 'Joalheria - Sincronizar Tudo com Produtos',
    'model_id': so_id,
    'state': 'code',
    'code': codigo_sync_pedido,
    'binding_model_id': so_id,
    'binding_type': 'action',
}])
print(f'  ✓ Action "Sincronizar Tudo com Produtos" criada: id={sa_sync_pedido}')


# ============================================================
# 2. Adicionar MAIS colunas x_joa_* na tree existente do sale.order
# ============================================================
print('\n' + '=' * 60)
print('2. Adicionar colunas na tree principal do sale.order (page Order Lines)')
print('=' * 60)

v = kw('ir.ui.view', 'read', [[1232], ['arch_db']])[0]
arch = v['arch_db']

# Limpa marcadores antigos
arch = re.sub(r'<!-- JOA_COMPOSICAO_PRECOS_V[12] -->.*?</page>', '', arch, flags=re.DOTALL)
arch = re.sub(r'<!-- JOA_COMPOSICAO_PRODUTO_V[0-9]+ -->.*?</page>', '', arch, flags=re.DOTALL)
arch = re.sub(r'<!-- JOA_TOTAIS_PEDIDO_V[0-9]+ -->.*?</page>', '', arch, flags=re.DOTALL)
arch = re.sub(r'<!-- JOA_SALE_COLS_V1 -->.*?(?=<field name=")', '', arch, flags=re.DOTALL)

marker = 'JOA_TREE_COLS_V1'
if marker in arch:
    print('  = Marcador JOA_TREE_COLS_V1 ja existe - removendo para re-aplicar')
    arch = re.sub(r'<!-- JOA_TREE_COLS_V1 -->.*?(?=<field name="price_unit")', '', arch, flags=re.DOTALL)

# Adiciona colunas extras antes do price_unit
cols_extra = '''<!-- JOA_TREE_COLS_V1 -->
                            <field name="x_joa_custo_pedras_brl" readonly="1" optional="show" sum="Total Pedras BRL"/>
                            <field name="x_joa_custo_mao_obra" readonly="1" optional="show" sum="Total Mao Obra"/>
                            <field name="x_joa_custo_total_unit" readonly="1" optional="show" sum="Total Custo"/>
                            <field name="x_joa_preco_calculado_unit" readonly="1" optional="show" sum="Total Preco Calc"/>'''

idx_price_unit = arch.find('<field name="price_unit"')
if idx_price_unit == -1:
    print('  ❌ price_unit nao encontrado')
else:
    novo = arch[:idx_price_unit] + cols_extra + arch[idx_price_unit:]
    try:
        kw('ir.ui.view', 'write', [[1232], {'arch_db': novo}])
        print('  ✓ Colunas adicionadas: custo_pedras_brl, custo_mao_obra, custo_total, preco_calculado')
        arch = novo
    except xmlrpc.client.Fault as e:
        err = str(e.faultString)
        print(f'  ❌ Falhou: {err[-300:]}')


# ============================================================
# 3. Aba "Totais do Pedido" (sem tree inline, so GROUP)
# ============================================================
print('\n' + '=' * 60)
print('3. Aba "Totais do Pedido" no sale.order.form')
print('=' * 60)

aba_totais = '''<!-- JOA_TOTAIS_PEDIDO_V1 -->
    <page string="Totais do Pedido" name="joa_totais_pedido">
      <group>
        <group string="Custos do Pedido">
          <field name="x_joa_total_peso_ouro_g" widget="float"/>
          <field name="x_joa_total_custo_metal"/>
          <field name="x_joa_total_custo_pedras_brl"/>
          <field name="x_joa_total_custo_mao_obra"/>
          <field name="x_joa_total_custo"/>
        </group>
        <group string="Preco e Margem">
          <field name="x_joa_total_preco_calculado"/>
          <field name="x_joa_total_markup_medio" widget="percentage"/>
          <field name="amount_untaxed" string="Preco Venda (s/ impostos)"/>
        </group>
      </group>
      <group string="Como Sincronizar com Produto">
        <p class="text-muted">
          Para copiar os valores das linhas de volta para o cadastro dos produtos:<br/>
          1. Va na aba <b>Order Lines</b><br/>
          2. Selecione as linhas (checkbox)<br/>
          3. Menu Acao (engrenagem) -> <b>Sincronizar Composicao com Produto</b><br/><br/>
          OU use a action <b>Sincronizar Tudo com Produtos</b> no menu Acao do pedido (copia TODAS as linhas).
        </p>
      </group>
    </page>'''

if 'JOA_TOTAIS_PEDIDO_V1' in arch:
    print('  = Aba ja existe')
else:
    idx = arch.rfind('</notebook>')
    novo = arch[:idx] + aba_totais + arch[idx:]
    try:
        kw('ir.ui.view', 'write', [[1232], {'arch_db': novo}])
        print('  ✓ Aba "Totais do Pedido" criada')
    except xmlrpc.client.Fault as e:
        err = str(e.faultString)
        print(f'  ❌ Falhou: {err[-300:]}')


# ============================================================
# RELATORIO FINAL
print('\n' + '=' * 60)
print('RESUMO FINAL')
print('=' * 60)
print(f'''
Server Actions criadas:
  - id={sa_sync}: Sincronizar Composicao com Produto (sale.order.line)
    -> Selecione 1 linha > menu Acao > Sincronizar
    -> Copia valores x_joa_* da linha para o product.template

  - id={sa_recalc}: Recalcular Custos da Linha (sale.order.line)
    -> Selecione 1 linha > menu Acao > Recalcular
    -> Recalcula custo_metal_total, custo_pedras_brl, custo_total, preco_calculado

  - id={sa_sync_pedido}: Sincronizar Tudo com Produtos (sale.order)
    -> No pedido > menu Acao > Sincronizar Tudo
    -> Copia valores de TODAS as linhas para os respectivos produtos

Colunas adicionadas na tree das linhas (page Order Lines):
  Antes ja tinha: peso_ouro_g, custo_metal_g, pedras_usd, mao_obra,
                  markup, preco_calculado, tipo_operacao
  Novas: custo_pedras_brl, custo_mao_obra (readonly), custo_total,
         preco_calculado (readonly)
  -> Soma no rodape: Total Pedras, Total Mao Obra, Total Custo,
     Total Preco Calc

Nova aba "Totais do Pedido" (depois da page Order Lines):
  Mostra 7 totais agregados:
    - Total Peso Ouro (g)
    - Total Custo Metal (BRL)
    - Total Custo Pedras (BRL)
    - Total Custo Mao Obra (BRL)
    - Custo Total do Pedido (BRL)
    - Total Preco Calculado (BRL)
    - Markup Medio (%)
    + Preco Venda (s/ impostos) do Odoo para comparacao

LIMITACAO DO SAAS TRIAL:
  Nao permite criar uma segunda tree inline do order_line (erro
  'product_id nao existe no modelo sale.order'). Por isso a composicao
  POR PRODUTO aparece na tree da page Order Lines (13 colunas) e os
  TOTAIS AGREGADOS aparecem na nova aba "Totais do Pedido".

COMO O VENDEDOR USA:
  1. Adiciona produto na linha (page Order Lines)
  2. AUTOMATICO: x_joa_* copiados do produto para a linha
     (automation id=4 Joalheria - Copiar Composicao ao Salvar Linha)
  3. AUTOMATICO: totais agregados calculados no sale.order
     (automation id=5 Joalheria - Totalizar ao Salvar Pedido)
  4. Vendedor pode editar valores na linha (override por venda)
  5. Vai na aba "Totais do Pedido" para ver resumo
  6. Para atualizar cadastro do produto com valores da linha:
     menu Acao > Sincronizar Composicao com Produto (na linha)
     ou > Sincronizar Tudo com Produtos (no pedido)
''')
