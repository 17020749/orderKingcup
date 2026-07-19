from pathlib import Path

path = Path('scripts/apply-step8-export-lifecycle.py')
source = path.read_text(encoding='utf-8')

old = r'''    r"(      orderSummaryPatch: orderPatchAfter\(row, 'da_xuat', \{ warehouse_export_code: 'pending_firestore' \}\),\n)",
    r"\1      expected_revision: toNumber(row.revision),\n",
'''
new = r'''    r"(orderSummaryPatch: orderPatchAfter\(row, 'da_xuat', \{ warehouse_export_code: 'pending_firestore' \}\),\n)",
    r"\1    expected_revision: toNumber(row.revision),\n",
'''

if old not in source:
    raise SystemExit('Generated expected_revision regex block was not found')
path.write_text(source.replace(old, new, 1), encoding='utf-8')
print('Step 8 revision insertion regex fixed')
