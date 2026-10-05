#!/usr/bin/env python3
"""
odoo-scripts/setup-completo-odoo.py
==================================
Script UNICO que cria tudo no Odoo da Joalheria:
  1. Campos customizados x_joalheria_* no account.move, res.company, product.product
  2. Botao "Emitir NF-e" (Server Action)
  3. Botao "Cancelar NF-e" (Server Action)

Execute no Git Bash do seu PC:

  cd ~/nfe-joalherias

  ODOO_URL=https://SEU-ODOO.odoo.com \\
    ODOO_DB=SEU-BANCO \\
    ODOO_API_KEY=SUA-CHAVE \\
    python3 odoo-scripts/setup-completo-odoo.py

Apos rodar, abra qualquer fatura no Odoo, clique na engrenagem (Acao)
e os botoes "Emitir NF-e" e "Cancelar NF-e" estaram la.
"""

import os
import sys
import xmlrpc.client

# ============================================================
# 1. AUTENTICACAO
# ============================================================
ODOO_URL = os.environ.get('ODOO_URL', '').rstrip('/')
ODOO_DB = os.environ.get('ODOO_DB', '')
ODOO_API_KEY = os.environ.get('ODOO_API_KEY', '')
MIDDLEWARE_URL = os.environ.get('MIDDLEWARE_URL', 'http://localhost:3000')
MIDDLEWARE_API_KEY = os.environ.get('MIDDLEWARE_API_KEY', os.environ.get('API_KEY', ''))

if not all([ODOO_URL, ODOO_DB, ODOO_API_KEY]):
    print('ERRO: Defina as 3 variaveis de ambiente:')
    print('  ODOO_URL=https://SEU-ODOO.odoo.com')
    print('  ODOO_DB=SEU-BANCO')
    print('  ODOO_API_KEY=SUA-CHAVE')
    print('')
    print('Exemplo no Git Bash:')
    print('  ODOO_URL=https://fiscal-cloud-joalherias.odoo.com ODOO_DB=fiscal-cloud-joalherias ODOO_API_KEY=abc123 python3 odoo-scripts/setup-completo-odoo.py')
    sys.exit(1)

# Usuario (email) - tenta ODOO_USER, fallback para ODOO_API_KEY (algumas versoes aceitam)
ODOO_USER = os.environ.get('ODOO_USER', ODOO_API_KEY)

print(f'Conectando em {ODOO_URL} (DB: {ODOO_DB})...')
common = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/common')
uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_API_KEY, {})
if not uid:
    # Fallback: tenta com api_key como user tambem (algumas versoes antigas)
    uid = common.authenticate(ODOO_DB, ODOO_API_KEY, ODOO_API_KEY, {})
if not uid:
    print('ERRO: Autenticacao falhou. Verifique ODOO_URL, ODOO_DB, ODOO_USER e ODOO_API_KEY.')
    print('Dica: ODOO_USER deve ser o email de login do usuario Odoo.')
    sys.exit(1)
print(f'Autenticado com sucesso! (uid={uid})')

models = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/object')


def kw(model, method, args=None, kwargs=None):
    return models.execute_kw(ODOO_DB, uid, ODOO_API_KEY, model, method, args or [], kwargs or {})


def upsert_field(model_id, name, field_description, ttype='char', **extra):
    """Cria ou atualiza um campo customizado."""
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
# 2. CAMPOS CUSTOMIZADOS (ir.model.fields)
# ============================================================
print('\n' + '=' * 60)
print('ETAPA 1: Criando campos customizados x_joalheria_*')
print('=' * 60)

# account.move
model_ids = kw('ir.model', 'search', [[['model', '=', 'account.move']]])
if not model_ids:
    print('ERRO: Modelo account.move nao encontrado.')
    sys.exit(1)
model_id = model_ids[0]
print(f'Modelo account.move encontrado: ir.model ID={model_id}')

campos_move = [
    {
        'name': 'x_joalheria_nfe_status',
        'field_description': 'NF-e Status (Joalheria)',
        'ttype': 'selection',
        'selection': "[('vazio','Vazio'),('pendente','Pendente'),('processando','Processando'),('autorizada','Autorizada'),('cancelada','Cancelada'),('erro','Erro')]",
    },
    {'name': 'x_joalheria_nfe_chave', 'field_description': 'NF-e Chave de Acesso (Joalheria)', 'ttype': 'char'},
    {'name': 'x_joalheria_nfe_protocolo', 'field_description': 'NF-e Protocolo (Joalheria)', 'ttype': 'char'},
    {'name': 'x_joalheria_nfe_xml', 'field_description': 'NF-e XML nfeProc (Joalheria)', 'ttype': 'text'},
    {'name': 'x_joalheria_nfe_erro', 'field_description': 'NF-e Erro (Joalheria)', 'ttype': 'text'},
    {'name': 'x_joalheria_nfe_dh_emissao', 'field_description': 'NF-e Data Emissao (Joalheria)', 'ttype': 'datetime'},
    {
        'name': 'x_joalheria_nfe_tipo_operacao',
        'field_description': 'NF-e Tipo Operacao (Joalheria)',
        'ttype': 'selection',
        'selection': "[('venda','Venda'),('remessa_industrializacao','Remessa para Industrializacao'),('retorno_industrializacao','Retorno de Industrializacao'),('exportacao','Exportacao')]",
    },
]
for c in campos_move:
    upsert_field(model_id, **c)

