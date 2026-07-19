from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text(encoding='utf-8')
    if old not in source:
        raise SystemExit(f'Missing patch target in {path}: {old[:160]!r}')
    file.write_text(source.replace(old, new, 1), encoding='utf-8')


# ---------------------------------------------------------------------------
# Restore Step 8 lifecycle fields in the cost-aware runtime and provide a
# lot-aware cancel/restore operation instead of calling the quantity-only
# legacy implementation.
# ---------------------------------------------------------------------------
replace_once(
    'composables/useWarehouseCostTransactions.ts',
    """// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { validateWarehouseReleaseSources } from '~/utils/orderItemDependencies.mjs'
""",
    """// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { validateWarehouseReleaseSources } from '~/utils/orderItemDependencies.mjs'
// @ts-ignore Shared ESM lifecycle helpers are executed directly by Node tests.
import {
  activeExportOrderId,
  appendExportLifecycleTimeline,
  buildCancelledReleaseRequestPatch,
  buildGeneratedExportLifecycleFields,
  buildReleasedRequestPatch,
  canCancelExportRequestRelease,
  canReleaseExportRequest,
  exportLifecycleLinkError,
  nextExportReleaseSequence,
  requestExportOrderId,
} from '~/utils/exportLifecycle.mjs'
""",
)

replace_once(
    'composables/useWarehouseCostTransactions.ts',
    """    const fallbackWarehouse = input.warehouse ? ensureWarehouse(input.warehouse, 'kho xuất mặc định') : null
    const exportDate = input.export_date || request.export_date || todayKey()
    const orderId = safeDocId(`request_export__${requestDocId}`, 'export')
    const code = safeDocId(`PXK-${request.request_id || requestDocId}`, 'PXK')
    const operationId = operationIdOf(input.operation_id, `export_request_release:${requestDocId}`)
""",
    """    if (!canReleaseExportRequest(request)) {
      throw new Error('Yêu cầu không còn ở trạng thái được phép cho xuất hoặc đang có phiếu xuất hoạt động.')
    }
    const fallbackWarehouse = input.warehouse ? ensureWarehouse(input.warehouse, 'kho xuất mặc định') : null
    const exportDate = input.export_date || request.export_date || todayKey()
    const expectedRevision = input.expected_revision ?? request.revision ?? 0
    const releaseSequence = nextExportReleaseSequence(request)
    const orderId = requestExportOrderId(requestDocId, releaseSequence)
    const code = safeDocId(`PXK-${request.request_id || requestDocId}${releaseSequence > 1 ? `-${releaseSequence}` : ''}`, 'PXK')
    const operationId = operationIdOf(input.operation_id, `export_request_release:${requestDocId}:${releaseSequence}`)
""",
)

replace_once(
    'composables/useWarehouseCostTransactions.ts',
    """    const timeline = Array.isArray(input.timeline) ? input.timeline : []
    const nextTimeline = [...timeline, {
      action: 'warehouse_export',
      title: 'Kho cho xuất kho',
      actor,
      actor_name: appUser.value?.display_name || actor,
      time: new Date().toISOString(),
      status: 'da_xuat',
      note: input.note || '',
    }]
""",
    """    const timeline = Array.isArray(input.timeline) ? input.timeline : []
    const nextTimeline = appendExportLifecycleTimeline(timeline, {
      action: 'warehouse_export',
      title: 'Kho cho xuất kho',
      actor,
      actorName: appUser.value?.display_name || actor,
      time: new Date().toISOString(),
      status: 'da_xuat',
      note: input.note || '',
      exportOrderId: orderId,
      exportCode: code,
    })
""",
)

