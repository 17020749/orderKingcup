import type { LogoLineDoc, OrderDoc, OrderItemDoc, PaymentDoc } from '~/types/models'
import { round2, safeJsonParse, toNumber } from '~/utils/format'

export function useOrderLogic() {
  function normalizePaymentType(value: any) {
    return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ')
  }

  function parseLogoLines(value: any): LogoLineDoc[] {
    const rows = safeJsonParse(value, [])
    return (Array.isArray(rows) ? rows : [])
      .map((line: any) => {
        const quantity = toNumber(line?.quantity ?? line?.qty ?? line?.export_quantity)
        const unit_price = toNumber(line?.unit_price ?? line?.price)
        const line_total = line?.line_total != null && line?.line_total !== ''
          ? toNumber(line.line_total)
          : round2(quantity * unit_price)
        return {
          logo: String(line?.logo || ''),
          logo_color: String(line?.logo_color ?? line?.color ?? ''),
          quantity,
          unit_price,
          line_total
        }
      })
      .filter(line => line.logo || toNumber(line.quantity))
  }

  function stringifyLogoLines(lines: LogoLineDoc[]) {
    const cleaned = parseLogoLines(lines)
    return cleaned.length ? JSON.stringify(cleaned) : ''
  }

  function getOrderItemFinancials(item: Partial<OrderItemDoc>) {
    const logoLines = parseLogoLines(item.logo_json)
    if (logoLines.length) {
      const quantity = round2(logoLines.reduce((sum, line) => sum + toNumber(line.quantity), 0))
      const line_total = round2(logoLines.reduce((sum, line) => sum + toNumber(line.line_total), 0))
      return {
        logoLines,
        quantity,
        unit_price: quantity ? round2(line_total / quantity) : 0,
        line_total
      }
    }

    const quantity = toNumber(item.quantity)
    const unit_price = toNumber(item.unit_price)
    return {
      logoLines: [],
      quantity,
      unit_price,
      line_total: round2(quantity * unit_price)
    }
  }

  function calcItems(items: Partial<OrderItemDoc>[], order: Partial<OrderDoc> = {}) {
    let subtotal = 0
    const normalized = items.map(item => {
      const financials = getOrderItemFinancials(item)
      subtotal += financials.line_total
      return {
        ...item,
        quantity: financials.quantity,
        unit_price: financials.unit_price,
        cost_price: 0,
        vat_rate: toNumber(order.vat_rate),
        line_total: financials.line_total,
        line_cost: 0,
        line_profit: financials.line_total,
        packing_standard: item.packing_standard || '',
        box_quantity: toNumber(item.box_quantity),
        odd_quantity: toNumber(item.odd_quantity),
        logo_json: financials.logoLines.length ? JSON.stringify(financials.logoLines) : ''
      }
    }).filter(item => item.product_name || item.product_code || toNumber(item.quantity))

    const subtotal_no_vat = round2(subtotal)
    const vat_amount = round2(subtotal_no_vat * toNumber(order.vat_rate) / 100)
    const total_vat = round2(subtotal_no_vat + vat_amount)
    const discount_amount = round2(Math.max(0, toNumber(order.discount_amount)))
    const payable_amount = round2(Math.max(0, total_vat - discount_amount))
    return {
      items: normalized,
      subtotal_no_vat,
      vat_amount,
      total_vat,
      discount_amount,
      payable_amount,
      actual_revenue: total_vat,
      shipping_fee: 0,
      adjustment_amount: 0
    }
  }

  function getOrderDebtBase(order: Partial<OrderDoc> = {}) {
    const gross = toNumber(order.actual_revenue) > 0
      ? toNumber(order.actual_revenue)
      : toNumber(order.total_vat) || toNumber(order.subtotal_no_vat)
    return round2(Math.max(0, gross - Math.max(0, toNumber(order.discount_amount))))
  }

  function computePaymentStatus(totalOrOrder: number | Partial<OrderDoc>, payments: Partial<PaymentDoc>[]) {
    const order = typeof totalOrOrder === 'number' ? { actual_revenue: totalOrOrder } : totalOrOrder
    const received = (payments || []).filter(p => String(p.payment_status || '').trim() === 'Đã nhận')
    const paid = round2(received.reduce((sum, p) => sum + toNumber(p.amount), 0))
    const debt = round2(getOrderDebtBase(order) - paid)
    let deposit_count = 0
    let collect_count = 0
    received.forEach(payment => {
      const type = normalizePaymentType(payment.payment_type)
      if (type === 'cọc' || type === 'coc') deposit_count += 1
      else if (/^thu(\s|\d|$)/.test(type)) collect_count += 1
    })

    let status = 'Chưa thanh toán'
    if (!received.length || paid <= 0) status = 'Chưa thanh toán'
    else if (debt === 0) status = 'Đã thanh toán'
    else if (debt < 0) status = 'Thanh toán thừa'
    else if (deposit_count > 0 && collect_count > 0) status = 'Đã cọc + thanh toán 1 phần'
    else if (deposit_count > 0) status = 'Đã cọc'
    else status = 'Thanh toán một phần'

    return {
      paid_amount: paid,
      debt_amount: debt,
      payment_status: status,
      computed_payment_status: status,
      payment_count: received.length,
      deposit_count,
      collect_count
    }
  }

  return {
    parseLogoLines,
    stringifyLogoLines,
    getOrderItemFinancials,
    calcItems,
    getOrderDebtBase,
    computePaymentStatus
  }
}