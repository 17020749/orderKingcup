<script setup lang="ts">
import { collection, doc, getDocs, query, runTransaction, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore'
import type { ProductDoc, WarehouseDoc } from '~/types/models'
import { formatDateTime, isActive, normalizeText, safeJsonParse, todayKey, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { LOGO_FILTER_OPTIONS, matchesLogoPresenceFilter, rowsHaveLogo } from '~/utils/logoFilter.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { isDateTimeInRange } from '~/utils/warehouseExportHistory.mjs'
// @ts-ignore Shared lifecycle helper is also executed by Node client tests.
import {
  buildAcceptedRequestPatch,
  buildCancelledExternalReleaseRequestPatch,
  buildExternalReleasedRequestPatch,
  buildRejectedRequestPatch,
  canAcceptExportRequest,
  canCancelExternalExportRequestRelease,
  canCancelExportRequestRelease,
  canRejectExportRequest,
  canReleaseExportRequest,
  canReleaseExportRequestExternally,
  externalExportLifecycleLinkError,
  requestExternalExportOrderId,
  isExternalExportRequestRelease,
} from '~/utils/exportLifecycle.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { orderWarehouseFulfillmentSummaryFromRequests } from '~/utils/warehouseFulfillment.mjs'
// @ts-ignore Shared safety helper is also executed by Node client tests.
import {
  externalExportManifestCountMatches,
  notificationDocumentId,
} from '~/utils/warehouseExportSafety.mjs'
import {
  buildNotificationPayload,
  resolveSaleNotificationRecipients,
} from '~/composables/useNotifications'

const { db } = useFirebaseServices()
const { appUser, hasPermission, hasAnyPermission } = useAuth()
const {
  loadProducts,
  loadWarehouses,
  listenWarehouseExportRequests,
} = useScopedQueries()
const { requestLineProgress } = useWarehouseLogic()
const { processExportRequestToExportOrder, cancelExportRequestRelease } = useWarehouseTransactions()
const { showToast } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()
const { invalidateScopedCache } = useRepo()

const supportingLoading = ref(false)
const realtimeLoading = ref(true)
const loading = computed(() => supportingLoading.value || realtimeLoading.value)
const saving = ref(false)
const search = ref('')
const statusFilter = ref('')
const logoFilter = ref('')
const dateTimeFrom = ref('')
const dateTimeTo = ref('')
const rows = ref<any[]>([])
const products = ref<ProductDoc[]>([])
const warehouses = ref<WarehouseDoc[]>([])
const selectedRequest = ref<any>(null)
const actionRequest = ref<any>(null)
const actionType = ref<'accept' | 'reject' | 'release' | 'external_release' | 'cancel_release' | 'cancel_external_release' | ''>('')
const showDetailModal = ref(false)
const showActionModal = ref(false)
const actionForm = reactive({ note: '', export_date: todayKey() })
const releaseLines = ref<any[]>([])
const releaseWarehouseIds = ref<Record<number, string>>({})
let stopRequestsListener: (() => void) | null = null
let lastRealtimeError = ''

const canOpenPage = computed(() => hasAnyPermission(['page.warehouse_export_requests', 'export_requests.process']))
const canAcceptAction = computed(() => hasAnyPermission(['export_requests.accept', 'export_requests.process']))
const canRejectAction = computed(() => hasAnyPermission(['export_requests.reject', 'export_requests.process']))
const canReleaseAction = computed(() => hasAnyPermission(['export_requests.release', 'export_requests.process']))
const warehouseOptions = computed(() => warehouses.value.map(warehouse => ({
  value: warehouse.id,
  label: warehouse.name || warehouse.warehouse_code || warehouse.id,
  subLabel: warehouse.address || '',
  search: `${warehouse.name || ''} ${warehouse.warehouse_code || ''} ${warehouse.address || ''}`
})))

const MAX_WAREHOUSE_RELEASE_LINES = 10

function warehouseOperationPayload(input: {
  operationId: string
  action: string
  requestId: string
  actor: string
  targetRevision: number
}) {
  return {
    operation_id: input.operationId,
    action: input.action,
    target_collection: 'order_export_requests',
    target_id: input.requestId,
    status: 'completed',
    created_by: input.actor,
    created_at: serverTimestamp(),
    processing_at: serverTimestamp(),
    completed_at: serverTimestamp(),
    target_revision: input.targetRevision,
    result_code: input.requestId,
    source: 'warehouse_export_requests',
  }
}

function requestHasLogo(row: any) {
  return rowsHaveLogo(requestLineProgress(row), line => [line?.logo, line?.source_logo])
}

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  return rows.value.filter(row => {
    const statusOk = !statusFilter.value || row.status === statusFilter.value
    const logoOk = matchesLogoPresenceFilter(requestHasLogo(row), logoFilter.value)
    const dateTimeOk = isDateTimeInRange(
      row.requested_at || row.created_at,
      dateTimeFrom.value,
      dateTimeTo.value,
    )
    const textOk = !keyword || normalizeText([
      row.request_id,
      row.order_code,
      row.customer_name,
      row.status,
      row.requested_by,
      row.warehouse_export_code,
      row.warehouse_note
    ].join(' ')).includes(keyword)
    return statusOk && logoOk && dateTimeOk && textOk
  })
})

function resetFilters() {
  search.value = ''
  statusFilter.value = ''
  logoFilter.value = ''
  dateTimeFrom.value = ''
  dateTimeTo.value = ''
}

const summary = computed(() => filtered.value.reduce((out, row) => {
  out.total++
  if (['cho_xu_ly', 'dang_xu_ly'].includes(String(row.status || ''))) out.waiting++
  if (['da_tiep_nhan', 'cho_xuat_kho'].includes(String(row.status || ''))) out.accepted++
  if (row.status === 'da_xuat') out.exported++
  if (row.status === 'tu_choi') out.rejected++
  return out
}, { total: 0, waiting: 0, accepted: 0, exported: 0, rejected: 0 }))

function statusLabel(status: any) {
  return ({
    cho_xu_ly: 'Chờ xử lý',
    dang_xu_ly: 'Đang xử lý',
    da_tiep_nhan: 'Đã tiếp nhận/chờ xuất kho',
    cho_xuat_kho: 'Chờ xuất kho',
    da_xuat: 'Đã xuất kho',
    tu_choi: 'Từ chối',
    loi: 'Lỗi xử lý'
  } as any)[status] || status || '-'
}

function statusClass(status: any) {
  if (status === 'da_xuat') return 'green'
  if (status === 'tu_choi' || status === 'loi') return 'red'
  if (status === 'da_tiep_nhan' || status === 'cho_xuat_kho') return 'blue'
  return 'yellow'
}

function timeline(row: any) {
  const value = safeJsonParse(row?.request_timeline_json, [])
  return Array.isArray(value) ? value : []
}

function timelineActorText(step: any, row?: any) {
  const payload = row ? safeJsonParse(row.payload_json, {}) : {}
  const actor = String(step?.actor || '').trim()
  const name = String(step?.actor_name || payload.requested_by_name || row?.requested_by_name || row?.sale_name || '').trim()
  if (name && actor && name.toLowerCase() !== actor.toLowerCase()) return `${name} · ${actor}`
  return name || actor || '-'
}

function timelineNoteText(step: any) {
  const note = String(step?.note || '').trim()
  return note ? `Ghi chú: ${note}` : ''
}

function timelineTitleText(step: any) {
  return String(step?.title || statusLabel(step?.status))
    .replace('Kingcup tạo yêu cầu xuất kho', 'Sale tạo yêu cầu xuất kho')
    .replace('Kingcup sửa yêu cầu xuất kho', 'Sale sửa yêu cầu xuất kho')
    .replace('Warehouse đã tiếp nhận', 'Kho đã tiếp nhận')
    .replace('Warehouse đã từ chối', 'Kho đã từ chối')
    .replace('Warehouse cho xuất kho', 'Kho cho xuất kho')
}