replace_once(
    'composables/useWarehouseCostTransactions.ts',
    """        const currentRequest = requestSnap.data() || {}
        alreadyProcessed = String(currentRequest.status || '') === 'da_xuat'
          || String(currentRequest.export_order_id || currentRequest.warehouse_export_order_id || '').trim() !== ''
        if (alreadyProcessed || exportSnap.exists()) {
          completeOperationTx(tx, operationId, code, 1)
          return
        }

        const sourceOrderId = String(currentRequest.order_id || '').trim()
""",
    """        const currentRequest = { ...requestSnap.data(), id: requestSnap.id }
        const currentActiveExportId = activeExportOrderId(currentRequest)
        if (String(currentRequest.status || '') === 'da_xuat' && currentActiveExportId) {
          if (currentActiveExportId !== orderId || !exportSnap.exists()) {
            throw new Error('Yêu cầu đã liên kết với một phiếu xuất khác. Hãy tải lại dữ liệu.')
          }
          alreadyProcessed = true
          completeOperationTx(tx, operationId, code, 1)
          return
        }
        const currentRevision = revisionOf(currentRequest)
        if (currentRevision !== revisionOf({ revision: expectedRevision })) {
          throw new Error('Yêu cầu xuất kho đã được cập nhật ở phiên khác.')
        }
        const currentSequence = nextExportReleaseSequence(currentRequest)
        if (!canReleaseExportRequest(currentRequest)) {
          throw new Error('Yêu cầu vừa được tài khoản khác cập nhật nên không thể cho xuất.')
        }
        if (currentSequence !== releaseSequence || requestExportOrderId(requestDocId, currentSequence) !== orderId) {
          throw new Error('Vòng đời xuất kho đã thay đổi. Hãy tải lại trước khi cho xuất.')
        }
        if (exportSnap.exists()) throw new Error('ID phiếu xuất của vòng đời này đã tồn tại.')

        const sourceOrderId = String(currentRequest.order_id || '').trim()
""",
)

replace_once(
    'composables/useWarehouseCostTransactions.ts',
    """          operation_id: operationId,
          last_operation_id: operationId,
          revision: 1,
          source: 'kingcup_firestore',
""",
    """          operation_id: operationId,
          last_operation_id: operationId,
          revision: 1,
          source: 'kingcup_firestore',
          ...buildGeneratedExportLifecycleFields({
            requestId: requestDocId,
            requestRevision: currentRevision,
            operationId,
            releaseSequence,
          }),
""",
)

replace_once(
    'composables/useWarehouseCostTransactions.ts',
    """            product_name: productName(line.product),
            logo: normalizeLogo(line.targetLogo),
            quantity: line.quantity,
""",
    """            product_name: productName(line.product),
            warehouse_id: line.fromWarehouse.id,
            warehouse_name: warehouseName(line.fromWarehouse),
            logo: normalizeLogo(line.targetLogo),
            quantity: line.quantity,
""",
)

replace_once(
    'composables/useWarehouseCostTransactions.ts',
    """        tx.update(requestRef, {
          status: 'da_xuat',
          warehouse_export_code: code,
          warehouse_export_id: orderId,
          warehouse_export_order_id: orderId,
          export_order_id: orderId,
          warehouse_handled_by: actor,
          warehouse_handled_at: serverTimestamp(),
          warehouse_note: input.note || '',
          exported_at: serverTimestamp(),
          actual_exported_at: serverTimestamp(),
          actual_export_summary_json: JSON.stringify(exportedSummary),
          stock_movement_ids: stockMovementIds,
          request_timeline_json: JSON.stringify(nextTimeline),
          operation_id: operationId,
          last_operation_id: operationId,
          revision: revisionOf(currentRequest) + 1,
          updated_at: serverTimestamp(),
        })
""",
    """        tx.update(requestRef, {
          ...buildReleasedRequestPatch({
            request: currentRequest,
            exportOrderId: orderId,
            exportCode: code,
            actor,
            note: input.note || '',
            operationId,
            releaseSequence,
            actualSummaryJson: JSON.stringify(exportedSummary),
            stockMovementIds,
            timelineJson: JSON.stringify(nextTimeline),
          }),
          warehouse_handled_at: serverTimestamp(),
          exported_at: serverTimestamp(),
          actual_exported_at: serverTimestamp(),
          revision: currentRevision + 1,
          updated_at: serverTimestamp(),
        })
""",
)

replace_once(
    'composables/useWarehouseCostTransactions.ts',
    """      return { id: orderId, code, stockMovementIds, operationId, alreadyProcessed, notificationCount: alreadyProcessed ? 0 : saleRecipients.length }
""",
    """      return {
        id: orderId,
        code,
        stockMovementIds,
        operationId,
        alreadyProcessed,
        notificationCount: alreadyProcessed ? 0 : saleRecipients.length,
        releaseSequence,
        revision: 1,
      }
""",
)