# res.company
model_company_ids = kw('ir.model', 'search', [[['model', '=', 'res.company']]])
if model_company_ids:
    model_company_id = model_company_ids[0]
    print(f'\nModelo res.company encontrado: ir.model ID={model_company_id}')
    campos_company = [
        {'name': 'x_joalheria_nfe_serie', 'field_description': 'NF-e Serie (Joalheria)', 'ttype': 'char'},
        {'name': 'x_joalheria_nfe_numero', 'field_description': 'NF-e Ultimo Numero (Joalheria)', 'ttype': 'integer'},
        {'name': 'x_joalheria_nfe_inscricao_estadual', 'field_description': 'NF-e IE Emitente (Joalheria)', 'ttype': 'char'},
    ]
    for c in campos_company:
        upsert_field(model_company_id, **c)

# product.product
model_product_ids = kw('ir.model', 'search', [[['model', '=', 'product.product']]])
if model_product_ids:
    model_product_id = model_product_ids[0]
    print(f'\nModelo product.product encontrado: ir.model ID={model_product_id}')
    campos_product = [
        {'name': 'x_joalheria_peso_ouro_kg', 'field_description': 'Peso Ouro (kg) p/ Exportacao', 'ttype': 'float'},
        {'name': 'x_joalheria_ncm', 'field_description': 'NCM Especifico (Joalheria)', 'ttype': 'char'},
        {'name': 'x_joalheria_cfop', 'field_description': 'CFOP Default (Joalheria)', 'ttype': 'char'},
        {'name': 'x_joalheria_descricao_nfe', 'field_description': 'Descricao NF-e (Joalheria)', 'ttype': 'text'},
        {'name': 'x_joalheria_unidade_medida', 'field_description': 'Unidade Medida NF-e (Joalheria)', 'ttype': 'char'},
    ]
    for c in campos_product:
        upsert_field(model_product_id, **c)

# ============================================================
# 3. BOTOES (Server Actions)
# ============================================================
print('\n' + '=' * 60)
print('ETAPA 2: Criando Server Actions (botoes)')
print('=' * 60)

# Botao "Emitir NF-e" - apenas marca como pendente. O middleware pega via polling.
# Isso evita uso de bibliotecas externas no sandbox do Odoo SaaS.
codigo_emitir = """
# Botao Emitir NF-e (Joalheria)
# Apenas marca a fatura como pendente. O middleware NF-e Joalherias pega via polling (a cada 20s).
for move in records:
    if move.x_joalheria_nfe_status in ('autorizada', 'cancelada'):
        move.message_post(body="<b>Nao e possivel emitir NF-e</b><br/>Status atual: %s" % move.x_joalheria_nfe_status, message_type='comment')
        continue
    move.write({'x_joalheria_nfe_status': 'pendente'})
    move.message_post(body="<b>Emissao de NF-e solicitada.</b><br/>O middleware NF-e Joalherias processara em alguns segundos. Aguarde o proximo refresh.", message_type='comment')
"""

# Deleta action existente se houver (idempotente)
existing_emitir = kw('ir.actions.server', 'search', [[['name', '=', 'Emitir NF-e (Joalheria)']]])
if existing_emitir:
    kw('ir.actions.server', 'unlink', [existing_emitir])

action_emitir_id = kw('ir.actions.server', 'create', [{
    'name': 'Emitir NF-e (Joalheria)',
    'model_id': model_id,
    'state': 'code',
    'code': codigo_emitir,
    'binding_model_id': model_id,
    'binding_type': 'action',
}])
print(f'Botao "Emitir NF-e" criado: id={action_emitir_id}')

# Botao "Cancelar NF-e" - marca como 'cancelar_solicitado'. O polling de cancelamento pega.
codigo_cancelar = """
# Botao Cancelar NF-e (Joalheria)
# Marca como 'cancelar_solicitado'. O middleware pega via polling.
for move in records:
    if move.x_joalheria_nfe_status != 'autorizada':
        move.message_post(body="<b>Nao e possivel cancelar NF-e.</b><br/>A fatura precisa estar autorizada. Status atual: %s" % (move.x_joalheria_nfe_status or 'vazio'), message_type='comment')
        continue
    move.write({'x_joalheria_nfe_status': 'cancelar_solicitado'})
    move.message_post(body="<b>Cancelamento solicitado.</b><br/>O middleware NF-e Joalherias processara em alguns segundos.", message_type='comment')
"""

existing_cancelar = kw('ir.actions.server', 'search', [[['name', '=', 'Cancelar NF-e (Joalheria)']]])
if existing_cancelar:
    kw('ir.actions.server', 'unlink', [existing_cancelar])

action_cancelar_id = kw('ir.actions.server', 'create', [{
    'name': 'Cancelar NF-e (Joalheria)',
    'model_id': model_id,
    'state': 'code',
    'code': codigo_cancelar,
    'binding_model_id': model_id,
    'binding_type': 'action',
}])
print(f'Botao "Cancelar NF-e" criado: id={action_cancelar_id}')

print('\n' + '=' * 60)
print('SETUP CONCLUIDO!')
print('=' * 60)
print(f'\nAcesse {ODOO_URL}/web#action=account.action_move_out_invoice_type')
print('Em qualquer fatura, clique em "Acao" (engrenagem) > "Emitir NF-e" para emitir.')
