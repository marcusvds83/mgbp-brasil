#!/usr/bin/env python3
"""
odoo-scripts/setup-uom-conversao.py
===================================
Implementa conversao de UOM (unidade de medida) entre composicao de
custo do produto e a linha de venda/compra.

PROBLEMA:
  - Produto "Ouro 18k" cadastrado em kg com custo_metal_g = R$ 350/g
  - Comprador cria linha de compra em g (precisa de 100g)
  - price_unit deveria ser R$ 350 (preco por g)
  - MAS o preco_calculado do produto = R$ 350.000 (preco por kg)
  - Entao o sistema precisa converter: 350.000 / 1000 = R$ 350

SOLUCAO:
1. Criar campo x_joa_uom_composicao no product.template (selection)
   Indica em qual UOM a composicao de custo foi cadastrada
   Opcoes: und, g, kg

2. Atualizar Server Action 1173 (Compra) com logica de conversao:
   - Le UOM da linha
   - Compara com UOM da composicao
   - Calcula fator (1.0, 0.001, 1000)
   - Seta price_unit = preco_calculado * fator

3. Criar Server Action + Automation "Aplicar Preco Calc Venda":
   - Mesma logica para sale.order.line
   - Trigger: on_create
   - Vinculada a action (menu Acao)

4. Adicionar campo x_joa_uom_composicao na view do produto
   (aba Formacao de Preco, ao lado do x_joa_moeda_ref)

UOMs DISPONIVEIS NO ODOO 20:
  - id=1: Units (unidade) - para venda de peca de joia
  - id=15: g (gramas)
  - id=16: kg (quilos, factor=1000) - para compra de ouro bruto

COMO USAR:

CASO 1 - Comprar ouro em kg (materia-prima):
1. Cadastrar produto "Ouro 18k":
   - UOM (uom_id) = kg (id=16)
   - Aba Composicao de Custo:
     - peso_ouro_g = 1000 (1kg em gramas) OU peso_ouro_kg = 1
     - custo_metal_g = 350 (preco por grama de ouro)
     - custo_metal_total = 1000 * 350 = 350000 (calculado)
   - Aba Formacao de Preco:
     - UOM Composicao = kg (indica que o preco_calculado=350000 e por kg)
     - markup = 0 (sem markup para materia-prima)
     - preco_calculado = 350000 (calculado)
2. Criar compra:
   - produto = Ouro 18k, qty = 5 (kg)
   - AUTOMATICO: price_unit = 350000 (preco por kg)
   - Total = 5 * 350000 = R$ 1.750.000

CASO 2 - Vender joia em unidade (peca):
1. Cadastrar produto "Anel Ouro 18k":
   - UOM (uom_id) = Units (id=1)
   - Aba Composicao de Custo:
     - peso_ouro_g = 5 (5g por peca)
     - custo_metal_g = 350
     - custo_metal_total = 5 * 350 = 1750 (calculado)
     - pedras_usd = 200, cotacao = 5.20
     - custo_pedras_brl = 1040 (calculado)
     - custo_mao_obra = 150
     - custo_total = 2940 (calculado)
   - Aba Formacao de Preco:
     - UOM Composicao = und (indica que o preco_calculado=5880 e por peca)
     - markup = 100
     - preco_calculado = 5880 (calculado com markup)
2. Criar venda:
   - produto = Anel Ouro 18k, qty = 10 (pecas)
   - AUTOMATICO: price_unit = 5880 (preco por peca)
   - Total = 10 * 5880 = R$ 58.800

CASO 3 - Converter UOM na linha:
  Se o produto "Ouro 18k" tem UOM=kg e preco_calculado=350000 (por kg)
  E voce cria linha de compra com UOM=g:
  AUTOMATICO: price_unit = 350000 * 0.001 = R$ 350 (preco por g)
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
# 1. Criar campo x_joa_uom_composicao no product.template
# ============================================================
print('\n' + '=' * 60)
print('1. Criar campo x_joa_uom_composicao no product.template')
print('=' * 60)

pt_ids = kw('ir.model', 'search', [[['model', '=', 'product.template']]])
pt_id = pt_ids[0]

existing = kw('ir.model.fields', 'search', [
    [['model', '=', 'product.template'], ['name', '=', 'x_joa_uom_composicao']]
])
if existing:
    print('  - ja existe')
else:
    fid = kw('ir.model.fields', 'create', [{
        'name': 'x_joa_uom_composicao',
        'field_description': 'UOM da Composicao (referencia)',
        'ttype': 'selection',
        'selection': "[('und','Unidade (peca)'),('g','Gramas (g)'),('kg','Quilos (kg)')]",
        'model_id': pt_id,
    }])
    print(f'  - CRIADO (id={fid})')


# ============================================================
# 2. Atualizar Server Action 1173 (Aplicar Preco Calc Compra)
# ============================================================
print('\n' + '=' * 60)
print('2. Atualizar Server Action 1173 (Compra) com conversao UOM')
print('=' * 60)

codigo_compra = """
# Joalheria: Aplica o Preco Calculado no price_unit da linha de compra
# Com conversao de UOM (kg/g/und)
for rec in records:
    if not rec.product_id:
        continue
    p = rec.product_id.product_tmpl_id
    preco_base = p.x_joa_preco_calculado or 0
    if preco_base <= 0:
        continue
    
    # UOM da composicao (do produto) - default 'und'
    uom_comp = p.x_joa_uom_composicao or 'und'
    
    # UOM da linha
    line_uom_name = ''
    if rec.product_uom:
        line_uom_name = (rec.product_uom.name or '').lower()
    
    # Calcula fator de conversao
    fator = 1.0
    if uom_comp == 'kg':
        # Composicao em kg
        if 'g' in line_uom_name and 'kg' not in line_uom_name:
            # Linha em g, composicao em kg -> preco por g = preco por kg / 1000
            fator = 0.001
        elif 'kg' in line_uom_name:
            # Linha em kg, composicao em kg -> igual
            fator = 1.0
    elif uom_comp == 'g':
        # Composicao em g
        if 'kg' in line_uom_name:
            # Linha em kg, composicao em g -> preco por kg = preco por g * 1000
            fator = 1000.0
        elif 'g' in line_uom_name and 'mg' not in line_uom_name:
            # Linha em g, composicao em g -> igual
            fator = 1.0
        elif 'mg' in line_uom_name:
            # Linha em mg, composicao em g -> preco por mg = preco por g / 1000
            fator = 0.001
    
    preco_final = preco_base * fator
    if preco_final > 0:
        rec.write({'price_unit': preco_final})