cancel_function = r'''
  async function cancelExportRequestRelease(input: any) {
    const actor = actorEmail()
    if (!actor) throw new Error('Bạn chưa đăng nhập.')
    const request = input.request || {}
    const requestDocId = String(request.id || request.request_id || '').trim()
    if (!requestDocId) throw new Error('Thiếu ID yêu cầu xuất kho.')
    if (!canCancelExportRequestRelease(request)) throw new Error('Yêu cầu không có phiếu xuất đang hoạt động để hủy.')
    const exportOrderId = activeExportOrderId(request)
    const reason = String(input.reason || '').trim()
    if (!reason) throw new Error('Vui lòng nhập lý do hủy xuất kho.')
    const expectedRequestRevision = input.expected_request_revision ?? request.revision ?? 0
    const expectedExportRevision = input.expected_export_revision ?? 1
    const operationId = operationIdOf(input.operation_id, `export_request_cancel:${requestDocId}:${expectedRequestRevision}`)

    let summary: any[] = []
    try {
      const parsed = JSON.parse(String(request.actual_export_summary_json || '[]'))
      summary = Array.isArray(parsed) ? parsed : []
    } catch {}
    if (!summary.length) {
      throw new Error('Yêu cầu thiếu tóm tắt xuất thực tế nên chưa thể hoàn tồn an toàn. Cần đối soát dữ liệu trước khi hủy.')
    }

    const lines = summary.map((line: any, index: number) => {
      const product = ensureProduct({
        id: line.product_id,
        product_code: line.product_code,
        product_name: line.product_name,
        unit: line.unit,
      })
      const fromWarehouse = ensureWarehouse({
        id: line.warehouse_id,
        name: line.warehouse_name,
      }, `kho xuất dòng ${index + 1}`)
      const quantity = positiveQuantity(line.quantity)
      return {
        product,
        fromWarehouse,
        logo: normalizeLogo(line.logo),
        unit: line.unit || product.unit || '',
        quantity,
        itemId: safeDocId(`${exportOrderId}__${index + 1}`, 'export_item'),
        reverseMovementId: safeDocId(`export_request_cancel:${exportOrderId}:${index + 1}:${operationId}`, 'movement'),
        summaryAllocations: Array.isArray(line.lot_allocations) ? line.lot_allocations : [],
      }
    })
    const refs = await buildBalanceRefs(lines.map((line: any) => ({
      product: line.product,
      warehouse: line.fromWarehouse,
      logo: line.logo,
    })))
    const replay = await claimOperation({
      operationId,
      action: 'export_request_cancel',
      targetCollection: 'export_orders',
      targetId: exportOrderId,
      resultCode: String(request.warehouse_export_code || exportOrderId),
      actor,
    })
    if (replay) return { ...replay, operationId, alreadyProcessed: true, notificationCount: 0 }

    const saleRecipients = Array.isArray(input.notification_recipients)
      ? Array.from(new Set(input.notification_recipients.map(normalizeEmail).filter(Boolean))).filter(recipient => recipient !== actor)
      : resolveSaleNotificationRecipients({ request, actorEmail: actor })
    const notificationRefs = saleRecipients.map(() => doc(collection(db, 'notifications')))
    let exportCode = String(request.warehouse_export_code || exportOrderId)
    let resultRevision = expectedExportRevision

    try {
      await runTransaction(db, async tx => {
        const operationRef = doc(db, 'warehouse_operations', operationId)
        const requestRef = doc(db, 'order_export_requests', requestDocId)
        const exportRef = doc(db, 'export_orders', exportOrderId)
        const operationSnap = await tx.get(operationRef)
        const requestSnap = await tx.get(requestRef)
        const exportSnap = await tx.get(exportRef)
        if (!operationSnap.exists() || operationSnap.data()?.status !== 'processing') throw new Error('Operation hủy xuất không hợp lệ.')
        if (!requestSnap.exists()) throw new Error('Yêu cầu xuất kho không còn tồn tại.')
        if (!exportSnap.exists()) throw new Error('Không tìm thấy phiếu xuất liên kết để hoàn tồn.')

        const currentRequest = { ...requestSnap.data(), id: requestSnap.id }
        const currentExport = { ...exportSnap.data(), id: exportSnap.id }
        if (revisionOf(currentRequest) !== revisionOf({ revision: expectedRequestRevision })) {
          throw new Error('Yêu cầu xuất kho đã được cập nhật ở phiên khác.')
        }
        if (revisionOf(currentExport) !== revisionOf({ revision: expectedExportRevision })) {
          throw new Error('Phiếu xuất kho đã được cập nhật ở phiên khác.')
        }
        const linkError = exportLifecycleLinkError(currentRequest, currentExport)
        if (linkError) throw new Error(linkError)
        if (!canCancelExportRequestRelease(currentRequest)) throw new Error('Yêu cầu vừa thay đổi nên không thể hủy xuất.')
        if (String(currentExport.destination_type || 'customer') !== 'customer') {
          throw new Error('Luồng yêu cầu Sale hiện chỉ hỗ trợ hoàn phiếu xuất tới khách.')
        }
        exportCode = String(currentExport.code || currentExport.export_code || exportCode)
        resultRevision = revisionOf(currentExport) + 1

        const itemSnaps = new Map<string, any>()
        for (const line of lines) itemSnaps.set(line.itemId, await tx.get(doc(db, 'export_order_items', line.itemId)))
        const states = await readBalanceStates(tx, refs, request.export_date || todayKey())

        const restoredAllocations = new Map<string, LotAllocation[]>()
        for (const line of lines) {
          const itemSnap = itemSnaps.get(line.itemId)
          if (!itemSnap?.exists()) throw new Error(`Thiếu chi tiết phiếu xuất ${line.itemId}, không thể hoàn tồn.`)
          const item = itemSnap.data() || {}
          if (String(item.export_order_id || '') !== exportOrderId || item.deleted === true || item.active === false) {
            throw new Error(`Chi tiết phiếu xuất ${line.itemId} không còn hợp lệ để hoàn tồn.`)
          }
          const itemAllocations = parseLotAllocations(item.lot_allocations_json)
          const allocations = itemAllocations.length
            ? itemAllocations
            : line.summaryAllocations.length
              ? line.summaryAllocations
              : [{
                  lot_id: `opening_restore__${line.itemId}`,
                  quantity: line.quantity,
                  import_code: 'OPENING',
                  import_date: '1970-01-01',
                  source: 'legacy_opening',
                }]
          const key = Array.from(refs.values()).find(entry => (
            entry.product.id === line.product.id
            && entry.warehouse.id === line.fromWarehouse.id
            && entry.logo === line.logo
          ))!.id
          const state = states.get(key)!
          reconcileState(state)
          restoreSourceAllocation(state, allocations, line.quantity)
          restoredAllocations.set(line.itemId, allocations)
        }

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
          revision: resultRevision,
          updated_at: serverTimestamp(),
        })
        lines.forEach((line: any) => {
          const item = itemSnaps.get(line.itemId).data() || {}
          const allocations = restoredAllocations.get(line.itemId) || []
          tx.update(doc(db, 'export_order_items', line.itemId), {
            deleted: true,
            active: false,
            status: 'cancelled',
            deleted_at: serverTimestamp(),
            deleted_by: actor,
            deleted_reason: reason,
            updated_by: actor,
            operation_id: operationId,
            last_operation_id: operationId,
            revision: revisionOf(item) + 1,
            updated_at: serverTimestamp(),
          })
          tx.set(doc(db, 'stock_movements', line.reverseMovementId), movementPayload({
            id: line.reverseMovementId,
            type: 'export_request_cancel_reverse',
            direction: 'in',
            quantity: line.quantity,
            product: line.product,
            warehouse: line.fromWarehouse,
            logo: line.logo,
            unit: line.unit,
            movementDate: request.export_date || todayKey(),
            sourceCollection: 'export_orders',
            sourceDocId: exportOrderId,
            sourceItemId: line.itemId,
            sourceCode: exportCode,
            reason,
            createdBy: actor,
            operationId,
            lotAllocations: allocations,
          }))
        })
        states.forEach(state => tx.set(state.ref, balancePayload(state, operationId, actor), { merge: true }))

        let currentTimeline: any[] = []
        try {
          const parsed = JSON.parse(String(currentRequest.request_timeline_json || '[]'))
          currentTimeline = Array.isArray(parsed) ? parsed : []
        } catch {}
        const nextTimeline = appendExportLifecycleTimeline(currentTimeline, {
          action: 'warehouse_export_cancel',
          title: 'Kho hủy xuất và hoàn tồn',
          actor,
          actorName: appUser.value?.display_name || actor,
          time: new Date().toISOString(),
          status: 'da_tiep_nhan',
          note: reason,
          exportOrderId,
          exportCode,
        })
        tx.update(requestRef, {
          ...buildCancelledReleaseRequestPatch({
            request: currentRequest,
            exportOrder: currentExport,
            actor,
            reason,
            operationId,
            timelineJson: JSON.stringify(nextTimeline),
          }),
          warehouse_handled_at: serverTimestamp(),
          last_cancelled_at: serverTimestamp(),
          revision: revisionOf(currentRequest) + 1,
          updated_at: serverTimestamp(),
        })
        if (currentRequest.order_id && input.orderSummaryPatch) tx.update(doc(db, 'orders', currentRequest.order_id), {
          warehouse_fulfillment_status: input.orderSummaryPatch.warehouse_fulfillment_status || 'chua_xuat',
          warehouse_request_status: input.orderSummaryPatch.warehouse_request_status || 'da_tiep_nhan',
          updated_at: serverTimestamp(),
        })
        tx.set(doc(collection(db, 'activity_logs')), activityPayload('export_orders', 'cancel_from_request', exportCode, {
          request_id: currentRequest.request_id || requestDocId,
          export_order_id: exportOrderId,
          reason,
        }, actor))
        tx.set(doc(collection(db, 'activity_logs')), activityPayload('order_export_requests', 'warehouse_export_cancel', currentRequest.request_id || requestDocId, {
          export_order_id: exportOrderId,
          export_code: exportCode,
          reason,
        }, actor))
        notificationRefs.forEach((notificationRef, index) => tx.set(notificationRef, buildNotificationPayload({
          type: 'warehouse_export_request_cancelled',
          title: 'Kho đã hủy xuất và hoàn tồn',
          message: `${currentRequest.request_id || requestDocId} · Phiếu ${exportCode} đã được hủy. Lý do: ${reason}`,
          route: '/export-requests',
          entity_collection: 'order_export_requests',
          entity_id: requestDocId,
          entity_code: currentRequest.request_id || requestDocId,
          created_by: actor,
          to_email: saleRecipients[index],
          metadata: {
            order_id: currentRequest.order_id || '',
            order_code: currentRequest.order_code || '',
            export_order_id: exportOrderId,
            export_code: exportCode,
            reason,
          },
        })))
        completeOperationTx(tx, operationId, exportCode, resultRevision)
      })
      invalidateWarehouseCaches()
      return {
        id: exportOrderId,
        code: exportCode,
        revision: resultRevision,
        operationId,
        alreadyProcessed: false,
        notificationCount: saleRecipients.length,
      }
    } catch (error) {
      await failOperation(operationId, actor, error).catch(() => undefined)
      throw error
    }
  }

'''
replace_once(
    'composables/useWarehouseCostTransactions.ts',
    """  async function createInventoryAdjustment(input: any) {
""",
    cancel_function + """  async function createInventoryAdjustment(input: any) {
""",
)

