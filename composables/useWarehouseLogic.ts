import type { OrderItemDoc } from '~/types/models'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import {
  buildWarehouseFulfillmentRows,
  orderWarehouseFulfillmentSummary,
  requestWarehouseItems,
  requestWarehouseLineProgress,
} from '~/utils/warehouseFulfillment.mjs'

export type FulfillmentRow = {
  order_item_id: string
  product_id: string
  product_code: string
  product_name: string
  logo: string
  unit: string
  ordered_qty: number
  requested_qty: number
  processed_qty: number
  exported_qty: number
  pending_qty: number
  remaining_qty: number
  available_to_request_qty: number
  status: string
}

export function useWarehouseLogic() {
  function buildFulfillmentRows(items: OrderItemDoc[], requests: any[], excludeRequestId = ''): FulfillmentRow[] {
    return buildWarehouseFulfillmentRows(items, requests, excludeRequestId)
  }

  function orderSummary(rows: FulfillmentRow[], requests: any[]) {
    return orderWarehouseFulfillmentSummary(rows, requests)
  }

  function requestItems(request: any) {
    return requestWarehouseItems(request)
  }

  function requestLineProgress(request: any) {
    return requestWarehouseLineProgress(request)
  }

  return { buildFulfillmentRows, orderSummary, requestItems, requestLineProgress }
}
