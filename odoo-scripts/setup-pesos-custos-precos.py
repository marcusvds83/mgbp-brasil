#!/usr/bin/env python3
"""
odoo-scripts/setup-pesos-custos-precos.py
=========================================
Script que cria no Odoo da Joalheria:
  1. Campos de composicao de custo no product.template (aba "Composicao de Custo")
  2. Campos de formacao de preco no product.template (aba "Formacao de Preco")
  3. View customizada que adiciona as abas no formulario do produto
  4. Campos de composicao de custo na sale.order.line (pedido de venda)
  5. Campos de composicao de custo na purchase.order.line (compra)
  6. View customizada que adiciona esses campos na linha do pedido

  Estrutura de custos do setor joalheiro:
    - Peso do metal (ouro) em gramas ou quilos
    - Custo do metal (R$/grama de ouro)
    - Custo das pedras (em USD, convertido para BRL)
    - Custo da mao de obra (em BRL)
    - Margem de lucro (markup %)
    - Preco final calculado automaticamente

  Execute:
    ODOO_URL=https://fiscal-cloud-joalherias.odoo.com \\
    ODOO_DB=fiscal-cloud-joalherias \\
    ODOO_USER=marcus@nytro.com.br \\
    ODOO_API_KEY=6ec8... python3 odoo-scripts/setup-pesos-custos-precos.py
"""

import os
import sys
import xmlrpc.client

# ============================================================
# AUTENTICACAO
# ============================================================
ODOO_URL = os.environ.get('ODOO_URL', '').rstrip('/')
ODOO_DB = os.environ.get('ODOO_DB', '')
ODOO_USER = os.environ.get('ODOO_USER', '')
ODOO_API_KEY = os.environ.get('ODOO_API_KEY', '')

if not all([ODOO_URL, ODOO_DB, ODOO_API_KEY]):
    print('ERRO: Defina as variaveis:')
    print('  ODOO_URL=https://fiscal-cloud-joalherias.odoo.com')
    print('  ODOO_DB=fiscal-cloud-joalherias')
    print('  ODOO_USER=marcus@nytro.com.br')
    print('  ODOO_API_KEY=...')
    sys.exit(1)

if not ODOO_USER:
    ODOO_USER = ODOO_API_KEY

print(f'Conectando em {ODOO_URL} (DB: {ODOO_DB})...')
common = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/common')
uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_API_KEY, {})
if not uid:
    uid = common.authenticate(ODOO_DB, ODOO_API_KEY, ODOO_API_KEY, {})
if not uid:
    print('ERRO: Autenticacao falhou.')
    sys.exit(1)
print(f'Autenticado! (uid={uid})')

models = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/object')


def kw(model, method, args=None, kwargs=None):
    try:
        return models.execute_kw(ODOO_DB, uid, ODOO_API_KEY, model, method, args or [], kwargs or {})
    except xmlrpc.client.Fault as e:
        # Se for "Record does not exist" em view recem-criada, ignora (caching issue do Odoo 20)
        if 'Record does not exist' in str(e) and model == 'ir.ui.view' and method == 'create':
            print(f'  WARN: Odoo retornou erro de cache apos criar view. Continuando...')
            return 0
        raise


def safe_create_view(name, model, inherit_id, arch):
    """Cria view com tratamento especial para Odoo 20 SaaS."""
    # Deleta view existente com mesmo nome
    existing = kw('ir.ui.view', 'search', [[['name', '=', name]]])
    if existing:
        try:
            kw('ir.ui.view', 'unlink', [existing])
        except Exception:
            pass

    try:
        view_id = kw('ir.ui.view', 'create', [{
            'name': name,
            'model': model,
            'inherit_id': inherit_id,
            'arch': arch,
            'active': True,
        }])
        print(f'  View criada: id={view_id} (herda de {inherit_id})')
        return view_id
    except xmlrpc.client.Fault as e:
        if 'Record does not exist' in str(e):
            print(f'  View criada ( Odoo 20 SaaS reporting issue): {name}')
            return None
        print(f'  ERRO ao criar view {name}: {str(e)[:200]}')
        return None
    except Exception as e:
        print(f'  ERRO generico ao criar view {name}: {str(e)[:200]}')
        return None


