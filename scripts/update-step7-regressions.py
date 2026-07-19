from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text(encoding='utf-8')
    if old not in source:
        raise SystemExit(f'Missing target in {path}: {old[:120]!r}')
    file.write_text(source.replace(old, new, 1), encoding='utf-8')


# All modern order fixtures start with reconciled zero relation locks.
replace_once(
    'tests/firestore.rules.test.mjs',
    """    printing_lock_updated_by: email,
    printing_lock_updated_at: 'now',
    active: true,
""",
    """    printing_lock_updated_by: email,
    printing_lock_updated_at: 'now',
    relation_lock_version: 1,
    payment_record_count: 0,
    invoice_record_count: 0,
    shipment_record_count: 0,
    payment_relation_revision: 0,
    invoice_relation_revision: 0,
    shipment_relation_revision: 0,
    relation_last_module: 'all',
    relation_last_action: 'reconcile',
    relation_last_document_id: '',
    relation_updated_by: email,
    relation_updated_at: 'now',
    active: true,
""",
)
replace_once(
    'tests/firestore.rules.test.mjs',
    """      setDoc(doc(db, 'orders', 'order-b'), order(B, 'order-b')),
""",
    """      setDoc(doc(db, 'orders', 'order-b'), {
        ...order(B, 'order-b'),
        payment_record_count: 1,
        invoice_record_count: 1,
        shipment_record_count: 1
      }),
""",
)

replace_once(
    'tests/firestore.rules.test.mjs',
    """test('User A tạo payment chuẩn cho order A', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertSucceeds(setDoc(doc(db, 'payments', 'payment-a'), {
    order_id: 'order-a', created_by: A, ...ownership(A), amount: 200, active: true
  }))
})
""",
    """test('User A tạo payment chuẩn cho order A bằng batch nguyên tử', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  const batch = writeBatch(db)
  batch.set(doc(db, 'payments', 'payment-a'), {
    id: 'payment-a', order_id: 'order-a', order_code: 'order-a', created_by: A,
    ...ownership(A), payment_type: 'Cọc', payment_status: 'Đã nhận', amount: 200,
    active: true, deleted: false, status: 'active'
  })
  batch.update(doc(db, 'orders', 'order-a'), {
    relation_lock_version: 1,
    relation_last_module: 'payments', relation_last_action: 'create',
    relation_last_document_id: 'payment-a', relation_updated_by: A, relation_updated_at: 'now',
    payment_record_count: 1, payment_relation_revision: 1,
    paid_amount: 200, debt_amount: -200,
    payment_status: 'Thanh toán thừa', computed_payment_status: 'Thanh toán thừa',
    payment_count: 1, deposit_count: 1, collect_count: 0,
    updated_at: 'now'
  })
  await assertSucceeds(batch.commit())
})
""",
)

replace_once(
    'tests/firestore.rules.test.mjs',
    """test('User A không thể đổi order_id của payment thuộc mình sang order B', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertSucceeds(setDoc(doc(db, 'payments', 'payment-a-immutable'), {
    order_id: 'order-a', created_by: A, ...ownership(A), amount: 200, active: true
  }))
  await assertFails(updateDoc(doc(db, 'payments', 'payment-a-immutable'), {
    order_id: 'order-b', ...ownership(B)
  }))
})
""",
    """test('User A không thể đổi order_id của payment thuộc mình sang order B', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore()
    await setDoc(doc(adminDb, 'payments', 'payment-a-immutable'), {
      id: 'payment-a-immutable', order_id: 'order-a', order_code: 'order-a',
      created_by: A, ...ownership(A), amount: 200, active: true, deleted: false, status: 'active'
    })
    await updateDoc(doc(adminDb, 'orders', 'order-a'), {
      payment_record_count: 1,
      payment_relation_revision: 1
    })
  })
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertFails(updateDoc(doc(db, 'payments', 'payment-a-immutable'), {
    order_id: 'order-b', ...ownership(B)
  }))
})
""",
)