function appendTimeline(row: any, action: string, title: string, status: string, note = '') {
  return JSON.stringify([...timeline(row), {
    action,
    title,
    actor: appUser.value?.email || '',
    actor_name: appUser.value?.display_name || appUser.value?.email || '',
    time: new Date().toISOString(),
    status,
    note
  }])
}

function requestHasExported(row: any) {
  const status = normalizeText(row?.status).replace(/\s+/g, '_')
  if (['da_xuat', 'da_xuat_kho', 'da_xuat_du', 'exported', 'completed', 'hoan_thanh'].includes(status)) return true
  return requestLineProgress(row).some((line: any) => toNumber(line.exported_qty) > 0)
}

function canAcceptRequest(row: any) {
  return canAcceptAction.value && canAcceptExportRequest(row)
}

function canRejectRequest(row: any) {
  return canRejectAction.value && canRejectExportRequest(row) && !requestHasExported(row)
}

function canReleaseRequest(row: any) {
  return canReleaseAction.value && canReleaseExportRequest(row) && !requestHasExported(row)
}

function canExternalReleaseRequest(row: any) {
  return canReleaseAction.value && canReleaseExportRequestExternally(row) && !requestHasExported(row)
}

function canCancelReleasedRequest(row: any) {
  return canReleaseAction.value && canCancelExportRequestRelease(row)
}

function canCancelExternalReleasedRequest(row: any) {
  return canReleaseAction.value && canCancelExternalExportRequestRelease(row)
}

function actionStillValid(row: any) {
  if (actionType.value === 'accept') return canAcceptRequest(row)
  if (actionType.value === 'reject') return canRejectRequest(row)
  if (actionType.value === 'release') return canReleaseRequest(row)
  if (actionType.value === 'external_release') return canExternalReleaseRequest(row)
  if (actionType.value === 'cancel_release') return canCancelReleasedRequest(row)
  if (actionType.value === 'cancel_external_release') return canCancelExternalReleasedRequest(row)
  return false
}

function normalizeCode(value: any) {
  return String(value || '').trim().toUpperCase()
}

function findProductByCode(code: any) {
  const wanted = normalizeCode(code)
  return products.value.find(product => normalizeCode(product.product_code) === wanted || normalizeCode((product as any).code) === wanted)
}

function findWarehouse(id: string) {
  return warehouses.value.find(warehouse => warehouse.id === id)
}

function openDetail(row: any) {
  selectedRequest.value = row
  showDetailModal.value = true
}

function openAction(row: any, type: 'accept' | 'reject' | 'release' | 'external_release' | 'cancel_release' | 'cancel_external_release') {
  if (type === 'accept' && !canAcceptRequest(row)) return showToast('Yêu cầu này không còn ở trạng thái có thể tiếp nhận.', 'error')
  if (type === 'reject' && !canRejectRequest(row)) return showToast('Yêu cầu này không thể từ chối.', 'error')
  if (type === 'release' && !canReleaseRequest(row)) return showToast('Yêu cầu phải được tiếp nhận trước khi cho xuất kho.', 'error')
  if (type === 'external_release' && !canExternalReleaseRequest(row)) return showToast('Yêu cầu này không còn ở trạng thái có thể xác nhận đã xuất ngoài hệ thống.', 'error')
  if (type === 'cancel_release' && !canCancelReleasedRequest(row)) return showToast('Yêu cầu không có phiếu xuất đang hoạt động để hủy.', 'error')
  if (type === 'cancel_external_release' && !canCancelExternalReleasedRequest(row)) return showToast('Yêu cầu không có phiếu xuất ngoài hệ thống đang hoạt động để hủy.', 'error')
  actionRequest.value = row
  actionType.value = type
  Object.assign(actionForm, {
    note: '',
    export_date: row.export_date || todayKey()
  })
  releaseLines.value = type === 'release'
    ? requestLineProgress(row).map((line: any) => ({
        ...line,
        from_warehouse_id: '',
      }))
    : []
  releaseWarehouseIds.value = {}
  showActionModal.value = true
}

const actionTitle = computed(() => {
  if (actionType.value === 'accept') return 'Tiếp nhận yêu cầu xuất kho'
  if (actionType.value === 'reject') return 'Từ chối yêu cầu xuất kho'
  if (actionType.value === 'release') return 'Cho xuất kho'
  if (actionType.value === 'external_release') return 'Xác nhận đã xuất ngoài hệ thống'
  if (actionType.value === 'cancel_release') return 'Hủy xuất và hoàn tồn'
  if (actionType.value === 'cancel_external_release') return 'Hủy xác nhận xuất ngoài hệ thống'
  return 'Xử lý yêu cầu xuất kho'
})

const actionSaveLabel = computed(() => {
  if (actionType.value === 'accept') return 'Xác nhận tiếp nhận'
  if (actionType.value === 'reject') return 'Xác nhận từ chối'
  if (actionType.value === 'release') return 'Cho xuất kho'
  if (actionType.value === 'external_release') return 'Xác nhận đã xuất'
  if (actionType.value === 'cancel_release') return 'Hủy xuất và hoàn tồn'
  if (actionType.value === 'cancel_external_release') return 'Hủy xác nhận xuất ngoài'
  return 'Xác nhận'
})

const actionLines = computed(() => {
  if (actionType.value === 'release') return releaseLines.value
  return actionRequest.value ? requestLineProgress(actionRequest.value) : []
})

function releaseWarehouseId(line: any, index: number) {
  return String(releaseWarehouseIds.value[index] || line?.from_warehouse_id || '').trim()
}

function onReleaseWarehouseChanged(index: number, value: string) {
  releaseWarehouseIds.value[index] = value
  if (releaseLines.value[index]) releaseLines.value[index].from_warehouse_id = value
}

function saleNotificationRecipients(row: any) {
  return resolveSaleNotificationRecipients({
    request: row,
    actorEmail: appUser.value?.email || '',
  })
}

function addSaleNotifications(batch: any, row: any, input: { type: string; title: string; message: string }, operation: string) {
  const recipients = saleNotificationRecipients(row)
  recipients.forEach(toEmail => {
    const notificationId = notificationDocumentId(operation, String(row.id || row.request_id || ''), toEmail)
    batch.set(
      doc(db, 'notifications', notificationId),
      buildNotificationPayload({
        type: input.type,
        title: input.title,
        message: input.message,
        route: '/export-requests',
        entity_collection: 'order_export_requests',
        entity_id: row.id,
        entity_code: row.request_id || row.id,
        created_by: appUser.value?.email || '',
        to_email: toEmail,
        metadata: {
          order_id: row.order_id || '',
          order_code: row.order_code || '',
          customer_name: row.customer_name || '',
        },
      }),
    )
  })
  return recipients.length
}

function requestsAfterTransition(row: any, patch: Record<string, any>) {
  const orderId = String(row?.order_id || '').trim()
  const targetId = String(row?.id || row?.request_id || '').trim()
  let targetFound = false
  const nextRequests = rows.value
    .filter(request => String(request?.order_id || '').trim() === orderId && isActive(request))
    .map(request => {
      const requestId = String(request?.id || request?.request_id || '').trim()
      if (!targetId || requestId !== targetId) return request
      targetFound = true
      return { ...request, ...patch }
    })
  if (!targetFound) nextRequests.push({ ...row, ...patch })
  return nextRequests
}