"""

try:
    kw('ir.actions.server', 'write', [[1173], {'code': codigo_compra}])
    print('  ✓ Server Action 1173 atualizada com conversao UOM')
except Exception as e:
    print(f'  ❌ Erro: {str(e)[:200]}')


# ============================================================
# 3. Criar Server Action + Automation para Venda (1174 + 10)
# ============================================================
print('\n' + '=' * 60)
print('3. Server Action + Automation "Aplicar Preco Calc Venda"')
print('=' * 60)

sol_ids = kw('ir.model', 'search', [[['model', '=', 'sale.order.line']]])
sol_id = sol_ids[0]

codigo_venda = """
# Joalheria: Aplica o Preco Calculado no price_unit da linha de venda
for rec in records:
    if not rec.product_id:
        continue
    p = rec.product_id.product_tmpl_id
    preco_base = p.x_joa_preco_calculado or 0
    if preco_base <= 0:
        continue
    
    uom_comp = p.x_joa_uom_composicao or 'und'
    line_uom_name = ''
    if rec.product_uom:
        line_uom_name = (rec.product_uom.name or '').lower()
    
    fator = 1.0
    if uom_comp == 'kg':
        if 'g' in line_uom_name and 'kg' not in line_uom_name:
            fator = 0.001
        elif 'kg' in line_uom_name:
            fator = 1.0
    elif uom_comp == 'g':
        if 'kg' in line_uom_name:
            fator = 1000.0
        elif 'g' in line_uom_name and 'mg' not in line_uom_name:
            fator = 1.0
        elif 'mg' in line_uom_name:
            fator = 0.001
    
    preco_final = preco_base * fator
    if preco_final > 0:
        rec.write({'price_unit': preco_final})
