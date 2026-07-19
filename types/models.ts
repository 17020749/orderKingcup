export type AnyDoc = Record<string, any> & { id?: string }

export interface AppUser {
  email: string
  user_code?: string
  display_name?: string
  role?: string
  roles?: string[]
  status?: string
  active?: boolean
  permissions_flat?: string[]
  is_admin?: boolean
  created_at?: any
  updated_at?: any
}

export interface RoleDoc {
  id: string
  name: string
  description?: string
  permissions: string[]
  status?: string
  active?: boolean
}

export interface CustomerDoc {
  id: string
  customer_code?: string
  customer_name: string
  company_name?: string
  phone?: string
  email?: string
  tax_code?: string
  billing_address?: string
  shipping_address?: string
  source?: string
  note?: string
  status?: string
}

export interface ProductDoc {
  id: string
  product_code?: string
  product_name: string
  category?: string
  unit?: string
  cost_price?: number
  selling_price?: number
  packing_standard?: string
  out_of_stock_max?: number
  out_of_stock_threshold?: number
  warning_stock_min?: number
  warning_stock_max?: number
  normal_stock_min?: number
  normal_stock_threshold?: number
  status?: string
  active?: boolean
  deleted?: boolean
  created_at?: any
  updated_at?: any
  created_by?: string
  owner_email?: string
  note?: string
}

export interface LogoLineDoc {
  logo?: string
  logo_color?: string
  quantity?: number
  unit_price?: number
  line_total?: number
}

export interface OrderItemDoc {
  id: string
  order_id: string
  order_code?: string
  product_id?: string
  product_code?: string
  product_name?: string
  unit?: string
  quantity: number
  unit_price: number
  cost_price?: number
  vat_rate?: number
  line_total?: number
  line_cost?: number
  line_profit?: number
  packing_standard?: string
  box_quantity?: number
  odd_quantity?: number
  logo_json?: string | any[]
  note?: string
  status?: string
  active?: boolean
  deleted?: boolean
}

export interface OrderDoc {
  id: string
  order_code: string
  order_sequence?: number
  user_code?: string
  customer_code?: string
  order_classification?: string
  order_date?: string
  customer_id?: string
  customer_name?: string
  phone?: string
  sale_name?: string
  sale_email?: string
  owner_email?: string
  order_status?: string
  operation_status?: string
  expected_delivery_date?: string
  completed_date?: string
  subtotal_no_vat?: number
  vat_amount?: number
  total_vat?: number
  shipping_fee?: number
  adjustment_amount?: number
  actual_revenue?: number
  vat_rate?: number
  payment_status?: string
  computed_payment_status?: string
  paid_amount?: number
  debt_amount?: number
  payment_count?: number
  deposit_count?: number
  collect_count?: number
  invoice_status?: string
  note?: string
  created_by?: string
  warehouse_fulfillment_status?: string
  warehouse_request_status?: string
  printing_progress_count?: number
  printing_lock_version?: number
  printing_last_action?: 'create' | 'delete' | 'reconcile'
  printing_last_print_order_id?: string
  printing_lock_updated_by?: string
  printing_lock_updated_at?: any
  relation_lock_version?: number
  payment_record_count?: number
  invoice_record_count?: number
  shipment_record_count?: number
  payment_relation_revision?: number
  invoice_relation_revision?: number
  shipment_relation_revision?: number
  relation_last_module?: string
  relation_last_action?: string
  relation_last_document_id?: string
  relation_updated_by?: string
  relation_updated_at?: any
  shipment_status?: string
  shipping_fee_total?: number
  cod_amount_total?: number
  status?: string
  created_at?: any
  updated_at?: any
}

export interface PaymentDoc {
  id: string
  order_id: string
  order_code?: string
  payment_date?: string
  payment_type?: string
  amount: number
  method?: string
  payment_status?: string
  cod_status?: string
  note?: string
  created_by?: string
  order_owner_email?: string
  order_created_by?: string
  order_sale_email?: string
  relation_revision?: number
  last_operation_id?: string
  status?: string
  active?: boolean
  deleted?: boolean
}

