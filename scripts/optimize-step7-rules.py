from pathlib import Path

path = Path('firestore.rules')
source = path.read_text(encoding='utf-8')
old = """        || orderPrintingSummaryUpdateAllowed(docId)
        || orderPaymentSummaryUpdateAllowed(docId)
        || orderInvoiceSummaryUpdateAllowed(docId)
        || orderShipmentSummaryUpdateAllowed(docId)
        || orderWarehouseSummaryUpdateAllowed()
"""
new = """        // Dispatch relation summaries by the cheap module marker first. This
        // prevents Firestore from evaluating all three expensive parent/child
        // relation branches for every order update.
        || (
          request.resource.data.get('relation_last_module', '') == 'payments'
          && orderPaymentSummaryUpdateAllowed(docId)
        )
        || (
          request.resource.data.get('relation_last_module', '') == 'invoices'
          && orderInvoiceSummaryUpdateAllowed(docId)
        )
        || (
          request.resource.data.get('relation_last_module', '') == 'shipments'
          && orderShipmentSummaryUpdateAllowed(docId)
        )
        || orderPrintingSummaryUpdateAllowed(docId)
        || orderWarehouseSummaryUpdateAllowed()
"""
if old not in source:
    raise SystemExit('Order relation dispatch target not found')
path.write_text(source.replace(old, new, 1), encoding='utf-8')
print('Step 7 rules dispatch optimized')