"""

existing_sa = kw('ir.actions.server', 'search', [[['name', '=', 'Joalheria - Aplicar Preco Calculado (Venda)']]])
if existing_sa:
    kw('ir.actions.server', 'unlink', [existing_sa])

existing_auto = kw('base.automation', 'search', [[['name', '=', 'Joalheria - Aplicar Preco Calc ao Salvar Venda']]])
if existing_auto:
    kw('base.automation', 'unlink', [existing_auto])

sa_venda_id = kw('ir.actions.server', 'create', [{
    'name': 'Joalheria - Aplicar Preco Calculado (Venda)',
    'model_id': sol_id,
    'state': 'code',
    'code': codigo_venda,
    'binding_model_id': sol_id,
    'binding_type': 'action',
}])
print(f'  ✓ Server Action criada: id={sa_venda_id}')

auto_venda_id = kw('base.automation', 'create', [{
    'name': 'Joalheria - Aplicar Preco Calc ao Salvar Venda',
    'model_id': sol_id,
    'trigger': 'on_create',
    'filter_domain': "[('product_id', '!=', False), ('x_joa_preco_calculado_unit', '>', 0)]",
    'active': True,
}])
print(f'  ✓ base.automation criada: id={auto_venda_id}')

kw('ir.actions.server', 'write', [[sa_venda_id], {'base_automation_id': auto_venda_id}])
print(f'  ✓ Server Action vinculada a automation')


# ============================================================
# 4. Adicionar campo x_joa_uom_composicao na view do produto (536)
# ============================================================
print('\n' + '=' * 60)
print('4. Adicionar campo x_joa_uom_composicao na view 536 (produto)')
print('=' * 60)

v = kw('ir.ui.view', 'read', [[536], ['arch_db']])[0]
arch = v['arch_db']

if 'JOA_UOM_COMPOSICAO_V1' in arch:
    print('  = Campo ja existe na view')
else:
    idx = arch.find('<field name="x_joa_moeda_ref"')
    if idx == -1:
        idx = arch.find('<field name="x_joa_markup_pct"')
    
    if idx != -1:
        campo = '<!-- JOA_UOM_COMPOSICAO_V1 -->\n          <field name="x_joa_uom_composicao" string="UOM Composicao"/>\n          '
        novo = arch[:idx] + campo + arch[idx:]
        try:
            kw('ir.ui.view', 'write', [[536], {'arch_db': novo}])
            print('  ✓ Campo adicionado na aba Formacao de Preco')
        except xmlrpc.client.Fault as e:
            err = str(e.faultString)
            print(f'  ❌ Falhou: {err[-300:]}')
    else:
        print('  ❌ Nao encontrou campo de referencia para inserir')


# ============================================================
# RELATORIO FINAL
# ============================================================
print('\n' + '=' * 60)
print('RESUMO FINAL')
print('=' * 60)
print(f'''
CAMPO NOVO no product.template:
  - x_joa_uom_composicao (selection: und/g/kg)
    Indica em qual UOM a composicao de custo foi cadastrada.
    Importante para conversao de UOM nas linhas de venda/compra.

SERVER ACTION ATUALIZADA:
  - 1173: "Aplicar Preco Calculado (Compra)"
    Agora converte preco_calculado do produto para a UOM da linha:
      kg -> g: fator 0.001
      g -> kg: fator 1000
      und -> und: fator 1.0
    Vinculada a automation id=9 (on_create em purchase.order.line)

SERVER ACTION + AUTOMATION NOVAS:
  - {sa_venda_id}: "Aplicar Preco Calculado (Venda)" (menu Acao)
  - {auto_venda_id}: "Aplicar Preco Calc ao Salvar Venda" (on_create em sale.order.line)
  Mesma logica de conversao UOM para venda

VIEW 536 (product.template) atualizada:
  - Campo x_joa_uom_composicao na aba Formacao de Preco
  - Ao cadastrar produto, selecione a UOM da composicao:
    - und: para joia pronta (venda por peca)
    - g: para materia-prima em gramas
    - kg: para materia-prima em quilos

COMO USAR (exemplos):

CASO 1 - Comprar ouro em kg:
  1. Cadastrar produto "Ouro 18k" com UOM=kg
     - peso_ouro_g=1000 (1kg em gramas)
     - custo_metal_g=350 (preco por g)
     - custo_metal_total=350000 (calculado)
     - Aba Formacao: UOM Composicao=kg, markup=0, preco_calculado=350000
  2. Criar compra com qty=5 (5kg)
     -> AUTOMATICO: price_unit=350000 (por kg)
     -> Total: 5 * 350000 = R$ 1.750.000

CASO 2 - Vender joia em unidade:
  1. Cadastrar produto "Anel Ouro 18k" com UOM=Units
     - peso_ouro_g=5 (5g por peca)
     - custo_metal_g=350, custo_metal_total=1750
     - pedras_usd=200, cotacao=5.20, pedras_brl=1040
     - custo_mao_obra=150, custo_total=2940
     - Aba Formacao: UOM Composicao=und, markup=100, preco_calculado=5880
  2. Criar venda com qty=10 (10 pecas)
     -> AUTOMATICO: price_unit=5880 (por peca)
     -> Total: 10 * 5880 = R$ 58.800

CASO 3 - Converter UOM na linha:
  Produto Ouro 18k com UOM=kg, preco_calculado=350000 (por kg)
  Criar linha de compra com UOM=g (precisa de 100g):
  -> AUTOMATICO: price_unit = 350000 * 0.001 = R$ 350 (por g)
  -> Total: 100 * 350 = R$ 35.000
''')
