# Firestore inventory-adjustment review

Scope reviewed: inventory_lot_costs, inventory_adjustment_costs, inventory_adjustments, import_orders, and import_order_items.

The inventory-adjust role needs to read protected lot costs and source import prices in order to allocate a negative adjustment by the selected lot and calculate its VAT-inclusive value. The rules grant this role only read access to import documents plus read/create access to the two protected cost collections. It cannot update or delete protected cost documents; those actions remain admin-only. Ordinary inventory-view users remain unable to read protected cost documents.

Client access patterns: direct document reads during adjustment transactions, collection read of inventory_lot_costs for the authorized inventory display, and existing import collection reads. All writes continue to require inventory.adjust and match the current actor email.