replace_once(
    'composables/useWarehouseCostTransactions.ts',
    """    createInventoryAdjustment,
    processExportRequestToExportOrder,
""",
    """    createInventoryAdjustment,
    processExportRequestToExportOrder,
    cancelExportRequestRelease,
""",
)

# ---------------------------------------------------------------------------
# Add a narrow admin-only reconcile rule. It works for fully exported orders,
# but only allows the computed relation summary fields.
# ---------------------------------------------------------------------------
reconcile_rule = r'''    function orderRelationReconcileAllowed() {
      return isAdmin()
        && request.resource.data.get('relation_last_module', '') == 'all'
        && request.resource.data.get('relation_last_action', '') == 'reconcile'
        && request.resource.data.get('relation_last_document_id', '') == ''
        && ownEmailField(request.resource.data, 'relation_updated_by')
        && orderIdentityUnchanged()
        && relationLockReadyData(request.resource.data)
        && onlyChanged([
          'relation_lock_version',
          'payment_record_count', 'invoice_record_count', 'shipment_record_count',
          'paid_amount', 'debt_amount', 'computed_payment_status', 'payment_status',
          'payment_count', 'deposit_count', 'collect_count',
          'invoice_status', 'shipment_status', 'shipping_fee_total', 'cod_amount_total',
          'payment_relation_revision', 'invoice_relation_revision', 'shipment_relation_revision',
          'relation_last_module', 'relation_last_action', 'relation_last_document_id',
          'relation_updated_by', 'relation_updated_at', 'updated_at'
        ]);
    }

'''
replace_once(
    'firestore.rules',
    """    function onlyWarehouseSummaryChanged() {
""",
    reconcile_rule + """    function onlyWarehouseSummaryChanged() {
""",
)

replace_once(
    'firestore.rules',
    """      allow read: if hasPerm('orders.view_all')
""",
    """      allow read: if isAdmin()
        || hasPerm('orders.view_all')
""",
)

replace_once(
    'firestore.rules',
    """        || orderWarehouseSummaryUpdateAllowed()
        // Dispatch relation summaries by the cheap module marker first. This
""",
    """        || orderWarehouseSummaryUpdateAllowed()
        || (
          request.resource.data.get('relation_last_module', '') == 'all'
          && orderRelationReconcileAllowed()
        )
        // Dispatch relation summaries by the cheap module marker first. This
""",
)

replace_once(
    'firestore.rules',
    """    match /payments/{docId} {
      allow read: if hasPerm('payments.view_all')
""",
    """    match /payments/{docId} {
      allow read: if isAdmin()
        || hasPerm('payments.view_all')
""",
)

print('Runtime export and relation sync fixes applied')