def upsert_field(model_id, name, field_description, ttype='char', **extra):
    existing = kw('ir.model.fields', 'search', [
        [['model_id', '=', model_id], ['name', '=', name]]
    ])
    values = {
        'name': name,
        'field_description': field_description,
        'ttype': ttype,
        'model_id': model_id,
        **extra,
    }
    if existing:
        kw('ir.model.fields', 'write', [existing, values])
        print(f'  - {name}: ATUALIZADO')
        return existing[0]
    else:
        fid = kw('ir.model.fields', 'create', [values])
        print(f'  - {name}: CRIADO (id={fid})')
        return fid


# ============================================================
# 1. CAMPOS NO product.template (PRODUTO)
# ============================================================
print('\n' + '=' * 60)
print('ETAPA 1: Campos de composicao de custo no product.template')
print('=' * 60)

pt_ids = kw('ir.model', 'search', [[['model', '=', 'product.template']]])
if not pt_ids:
    print('ERRO: Modelo product.template nao encontrado.')
    sys.exit(1)
pt_id = pt_ids[0]
print(f'Modelo product.template: ir.model ID={pt_id}')

# Composicao de custo (3 frentes do setor joalheiro: metal, pedras, mao-de-obra)
campos_custo_produto = [
    # === METAL (ouro como produto-moeda) ===
    {'name': 'x_joa_peso_ouro_g', 'field_description': 'Peso Ouro (g)', 'ttype': 'float',
     'help': 'Peso de ouro em gramas usado na composicao do produto.'},
    {'name': 'x_joa_peso_ouro_kg', 'field_description': 'Peso Ouro (kg)', 'ttype': 'float',
     'help': 'Peso de ouro em quilos (para exportacao).'},
    {'name': 'x_joa_custo_metal_g', 'field_description': 'Custo Ouro/g (BRL)', 'ttype': 'float',
     'help': 'Custo do grama de ouro em reais (cenario base para formacao de preco).'},
    {'name': 'x_joa_custo_metal_total', 'field_description': 'Custo Metal Total (BRL)', 'ttype': 'float',
     'help': 'Custo total do metal (peso * custo/g). Calculado automaticamente.'},

    # === PEDRAS (precificadas em USD) ===
    {'name': 'x_joa_custo_pedras_usd', 'field_description': 'Custo Pedras (USD)', 'ttype': 'float',
     'help': 'Custo total das pedras em dolar americano.'},
    {'name': 'x_joa_cotacao_usd_brl', 'field_description': 'Cotacao USD/BRL', 'ttype': 'float',
     'help': 'Cotacao do dolar usada para conversao (ex: 5.20).'},
    {'name': 'x_joa_custo_pedras_brl', 'field_description': 'Custo Pedras (BRL)', 'ttype': 'float',
     'help': 'Custo das pedras convertido para reais. Calculado automaticamente.'},

    # === MAO DE OBRA (em BRL) ===
    {'name': 'x_joa_custo_mao_obra', 'field_description': 'Custo Mao de Obra (BRL)', 'ttype': 'float',
     'help': 'Custo da mao de obra para fabricar a peca.'},

    # === FORMACAO DE PRECO ===
    {'name': 'x_joa_custo_total', 'field_description': 'Custo Total (BRL)', 'ttype': 'float',
     'help': 'Soma: custo metal + pedras + mao de obra. Calculado automaticamente.'},
    {'name': 'x_joa_markup_pct', 'field_description': 'Markup (%)', 'ttype': 'float',
     'help': 'Margem aplicada sobre o custo total (ex: 100 = dobra o preco).'},
    {'name': 'x_joa_preco_calculado', 'field_description': 'Preco Calculado (BRL)', 'ttype': 'float',
     'help': 'Preco final sugerido: custo total * (1 + markup/100). Calculado automaticamente.'},

    # === MOEDA DE REFERENCIA ===
    {'name': 'x_joa_moeda_ref', 'field_description': 'Moeda Referencia', 'ttype': 'selection',
     'selection': "[('BRL','Real (BRL)'),('USD','Dolar (USD)'),('OURO','Ouro (g)')]",
     'help': 'Moeda de referencia para precificacao.'},

    # === EXCEPTION FISCAL (parametrizavel por estado/municipio) ===
    {'name': 'x_joa_excecao_fiscal_uf', 'field_description': 'Excecao Fiscal UF', 'ttype': 'char',
     'help': 'UF com excecao fiscal aplicavel (parametrizavel).'},
    {'name': 'x_joa_aliquota_icms_especial', 'field_description': 'Aliquota ICMS Especial', 'ttype': 'float',
     'help': 'Aliquota ICMS personalizada para excecoes fiscais.'},
]

