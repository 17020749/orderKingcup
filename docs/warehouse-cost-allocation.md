# Warehouse cost allocation without Cloud Functions

## Data visibility

- `import_order_items` stores `unit_cost`, `line_cost`, and `lot_id`.
- `inventory_balances.lots` stores only operational lot metadata: lot id, source receipt, dates, and remaining quantity.
- `export_order_items.lot_allocations_json` stores only lot ids and allocated quantities.
- Export requests, export orders, stock balances, and warehouse screens do not contain purchase prices.

Firestore Rules already require `import.view` to read `import_order_items`. Warehouse export roles must not be granted `import.view` when purchase prices must remain hidden.

## Issue strategy

The active strategy is stored in `app_meta/warehouse_issue`:

- `fifo`: oldest receipt first.
- `fefo`: earliest expiry first, then FIFO.
- `smallest_lot_first`: smallest remaining lot first, then FIFO.

Active users may read the strategy. Only Admin may change `app_meta` under the current Rules.

## Transactions

The Nuxt module overrides the existing `useWarehouseTransactions` auto-import with a lot-aware implementation. Import, export, transfer, adjustment, update, cancellation, and release-from-request operations update total balances and lot quantities in Firestore transactions.

Existing stock without lot metadata is represented by an automatic `legacy_opening` lot. It has no purchase-price reference and remains operationally exportable.

## Limitation

Without a trusted backend, a technically capable user who can alter client code may attempt to change the allocation order. Firestore transactions and Rules still protect permissions, actor identity, non-negative total stock, and operation ownership. Purchase prices remain unavailable to warehouse users because they are not copied into warehouse-readable documents.