replace_once(
    'tests/firestore.rules.test.mjs',
    """test('Admin có thể tạo dữ liệu con cho order của user khác', async () => {
  const db = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()
  await assertSucceeds(setDoc(doc(db, 'payments', 'payment-b-by-admin'), {
    order_id: 'order-b', created_by: ADMIN, ...ownership(B), amount: 300, active: true
  }))
  await assertSucceeds(setDoc(doc(db, 'order_items', 'item-b-by-admin'), {
    order_id: 'order-b', owner_email: B, created_by: B, sale_email: B,
    product_name: 'Admin thêm', active: true
  }))
})
""",
    """test('Admin có thể tạo dữ liệu con cho order của user khác bằng batch nguyên tử', async () => {
  const db = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()
  const paymentBatch = writeBatch(db)
  paymentBatch.set(doc(db, 'payments', 'payment-b-by-admin'), {
    id: 'payment-b-by-admin', order_id: 'order-b', order_code: 'order-b',
    created_by: ADMIN, ...ownership(B), payment_type: 'Thu 1', payment_status: 'Đã nhận',
    amount: 300, active: true, deleted: false, status: 'active'
  })
  paymentBatch.update(doc(db, 'orders', 'order-b'), {
    relation_lock_version: 1,
    relation_last_module: 'payments', relation_last_action: 'create',
    relation_last_document_id: 'payment-b-by-admin', relation_updated_by: ADMIN,
    relation_updated_at: 'now', payment_record_count: 2, payment_relation_revision: 1,
    paid_amount: 300, debt_amount: -300,
    payment_status: 'Thanh toán thừa', computed_payment_status: 'Thanh toán thừa',
    payment_count: 1, deposit_count: 0, collect_count: 1, updated_at: 'now'
  })
  await assertSucceeds(paymentBatch.commit())
  await assertSucceeds(setDoc(doc(db, 'order_items', 'item-b-by-admin'), {
    order_id: 'order-b', owner_email: B, created_by: B, sale_email: B,
    product_name: 'Admin thêm', active: true
  }))
})
""",
)

replace_once(
    'tests/firestore.rules.test.mjs',
    """test('V7.4 cho phép sửa đơn và trạng thái hóa đơn nguyên tử khi đủ quyền', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'orders', 'order-a'), {
    note: 'Đã cập nhật',
    invoice_status: 'Khách lẻ',
    updated_at: 'now'
  }))
})
""",
    """test('Bước 7 sửa nội dung đơn và hóa đơn qua hai luồng được bảo vệ', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'orders', 'order-a'), {
    note: 'Đã cập nhật',
    updated_at: 'now'
  }))
  await assertFails(updateDoc(doc(db, 'orders', 'order-a'), {
    invoice_status: 'Khách lẻ',
    updated_at: 'now'
  }))

  const batch = writeBatch(db)
  batch.set(doc(db, 'invoices', 'invoice-v74'), {
    id: 'invoice-v74', order_id: 'order-a', order_code: 'order-a',
    invoice_status: 'Khách lẻ', created_by: A, ...ownership(A),
    active: true, deleted: false, status: 'active'
  })
  batch.update(doc(db, 'orders', 'order-a'), {
    relation_lock_version: 1,
    relation_last_module: 'invoices', relation_last_action: 'create',
    relation_last_document_id: 'invoice-v74', relation_updated_by: A,
    relation_updated_at: 'now', invoice_record_count: 1,
    invoice_relation_revision: 1, invoice_status: 'Khách lẻ', updated_at: 'now'
  })
  await assertSucceeds(batch.commit())
})
""",
)

# Printing tests also need zero relation locks before the order may be deleted.
replace_once(
    'tests/order-printing-delete-lock.rules.test.mjs',
    """      printing_lock_updated_by: OWNER,
      printing_lock_updated_at: 'now',
    }),
""",
    """      printing_lock_updated_by: OWNER,
      printing_lock_updated_at: 'now',
      relation_lock_version: 1,
      payment_record_count: 0,
      invoice_record_count: 0,
      shipment_record_count: 0,
      payment_relation_revision: 0,
      invoice_relation_revision: 0,
      shipment_relation_revision: 0,
      relation_last_module: 'all',
      relation_last_action: 'reconcile',
      relation_last_document_id: '',
      relation_updated_by: OWNER,
      relation_updated_at: 'now',
    }),
""",
)

# Invoice state is now managed only by the atomic invoice page after creation.
replace_once(
    'pages/orders.vue',
    """const canManageInvoiceStatus = computed(() => editing.value
  ? hasPermission('invoices.edit')
  : hasPermission('invoices.create')
)
""",
    """const canManageInvoiceStatus = computed(() => !editing.value && hasPermission('invoices.create'))
""",
)

print('Step 7 regressions updated')
