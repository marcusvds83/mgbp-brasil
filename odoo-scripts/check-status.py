#!/usr/bin/env python3
"""
odoo-scripts/check-status.py
============================
Verifica tudo que foi criado no Odoo da Joalheria via scripts anteriores.
Lista:
  - Campos customizados x_joa_* e x_joalheria_*
  - Server Actions criadas
  - Views customizadas (se houver)
  - Empresas configuradas
  - Faturas com status NF-e

Uso:
  ODOO_URL=https://fiscal-cloud-joalherias.odoo.com \\
  ODOO_DB=fiscal-cloud-joalherias \\
  ODOO_USER=marcus@nytro.com.br \\
  ODOO_API_KEY=6ec8... python3 odoo-scripts/check-status.py
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


# ============================================================
# 1. CAMPOS CUSTOMIZADOS
# ============================================================
print('\n' + '=' * 60)
print('CAMPOS CUSTOMIZADOS (x_joa_* e x_joalheria_*)')
print('=' * 60)

for model_name in ['account.move', 'res.company', 'product.product', 'product.template',
                    'sale.order.line', 'purchase.order.line']:
    print(f'\n--- {model_name} ---')
    try:
        campos = kw('ir.model.fields', 'search_read', [
            [['model', '=', model_name], '|',
             ['name', '=like', 'x_joa_%'],
             ['name', '=like', 'x_joalheria_%']],
            ['name', 'field_description', 'ttype']
        ])
        if not campos:
            print('  (nenhum campo encontrado)')
        for c in campos:
            print(f'  {c["name"]:50s} | {c["ttype"]:12s} | {c["field_description"]}')
    except Exception as e:
        print(f'  ERRO: {str(e)[:200]}')


# ============================================================
# 2. SERVER ACTIONS
# ============================================================
print('\n' + '=' * 60)
print('SERVER ACTIONS (Joalheria)')
print('=' * 60)

try:
    actions = kw('ir.actions.server', 'search_read', [
        [['name', 'like', 'Joalheria']],
        ['id', 'name', 'model_id', 'binding_model_id']
    ])
    if not actions:
        print('  (nenhuma action encontrada)')
    for a in actions:
        model_name = '?'
        if a.get('model_id'):
            try:
                m = kw('ir.model', 'read', [[a['model_id'][0]], ['model']])
                model_name = m[0]['model'] if m else '?'
            except:
                model_name = '?'
        binding = ''
        if a.get('binding_model_id'):
            try:
                bm = kw('ir.model', 'read', [[a['binding_model_id'][0]], ['model']])
                binding = f' (binding: {bm[0]["model"] if bm else "?"})'
            except:
                binding = ' (binding: ?)'
        print(f'  id={a["id"]:5d} | {a["name"]:50s} | model={model_name}{binding}')
except Exception as e:
    print(f'  ERRO: {str(e)[:200]}')


# ============================================================
# 3. VIEWS CUSTOMIZADAS (inclui Odoo Studio customizations)
# ============================================================
print('\n' + '=' * 60)
print('VIEWS CUSTOMIZADAS (Joalheria / Odoo Studio)')
print('=' * 60)

# Procura views criadas pelo usuario Marcus (uid=2) hoje OU com nome "Joalheria" OU "Odoo Studio"
try:
    views = kw('ir.ui.view', 'search_read', [
        ['|', ['|', ['name', 'like', 'Joalheria'], ['name', 'like', 'Odoo Studio']],
         ['&', ['create_uid', '=', uid], ['create_date', '>=', '2025-09-25 00:00:00']]],
        ['id', 'name', 'model', 'type', 'inherit_id', 'create_date']
    ])
    if not views:
        print('  (nenhuma view customizada encontrada)')
        print('  -> Use Odoo Studio para criar as abas (ver ODOO-STUDIO-TUTORIAL.md)')
    else:
        print(f'  Total: {len(views)} views customizadas\n')
        # Verifica quais modelos já têm aba NF-e
        modelos_com_aba = set()
        modelos_esperados = {'product.template', 'account.move', 'res.company',
                              'sale.order', 'purchase.order'}
        for v in views:
            model = v.get('model') or '(qweb)'
            if model in modelos_esperados or 'studio' in (v.get('name') or '').lower():
                modelos_com_aba.add(model)
            inh = v.get('inherit_id')
            inh_str = f'herda={inh[0]}' if inh else 'primary'
            print(f'  id={v["id"]:5d} | {(v["name"] or "?")[:60]:60s} | model={model} | type={v["type"]} | {inh_str}')

        print(f'\n  Modelos com aba NF-e ja criada: {sorted(modelos_com_aba)}')
        faltam = modelos_esperados - modelos_com_aba
        if faltam:
            print(f'  FALTAM criar aba em: {sorted(faltam)}')
            print('  -> Use Odoo Studio (ver ODOO-STUDIO-PASSO3.md)')
        else:
            print('  ✅ TODAS as abas criadas!')
except Exception as e:
    print(f'  ERRO: {str(e)[:300]}')


# ============================================================
# 4. EMPRESAS
# ============================================================
print('\n' + '=' * 60)
print('EMPRESAS (res.company) - campos NF-e Joalheria')
print('=' * 60)

try:
    company_ids = kw('res.company', 'search', [[]])
    if company_ids:
        campos_company = ['name', 'vat', 'x_joalheria_nfe_serie',
                          'x_joalheria_nfe_numero', 'x_joalheria_nfe_inscricao_estadual']
        companies = kw('res.company', 'read', [company_ids, campos_company])
        for c in companies:
            print(f'\n  Empresa: {c.get("name", "?")} (id={c["id"]})')
            print(f'    CNPJ (vat): {c.get("vat", "VAZIO")}')
            print(f'    Série NF-e: {c.get("x_joalheria_nfe_serie", "VAZIO")}')
            print(f'    Último número NF-e: {c.get("x_joalheria_nfe_numero", "VAZIO")}')
            print(f'    IE Emitente: {c.get("x_joalheria_nfe_inscricao_estadual", "VAZIO")}')
            if not c.get('vat'):
                print('    ⚠️  CNPJ da empresa está vazio - preencha em Configurações > Empresas')
    else:
        print('  (nenhuma empresa encontrada)')
except Exception as e:
    print(f'  ERRO: {str(e)[:200]}')


# ============================================================
# 5. FATURAS COM STATUS NF-e
# ============================================================
print('\n' + '=' * 60)
print('FATURAS (account.move) - status NF-e Joalheria')
print('=' * 60)

try:
    move_ids = kw('account.move', 'search', [
        [['move_type', '=', 'out_invoice']]
    ], {'limit': 10, 'order': 'create_date desc'})
    if not move_ids:
        print('  (nenhuma fatura out_invoice encontrada)')
    else:
        moves = kw('account.move', 'read', [move_ids, [
            'name', 'partner_id', 'amount_total', 'state',
            'x_joalheria_nfe_status', 'x_joalheria_nfe_chave',
            'x_joalheria_nfe_protocolo', 'x_joalheria_nfe_tipo_operacao'
        ]])
        for m in moves:
            print(f'\n  Fatura: {m["name"]} (id={m["id"]})')
            partner = m.get('partner_id')
            print(f'    Cliente: {partner[1] if partner else "?"}')
            print(f'    Valor: R$ {m.get("amount_total", 0):.2f} - Estado: {m.get("state", "?")}')
            print(f'    Status NF-e: {m.get("x_joalheria_nfe_status", "vazio")}')
            print(f'    Tipo Operação: {m.get("x_joalheria_nfe_tipo_operacao", "?")}')
            chave = m.get('x_joalheria_nfe_chave', '')
            if chave:
                print(f'    Chave: {chave}')
            prot = m.get('x_joalheria_nfe_protocolo', '')
            if prot:
                print(f'    Protocolo: {prot}')
except Exception as e:
    print(f'  ERRO: {str(e)[:200]}')


# ============================================================
# 6. PRODUTOS COM COMPOSIÇÃO DE CUSTO
# ============================================================
print('\n' + '=' * 60)
print('PRODUTOS (product.template) - composicao de custo')
print('=' * 60)

try:
    pt_ids = kw('product.template', 'search', [[]], {'limit': 5, 'order': 'create_date desc'})
    if not pt_ids:
        print('  (nenhum produto encontrado)')
    else:
        campos = ['name', 'default_code', 'list_price',
                   'x_joa_peso_ouro_g', 'x_joa_custo_metal_g',
                   'x_joa_custo_total', 'x_joa_markup_pct', 'x_joa_preco_calculado',
                   'x_joalheria_ncm', 'x_joalheria_cfop']
        products = kw('product.template', 'read', [pt_ids, campos])
        for p in products:
            print(f'\n  Produto: {p["name"]} (id={p["id"]})')
            print(f'    Código: {p.get("default_code", "VAZIO")}')
            print(f'    Preço venda (list_price): R$ {p.get("list_price", 0):.2f}')
            print(f'    Peso ouro (g): {p.get("x_joa_peso_ouro_g", 0)}')
            print(f'    Custo metal (g): R$ {p.get("x_joa_custo_metal_g", 0):.2f}')
            print(f'    Custo total: R$ {p.get("x_joa_custo_total", 0):.2f}')
            print(f'    Markup %: {p.get("x_joa_markup_pct", 0)}')
            print(f'    Preço calculado: R$ {p.get("x_joa_preco_calculado", 0):.2f}')
            print(f'    NCM: {p.get("x_joalheria_ncm", "VAZIO")}')
            print(f'    CFOP: {p.get("x_joalheria_cfop", "VAZIO")}')
except Exception as e:
    print(f'  ERRO: {str(e)[:200]}')

print('\n' + '=' * 60)
print('Status final: verifique acima o que esta configurado e o que falta')
print('=' * 60)