for c in campos_custo_produto:
    upsert_field(pt_id, **c)

# Campos x_joalheria_* no product.template (NCM, CFOP, descricao NFE, etc.)
# Esses campos sao necessarios porque o formulario principal do produto
# eh do product.template (nao product.product).
campos_joalheria_pt = [
    {'name': 'x_joalheria_ncm', 'field_description': 'NCM Especifico (Joalheria)', 'ttype': 'char'},
    {'name': 'x_joalheria_cfop', 'field_description': 'CFOP Default (Joalheria)', 'ttype': 'char'},
    {'name': 'x_joalheria_descricao_nfe', 'field_description': 'Descricao NF-e (Joalheria)', 'ttype': 'text'},
    {'name': 'x_joalheria_unidade_medida', 'field_description': 'Unidade Medida NF-e (Joalheria)', 'ttype': 'char'},
    {'name': 'x_joalheria_peso_ouro_kg', 'field_description': 'Peso Ouro (kg) p/ Exportacao', 'ttype': 'float'},
]
for c in campos_joalheria_pt:
    upsert_field(pt_id, **c)

# ============================================================
# 2. VIEW NO PRODUTO (adiciona abas)
# ============================================================
print('\n' + '=' * 60)
print('ETAPA 2: Criando view com abas no formulario do produto')
print('=' * 60)

view_xml = """
<data>
  <xpath expr="//notebook" position="inside">
    <page string="Composicao de Custo" name="joa_composicao_custo">
      <group>
        <group string="Metal (Ouro)">
          <field name="x_joa_peso_ouro_g"/>
          <field name="x_joa_peso_ouro_kg"/>
          <field name="x_joa_custo_metal_g"/>
          <field name="x_joa_custo_metal_total" readonly="1"/>
        </group>
        <group string="Pedras">
          <field name="x_joa_custo_pedras_usd"/>
          <field name="x_joa_cotacao_usd_brl"/>
          <field name="x_joa_custo_pedras_brl" readonly="1"/>
        </group>
        <group string="Mao de Obra">
          <field name="x_joa_custo_mao_obra"/>
        </group>
      </group>
    </page>
    <page string="Formacao de Preco" name="joa_formacao_preco">
      <group>
        <group string="Custos">
          <field name="x_joa_custo_total" readonly="1"/>
          <field name="x_joa_moeda_ref"/>
        </group>
        <group string="Preco Final">
          <field name="x_joa_markup_pct"/>
          <field name="x_joa_preco_calculado" readonly="1"/>
          <button name="action_aplicar_preco_calculado" type="object"
                  string="Aplicar Preco Calculado" class="btn-primary"/>
        </group>
      </group>
      <group string="Excecao Fiscal (opcional)">
        <field name="x_joa_excecao_fiscal_uf"/>
        <field name="x_joa_aliquota_icms_especial"/>
      </group>
    </page>
  </xpath>
</data>
"""

# Deleta view existente se houver
existing_view = kw('ir.ui.view', 'search', [[['name', '=', 'Joalheria - Composicao Custo Produto']]])
if existing_view:
    kw('ir.ui.view', 'unlink', [existing_view])

# Procura a view base do product.template (form) - nome "product.template.common.form"
inherit_pt = kw('ir.ui.view', 'search', [[
    ['model', '=', 'product.template'],
    ['name', '=', 'product.template.common.form'],
    ['type', '=', 'form'],
]], {'limit': 1})

if not inherit_pt:
    # fallback - qualquer view primary form do product.template
    inherit_pt = kw('ir.ui.view', 'search', [[
        ['model', '=', 'product.template'],
        ['inherit_id', '=', False],
        ['type', '=', 'form'],
    ]], {'limit': 1})