async function reconcileOrderSummary(row: any, patch: Record<string, any>, operation: string) {
  const orderId = String(row?.order_id || '').trim()
  if (!orderId) return true
  let lastError: unknown = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const latestSnapshot = await getDocs(query(
        collection(db, 'order_export_requests'),
        where('order_id', '==', orderId),
      ))
      const latestRequests = latestSnapshot.docs
        .map(snapshot => ({ ...snapshot.data(), id: snapshot.id }))
        .filter(isActive)
      const targetId = String(row?.id || row?.request_id || '').trim()
      const reconciledRequests = latestRequests.map(request => (
        String(request.id || request.request_id || '').trim() === targetId
          ? { ...request, ...patch }
          : request
      ))
      const summaryPatch = orderWarehouseFulfillmentSummaryFromRequests(
        reconciledRequests.length ? reconciledRequests : requestsAfterTransition(row, patch),
      )
      await updateDoc(doc(db, 'orders', orderId), {
        ...summaryPatch,
        updated_at: serverTimestamp(),
      })
      invalidateScopedCache('orders')
      return true
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 250))
    }
  }
  reportFirebaseError(lastError, 'Nghiệp vụ kho đã thành công nhưng chưa đồng bộ được trạng thái tổng của đơn.', {
    module: 'warehouse_export_requests',
    operation: `${operation}_order_summary`,
    stage: 'post_commit_reconcile',
    record: orderId,
    status: String(patch.status || row.status || ''),
    actionPermissions: ['export_requests.accept', 'export_requests.reject', 'export_requests.release', 'export_requests.process'],
    context: { request_id: row.id || '', lifecycle_status: patch.lifecycle_status || '', retry_count: 3 },
  })
  return false
}

async function sendSaleNotificationAfterCommit(row: any, input: { type: string; title: string; message: string }, operation: string) {
  const batch = writeBatch(db)
  const operationKey = String(row.last_operation_id || row.operation_id || operation)
  const notificationCount = addSaleNotifications(batch, row, input, operationKey)
  if (!notificationCount) return 0
  try {
    await batch.commit()
    return notificationCount
  } catch (error) {
    reportFirebaseError(error, 'Nghiệp vụ kho đã thành công nhưng chưa gửi được thông báo cho Sale.', {
      module: 'warehouse_export_requests',
      operation: `${operation}_notification`,
      stage: 'post_commit_notification',
      record: row.id,
      status: row.status,
      context: { order_id: row.order_id || '', lifecycle_status: row.lifecycle_status || '' },
    })
    return 0
  }
}

async function transitionRequest(
  row: any,
  type: 'accept' | 'reject',
  note: string,
  notification: { type: string; title: string; message: string },
) {
  const actor = String(appUser.value?.email || '').trim().toLowerCase()
  const expectedRevision = Math.max(0, Math.floor(toNumber(row.revision)))
  const operationId = `export_request_${type}:${row.id}:${expectedRevision}`
  const requestRef = doc(db, 'order_export_requests', row.id)
  let committedRequest: any = null
  let alreadyProcessed = false

  await runTransaction(db, async tx => {
    const snapshot = await tx.get(requestRef)
    if (!snapshot.exists()) throw new Error('Yêu cầu xuất kho không còn tồn tại.')
    const current = { ...snapshot.data(), id: snapshot.id }
    const targetStatus = type === 'accept' ? 'da_tiep_nhan' : 'tu_choi'
    const targetLifecycle = type === 'accept' ? 'accepted' : 'rejected'
    if (String(current.status || '') === targetStatus && String(current.lifecycle_status || '') === targetLifecycle) {
      alreadyProcessed = true
      committedRequest = current
      return
    }
    if (Math.max(0, Math.floor(toNumber(current.revision))) !== expectedRevision) {
      throw new Error('Yêu cầu vừa được cập nhật ở phiên khác. Vui lòng tải lại trước khi thao tác.')
    }
    if (type === 'accept' ? !canAcceptExportRequest(current) : !canRejectExportRequest(current)) {
      throw new Error(type === 'accept'
        ? 'Yêu cầu không còn ở trạng thái có thể tiếp nhận.'
        : 'Yêu cầu không còn ở trạng thái có thể từ chối.')
    }
    const timelineJson = appendTimeline(
      current,
      type,
      type === 'accept' ? 'Kho đã tiếp nhận' : 'Kho đã từ chối',
      targetStatus,
      note,
    )
    const lifecyclePatch = type === 'accept'
      ? buildAcceptedRequestPatch({ request: current, actor, note, operationId, timelineJson })
      : buildRejectedRequestPatch({ request: current, actor, reason: note, operationId, timelineJson })
    const patch = {
      ...lifecyclePatch,
      warehouse_handled_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    }
    tx.update(requestRef, patch)
    tx.set(doc(db, 'warehouse_operations', operationId), warehouseOperationPayload({
      operationId,
      action: type,
      requestId: current.id,
      actor,
      targetRevision: lifecyclePatch.revision,
    }))
    tx.set(doc(collection(db, 'activity_logs')), {
      module: 'order_export_requests',
      action: type,
      item_code: current.request_id || current.id,
      item_name: `${current.order_code || ''} - ${current.customer_name || ''}`,
      changed_by: actor,
      after_json: JSON.stringify({
        id: current.id,
        request_id: current.request_id || '',
        status: targetStatus,
        lifecycle_status: targetLifecycle,
        revision: lifecyclePatch.revision,
        note,
        operation_id: operationId,
      }),
      created_at: serverTimestamp(),
      active: true,
      deleted: false,
    })
    committedRequest = { ...current, ...lifecyclePatch }
  })

  invalidateScopedCache('order_export_requests')
  invalidateScopedCache('activity_logs')
  const notificationCount = alreadyProcessed
    ? 0
    : await sendSaleNotificationAfterCommit(committedRequest, notification, type)
  const summarySynced = await reconcileOrderSummary(committedRequest || row, committedRequest || {}, type)
  return { notificationCount, summarySynced, alreadyProcessed }
}

async function submitAccept(row: any) {
  const result = await transitionRequest(
    row,
    'accept',
    actionForm.note,
    {
      type: 'warehouse_export_request_accepted',
      title: 'Kho đã tiếp nhận yêu cầu xuất',
      message: `${row.request_id || row.id} · Đơn ${row.order_code || '-'} đã được Kho tiếp nhận.`,
    },
  )
  showToast(
    result.notificationCount
      ? 'Đã tiếp nhận yêu cầu xuất kho.'
      : 'Đã tiếp nhận yêu cầu nhưng không xác định được Sale để gửi thông báo.',
    result.notificationCount ? 'success' : 'info',
  )
}

async function submitReject(row: any) {
  if (!String(actionForm.note || '').trim()) return showToast('Vui lòng nhập lý do từ chối.', 'error')
  const confirmed = await askConfirm({
    title: 'Từ chối yêu cầu xuất kho',
    message: `Bạn chắc chắn muốn từ chối yêu cầu ${row.request_id}?`,
    confirmLabel: 'Từ chối'
  })
  if (!confirmed) return
  const result = await transitionRequest(
    row,
    'reject',
    actionForm.note,
    {
      type: 'warehouse_export_request_rejected',
      title: 'Kho đã từ chối yêu cầu xuất',
      message: `${row.request_id || row.id} · Lý do: ${String(actionForm.note || '').trim()}`,
    },
  )
  showToast(
    result.notificationCount
      ? 'Đã từ chối yêu cầu xuất kho.'
      : 'Đã từ chối yêu cầu nhưng không xác định được Sale để gửi thông báo.',
    result.notificationCount ? 'success' : 'info',
  )
}

