#!/usr/bin/env python3
"""
odoo-scripts/setup-views-completo.py
=====================================
FAZ WRITE nas views do Studio existentes, adicionando TODOS os campos
joalheiros necessarios.

ESTRATEGIA:
  - SaaS Trial BLOQUEIA criar novas views via XML-RPC/JSON-RPC
  - MAS permite fazer WRITE em views existentes (incluindo as criadas pelo
    usuario via Studio)
  - Entao: o usuario cria view vazia via Studio (3 cliques) e este script
    faz write preenchendo TODOS os campos x_joa_* e x_joalheria_*

MODELOS TRATADOS:
  1. product.template - cria 2 abas (Composicao de Custo + Formacao de Preco)
  2. account.move - completa a aba NF-e com todos os campos
  3. res.company - completa a aba NF-e com todos os campos
  4. sale.order - adiciona colunas x_joa_* na tree das linhas
  5. purchase.order - adiciona colunas x_joa_* na tree das linhas

PRE-REQUISITO (so precisa fazer 1x):
  - Para CADA modelo, criar 1 view vazia via Odoo Studio
  - Tutorial: ODOO-STUDIO-PASSO3.md (3 cliques por modelo, 5 min total)

COMO USAR:
  ODOO_URL=https://fiscal-cloud-joalherias.odoo.com \\
  ODOO_DB=fiscal-cloud-joalherias \\
  ODOO_USER=marcus@nytro.com.br \\
  ODOO_API_KEY=6ec8... python3 odoo-scripts/setup-views-completo.py
"""

import os
import sys
import xmlrpc.client

# ============================================================
# CONFIGURACAO
# ============================================================
ODOO_URL = os.environ.get('ODOO_URL', '').rstrip('/')
ODOO_DB = os.environ.get('ODOO_DB', '')
ODOO_USER = os.environ.get('ODOO_USER', '')
ODOO_API_KEY = os.environ.get('ODOO_API_KEY', '')

if not all([ODOO_URL, ODOO_DB, ODOO_API_KEY]):
    print('ERRO: Defina ODOO_URL, ODOO_DB, ODOO_USER e ODOO_API_KEY')
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
    return models.execute_kw(ODOO_DB, uid, ODOO_API_KEY, model, method, args or [], kwargs or {})


def buscar_studio_view(model_name):
    """Procura view do Studio (nome comeca com 'Odoo Studio:') para o modelo."""
    views = kw('ir.ui.view', 'search_read', [
        [['model', '=', model_name],
         ['name', 'like', 'Odoo Studio:'],
         ['type', '=', 'form']],
        ['id', 'name', 'arch_db']
    ], {'order': 'create_date desc', 'limit': 1})
    return views[0] if views else None


def fazer_write(model_name, novo_arch, instrucoes_setup):
    """Faz write na view do Studio do modelo especificado."""
    view = buscar_studio_view(model_name)
    if not view:
        print(f'\n❌ {model_name}: SEM view do Studio.')
        print(f'   Acao necessaria (1x, ~1 min):')
        for passo in instrucoes_setup:
            print(f'     {passo}')
        print(f'   Depois rode este script novamente.')
        return False

    # Write no arch_db
    try:
        kw('ir.ui.view', 'write', [[view['id']], {'arch_db': novo_arch}])
        print(f'\n✅ {model_name}: VIEW ATUALIZADA (id={view["id"]})')
        return True
    except Exception as e:
        print(f'\n❌ {model_name}: ERRO write: {str(e)[:200]}')
        return False


# ============================================================
# 1. product.template - 3 abas (Composicao de Custo, Formacao de Preco, NF-e)
# ============================================================
print('\n' + '=' * 60)
print('1/5 - product.template (Produto)')
print('=' * 60)

arch_produto = """<data>
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
        </group>
      </group>
      <group string="Excecao Fiscal (opcional)">
        <group>
          <field name="x_joa_excecao_fiscal_uf"/>
          <field name="x_joa_aliquota_icms_especial"/>
        </group>
      </group>
    </page>
    <page string="NF-e Joalheria" name="joa_nfe_dados">
      <group>
        <group string="Dados Fiscais NF-e">
          <field name="x_joalheria_ncm"/>
          <field name="x_joalheria_cfop"/>
          <field name="x_joalheria_descricao_nfe"/>
          <field name="x_joalheria_unidade_medida"/>
          <field name="x_joalheria_peso_ouro_kg"/>
        </group>
      </group>
    </page>
  </xpath>
</data>"""

instrucoes_produto = [
    '1. Abra um produto qualquer no Odoo',
    '2. Clique no icone Studio (canto sup. direito)',
    '3. Barra lateral esquerda: Views > Product (product.template) > Form',
    '4. Clique em qualquer campo e arraste para criar uma view nova',
    '   (OU clique no botao "New View" e escolha Inherit Form)',
    '5. Salve (botao azul)',
]

fazer_write('product.template', arch_produto, instrucoes_produto)


# ============================================================
# 2. account.move (Fatura/Financeiro) - completa aba NF-e com todos os campos
# ============================================================
print('\n' + '=' * 60)
print('2/5 - account.move (Fatura)')
print('=' * 60)