if inherit_pt:
    safe_create_view(
        'Joalheria - Composicao Custo Produto',
        'product.template',
        inherit_pt[0],
        view_xml
    )
else:
    print('WARN: View base do product.template nao encontrada.')

# ============================================================
# 3. CAMPOS NA sale.order.line (PEDIDO DE VENDA)
# ============================================================
print('\n' + '=' * 60)
print('ETAPA 3: Campos na sale.order.line (pedido de venda)')
print('=' * 60)

sol_ids = kw('ir.model', 'search', [[['model', '=', 'sale.order.line']]])
if sol_ids:
    sol_id = sol_ids[0]
    print(f'Modelo sale.order.line: ir.model ID={sol_id}')

    campos_sol = [
        {'name': 'x_joa_peso_ouro_g', 'field_description': 'Peso Ouro (g)', 'ttype': 'float'},
        {'name': 'x_joa_custo_metal_g', 'field_description': 'Custo Ouro/g (BRL)', 'ttype': 'float'},
        {'name': 'x_joa_custo_metal_total', 'field_description': 'Custo Metal Total', 'ttype': 'float'},
        {'name': 'x_joa_custo_pedras_usd', 'field_description': 'Custo Pedras (USD)', 'ttype': 'float'},
        {'name': 'x_joa_cotacao_usd_brl', 'field_description': 'Cotacao USD/BRL', 'ttype': 'float'},
        {'name': 'x_joa_custo_pedras_brl', 'field_description': 'Custo Pedras (BRL)', 'ttype': 'float'},
        {'name': 'x_joa_custo_mao_obra', 'field_description': 'Custo Mao de Obra (BRL)', 'ttype': 'float'},
        {'name': 'x_joa_custo_total_unit', 'field_description': 'Custo Total Unitario (BRL)', 'ttype': 'float'},
        {'name': 'x_joa_markup_pct', 'field_description': 'Markup (%)', 'ttype': 'float'},
        {'name': 'x_joa_preco_calculado_unit', 'field_description': 'Preco Calculado (BRL)', 'ttype': 'float'},
        # Tipo de operacao (NF-e joalheiro)
        {'name': 'x_joa_tipo_operacao', 'field_description': 'Tipo Operacao NF-e', 'ttype': 'selection',
         'selection': "[('venda','Venda'),('remessa_industrializacao','Remessa Industrializacao'),('retorno_industrializacao','Retorno Industrializacao'),('exportacao','Exportacao')]",
         'help': 'Tipo de operacao para emissao de NF-e joalheiro.'},
    ]

    for c in campos_sol:
        upsert_field(sol_id, **c)

    # View para mostrar campos na linha do pedido (formulario da sale.order)
    view_sol_xml = """
<data>
      <xpath expr="//field[@name='order_line']/tree/field[@name='price_unit']" position="after">
        <field name="x_joa_peso_ouro_g" optional="show"/>
        <field name="x_joa_custo_metal_g" optional="show"/>
        <field name="x_joa_custo_pedras_usd" optional="show"/>
        <field name="x_joa_custo_mao_obra" optional="show"/>
        <field name="x_joa_custo_total_unit" readonly="1" optional="show"/>
        <field name="x_joa_markup_pct" optional="show"/>
        <field name="x_joa_preco_calculado_unit" readonly="1" optional="show"/>
        <field name="x_joa_tipo_operacao" optional="show"/>
      </xpath>
</data>
"""

    existing_view_sol = kw('ir.ui.view', 'search', [[['name', '=', 'Joalheria - Sale Order Line']]])
    if existing_view_sol:
        kw('ir.ui.view', 'unlink', [existing_view_sol])

    # Herda da view primary form da sale.order
    inherit_view_sol = kw('ir.ui.view', 'search', [[
        ['model', '=', 'sale.order'],
        ['name', '=', 'sale.order.form'],
        ['type', '=', 'form'],
    ]], {'limit': 1})

    if not inherit_view_sol:
        inherit_view_sol = kw('ir.ui.view', 'search', [[
            ['model', '=', 'sale.order'],
            ['inherit_id', '=', False],
            ['type', '=', 'form'],
        ]], {'limit': 1})

    if inherit_view_sol:
        safe_create_view(
            'Joalheria - Sale Order Line',
            'sale.order',
            inherit_view_sol[0],
            view_sol_xml
        )
    else:
        print('WARN: View base da sale.order nao encontrada.')