async function submitRelease(row: any) {
  const lines = releaseLines.value
    .map((line: any, index: number) => ({ ...line, __release_index: index }))
    .filter((line: any) => toNumber(line.requested_qty) > 0)
  if (!lines.length) return showToast('Yêu cầu xuất kho chưa có dòng hàng hợp lệ.', 'error')
  if (lines.length > MAX_WAREHOUSE_RELEASE_LINES) {
    return showToast(`Một lần xuất kho hỗ trợ tối đa ${MAX_WAREHOUSE_RELEASE_LINES} dòng để bảo đảm giới hạn kiểm tra Firestore Rules. Vui lòng tách yêu cầu.`, 'error')
  }

  const missingSource = lines.filter((line: any) => !String(line.order_item_id || line.source_order_item_id || '').trim())
  if (missingSource.length) return showToast('Yêu cầu thiếu tham chiếu dòng đơn hàng nguồn. Sale cần mở và lưu lại yêu cầu trước khi xuất.', 'error')

  const missing = lines.filter((line: any) => !findProductByCode(line.product_code))
  if (missing.length) {
    return showToast(`Chưa tìm thấy sản phẩm cho mã: ${missing.map((line: any) => line.product_code).join(', ')}. Kiểm tra quyền truy cập và mã sản phẩm.`, 'error')
  }
  const missingWarehouse = lines.filter((line: any) => !releaseWarehouseId(line, line.__release_index))
  if (missingWarehouse.length) {
    return showToast(
      `Vui lòng chọn kho xuất cho dòng ${missingWarehouse.map((line: any) => line.__release_index + 1).join(', ')}.`,
      'error',
    )
  }
  const missingWarehouseDocs = lines.filter((line: any) => !findWarehouse(releaseWarehouseId(line, line.__release_index)))
  if (missingWarehouseDocs.length) {
    return showToast(
      `Kho xuất dòng ${missingWarehouseDocs.map((line: any) => line.__release_index + 1).join(', ')} không còn trong danh mục kho. Vui lòng tải lại trang và chọn lại.`,
      'error',
    )
  }

  const result = await processExportRequestToExportOrder({
    request: row,
    customer_name: row.customer_name,
    export_date: actionForm.export_date,
    note: actionForm.note,
    timeline: timeline(row),
    expected_revision: toNumber(row.revision),
    lines: lines.map((line: any) => {
      const warehouseId = releaseWarehouseId(line, line.__release_index)
      const fromWarehouse = findWarehouse(warehouseId)
      return {
        source_order_id: row.order_id,
        source_order_item_id: String(line.order_item_id || line.source_order_item_id || '').trim(),
        product: findProductByCode(line.product_code),
        fromWarehouse,
        warehouse: fromWarehouse,
        from_warehouse_id: warehouseId,
        warehouse_id: warehouseId,
        logo: line.logo,
        quantity: toNumber(line.requested_qty),
        unit: line.unit,
        note: line.note || ''
      }
    })
  })
  await reconcileOrderSummary(row, {
    status: 'da_xuat',
    lifecycle_status: 'released',
    revision: toNumber(row.revision) + 1,
  }, 'release')
  const notificationCount = result.alreadyProcessed ? 0 : await sendSaleNotificationAfterCommit(
    {
      ...row,
      status: 'da_xuat',
      lifecycle_status: 'released',
      warehouse_handled_by: appUser.value?.email || '',
      operation_id: result.operationId || `export_request_release:${row.id}:${toNumber(row.revision)}`,
    },
    {
      type: 'warehouse_export_request_released',
      title: 'Kho đã cho xuất hàng',
      message: `${row.request_id || row.id} · Đã tạo phiếu xuất ${result.code}.`,
    },
    'release',
  )
  if (result.alreadyProcessed) {
    showToast('Yêu cầu đã được xử lý trước đó.', 'info')
  } else if (!notificationCount) {
    showToast(`Đã cho xuất kho và tạo phiếu ${result.code}, nhưng không xác định được Sale để gửi thông báo.`, 'info')
  } else {
    showToast(`Đã cho xuất kho và tạo phiếu ${result.code}.`, 'success')
  }
}