export interface ExportRequestDoc {
  id: string
  request_id: string
  order_id: string
  order_code?: string
  customer_name?: string
  export_date?: string
  requested_by?: string
  requested_at?: any
  updated_by?: string
  status?: string
  warehouse_export_code?: string
  warehouse_handled_by?: string
  warehouse_handled_at?: any
  warehouse_note?: string
  payload_json?: string
  request_timeline_json?: string
  lifecycle_status?: string
  release_sequence?: number
  active_export_order_id?: string
  warehouse_export_id?: string
  warehouse_export_order_id?: string
  export_order_id?: string
  last_released_export_order_id?: string
  last_released_export_code?: string
  last_cancelled_export_order_id?: string
  last_cancelled_export_code?: string
  last_cancel_reason?: string
  cancel_count?: number
  actual_export_summary_json?: string
  stock_movement_ids?: string[]
  revision?: number
}

export interface ExportOrderDoc {
  id: string
  code?: string
  export_code?: string
  export_date?: string
  destination_type?: string
  source_order_code?: string
  source_request_id?: string
  sync_source?: string
  source?: string
  lifecycle_status?: string
  release_sequence?: number
  source_request_revision?: number
  request_operation_id?: string
  customer_name?: string
  destination_name?: string
  to_warehouse_id?: string
  to_warehouse_name?: string
  note?: string
  status?: string
  active?: boolean
  deleted?: boolean
  created_by?: string
  revision?: number
}

export interface ExportOrderItemDoc {
  id: string
  export_order_id: string
  product_id?: string
  product_code?: string
  product_name?: string
  from_warehouse_id?: string
  from_warehouse_name?: string
  to_warehouse_id?: string
  to_warehouse_name?: string
  destination_name?: string
  logo?: string
  source_logo?: string
  target_logo?: string
  quantity: number
  unit?: string
  note?: string
  status?: string
  active?: boolean
  deleted?: boolean
  created_by?: string
  revision?: number
}

export interface ShipmentDoc {
  id: string
  order_id: string
  order_code?: string
  carrier?: string
  tracking_code?: string
  shipping_fee?: number
  cod_amount?: number
  shipping_status?: string
  shipped_date?: string
  delivered_date?: string
  receiver_name?: string
  receiver_phone?: string
  receiver_address?: string
  note?: string
  created_by?: string
  order_owner_email?: string
  order_created_by?: string
  order_sale_email?: string
  relation_revision?: number
  last_operation_id?: string
  status?: string
  active?: boolean
  deleted?: boolean
}

export interface PrintOrderDoc {
  id: string
  order_id?: string
  order_code: string
  am_code?: string
  supplier_id?: string
  supplier_name?: string
  note?: string
  status?: string
  active?: boolean
  deleted?: boolean
  created_by?: string
  created_at?: any
  updated_by?: string
  updated_at?: any
  deleted_by?: string
  deleted_at?: any
  source?: string
}

export interface PrintOrderItemDoc {
  id: string
  print_order_id: string
  product_id?: string
  product_code?: string
  product_name?: string
  logo?: string
  logo_color?: string
  print_quantity: number
  actual_print_quantity?: number
  print_started_at?: string
  expected_done_at?: string
  is_completed?: boolean | string
  completed_at?: any
  note?: string
  status?: string
  active?: boolean
  deleted?: boolean
  created_by?: string
  created_at?: any
  updated_by?: string
  updated_at?: any
  deleted_by?: string
  deleted_at?: any
  source?: string
}

export interface InvoiceDoc {
  id: string
  order_id: string
  order_code?: string
  invoice_number?: string
  invoice_date?: string
  invoice_amount?: number
  invoice_status?: string
  tax_code?: string
  company_name?: string
  billing_address?: string
  note?: string
  created_by?: string
  order_owner_email?: string
  order_created_by?: string
  order_sale_email?: string
  relation_revision?: number
  last_operation_id?: string
  status?: string
  active?: boolean
  deleted?: boolean
}