# ============================================================
# 4. CAMPOS NA purchase.order.line (COMPRAS)
# ============================================================
print('\n' + '=' * 60)
print('ETAPA 4: Campos na purchase.order.line (compras)')
print('=' * 60)

pol_ids = kw('ir.model', 'search', [[['model', '=', 'purchase.order.line']]])
if pol_ids:
    pol_id = pol_ids[0]
    print(f'Modelo purchase.order.line: ir.model ID={pol_id}')

    campos_pol = [
        {'name': 'x_joa_peso_ouro_g', 'field_description': 'Peso Ouro (g)', 'ttype': 'float'},
        {'name': 'x_joa_custo_metal_g', 'field_description': 'Custo Ouro/g (BRL)', 'ttype': 'float'},
        {'name': 'x_joa_custo_metal_total', 'field_description': 'Custo Metal Total', 'ttype': 'float'},
        {'name': 'x_joa_custo_pedras_usd', 'field_description': 'Custo Pedras (USD)', 'ttype': 'float'},
        {'name': 'x_joa_cotacao_usd_brl', 'field_description': 'Cotacao USD/BRL', 'ttype': 'float'},
        {'name': 'x_joa_custo_pedras_brl', 'field_description': 'Custo Pedras (BRL)', 'ttype': 'float'},
        {'name': 'x_joa_custo_mao_obra', 'field_description': 'Custo Mao de Obra (BRL)', 'ttype': 'float'},
        {'name': 'x_joa_custo_total_unit', 'field_description': 'Custo Total Unitario (BRL)', 'ttype': 'float'},
        # Na compra, o markup fica implicito no preco unitario
        {'name': 'x_joa_tipo_operacao', 'field_description': 'Tipo Operacao', 'ttype': 'selection',
         'selection': "[('compra_interna','Compra Interna'),('importacao','Importacao'),('compra_sucata','Compra Sucata/Ouro Usado')]",
         'help': 'Tipo de compra: interna, importacao ou sucata (cliente paga com ouro).'},
    ]

    for c in campos_pol:
        upsert_field(pol_id, **c)

    # View na purchase order line
    view_pol_xml = """
<data>
      <xpath expr="//field[@name='order_line']/tree/field[@name='price_unit']" position="after">
        <field name="x_joa_peso_ouro_g" optional="show"/>
        <field name="x_joa_custo_metal_g" optional="show"/>
        <field name="x_joa_custo_pedras_usd" optional="show"/>
        <field name="x_joa_custo_mao_obra" optional="show"/>
        <field name="x_joa_custo_total_unit" readonly="1" optional="show"/>
        <field name="x_joa_tipo_operacao" optional="show"/>
      </xpath>
</data>
"""

    existing_view_pol = kw('ir.ui.view', 'search', [[['name', '=', 'Joalheria - Purchase Order Line']]])
    if existing_view_pol:
        kw('ir.ui.view', 'unlink', [existing_view_pol])

    inherit_view_pol = kw('ir.ui.view', 'search', [[
        ['model', '=', 'purchase.order'],
        ['name', '=', 'purchase.order.form'],
        ['type', '=', 'form'],
    ]], {'limit': 1})

    if not inherit_view_pol:
        inherit_view_pol = kw('ir.ui.view', 'search', [[
            ['model', '=', 'purchase.order'],
            ['inherit_id', '=', False],
            ['type', '=', 'form'],
        ]], {'limit': 1})

    if inherit_view_pol:
        safe_create_view(
            'Joalheria - Purchase Order Line',
            'purchase.order',
            inherit_view_pol[0],
            view_pol_xml
        )
    else:
        print('WARN: View base da purchase.order nao encontrada.')

# ============================================================
# 5. SERVER ACTION: calcular custos automaticamente
# ============================================================
print('\n' + '=' * 60)
print('ETAPA 5: Server Action para calcular custos no produto')
print('=' * 60)

