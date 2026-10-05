#!/usr/bin/env python3
"""
odoo-scripts/setup-views-direto.py
===================================
Faz WRITE DIRETO nas views BASE do Odoo (product.template.common.form,
sale.order.form, purchase.order.form) para adicionar abas/colunas
joalheiras.

DESCOBERTA IMPORTANTE:
  SaaS Trial BLOQUEIA criar views COM inherit_id (4 abordagens testadas,
  todas falham com 'Record does not exist')
  MAS permite:
  ✅ Write direto em views base do Odoo (que ja existem)
  ✅ Criar primary views (sem inherit_id)
  ✅ Criar ir.actions.act_window

ESTRATEGIA USADA AQUI:
  1. Localizar a view BASE de cada modelo (primary form)
  2. Fazer write direto no arch_db dela
  3. Substituir/inserir conteudo joalheiro (abas, grupos, colunas)

VANTAGEM: Nao depende do usuario criar views vazias no Studio.
DESVANTAGEM: Modifica views base (mas e idempotente - pode rodar multiplas
vezes sem duplicar conteudo porque usa marcadores unicos).

COMO USAR:
  ODOO_URL=https://fiscal-cloud-joalherias.odoo.com \\
  ODOO_DB=fiscal-cloud-joalherias \\
  ODOO_USER=marcus@nytro.com.br \\
  ODOO_API_KEY=6ec8... python3 odoo-scripts/setup-views-direto.py
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
    print('ERRO: Autenticacao falhou.')
    sys.exit(1)
print(f'Autenticado! (uid={uid})')

models = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/object')


def kw(model, method, args=None, kwargs=None):
    return models.execute_kw(ODOO_DB, uid, ODOO_API_KEY, model, method, args or [], kwargs or {})


def buscar_view_base(model_name, view_name=None):
    """Procura view primary form de um modelo."""
    domain = [
        ['model', '=', model_name],
        ['type', '=', 'form'],
        ['inherit_id', '=', False],
    ]
    if view_name:
        domain.append(['name', '=', view_name])
    views = kw('ir.ui.view', 'search', [domain], {'limit': 1, 'order': 'id asc'})
    return views[0] if views else None


def insert_into_notebook(arch_db, marker_comment, content_to_insert):
    """
    Insere content_to_insert dentro do <notebook> do arch_db (antes de </notebook>).
    Funciona com <notebook> e <notebook colspan="4">.
    Usa marker_comment para idempotencia.
    """
    if marker_comment in arch_db:
        return arch_db, 'JA_EXISTE'
    # Procura tag </notebook> (qualquer atributo no <notebook ...>)
    import re
    match = re.search(r'</notebook>', arch_db)
    if not match:
        return arch_db, 'NO_NOTEBOOK'
    insert_pos = match.start()
    new_arch = arch_db[:insert_pos] + f'<!-- {marker_comment} -->{content_to_insert}' + arch_db[insert_pos:]
    return new_arch, 'INSERIDO'


def insert_after_field_in_tree(arch_db, marker_comment, target_field, columns_xml):
    """
    Insere columns_xml apos o field target_field dentro de uma tree.
    Usa marker_comment para idempotencia.
    """
    if marker_comment in arch_db:
        return arch_db, 'JA_EXISTE'
    target = f"<field name=\"{target_field}\""
    idx = arch_db.find(target)
    if idx == -1:
        return arch_db, f'FIELD_{target_field}_NAO_ENCONTRADO'
    # Acha o final do field (pode ser self-closing <field name="X"/> ou <field>...</field>)
    field_start = idx
    rest = arch_db[field_start:]
    # Self-closing?
    self_close = rest.find('/>')
    open_close = rest.find('>')
    if self_close != -1 and (open_close == -1 or self_close < open_close):
        # <field name="X"/>
        insert_pos = field_start + self_close + 2
    else:
        # <field name="X">...</field> - acha o </field>
        end_tag = rest.find('</field>')
        if end_tag == -1:
            return arch_db, 'CLOSE_TAG_NAO_ENCONTRADO'
        insert_pos = field_start + end_tag + len('</field>')
    new_arch = arch_db[:insert_pos] + f'<!-- {marker_comment} -->{columns_xml}' + arch_db[insert_pos:]
    return new_arch, 'INSERIDO'


# ============================================================
# 1. product.template - 3 abas (Composicao de Custo, Formacao de Preco, NF-e)
# ============================================================
print('\n' + '=' * 60)
print('1/5 - product.template (Produto) - 3 abas')
print('=' * 60)

vid_pt = buscar_view_base('product.template', 'product.template.common.form')
if not vid_pt:
    vid_pt = buscar_view_base('product.template')
if vid_pt:
    v = kw('ir.ui.view', 'read', [[vid_pt], ['id', 'name', 'arch_db']])[0]
    arch = v['arch_db']

    # Aba 1: Composicao de Custo
    aba_custo = '''<page string="Composicao de Custo" name="joa_composicao_custo">
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
    </page>'''
    new_arch, status = insert_into_notebook(arch, 'JOA_COMPOSICAO_CUSTO_V1', aba_custo)
    if status == 'INSERIDO':
        arch = new_arch
        print(f'  ✓ Aba "Composicao de Custo" inserida')
    elif status == 'JA_EXISTE':
        print(f'  = Aba "Composicao de Custo" ja existe')
    else:
        print(f'  ! Aba Composicao: {status}')

    # Aba 2: Formacao de Preco
    aba_preco = '''<page string="Formacao de Preco" name="joa_formacao_preco">
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
    </page>'''
    new_arch, status = insert_into_notebook(arch, 'JOA_FORMACAO_PRECO_V1', aba_preco)
    if status == 'INSERIDO':
        arch = new_arch
        print(f'  ✓ Aba "Formacao de Preco" inserida')
    elif status == 'JA_EXISTE':
        print(f'  = Aba "Formacao de Preco" ja existe')
    else:
        print(f'  ! Aba Preco: {status}')

    # Aba 3: NF-e Joalheria (dados fiscais)
    aba_nfe = '''<page string="NF-e Joalheria" name="joa_nfe_dados">
      <group>
        <group string="Dados Fiscais NF-e">
          <field name="x_joalheria_ncm"/>
          <field name="x_joalheria_cfop"/>
          <field name="x_joalheria_descricao_nfe"/>
          <field name="x_joalheria_unidade_medida"/>
          <field name="x_joalheria_peso_ouro_kg"/>
        </group>
      </group>
    </page>'''
    new_arch, status = insert_into_notebook(arch, 'JOA_NFE_DADOS_V1', aba_nfe)
    if status == 'INSERIDO':
        arch = new_arch
        print(f'  ✓ Aba "NF-e Joalheria" inserida')
    elif status == 'JA_EXISTE':
        print(f'  = Aba "NF-e Joalheria" ja existe')
    else:
        print(f'  ! Aba NF-e: {status}')

    # Write na view base
    try:
        kw('ir.ui.view', 'write', [[vid_pt], {'arch_db': arch}])
        print(f'✅ product.template: view base {vid_pt} atualizada com 3 abas')
    except Exception as e:
        print(f'❌ product.template write: {str(e)[:200]}')
else:
    print('❌ product.template: view base nao encontrada')


# ============================================================
# 2. account.move (Fatura) - aba NF-e Joalheria
# ============================================================
print('\n' + '=' * 60)
print('2/5 - account.move (Fatura) - aba NF-e Joalheria')
print('=' * 60)

vid_am = buscar_view_base('account.move', 'account.move.form')
if not vid_am:
    vid_am = buscar_view_base('account.move')
if vid_am:
    v = kw('ir.ui.view', 'read', [[vid_am], ['id', 'name', 'arch_db']])[0]
    arch = v['arch_db']

    aba_nfe_fatura = '''<page string="NF-e Joalheria" name="joa_nfe_fatura">
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
    </page>'''
    new_arch, status = insert_into_notebook(arch, 'JOA_NFE_FATURA_V1', aba_nfe_fatura)
    if status == 'INSERIDO':
        try:
            kw('ir.ui.view', 'write', [[vid_am], {'arch_db': new_arch}])
            print(f'✅ account.move: view base {vid_am} atualizada com aba NF-e Joalheria')
        except Exception as e:
            print(f'❌ account.move write: {str(e)[:200]}')
    elif status == 'JA_EXISTE':
        print(f'= account.move: aba NF-e Joalheria ja existe')
    else:
        print(f'! account.move: {status}')
else:
    print('❌ account.move: view base nao encontrada')


# ============================================================
# 3. res.company (Empresa) - aba NF-e Joalheria
# ============================================================
print('\n' + '=' * 60)
print('3/5 - res.company (Empresa) - aba NF-e Joalheria')
print('=' * 60)

vid_rc = buscar_view_base('res.company', 'res.company.form')
if not vid_rc:
    vid_rc = buscar_view_base('res.company')
if vid_rc:
    v = kw('ir.ui.view', 'read', [[vid_rc], ['id', 'name', 'arch_db']])[0]
    arch = v['arch_db']

    aba_nfe_empresa = '''<page string="NF-e Joalheria" name="joa_nfe_empresa">
      <group>
        <group string="Configuracao NF-e">
          <field name="x_joalheria_nfe_serie"/>
          <field name="x_joalheria_nfe_numero"/>
          <field name="x_joalheria_nfe_inscricao_estadual"/>
        </group>
      </group>
    </page>'''
    new_arch, status = insert_into_notebook(arch, 'JOA_NFE_EMPRESA_V1', aba_nfe_empresa)
    if status == 'INSERIDO':
        try:
            kw('ir.ui.view', 'write', [[vid_rc], {'arch_db': new_arch}])
            print(f'✅ res.company: view base {vid_rc} atualizada com aba NF-e Joalheria')
        except Exception as e:
            print(f'❌ res.company write: {str(e)[:200]}')
    elif status == 'JA_EXISTE':
        print(f'= res.company: aba NF-e Joalheria ja existe')
    else:
        print(f'! res.company: {status}')
else:
    print('❌ res.company: view base nao encontrada')


# ============================================================
# 4. sale.order (Pedido de Venda) - colunas na tree
# ============================================================
print('\n' + '=' * 60)
print('4/5 - sale.order (Pedido de Venda) - colunas na tree')
print('=' * 60)

vid_so = buscar_view_base('sale.order', 'sale.order.form')
if not vid_so:
    vid_so = buscar_view_base('sale.order')
if vid_so:
    v = kw('ir.ui.view', 'read', [[vid_so], ['id', 'name', 'arch_db']])[0]
    arch = v['arch_db']

    colunas_sale = '''<field name="x_joa_peso_ouro_g" optional="show"/>
        <field name="x_joa_custo_metal_g" optional="show"/>
        <field name="x_joa_custo_pedras_usd" optional="show"/>
        <field name="x_joa_custo_mao_obra" optional="show"/>
        <field name="x_joa_custo_total_unit" readonly="1" optional="show"/>
        <field name="x_joa_markup_pct" optional="show"/>
        <field name="x_joa_preco_calculado_unit" readonly="1" optional="show"/>
        <field name="x_joa_tipo_operacao" optional="show"/>'''
    new_arch, status = insert_after_field_in_tree(arch, 'JOA_SALE_COLS_V1', 'price_unit', colunas_sale)
    if status == 'INSERIDO':
        try:
            kw('ir.ui.view', 'write', [[vid_so], {'arch_db': new_arch}])
            print(f'✅ sale.order: view base {vid_so} atualizada com 8 colunas x_joa_*')
        except Exception as e:
            print(f'❌ sale.order write: {str(e)[:200]}')
    elif status == 'JA_EXISTE':
        print(f'= sale.order: colunas ja existem')
    else:
        print(f'! sale.order: {status}')
else:
    print('❌ sale.order: view base nao encontrada')


# ============================================================
# 5. purchase.order (Pedido de Compra) - colunas na tree
# ============================================================
print('\n' + '=' * 60)
print('5/5 - purchase.order (Pedido de Compra) - colunas na tree')
print('=' * 60)

vid_po = buscar_view_base('purchase.order', 'purchase.order.form')
if not vid_po:
    vid_po = buscar_view_base('purchase.order')
if vid_po:
    v = kw('ir.ui.view', 'read', [[vid_po], ['id', 'name', 'arch_db']])[0]
    arch = v['arch_db']

    colunas_purchase = '''<field name="x_joa_peso_ouro_g" optional="show"/>
        <field name="x_joa_custo_metal_g" optional="show"/>
        <field name="x_joa_custo_pedras_usd" optional="show"/>
        <field name="x_joa_custo_mao_obra" optional="show"/>
        <field name="x_joa_custo_total_unit" readonly="1" optional="show"/>
        <field name="x_joa_tipo_operacao" optional="show"/>'''
    new_arch, status = insert_after_field_in_tree(arch, 'JOA_PURCHASE_COLS_V1', 'price_unit', colunas_purchase)
    if status == 'INSERIDO':
        try:
            kw('ir.ui.view', 'write', [[vid_po], {'arch_db': new_arch}])
            print(f'✅ purchase.order: view base {vid_po} atualizada com 6 colunas x_joa_*')
        except Exception as e:
            print(f'❌ purchase.order write: {str(e)[:200]}')
    elif status == 'JA_EXISTE':
        print(f'= purchase.order: colunas ja existem')
    else:
        print(f'! purchase.order: {status}')
else:
    print('❌ purchase.order: view base nao encontrada')


# ============================================================
# RELATORIO FINAL
# ============================================================
print('\n' + '=' * 60)
print('SETUP CONCLUIDO!')
print('=' * 60)
print('\nProximo passo:')
print('  1. Faca LOGOUT do Odoo (avatar > Sair)')
print('  2. Faca LOGIN novamente (para recarregar cache de views)')
print('  3. Abra um produto -> vera 3 abas:')
print('     - Composicao de Custo')
print('     - Formacao de Preco')
print('     - NF-e Joalheria')
print('  4. Abra uma fatura -> vera aba NF-e Joalheria')
print('  5. Abra um pedido de venda -> vera colunas x_joa_* na tree')
print('  6. Abra um pedido de compra -> vera colunas x_joa_* na tree')
print('\nPara reverter (se necessario):')
print('  python3 odoo-scripts/reverter-views.py (nao implementado, mas')
print('  basta remover os marcadores JOA_*_V1 e o conteudo entre eles)')
