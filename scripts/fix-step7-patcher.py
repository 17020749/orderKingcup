from pathlib import Path

path = Path('scripts/apply-step7-relations.py')
source = path.read_text(encoding='utf-8')
old = '''replace_once(
    'types/models.ts',
    """  order_owner_email?: string
  order_created_by?: string
}
""",
    """  order_owner_email?: string
  order_created_by?: string
  order_sale_email?: string
  relation_revision?: number
  last_operation_id?: string
  status?: string
  active?: boolean
  deleted?: boolean
}
""",
)
'''
new = '''replace_once(
    'types/models.ts',
    """  order_created_by?: string
}""",
    """  order_created_by?: string
  order_sale_email?: string
  relation_revision?: number
  last_operation_id?: string
  status?: string
  active?: boolean
  deleted?: boolean
}""",
)
'''
if old not in source:
    raise SystemExit('Invoice type patch block not found')
path.write_text(source.replace(old, new, 1), encoding='utf-8')
print('Step 7 patcher fixed')