# Action que recalcula os custos calculados no product.template
# IMPORTANTE: Odoo SaaS sandbox bloqueia STORE_ATTR (rec.field = value)
# Workaround: usar rec.write({'field': value}) em vez de atribuicao direta
codigo_calc = """
# Recalcula custos do produto (Joalheria)
for rec in records:
    # Custo metal total = peso (g) * custo/g
    peso_g = rec.x_joa_peso_ouro_g or 0
    custo_g = rec.x_joa_custo_metal_g or 0
    custo_metal_total = peso_g * custo_g

    # Custo pedras em BRL = USD * cotacao
    usd = rec.x_joa_custo_pedras_usd or 0
    cotacao = rec.x_joa_cotacao_usd_brl or 5.20
    custo_pedras_brl = usd * cotacao

    # Custo total = metal + pedras + mao de obra
    custo_total = custo_metal_total + custo_pedras_brl + (rec.x_joa_custo_mao_obra or 0)

    # Preco calculado = custo * (1 + markup/100)
    markup = rec.x_joa_markup_pct or 0
    preco_calculado = custo_total * (1 + markup / 100)

    # Usa write() para evitar STORE_ATTR (proibido no sandbox Odoo SaaS)
    rec.write({
        'x_joa_custo_metal_total': custo_metal_total,
        'x_joa_custo_pedras_brl': custo_pedras_brl,
        'x_joa_custo_total': custo_total,
        'x_joa_preco_calculado': preco_calculado,
    })

# Mensagem no chatter
if records:
    records[0].message_post(
        body="<b>Custos recalculados</b><br/>Custo total: R$ %.2f<br/>Preco calculado: R$ %.2f" % (
            records[0].x_joa_custo_total,
            records[0].x_joa_preco_calculado
        ),
        message_type='comment'
    )
"""

existing_calc = kw('ir.actions.server', 'search', [[['name', '=', 'Recalcular Custos (Joalheria)']]])
if existing_calc:
    kw('ir.actions.server', 'unlink', [existing_calc])

calc_id = kw('ir.actions.server', 'create', [{
    'name': 'Recalcular Custos (Joalheria)',
    'model_id': pt_id,
    'state': 'code',
    'code': codigo_calc,
    'binding_model_id': pt_id,
    'binding_type': 'action',
}])
print(f'Server Action "Recalcular Custos" criada: id={calc_id}')

# Action para aplicar o preco calculado no lst_price (preco de venda)
codigo_aplicar = """
# Aplica o preco calculado no lst_price do produto
for rec in records:
    if rec.x_joa_preco_calculado and rec.x_joa_preco_calculado > 0:
        rec.write({'list_price': rec.x_joa_preco_calculado})
        rec.message_post(body="<b>Preco aplicado:</b> R$ %.2f" % rec.x_joa_preco_calculado, message_type='comment')
"""

existing_aplicar = kw('ir.actions.server', 'search', [[['name', '=', 'Aplicar Preco Calculado (Joalheria)']]])
if existing_aplicar:
    kw('ir.actions.server', 'unlink', [existing_aplicar])

aplicar_id = kw('ir.actions.server', 'create', [{
    'name': 'Aplicar Preco Calculado (Joalheria)',
    'model_id': pt_id,
    'state': 'code',
    'code': codigo_aplicar,
}])
print(f'Server Action "Aplicar Preco Calculado" criada: id={aplicar_id}')

# ============================================================
# RESUMO
# ============================================================
print('\n' + '=' * 60)
print('SETUP CONCLUIDO COM SUCESSO!')
print('=' * 60)
print('\nNo Odoo:')
print('  - Abra um produto > veja abas "Composicao de Custo" e "Formacao de Preco"')
print('  - Em pedidos de venda > linhas mostram peso, custos e markup')
print('  - Em pedidos de compra > linhas mostram peso e custos')
print('  - Acao (engrenagem) > "Recalcular Custos" em qualquer produto')
print('  - Botao "Aplicar Preco Calculado" na aba Formacao de Preco')
print('\nRotina do usuario:')
print('  1. Cadastre o produto (peso, custo/g, pedras, mao de obra, markup)')
print('  2. Acao > Recalcular Custos -> preenche os campos calculados')
print('  3. Botao "Aplicar Preco Calculado" -> copia para list_price')
print('  4. Na venda/compra, ajuste por linha conforme necessario')