async function submitExternalRelease(row: any) {
  const note = String(actionForm.note || '').trim()
  const exportDate = String(actionForm.export_date || '').trim()
  if (!exportDate) return showToast('Vui lòng chọn ngày đã xuất thực tế.', 'error')
  if (!note) return showToast('Vui lòng nhập lý do hoặc ghi chú xác nhận.', 'error')

  const lines = requestLineProgress(row).filter((line: any) => toNumber(line.requested_qty) > 0)
  if (!lines.length) return showToast('Yêu cầu xuất kho chưa có dòng hàng hợp lệ.', 'error')
  if (lines.length > MAX_WAREHOUSE_RELEASE_LINES) {
    return showToast(`Một lần xuất ngoài hỗ trợ tối đa ${MAX_WAREHOUSE_RELEASE_LINES} dòng. Vui lòng tách yêu cầu trước khi xác nhận.`, 'error')
  }

  const confirmed = await askConfirm({
    title: 'Xác nhận đã xuất ngoài hệ thống',
    message: `Yêu cầu ${row.request_id || row.id} sẽ chuyển thành Đã xuất kho và tạo phiếu ghi nhận trên trang Xuất kho. Phiếu này KHÔNG ghi biến động và KHÔNG trừ tồn. Bạn chắc chắn?`,
    confirmLabel: 'Xác nhận đã xuất',
  })
  if (!confirmed) return

  const actor = String(appUser.value?.email || '').trim().toLowerCase()
  if (!actor) throw new Error('Không xác định được tài khoản đang xác nhận xuất ngoài hệ thống.')
  const expectedRevision = Math.max(0, Math.floor(toNumber(row.revision)))
  const releaseSequence = Math.max(0, Math.floor(toNumber(row.release_sequence))) + 1
  const operationId = `export_request_external:${row.id}:${releaseSequence}`
  const exportOrderId = requestExternalExportOrderId(row.id, releaseSequence)
  const safeRequestCode = String(row.request_id || row.id || 'YCXK')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
  const exportCode = `PXK-NGOAI-${safeRequestCode}${releaseSequence > 1 ? `-${releaseSequence}` : ''}`
  const actualSummaryJson = JSON.stringify(lines.map((line: any) => ({
    source_order_id: row.order_id || '',
    source_order_item_id: String(line.order_item_id || line.source_order_item_id || '').trim(),
    product_id: line.product_id || '',
    product_code: line.product_code || '',
    logo: line.logo || '',
    quantity: toNumber(line.requested_qty),
    unit: line.unit || '',
    release_mode: 'external_no_inventory',
  })))
  const exportItemPayloads = lines.map((line: any, index: number) => {
    const product = findProductByCode(line.product_code)
    const logo = String(line.logo || '').trim()
    const sourceItemId = String(line.order_item_id || line.source_order_item_id || '').trim()
    const itemSuffix = (sourceItemId || String(index + 1)).replace(/[^A-Za-z0-9._-]+/g, '_')
    return {
      id: `${exportOrderId}__${itemSuffix}__${index + 1}`,
      export_order_id: exportOrderId,
      source_order_id: row.order_id || '',
      source_order_item_id: sourceItemId,
      product_id: line.product_id || product?.id || '',
      product_code: line.product_code || product?.product_code || '',
      product_name: line.product_name || product?.product_name || '',
      from_warehouse_id: '',
      from_warehouse_name: 'Xuất ngoài hệ thống',
      to_warehouse_id: '',
      to_warehouse_name: '',
      destination_name: row.customer_name || '',
      logo,
      source_logo: logo,
      target_logo: logo,
      quantity: toNumber(line.requested_qty),
      unit: line.unit || product?.unit || '',
      note: line.note || note,
      status: 'completed',
      lifecycle_status: 'released_external',
      release_mode: 'external_no_inventory',
      affects_inventory: false,
      active: true,
      deleted: false,
      created_by: actor,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      operation_id: operationId,
      last_operation_id: operationId,
      revision: 1,
      source: 'kingcup_firestore',
    }
  })

  const requestRef = doc(db, 'order_export_requests', row.id)
  const exportRef = doc(db, 'export_orders', exportOrderId)
  let committedRequest: any = null
  let alreadyProcessed = false
  await runTransaction(db, async tx => {
    const requestSnapshot = await tx.get(requestRef)
    const exportSnapshot = await tx.get(exportRef)
    if (!requestSnapshot.exists()) throw new Error('Yêu cầu xuất kho không còn tồn tại.')
    const current = { ...requestSnapshot.data(), id: requestSnapshot.id }
    if (String(current.lifecycle_status || '') === 'released_external') {
      if (String(current.external_export_order_id || '') !== exportOrderId || !exportSnapshot.exists()) {
        throw new Error('Yêu cầu đã liên kết với một phiếu xuất ngoài khác. Vui lòng tải lại dữ liệu.')
      }
      alreadyProcessed = true
      committedRequest = current
      return
    }
    const currentRevision = Math.max(0, Math.floor(toNumber(current.revision)))
    if (currentRevision !== expectedRevision) {
      throw new Error('Yêu cầu vừa được cập nhật ở phiên khác. Vui lòng tải lại trước khi xác nhận xuất.')
    }
    if (!canReleaseExportRequestExternally(current)) {
      throw new Error('Yêu cầu không còn ở trạng thái có thể xác nhận xuất ngoài hệ thống.')
    }
    const currentSequence = Math.max(0, Math.floor(toNumber(current.release_sequence))) + 1
    if (currentSequence !== releaseSequence || requestExternalExportOrderId(current.id, currentSequence) !== exportOrderId) {
      throw new Error('Vòng đời yêu cầu xuất đã thay đổi. Vui lòng tải lại dữ liệu.')
    }
    if (exportSnapshot.exists()) throw new Error('Phiếu ghi nhận của lần xuất này đã tồn tại.')

    const timelineJson = appendTimeline(current, 'external_release', 'Kho xác nhận đã xuất ngoài hệ thống', 'da_xuat', note)
    const externalPatch = buildExternalReleasedRequestPatch({
      request: current,
      actor,
      exportDate,
      note,
      operationId,
      timelineJson,
      actualSummaryJson,
    })
    const exportOrderPayload = {
      id: exportOrderId,
      code: exportCode,
      export_code: exportCode,
      export_date: exportDate,
      destination_type: 'customer',
      source_order_id: current.order_id || '',
      source_order_code: current.order_code || '',
      source_request_id: current.id,
      sync_source: 'kingcup_firestore:external_no_inventory',
      customer_name: current.customer_name || '',
      destination_name: current.customer_name || '',
      to_warehouse_id: '',
      to_warehouse_name: '',
      note,
      status: 'completed',
      lifecycle_status: 'released_external',
      release_mode: 'external_no_inventory',
      affects_inventory: false,
      stock_movement_ids: [],
      item_count: exportItemPayloads.length,
      manifest_item_ids: exportItemPayloads.map(item => item.id),
      release_sequence: releaseSequence,
      source_request_revision: currentRevision,
      request_operation_id: operationId,
      active: true,
      deleted: false,
      created_by: actor,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      operation_id: operationId,
      last_operation_id: operationId,
      revision: 1,
      source: 'kingcup_firestore',
    }
    tx.set(exportRef, exportOrderPayload)
    exportItemPayloads.forEach(item => tx.set(doc(db, 'export_order_items', item.id), item))
    tx.update(requestRef, {
      ...externalPatch,
      release_sequence: releaseSequence,
      external_export_order_id: exportOrderId,
      external_export_code: exportCode,
      warehouse_handled_at: serverTimestamp(),
      external_exported_at: serverTimestamp(),
      exported_at: serverTimestamp(),
      actual_exported_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    })
    tx.set(doc(db, 'warehouse_operations', operationId), warehouseOperationPayload({
      operationId,
      action: 'external_release',
      requestId: current.id,
      actor,
      targetRevision: externalPatch.revision,
    }))
    tx.set(doc(collection(db, 'activity_logs')), {
      module: 'order_export_requests',
      action: 'external_release',
      item_code: current.request_id || current.id,
      item_name: `${current.order_code || ''} - ${current.customer_name || ''}`,
      changed_by: actor,
      after_json: JSON.stringify({
        id: current.id,
        status: 'da_xuat',
        lifecycle_status: 'released_external',
        external_export_order_id: exportOrderId,
        external_export_code: exportCode,
        operation_id: operationId,
      }),
      created_at: serverTimestamp(),
      active: true,
      deleted: false,
    })
    committedRequest = {
      ...current,
      ...externalPatch,
      release_sequence: releaseSequence,
      external_export_order_id: exportOrderId,
      external_export_code: exportCode,
    }
  })

  invalidateScopedCache('order_export_requests')
  invalidateScopedCache('export_orders')
  invalidateScopedCache('export_order_items')
  invalidateScopedCache('activity_logs')
  const notificationCount = alreadyProcessed ? 0 : await sendSaleNotificationAfterCommit(
    committedRequest,
    {
      type: 'warehouse_export_request_released',
      title: 'Kho xác nhận đơn đã xuất ngoài hệ thống',
      message: `${row.request_id || row.id} · Đơn ${row.order_code || '-'} đã xuất thực tế ngoài hệ thống, đã tạo phiếu ${exportCode} và không trừ tồn kho.`,
    },
    'external_release',
  )
  await reconcileOrderSummary(committedRequest || row, committedRequest || { status: 'da_xuat' }, 'external_release')
  showToast(
    notificationCount
      ? `Đã xác nhận xuất ngoài hệ thống và tạo phiếu ghi nhận ${exportCode}.`
      : `Đã tạo phiếu ghi nhận ${exportCode}, nhưng không xác định được Sale để gửi thông báo.`,
    notificationCount ? 'success' : 'info',
  )
}

