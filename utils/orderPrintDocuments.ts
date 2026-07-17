export { buildCommercialPrintHtml } from '~/utils/orderCommercialPrint'
export { buildDeliveryPrintHtml } from '~/utils/orderDeliveryPrint'
export type { CommercialPrintKind, DeliveryPrintRow, PrintCustomer } from '~/utils/orderPrintShared'

export function openPrintDocument(html: string, onBlocked?: () => void) {
  const popup = window.open('', '_blank', 'popup=yes,width=1100,height=900')
  if (!popup) {
    onBlocked?.()
    return false
  }
  popup.document.open()
  popup.document.write(html)
  popup.document.close()
  popup.focus()

  const printNow = () => window.setTimeout(() => popup.print(), 150)
  if (popup.document.fonts?.ready) popup.document.fonts.ready.then(printNow).catch(printNow)
  else window.setTimeout(printNow, 500)
  return true
}