arch_fatura = """<data>
  <xpath expr="//notebook" position="inside">
    <page string="NF-e Joalheria" name="joa_nfe_fatura">
      <group>
        <group string="Status NF-e">
          <field name="x_joalheria_nfe_status" readonly="1"/>
          <field name="x_joalheria_nfe_tipo_operacao"/>
          <field name="x_joalheria_nfe_dh_emissao" readonly="1"/>
        </group>
        <group string="Autorizacao SEFAZ">
          <field name="x_joalheria_nfe_chave" readonly="1"/>
          <field name="x_joalheria_nfe_protocolo" readonly="1"/>
        </group>
      </group>
      <group string="Erros e Logs">
        <field name="x_joalheria_nfe_erro" readonly="1" nolabel="1" colspan="2"/>
      </group>
      <group string="XML NF-e (nfeProc autorizado)">
        <field name="x_joalheria_nfe_xml" readonly="1" nolabel="1" colspan="2" widget="ace"/>
      </group>
    </page>
  </xpath>
</data>"""

instrucoes_fatura = [
    '1. Abra uma fatura qualquer no Odoo (Accounting > Invoices)',
    '2. Clique no icone Studio',
    '3. Views > Invoice (account.move) > Form',
    '4. Arraste um campo para criar uma view (ou New View > Inherit Form)',
    '5. Salve',
]

fazer_write('account.move', arch_fatura, instrucoes_fatura)


# ============================================================
# 3. res.company (Empresa) - completa aba NF-e com todos os campos
# ============================================================
print('\n' + '=' * 60)
print('3/5 - res.company (Empresa)')
print('=' * 60)

arch_empresa = """<data>
  <xpath expr="//notebook" position="inside">
    <page string="NF-e Joalheria" name="joa_nfe_empresa">
      <group>
        <group string="Configuracao NF-e">
          <field name="x_joalheria_nfe_serie"/>
          <field name="x_joalheria_nfe_numero"/>
          <field name="x_joalheria_nfe_inscricao_estadual"/>
        </group>
      </group>
    </page>
  </xpath>
</data>"""

instrucoes_empresa = [
    '1. Va em Settings > Companies > abra sua empresa',
    '2. Clique no icone Studio',
    '3. Views > Company (res.company) > Form',
    '4. Arraste um campo para criar uma view (ou New View > Inherit Form)',
    '5. Salve',
]

fazer_write('res.company', arch_empresa, instrucoes_empresa)


# ============================================================
# 4. sale.order (Pedido de Venda / Cotacao) - colunas na tree das linhas
# ============================================================
print('\n' + '=' * 60)
print('4/5 - sale.order (Pedido de Venda)')
print('=' * 60)

arch_sale = """<data>
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
</data>"""

instrucoes_sale = [
    '1. Abra um pedido de venda qualquer (Sales > Quotations)',
    '2. Clique no icone Studio',
    '3. Views > Sale Order (sale.order) > Form',
    '4. Arraste um campo para criar uma view (ou New View > Inherit Form)',
    '5. Salve',
]

fazer_write('sale.order', arch_sale, instrucoes_sale)


# ============================================================
# 5. purchase.order (Pedido de Compra) - colunas na tree das linhas
# ============================================================
print('\n' + '=' * 60)
print('5/5 - purchase.order (Pedido de Compra)')
print('=' * 60)

arch_purchase = """<data>
  <xpath expr="//field[@name='order_line']/tree/field[@name='price_unit']" position="after">
    <field name="x_joa_peso_ouro_g" optional="show"/>
    <field name="x_joa_custo_metal_g" optional="show"/>
    <field name="x_joa_custo_pedras_usd" optional="show"/>
    <field name="x_joa_custo_mao_obra" optional="show"/>
    <field name="x_joa_custo_total_unit" readonly="1" optional="show"/>
    <field name="x_joa_tipo_operacao" optional="show"/>
  </xpath>
</data>"""

instrucoes_purchase = [
    '1. Abra um pedido de compra qualquer (Purchase > Orders)',
    '2. Clique no icone Studio',
    '3. Views > Purchase Order (purchase.order) > Form',
    '4. Arraste um campo para criar uma view (ou New View > Inherit Form)',
    '5. Salve',
]

fazer_write('purchase.order', arch_purchase, instrucoes_purchase)


# ============================================================
# RELATORIO FINAL
# ============================================================
print('\n' + '=' * 60)
print('RELATORIO FINAL')
print('=' * 60)

print('\nViews do Studio encontradas:')
for modelo in ['product.template', 'account.move', 'res.company', 'sale.order', 'purchase.order']:
    v = buscar_studio_view(modelo)
    if v:
        print(f'  ✅ {modelo:25s} -> id={v["id"]}')
    else:
        print(f'  ❌ {modelo:25s} -> SEM VIEW do Studio (criar via Studio)')

print('\nProximo passo:')
print('  - Se algum modelo esta SEM view do Studio, faca o tutorial acima')
print('  - Depois rode este script novamente para preencher os campos')
print('  - Apos preencher, faca logout/login no Odoo para aplicar as views')