async function submitCancelExternalRelease(row: any) {
  const reason = String(actionForm.note || '').trim()
  if (!reason) return showToast('Vui lòng nhập lý do hủy xác nhận xuất ngoài.', 'error')
  const exportOrderId = String(row.external_export_order_id || '').trim()
  if (!exportOrderId) return showToast('Yêu cầu không còn liên kết phiếu xuất ngoài để hủy.', 'error')
  const confirmed = await askConfirm({
    title: 'Hủy xác nhận xuất ngoài hệ thống',
    message: `Phiếu ${row.external_export_code || exportOrderId} sẽ bị hủy và yêu cầu ${row.request_id || row.id} được mở lại. Thao tác này không thay đổi tồn kho. Bạn chắc chắn?`,
    confirmLabel: 'Hủy xác nhận xuất ngoài',
  })
  if (!confirmed) return

  const actor = String(appUser.value?.email || '').trim().toLowerCase()
  if (!actor) throw new Error('Không xác định được tài khoản đang hủy xác nhận xuất ngoài.')
  const expectedRevision = Math.max(0, Math.floor(toNumber(row.revision)))
  const operationId = `export_request_external_cancel:${row.id}:${expectedRevision}`
  const exportRef = doc(db, 'export_orders', exportOrderId)
  const requestRef = doc(db, 'order_export_requests', row.id)
  const itemQuery = query(collection(db, 'export_order_items'), where('export_order_id', '==', exportOrderId))
  const itemRows = (await getDocs(itemQuery)).docs.map(snapshot => ({
    ref: snapshot.ref,
    id: snapshot.id,
  }))
  if (!itemRows.length) throw new Error('Phiếu xuất ngoài không có chi tiết hợp lệ để hủy an toàn.')

  let committedRequest: any = null
  let exportCode = String(row.external_export_code || exportOrderId)
  await runTransaction(db, async tx => {
    const requestSnapshot = await tx.get(requestRef)
    const exportSnapshot = await tx.get(exportRef)
    const itemSnapshots = []
    for (const itemRow of itemRows) itemSnapshots.push(await tx.get(itemRow.ref))
    if (!requestSnapshot.exists()) throw new Error('Yêu cầu xuất kho không còn tồn tại.')
    if (!exportSnapshot.exists()) throw new Error('Phiếu xuất ngoài liên kết không còn tồn tại.')
    const current = { ...requestSnapshot.data(), id: requestSnapshot.id }
    const currentExport = { ...exportSnapshot.data(), id: exportSnapshot.id }
    if (Math.max(0, Math.floor(toNumber(current.revision))) !== expectedRevision) {
      throw new Error('Yêu cầu vừa được cập nhật ở phiên khác. Vui lòng tải lại trước khi hủy.')
    }
    if (!canCancelExternalExportRequestRelease(current)) {
      throw new Error('Yêu cầu không còn ở trạng thái có thể hủy xác nhận xuất ngoài.')
    }
    const linkError = externalExportLifecycleLinkError(current, currentExport)
    if (linkError) throw new Error(linkError)
    if (itemSnapshots.some(snapshot => !snapshot.exists())) {
      throw new Error('Chi tiết phiếu xuất ngoài vừa thay đổi. Vui lòng tải lại dữ liệu.')
    }
    if (!externalExportManifestCountMatches(currentExport, itemSnapshots.length)) {
      throw new Error('Số dòng phiếu xuất ngoài không khớp manifest đã khóa. Không thể hủy an toàn.')
    }
    exportCode = String(currentExport.code || currentExport.export_code || exportCode)
    const timelineJson = appendTimeline(
      current,
      'external_release_cancel',
      'Kho hủy xác nhận xuất ngoài hệ thống',
      'da_tiep_nhan',
      reason,
    )
    const lifecyclePatch = buildCancelledExternalReleaseRequestPatch({
      request: current,
      exportOrder: currentExport,
      actor,
      reason,
      operationId,
      timelineJson,
    })
    tx.update(exportRef, {
      lifecycle_status: 'cancelled',
      deleted: true,
      active: false,
      status: 'cancelled',
      deleted_at: serverTimestamp(),
      deleted_by: actor,
      deleted_reason: reason,
      cancelled_at: serverTimestamp(),
      cancelled_by: actor,
      cancel_reason: reason,
      updated_by: actor,
      operation_id: operationId,
      last_operation_id: operationId,
      revision: Math.max(0, Math.floor(toNumber(currentExport.revision))) + 1,
      updated_at: serverTimestamp(),
    })
    itemSnapshots.forEach(snapshot => {
      const item = snapshot.data() || {}
      if (String(item.export_order_id || '') !== exportOrderId || item.deleted === true || item.active === false) {
        throw new Error(`Chi tiết phiếu xuất ngoài ${snapshot.id} không còn hợp lệ để hủy.`)
      }
      tx.update(snapshot.ref, {
        deleted: true,
        active: false,
        status: 'cancelled',
        deleted_at: serverTimestamp(),
        deleted_by: actor,
        deleted_reason: reason,
        updated_by: actor,
        operation_id: operationId,
        last_operation_id: operationId,
        revision: Math.max(0, Math.floor(toNumber(item.revision))) + 1,
        updated_at: serverTimestamp(),
      })
    })
    tx.update(requestRef, {
      ...lifecyclePatch,
      warehouse_handled_at: serverTimestamp(),
      last_cancelled_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    })
    tx.set(doc(db, 'warehouse_operations', operationId), warehouseOperationPayload({
      operationId,
      action: 'cancel_external_release',
      requestId: current.id,
      actor,
      targetRevision: lifecyclePatch.revision,
    }))
    tx.set(doc(collection(db, 'activity_logs')), {
      module: 'order_export_requests',
      action: 'external_release_cancel',
      item_code: current.request_id || current.id,
      item_name: `${current.order_code || ''} - ${current.customer_name || ''}`,
      changed_by: actor,
      after_json: JSON.stringify({
        id: current.id,
        status: 'da_tiep_nhan',
        lifecycle_status: 'external_release_cancelled',
        cancelled_export_order_id: exportOrderId,
        operation_id: operationId,
        reason,
      }),
      created_at: serverTimestamp(),
      active: true,
      deleted: false,
    })
    committedRequest = { ...current, ...lifecyclePatch }
  })

  invalidateScopedCache('order_export_requests')
  invalidateScopedCache('export_orders')
  invalidateScopedCache('export_order_items')
  invalidateScopedCache('activity_logs')
  const notificationCount = await sendSaleNotificationAfterCommit(
    committedRequest,
    {
      type: 'warehouse_export_request_cancelled',
      title: 'Kho đã hủy xác nhận xuất ngoài hệ thống',
      message: `${row.request_id || row.id} · Phiếu ${exportCode} đã được hủy. Lý do: ${reason}`,
    },
    'cancel_external_release',
  )
  await reconcileOrderSummary(committedRequest || row, committedRequest || { status: 'da_tiep_nhan' }, 'cancel_external_release')
  showToast(
    notificationCount
      ? `Đã hủy phiếu ${exportCode} và mở lại yêu cầu; tồn kho không thay đổi.`
      : `Đã hủy phiếu ${exportCode}; tồn kho không thay đổi nhưng chưa gửi được thông báo cho Sale.`,
    notificationCount ? 'success' : 'info',
  )
}

async function submitCancelRelease(row: any) {
  const reason = String(actionForm.note || '').trim()
  if (!reason) return showToast('Vui lòng nhập lý do hủy xuất kho.', 'error')
  const confirmed = await askConfirm({
    title: 'Hủy xuất và hoàn tồn',
    message: `Hủy phiếu ${row.warehouse_export_code || row.export_order_id || '-'} sẽ hoàn tồn và mở lại yêu cầu ${row.request_id || row.id}. Bạn chắc chắn?`,
    confirmLabel: 'Hủy xuất và hoàn tồn'
  })
  if (!confirmed) return
  const result = await cancelExportRequestRelease({
    request: row,
    reason,
    timeline: timeline(row),
    operation_id: `export_request_cancel:${row.id}:${toNumber(row.revision)}`,
    expected_request_revision: toNumber(row.revision),
  })
  await reconcileOrderSummary(row, {
    status: 'da_tiep_nhan',
    lifecycle_status: 'release_cancelled',
    revision: toNumber(row.revision) + 1,
  }, 'cancel_release')
  const notificationCount = result.alreadyProcessed ? 0 : await sendSaleNotificationAfterCommit(
    {
      ...row,
      status: 'da_tiep_nhan',
      lifecycle_status: 'release_cancelled',
      warehouse_handled_by: appUser.value?.email || '',
      operation_id: result.operationId || `export_request_cancel:${row.id}:${toNumber(row.revision)}`,
    },
    {
      type: 'warehouse_export_request_cancelled',
      title: 'Kho đã hủy xuất và hoàn tồn',
      message: `${row.request_id || row.id} · Phiếu ${result.code} đã được hủy. Lý do: ${reason}`,
    },
    'cancel_release',
  )
  showToast(
    notificationCount
      ? `Đã hủy phiếu ${result.code}, hoàn tồn và mở lại yêu cầu.`
      : `Đã hủy phiếu ${result.code} và hoàn tồn, nhưng không xác định được Sale để gửi thông báo.`,
    notificationCount ? 'success' : 'info',
  )
}

