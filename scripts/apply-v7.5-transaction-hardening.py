from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: cần đúng 1 vị trí, tìm thấy {count}')
    file.write_text(text.replace(old, new, 1), encoding='utf-8')


path = 'tests/firestore.rules.test.mjs'

replace_once(
    path,
    """    quantity: -2,
    created_by: WAREHOUSE_RELEASE,
    created_at: 'now',
""",
    """    quantity: -2,
    created_by: WAREHOUSE_RELEASE,
    operation_id: 'op-release-test',
    created_at: 'now',
""",
    'release movement operation id',
)
replace_once(
    path,
    """  await assertSucceeds(updateDoc(doc(db, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: 3,
    updated_at: 'now'
  }))
""",
    """  await assertSucceeds(updateDoc(doc(db, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: 3,
    last_operation_id: 'op-release-test',
    updated_by: WAREHOUSE_RELEASE,
    updated_at: 'now'
  }))
""",
    'release balance operation fields',
)

replace_once(
    path,
    """    quantity: -5,
    created_by: STOCK_DELETE,
    created_at: 'now',
""",
    """    quantity: -5,
    created_by: STOCK_DELETE,
    operation_id: 'op-import-delete-test',
    created_at: 'now',
""",
    'import delete movement operation id',
)
replace_once(
    path,
    """  await assertSucceeds(updateDoc(doc(deleteDb, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: 5,
    updated_at: 'now'
  }))
""",
    """  await assertSucceeds(updateDoc(doc(deleteDb, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: 5,
    last_operation_id: 'op-import-delete-test',
    updated_by: STOCK_DELETE,
    updated_at: 'now'
  }))
""",
    'import delete balance operation fields',
)

replace_once(
    path,
    """  await assertSucceeds(updateDoc(doc(stockDb, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: 7,
    updated_at: 'now'
  }))

  await assertFails(updateDoc(doc(stockDb, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: -1,
    updated_at: 'now'
  }))
""",
    """  await assertSucceeds(updateDoc(doc(stockDb, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: 7,
    last_operation_id: 'op-balance-safe-test',
    updated_by: STOCK,
    updated_at: 'now'
  }))

  await assertFails(updateDoc(doc(stockDb, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: -1,
    last_operation_id: 'op-balance-negative-test',
    updated_by: STOCK,
    updated_at: 'now'
  }))
""",
    'inventory positive and negative operation fields',
)

replace_once(
    path,
    """    quantity: 3,
    created_by: STOCK,
    created_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))

  await assertFails(updateDoc(doc(stockDb, 'stock_movements', 'move-a'), {
""",
    """    quantity: 3,
    created_by: STOCK,
    operation_id: 'op-movement-append-only-test',
    created_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))

  await assertFails(updateDoc(doc(stockDb, 'stock_movements', 'move-a'), {
""",
    'append-only movement operation id',
)

replace_once(
    path,
    """    quantity: 2,
    created_by: STOCK,
    created_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))

  await assertSucceeds(updateDoc(doc(stockDb, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: 12,
    updated_at: 'now'
  }))

  await assertFails(updateDoc(doc(stockDb, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: -1,
    updated_at: 'now'
  }))
""",
    """    quantity: 2,
    created_by: STOCK,
    operation_id: 'op-export-cancel-test',
    created_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))

  await assertSucceeds(updateDoc(doc(stockDb, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: 12,
    last_operation_id: 'op-export-cancel-test',
    updated_by: STOCK,
    updated_at: 'now'
  }))

  await assertFails(updateDoc(doc(stockDb, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: -1,
    last_operation_id: 'op-export-cancel-negative-test',
    updated_by: STOCK,
    updated_at: 'now'
  }))
""",
    'export cancel operation fields',
)

for temporary_path in [
    Path('v7.5-rules-error.log'),
    Path('v7.5-final-tests-error.log'),
]:
    temporary_path.unlink(missing_ok=True)

print('Đã cập nhật 5 test legacy sang schema operation V7.5 và xóa log chẩn đoán.')
