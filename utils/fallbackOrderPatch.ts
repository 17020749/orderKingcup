export type WarehouseOrderSummaryPatch = {
  warehouse_fulfillment_status?: string
  warehouse_request_status?: string
}

/**
 * Build the limited warehouse status patch written back to an order.
 *
 * This helper is intentionally pure: it does not read orders, order_items,
 * customers, prices, or any other Sale-owned data. Firestore Rules continue
 * to restrict the write to the two warehouse summary fields and updated_at.
 */
export function fallbackOrderPatch(nextStatus: string): WarehouseOrderSummaryPatch {
  if (nextStatus === 'da_xuat') {
    return {
      warehouse_fulfillment_status: 'da_xuat_1_phan',
      warehouse_request_status: 'da_xuat',
    }
  }

  if (nextStatus === 'da_tiep_nhan' || nextStatus === 'cho_xuat_kho') {
    return {
      warehouse_request_status: 'da_tiep_nhan',
    }
  }

  if (nextStatus === 'tu_choi') {
    return {
      warehouse_request_status: 'co_tu_choi',
    }
  }

  return {}
}