async function submitAction() {
  const row = actionRequest.value
  if (!row || !actionType.value) return
  saving.value = true
  try {
    if (actionType.value === 'accept') await submitAccept(row)
    if (actionType.value === 'reject') await submitReject(row)
    if (actionType.value === 'release') await submitRelease(row)
    if (actionType.value === 'external_release') await submitExternalRelease(row)
    if (actionType.value === 'cancel_release') await submitCancelRelease(row)
    if (actionType.value === 'cancel_external_release') await submitCancelExternalRelease(row)
    showActionModal.value = false
  } catch (error) {
    const row = actionRequest.value
    showToast(reportFirebaseError(error, 'Không xử lý được yêu cầu xuất kho.', {
      module: 'warehouse_export_requests',
      operation: actionType.value || 'unknown',
      stage: 'warehouse_lifecycle_transaction',
      record: row?.id || '',
      status: row?.status || '',
      actionPermission: actionType.value === 'accept'
        ? 'export_requests.accept'
        : actionType.value === 'reject'
          ? 'export_requests.reject'
          : 'export_requests.release',
      context: {
        order_id: row?.order_id || '',
        lifecycle_status: row?.lifecycle_status || '',
        release_mode: row?.release_mode || '',
        revision: toNumber(row?.revision),
        line_count: row ? requestLineProgress(row).length : 0,
        active_export_order_id: row?.active_export_order_id || '',
        external_export_order_id: row?.external_export_order_id || '',
      },
    }), 'error')
  } finally {
    saving.value = false
  }
}

function detailRequestLines(row: any) {
  return requestLineProgress(row)
}

function syncOpenRequestState(nextRows: any[]) {
  if (selectedRequest.value) {
    const fresh = nextRows.find(row => row.id === selectedRequest.value.id)
    if (fresh) selectedRequest.value = fresh
    else {
      selectedRequest.value = null
      showDetailModal.value = false
    }
  }

  if (!actionRequest.value) return
  const fresh = nextRows.find(row => row.id === actionRequest.value.id)
  if (!fresh) {
    actionRequest.value = null
    if (showActionModal.value && !saving.value) {
      showActionModal.value = false
      showToast('Yêu cầu đang xử lý không còn khả dụng.', 'info')
    }
    return
  }

  actionRequest.value = fresh
  if (showActionModal.value && !saving.value && !actionStillValid(fresh)) {
    showActionModal.value = false
    showToast('Yêu cầu vừa được tài khoản khác cập nhật nên thao tác này không còn hợp lệ.', 'info')
  }
}

function startRequestsListener() {
  stopRequestsListener?.()
  stopRequestsListener = null
  realtimeLoading.value = true
  stopRequestsListener = listenWarehouseExportRequests(
    nextRows => {
      syncOpenRequestState(nextRows)
      rows.value = nextRows
      realtimeLoading.value = false
      lastRealtimeError = ''
    },
    error => {
      realtimeLoading.value = false
      const message = reportFirebaseError(
        error,
        'Mất kết nối realtime với yêu cầu xuất kho.',
      )
      if (message !== lastRealtimeError) showToast(message, 'error')
      lastRealtimeError = message
    },
  )
}

async function loadRows(force = false) {
  supportingLoading.value = true
  try {
    const [productRows, warehouseRows] = await Promise.all([
      loadProducts(force),
      loadWarehouses(force)
    ])
    products.value = productRows
    warehouses.value = warehouseRows
    startRequestsListener()
  } catch (error) {
    realtimeLoading.value = false
    showToast(reportFirebaseError(error, 'Không tải được danh sách yêu cầu xuất kho cần xử lý.'), 'error')
  } finally {
    supportingLoading.value = false
  }
}

onMounted(() => loadRows())
onBeforeUnmount(() => {
  stopRequestsListener?.()
  stopRequestsListener = null
})
</script>

<template>
  <AppShell>
    <PageHeader title="Xử lý yêu cầu xuất kho" subtitle="Kho tiếp nhận, từ chối hoặc cho xuất các yêu cầu từ Sale/OrderKingcup">
      <button class="btn" @click="loadRows(true)">Làm mới</button>
    </PageHeader>

    <div class="summary-grid">
      <div class="summary-card"><label>Tổng yêu cầu</label><strong>{{ summary.total.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Chờ tiếp nhận</label><strong>{{ summary.waiting.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Đã tiếp nhận</label><strong>{{ summary.accepted.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Đã xuất kho</label><strong>{{ summary.exported.toLocaleString('vi-VN') }}</strong></div>
    </div>

    <div class="card" style="margin: 24px;">
      <div class="toolbar">
        <input v-model="search" class="input" style="max-width:420px" placeholder="Tìm mã yêu cầu, đơn hàng, khách hàng..." />
        <select v-model="statusFilter" class="input" style="max-width:220px">
          <option value="">Tất cả trạng thái</option>
          <option value="cho_xu_ly">Chờ xử lý</option>
          <option value="da_tiep_nhan">Đã tiếp nhận</option>
          <option value="da_xuat">Đã xuất kho</option>
          <option value="tu_choi">Từ chối</option>
          <option value="loi">Lỗi xử lý</option>
        </select>
        <select v-model="logoFilter" class="input" style="max-width:200px">
          <option value="">Tất cả logo</option>
          <option v-for="option in LOGO_FILTER_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
        <div class="filter-field" style="min-width:220px">
          <label class="filter-label" for="warehouse-request-from">Từ ngày giờ</label>
          <input id="warehouse-request-from" v-model="dateTimeFrom" class="input" type="datetime-local" />
        </div>
        <div class="filter-field" style="min-width:220px">
          <label class="filter-label" for="warehouse-request-to">Đến ngày giờ</label>
          <input id="warehouse-request-to" v-model="dateTimeTo" class="input" type="datetime-local" />
        </div>
        <button class="btn ghost" type="button" @click="resetFilters">Xóa lọc</button>
      </div>

      <LoadingState v-if="loading" />
      <div v-else-if="!canOpenPage" class="empty">Bạn không có quyền thực hiện thao tác này.</div>
      <div v-else class="table-wrap">
        <table style="min-width: 980px">
          <thead>
            <tr>
              <th>Mã YC</th><th>Đơn hàng</th><th>Khách hàng</th><th>Ngày yêu cầu</th><th>Người yêu cầu</th><th>Trạng thái</th><th>Phiếu kho</th><th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td><b>{{ row.request_id || row.id }}</b></td>
              <td>{{ row.order_code || '-' }}</td>
              <td>{{ row.customer_name || '-' }}</td>
              <td>{{ formatDateTime(row.requested_at || row.created_at) }}</td>
              <td>{{ row.requested_by || '-' }}</td>
              <td><span class="badge" :class="statusClass(row.status)">{{ statusLabel(row.status) }}</span></td>
              <td><template v-if="isExternalExportRequestRelease(row)"><span class="badge yellow">Xuất ngoài HT</span><div class="small subtle">{{ row.external_export_code || '-' }}</div></template><template v-else>{{ row.warehouse_export_code || '-' }}</template></td>
              <td>
                <div class="action-buttons">
                  <button class="btn-sm" @click="openDetail(row)">Xem</button>
                  <WarehousePrintMenu :request="row" />
                  <button v-if="canAcceptRequest(row)" class="btn-sm btn-view" @click="openAction(row, 'accept')">Tiếp nhận</button>
                  <button v-if="canReleaseRequest(row)" class="btn-sm btn-view" @click="openAction(row, 'release')">Cho xuất kho</button>
                  <button v-if="canExternalReleaseRequest(row)" class="btn-sm" @click="openAction(row, 'external_release')">Đã xuất ngoài HT</button>
                  <button v-if="canCancelReleasedRequest(row)" class="btn-sm btn-delete" @click="openAction(row, 'cancel_release')">Hủy xuất/Hoàn tồn</button>
                  <button v-if="canCancelExternalReleasedRequest(row)" class="btn-sm btn-delete" @click="openAction(row, 'cancel_external_release')">Hủy xuất ngoài</button>
                  <button v-if="canRejectRequest(row)" class="btn-sm btn-delete" @click="openAction(row, 'reject')">Từ chối</button>
                  <button v-if="!canAcceptRequest(row) && !canReleaseRequest(row) && !canExternalReleaseRequest(row) && !canCancelReleasedRequest(row) && !canCancelExternalReleasedRequest(row) && !canRejectRequest(row)" class="btn-sm" disabled>Khóa</button>
                </div>
              </td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="8" class="empty">Không có yêu cầu xuất kho phù hợp.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseModal v-if="showDetailModal && selectedRequest" title="Chi tiết yêu cầu xuất kho" size="xl" :show-footer="false" @close="showDetailModal=false">
      <div class="detail-grid">
        <div class="detail-item"><label>Mã yêu cầu</label><strong>{{ selectedRequest.request_id || selectedRequest.id }}</strong></div>
        <div class="detail-item"><label>Đơn hàng</label><strong>{{ selectedRequest.order_code || '-' }}</strong></div>
        <div class="detail-item"><label>Khách hàng</label><strong>{{ selectedRequest.customer_name || '-' }}</strong></div>
        <div class="detail-item"><label>Trạng thái</label><strong>{{ statusLabel(selectedRequest.status) }}</strong></div>
        <div class="detail-item"><label>Sale tạo yêu cầu</label><strong>{{ timelineActorText({ actor: selectedRequest.requested_by, actor_name: safeJsonParse(selectedRequest.payload_json, {}).requested_by_name || selectedRequest.sale_name }, selectedRequest) }}</strong></div>
        <div class="detail-item"><label>Ngày yêu cầu</label><strong>{{ formatDateTime(selectedRequest.requested_at || selectedRequest.created_at) }}</strong></div>
        <div class="detail-item"><label>Phiếu kho</label><strong>{{ isExternalExportRequestRelease(selectedRequest) ? (selectedRequest.external_export_code || 'Phiếu ghi nhận xuất ngoài HT') : (selectedRequest.warehouse_export_code || '-') }}</strong></div>
        <div class="detail-item"><label>Hình thức xuất</label><strong>{{ isExternalExportRequestRelease(selectedRequest) ? 'Xuất ngoài hệ thống - không trừ tồn' : 'Xuất kho chuẩn' }}</strong></div>
        <div v-if="isExternalExportRequestRelease(selectedRequest)" class="detail-item"><label>Ngày xuất thực tế</label><strong>{{ selectedRequest.external_export_date || '-' }}</strong></div>
        <div class="detail-item"><label>Ghi chú kho</label><strong>{{ selectedRequest.warehouse_note || '-' }}</strong></div>
        <div class="detail-item"><label>Lần xuất</label><strong>{{ selectedRequest.release_sequence || (selectedRequest.export_order_id ? 1 : 0) }}</strong></div>
        <div class="detail-item"><label>Phiếu đã hủy gần nhất</label><strong>{{ selectedRequest.last_cancelled_export_code || '-' }}</strong></div>
      </div>

      <h3>Sản phẩm yêu cầu</h3>
      <div class="table-wrap">
        <table style="min-width: 780px">
          <thead><tr><th>Sản phẩm</th><th>Logo</th><th>Đơn vị</th><th>SL yêu cầu</th><th>Đã xử lý</th><th>Đã xuất</th></tr></thead>
          <tbody>
            <tr v-for="(line,index) in detailRequestLines(selectedRequest)" :key="index">
              <td><b>{{ line.product_code }}</b><div class="small subtle">{{ line.product_name }}</div></td>
              <td>{{ line.logo || '-' }}</td>
              <td>{{ line.unit || '-' }}</td>
              <td>{{ line.requested_qty }}</td>
              <td>{{ line.processed_qty }}</td>
              <td>{{ line.exported_qty }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 v-if="timeline(selectedRequest).length">Timeline xử lý</h3>
      <div v-for="(step,index) in timeline(selectedRequest)" :key="index" class="detail-item" style="margin-bottom:8px">
        <strong>{{ timelineTitleText(step) }}</strong>
        <div class="small subtle">{{ formatDateTime(step.time) }} · {{ timelineActorText(step, selectedRequest) }}</div>
        <div v-if="timelineNoteText(step)">{{ timelineNoteText(step) }}</div>
      </div>
    </BaseModal>

    <BaseModal v-if="showActionModal && actionRequest" :title="actionTitle" size="lg" :loading="saving" :save-label="actionSaveLabel" @close="showActionModal=false" @save="submitAction">
      <div class="detail-grid">
        <div class="detail-item"><label>Mã yêu cầu</label><strong>{{ actionRequest.request_id }}</strong></div>
        <div class="detail-item"><label>Đơn hàng</label><strong>{{ actionRequest.order_code }}</strong></div>
        <div class="detail-item"><label>Khách hàng</label><strong>{{ actionRequest.customer_name || '-' }}</strong></div>
        <div class="detail-item"><label>Trạng thái</label><strong>{{ statusLabel(actionRequest.status) }}</strong></div>
      </div>

      <div v-if="actionType === 'release' || actionType === 'external_release'" class="form-grid">
        <div class="form-group"><label>Ngày xuất thực tế</label><input v-model="actionForm.export_date" class="input" type="date" /></div>
      </div>

      <div class="table-wrap" style="margin-top: 14px">
        <table :style="{ minWidth: actionType === 'release' ? '980px' : '720px' }">
          <thead><tr><th v-if="actionType === 'release'">Kho xuất</th><th>Sản phẩm</th><th>Logo</th><th>Đơn vị</th><th>Số lượng</th></tr></thead>
          <tbody>
            <tr v-for="(line,index) in actionLines" :key="index">
              <td v-if="actionType === 'release'">
                <SearchableSelect
                  :model-value="releaseWarehouseId(line, index)"
                  :options="warehouseOptions"
                  placeholder="Chọn kho xuất"
                  @update:model-value="onReleaseWarehouseChanged(index, $event)"
                  @change="onReleaseWarehouseChanged(index, $event)"
                />
                <div class="small subtle">ID kho: {{ releaseWarehouseId(line, index) || 'chưa chọn' }}</div>
              </td>
              <td><b>{{ line.product_code }}</b><div class="small subtle">{{ line.product_name }}</div></td>
              <td>{{ line.logo || '-' }}</td>
              <td>{{ line.unit || '-' }}</td>
              <td><b>{{ line.requested_qty }}</b></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="form-group" style="margin-top:12px">
        <label>{{ actionType === 'reject' ? 'Lý do từ chối' : actionType === 'cancel_release' ? 'Lý do hủy xuất' : actionType === 'cancel_external_release' ? 'Lý do hủy xác nhận xuất ngoài' : actionType === 'external_release' ? 'Lý do / ghi chú xác nhận' : 'Ghi chú kho' }}</label>
        <textarea v-model="actionForm.note" class="textarea" rows="3" />
      </div>
      <p v-if="actionType === 'release'" class="small subtle">Khi cho xuất kho, hệ thống sẽ check tồn, tạo export_orders/export_order_items, ghi stock_movements và trừ inventory_balances bằng transaction.</p>
      <p v-if="actionType === 'external_release'" class="small" style="color:#b45309">Chỉ dùng cho hàng đã xuất thực tế trước khi quản lý tồn trên hệ thống. Hệ thống tạo một phiếu ghi nhận trên trang Xuất kho, nhưng không ghi stock_movements và không thay đổi inventory_balances.</p>
      <p v-if="actionType === 'cancel_release'" class="small subtle">Hệ thống sẽ hủy mềm phiếu xuất liên kết, hoàn inventory_balances, ghi stock_movements đảo và mở lại yêu cầu trong cùng transaction.</p>
      <p v-if="actionType === 'cancel_external_release'" class="small subtle">Hệ thống chỉ hủy phiếu ghi nhận xuất ngoài và mở lại yêu cầu; không ghi stock_movements và không thay đổi inventory_balances.</p>
    </BaseModal>

    <ConfirmModal
      v-bind="confirmState"
      @cancel="resolveConfirm(false)"
      @confirm="resolveConfirm(true)"
    />
  </AppShell>
</template>
