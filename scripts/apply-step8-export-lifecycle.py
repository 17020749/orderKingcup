from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text(encoding='utf-8')
    if old not in source:
        raise SystemExit(f'Missing patch target in {path}: {old[:160]!r}')
    file.write_text(source.replace(old, new, 1), encoding='utf-8')


def regex_once(path: str, pattern: str, replacement: str) -> None:
    file = Path(path)
    source = file.read_text(encoding='utf-8')
    next_source, count = re.subn(pattern, replacement, source, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'Expected one regex target in {path}, got {count}: {pattern[:120]}')
    file.write_text(next_source, encoding='utf-8')


# ---------------------------------------------------------------------------
# Warehouse transaction lifecycle
# ---------------------------------------------------------------------------
replace_once(
    'composables/useWarehouseTransactions.ts',
    """import {
  buildNotificationPayload,
  resolveSaleNotificationRecipients,
} from '~/composables/useNotifications'
""",
    """import {
  buildNotificationPayload,
  resolveSaleNotificationRecipients,
} from '~/composables/useNotifications'
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

new_process_functions = r'''  async function processExportRequestToExportOrder(input: {
    request: any
    orderSummaryPatch?: Record<string, any>
    customer_name?: string
    note?: string
    export_date?: string
    timeline?: any[]
    notification_recipients?: string[]
    operation_id?: string
    expected_revision?: number
    warehouse?: WarehouseDoc | any
    lines: Array<{ product: ProductDoc | any; warehouse?: WarehouseDoc | any; fromWarehouse?: WarehouseDoc | any; from_warehouse_id?: string; warehouse_id?: string; logo?: string; quantity: number; unit?: string; note?: string }>
  }) {
    const createdBy = email()
    if (!createdBy) throw new Error('Bạn chưa đăng nhập.')

    const request = input.request || {}
    const requestDocId = String(request.id || request.request_id || '').trim()
    if (!requestDocId) throw new Error('Thiếu ID yêu cầu xuất kho.')
    if (!canReleaseExportRequest(request)) {
      throw new Error('Yêu cầu không còn ở trạng thái được phép cho xuất hoặc đang có phiếu xuất hoạt động.')
    }

    const expectedRevision = input.expected_revision ?? request.revision ?? 0
    const releaseSequence = nextExportReleaseSequence(request)
    const orderId = requestExportOrderId(requestDocId, releaseSequence)
    const baseCode = `PXK-${request.request_id || requestDocId}`
    const code = safeDocId(releaseSequence <= 1 ? baseCode : `${baseCode}-${releaseSequence}`, 'PXK')
    const operationId = operationIdOf(input.operation_id, `export_request_release:${requestDocId}:${releaseSequence}`)
    const fallbackWarehouse = input.warehouse ? ensureWarehouse(input.warehouse, 'kho xuất mặc định') : null
    const exportDate = input.export_date || request.export_date || todayKey()
    let resultId = orderId
    let resultCode = code
    let resultRevision = 1
    let alreadyProcessed = false

    const rawLines = input.lines.filter(line => toNumber(line.quantity) > 0)
    if (!rawLines.length) throw new Error('Yêu cầu xuất kho chưa có dòng hàng hợp lệ.')

    const preparedLines = [] as Array<{ product: any; fromWarehouse: any; logo: string; unit?: string; note?: string; quantity: number; itemId: string; outMovementId: string }>
    rawLines.forEach((line, index) => {
      const product = ensureProduct(line.product)
      const fromWarehouse = ensureWarehouse(
        line.from_warehouse_id || line.warehouse_id || line.fromWarehouse || line.warehouse || fallbackWarehouse || line,
        `kho xuất dòng ${index + 1}`,
      )
      const quantity = ensurePositiveQuantity(line.quantity)
      preparedLines.push({
        product,
        fromWarehouse,
        logo: lineTargetLogo(line),
        unit: line.unit || product.unit || '',
        note: line.note || '',
        quantity,
        itemId: safeDocId(`${orderId}__${index + 1}`, 'export_item'),
        outMovementId: safeDocId(`export_out:${orderId}:${index + 1}`, 'movement')
      })
    })

    const balanceDeltas = new Map<string, BalanceDelta>()
    for (const line of preparedLines) {
      const outId = await inventoryBalanceId(line.product.id, line.fromWarehouse.id, line.logo)
      applyDelta(balanceDeltas, {
        id: outId,
        delta: -line.quantity,
        product: line.product,
        warehouse: line.fromWarehouse,
        logo: normalizeLogo(line.logo),
        unit: line.unit || line.product.unit || '',
        movementDate: exportDate
      })
    }

    const stockMovementIds = preparedLines.map(line => line.outMovementId)
    const actualSummary = preparedLines.map(line => ({
      product_id: line.product?.id || '',
      product_code: productCode(line.product),
      product_name: productName(line.product),
      logo: normalizeLogo(line.logo),
      warehouse_id: line.fromWarehouse?.id || '',
      warehouse_name: warehouseName(line.fromWarehouse),
      quantity: toNumber(line.quantity),
      unit: line.unit || line.product?.unit || ''
    }))
    const orderPayload = {
      id: orderId,
      code,
      export_code: code,
      export_date: exportDate,
      destination_type: 'customer',
      source_order_code: request.order_code || '',
      source_request_id: requestDocId,
      sync_source: `kingcup_firestore:${requestDocId}`,
      customer_name: input.customer_name || request.customer_name || '',
      destination_name: input.customer_name || request.customer_name || '',
      note: input.note || '',
      status: 'completed',
      active: true,
      deleted: false,
      created_by: createdBy,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      operation_id: operationId,
      last_operation_id: operationId,
      revision: 1,
      source: 'kingcup_firestore',
      ...buildGeneratedExportLifecycleFields({
        requestId: requestDocId,
        requestRevision: expectedRevision,
        releaseSequence,
        operationId,
      }),
    }

    const handledBy = createdBy
    const saleRecipients = Array.isArray(input.notification_recipients)
      ? Array.from(new Set(input.notification_recipients.map(normalizeEmail).filter(Boolean)))
        .filter(recipient => recipient !== handledBy)
      : resolveSaleNotificationRecipients({ request, actorEmail: handledBy })
    const notificationRefs = saleRecipients.map(() => doc(collection(db, 'notifications')))

    await claimWarehouseOperation(db, {
      operationId,
      action: 'export_request_release',
      targetCollection: 'export_orders',
      targetId: orderId,
      resultCode: code,
      createdBy,
    })

    try {
      await runTransaction(db, async tx => {
        const operationRef = doc(db, 'warehouse_operations', operationId)
        const requestRef = doc(db, 'order_export_requests', requestDocId)
        const exportRef = doc(db, 'export_orders', orderId)
        const operationSnap = await tx.get(operationRef)
        const requestSnap = await tx.get(requestRef)
        const exportSnap = await tx.get(exportRef)
        if (!operationSnap.exists()) throw new Error('Không tìm thấy operation pending cho nghiệp vụ kho.')
        if (!requestSnap.exists()) throw new Error('Yêu cầu xuất kho không còn tồn tại.')
        const operationData = operationSnap.data() || {}
        assertOperationOwner(operationData, 'export_request_release', createdBy)
        if (String(operationData.status || '') === 'completed') {
          const previous = readOperationResult(operationData, 'export_request_release')
          resultId = previous.id || resultId
          resultCode = previous.code || resultCode
          resultRevision = previous.revision || resultRevision
          alreadyProcessed = true
          return
        }

        const currentRequest = { ...requestSnap.data(), id: requestSnap.id }
        const currentActiveExportId = activeExportOrderId(currentRequest)
        if (String(currentRequest.status || '') === 'da_xuat' && currentActiveExportId) {
          if (currentActiveExportId !== orderId || !exportSnap.exists()) {
            throw new Error('Yêu cầu đã liên kết với một phiếu xuất khác. Hãy tải lại dữ liệu.')
          }
          alreadyProcessed = true
          resultId = currentActiveExportId
          resultCode = String(currentRequest.warehouse_export_code || code)
          return
        }

        const currentRevision = assertExpectedRevision(currentRequest, expectedRevision, 'Yêu cầu xuất kho')
        const currentSequence = nextExportReleaseSequence(currentRequest)
        if (!canReleaseExportRequest(currentRequest)) {
          throw new Error('Yêu cầu vừa được tài khoản khác cập nhật nên không thể cho xuất.')
        }
        if (currentSequence !== releaseSequence || requestExportOrderId(requestDocId, currentSequence) !== orderId) {
          throw new Error('Vòng đời xuất kho đã thay đổi. Hãy tải lại trước khi cho xuất.')
        }
        if (exportSnap.exists()) throw new Error('ID phiếu xuất của vòng đời này đã tồn tại.')

        const balanceSnaps = new Map<string, any>()
        for (const delta of balanceDeltas.values()) {
          balanceSnaps.set(delta.id, await tx.get(doc(db, 'inventory_balances', delta.id)))
        }
        for (const delta of balanceDeltas.values()) {
          const snap = balanceSnaps.get(delta.id)
          const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
          const next = current + delta.delta
          if (next < 0) {
            throw new Error(`Không đủ tồn: ${productCode(delta.product)} - ${productName(delta.product)} / ${warehouseName(delta.warehouse)}${delta.logo ? ` / ${delta.logo}` : ''}. Tồn hiện tại ${current}, cần ${Math.abs(delta.delta)}.`)
          }
        }

        tx.set(exportRef, orderPayload)
        preparedLines.forEach(line => {
          tx.set(doc(db, 'export_order_items', line.itemId), {
            id: line.itemId,
            export_order_id: orderId,
            product_id: line.product.id,
            product_code: productCode(line.product),
            product_name: productName(line.product),
            from_warehouse_id: line.fromWarehouse.id,
            from_warehouse_name: warehouseName(line.fromWarehouse),
            to_warehouse_id: '',
            to_warehouse_name: '',
            destination_name: orderPayload.destination_name,
            logo: normalizeLogo(line.logo),
            source_logo: normalizeLogo(line.logo),
            target_logo: normalizeLogo(line.logo),
            quantity: line.quantity,
            unit: line.unit || line.product.unit || '',
            note: line.note || '',
            legacy_line_key: '',
            status: 'completed',
            active: true,
            deleted: false,
            created_by: createdBy,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            operation_id: operationId,
            last_operation_id: operationId,
            revision: 1,
            source: 'kingcup_firestore'
          })
          tx.set(doc(db, 'stock_movements', line.outMovementId), movementPayload({
            id: line.outMovementId,
            type: 'export_customer',
            direction: 'out',
            quantity: -line.quantity,
            product: line.product,
            warehouse: line.fromWarehouse,
            logo: line.logo,
            unit: line.unit,
            movementDate: exportDate,
            sourceCollection: 'export_orders',
            sourceDocId: orderId,
            sourceItemId: line.itemId,
            sourceCode: code,
            reason: 'Xuất theo yêu cầu OrderKingcup',
            createdBy,
            operationId
          }))
        })
        for (const delta of balanceDeltas.values()) {
          const snap = balanceSnaps.get(delta.id)
          const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
          tx.set(doc(db, 'inventory_balances', delta.id), balancePayload(delta, current + delta.delta, operationId, createdBy), { merge: true })
        }

        let currentTimeline: any[] = []
        try {
          const parsed = JSON.parse(String(currentRequest.request_timeline_json || '[]'))
          currentTimeline = Array.isArray(parsed) ? parsed : []
        } catch {}
        const nextTimeline = appendExportLifecycleTimeline(currentTimeline, {
          action: 'warehouse_export',
          title: 'Kho cho xuất kho',
          actor: handledBy,
          actorName: appUser.value?.display_name || handledBy,
          time: new Date().toISOString(),
          status: 'da_xuat',
          note: input.note || '',
          exportOrderId: orderId,
          exportCode: code,
        })
        tx.update(requestRef, {
          ...buildReleasedRequestPatch({
            request: currentRequest,
            exportOrderId: orderId,
            exportCode: code,
            actor: handledBy,
            note: input.note || '',
            operationId,
            releaseSequence,
            actualSummaryJson: JSON.stringify(actualSummary),
            stockMovementIds,
            timelineJson: JSON.stringify(nextTimeline),
          }),
          warehouse_handled_at: serverTimestamp(),
          exported_at: serverTimestamp(),
          actual_exported_at: serverTimestamp(),
          revision: currentRevision + 1,
          updated_at: serverTimestamp(),
        })
        resultRevision = 1
        if (request.order_id && input.orderSummaryPatch) {
          tx.update(doc(db, 'orders', request.order_id), {
            ...input.orderSummaryPatch,
            updated_at: serverTimestamp()
          })
        }
        tx.set(doc(collection(db, 'activity_logs')), activity('export_orders', 'create_from_request', code, orderPayload, operationId))
        tx.set(doc(collection(db, 'activity_logs')), activity('order_export_requests', 'warehouse_export', request.request_id || requestDocId, {
          request_id: request.request_id || requestDocId,
          export_order_id: orderId,
          export_code: code,
          release_sequence: releaseSequence,
        }, operationId))
        notificationRefs.forEach((notificationRef, index) => {
          tx.set(notificationRef, buildNotificationPayload({
            type: 'warehouse_export_request_released',
            title: 'Kho đã cho xuất hàng',
            message: `${request.request_id || requestDocId} · Đã tạo phiếu xuất ${code}.`,
            route: '/export-requests',
            entity_collection: 'order_export_requests',
            entity_id: requestDocId,
            entity_code: request.request_id || requestDocId,
            created_by: handledBy,
            to_email: saleRecipients[index],
            metadata: {
              order_id: request.order_id || '',
              order_code: request.order_code || '',
              export_order_id: orderId,
              export_code: code,
              release_sequence: releaseSequence,
            },
          }))
        })
      })
    } catch (error) {
      await failWarehouseOperation(db, operationId, 'export_request_release', createdBy, error).catch(() => undefined)
      throw error
    }

    await completeWarehouseOperation(db, {
      operationId,
      action: 'export_request_release',
      targetCollection: 'export_orders',
      targetId: resultId,
      resultCode,
      targetRevision: resultRevision,
      createdBy,
    })
    invalidateWarehouseCaches()
    return {
      id: resultId,
      code: resultCode,
      stockMovementIds,
      alreadyProcessed,
      notificationCount: alreadyProcessed ? 0 : saleRecipients.length,
      releaseSequence,
      revision: resultRevision,
    }
  }

  async function cancelExportRequestRelease(input: {
    request: any
    orderSummaryPatch?: Record<string, any>
    reason: string
    timeline?: any[]
    notification_recipients?: string[]
    operation_id?: string
    expected_request_revision?: number
    expected_export_revision?: number
  }) {
    const cancelledBy = email()
    if (!cancelledBy) throw new Error('Bạn chưa đăng nhập.')
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

    const preparedLines = summary.map((line, index) => {
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
      return {
        product,
        fromWarehouse,
        logo: normalizeLogo(line.logo),
        unit: line.unit || product.unit || '',
        quantity: ensurePositiveQuantity(line.quantity),
        itemId: safeDocId(`${exportOrderId}__${index + 1}`, 'export_item'),
        reverseMovementId: safeDocId(`export_request_cancel:${exportOrderId}:${index + 1}:${operationId}`, 'movement'),
      }
    })

    const balanceDeltas = new Map<string, BalanceDelta>()
    for (const line of preparedLines) {
      const balanceId = await inventoryBalanceId(line.product.id, line.fromWarehouse.id, line.logo)
      applyDelta(balanceDeltas, {
        id: balanceId,
        delta: line.quantity,
        product: line.product,
        warehouse: line.fromWarehouse,
        logo: line.logo,
        unit: line.unit,
        movementDate: request.export_date || todayKey(),
      })
    }

    const saleRecipients = Array.isArray(input.notification_recipients)
      ? Array.from(new Set(input.notification_recipients.map(normalizeEmail).filter(Boolean)))
        .filter(recipient => recipient !== cancelledBy)
      : resolveSaleNotificationRecipients({ request, actorEmail: cancelledBy })
    const notificationRefs = saleRecipients.map(() => doc(collection(db, 'notifications')))
    let exportCode = String(request.warehouse_export_code || exportOrderId)
    let resultRevision = expectedExportRevision
    let alreadyProcessed = false

    await claimWarehouseOperation(db, {
      operationId,
      action: 'export_request_cancel',
      targetCollection: 'export_orders',
      targetId: exportOrderId,
      resultCode: exportCode,
      createdBy: cancelledBy,
    })

    try {
      await runTransaction(db, async tx => {
        const operationRef = doc(db, 'warehouse_operations', operationId)
        const requestRef = doc(db, 'order_export_requests', requestDocId)
        const exportRef = doc(db, 'export_orders', exportOrderId)
        const operationSnap = await tx.get(operationRef)
        const requestSnap = await tx.get(requestRef)
        const exportSnap = await tx.get(exportRef)
        if (!operationSnap.exists()) throw new Error('Không tìm thấy operation pending cho nghiệp vụ hủy xuất.')
        if (!requestSnap.exists()) throw new Error('Yêu cầu xuất kho không còn tồn tại.')
        if (!exportSnap.exists()) throw new Error('Không tìm thấy phiếu xuất liên kết để hoàn tồn.')
        const operationData = operationSnap.data() || {}
        assertOperationOwner(operationData, 'export_request_cancel', cancelledBy)
        if (String(operationData.status || '') === 'completed') {
          const previous = readOperationResult(operationData, 'export_request_cancel')
          exportCode = previous.code || exportCode
          resultRevision = previous.revision || resultRevision
          alreadyProcessed = true
          return
        }

        const currentRequest = { ...requestSnap.data(), id: requestSnap.id }
        const currentExport = { ...exportSnap.data(), id: exportSnap.id }
        if (currentExport.deleted === true || currentExport.active === false || String(currentExport.status || '') === 'cancelled') {
          if (String(currentRequest.status || '') === 'da_tiep_nhan' && !activeExportOrderId(currentRequest)) {
            alreadyProcessed = true
            resultRevision = revisionOf(currentExport)
            return
          }
          throw new Error('Phiếu xuất đã hủy nhưng yêu cầu chưa được mở lại đúng trạng thái.')
        }
        assertExpectedRevision(currentRequest, expectedRequestRevision, 'Yêu cầu xuất kho')
        const currentExportRevision = assertExpectedRevision(currentExport, expectedExportRevision, 'Phiếu xuất kho')
        const linkError = exportLifecycleLinkError(currentRequest, currentExport)
        if (linkError) throw new Error(linkError)
        if (!canCancelExportRequestRelease(currentRequest)) throw new Error('Yêu cầu vừa thay đổi nên không thể hủy xuất.')
        if (String(currentExport.destination_type || 'customer') !== 'customer') {
          throw new Error('Luồng yêu cầu Sale hiện chỉ hỗ trợ hoàn phiếu xuất tới khách.')
        }
        exportCode = String(currentExport.code || currentExport.export_code || exportCode)
        resultRevision = currentExportRevision + 1

        const itemSnaps = new Map<string, any>()
        for (const line of preparedLines) {
          itemSnaps.set(line.itemId, await tx.get(doc(db, 'export_order_items', line.itemId)))
        }
        const balanceSnaps = new Map<string, any>()
        for (const delta of balanceDeltas.values()) {
          balanceSnaps.set(delta.id, await tx.get(doc(db, 'inventory_balances', delta.id)))
        }
        for (const line of preparedLines) {
          const itemSnap = itemSnaps.get(line.itemId)
          if (!itemSnap?.exists()) throw new Error(`Thiếu chi tiết phiếu xuất ${line.itemId}, không thể hoàn tồn.`)
          const item = itemSnap.data() || {}
          if (String(item.export_order_id || '') !== exportOrderId || item.deleted === true || item.active === false) {
            throw new Error(`Chi tiết phiếu xuất ${line.itemId} không còn hợp lệ để hoàn tồn.`)
          }
        }

        tx.update(exportRef, {
          lifecycle_status: 'cancelled',
          deleted: true,
          active: false,
          status: 'cancelled',
          deleted_at: serverTimestamp(),
          deleted_by: cancelledBy,
          deleted_reason: reason,
          cancelled_at: serverTimestamp(),
          cancelled_by: cancelledBy,
          cancel_reason: reason,
          updated_by: cancelledBy,
          operation_id: operationId,
          last_operation_id: operationId,
          revision: resultRevision,
          updated_at: serverTimestamp(),
        })
        preparedLines.forEach(line => {
          const itemSnap = itemSnaps.get(line.itemId)
          const itemRevision = revisionOf(itemSnap.data() || {})
          tx.update(doc(db, 'export_order_items', line.itemId), {
            deleted: true,
            active: false,
            status: 'cancelled',
            deleted_at: serverTimestamp(),
            deleted_by: cancelledBy,
            deleted_reason: reason,
            updated_by: cancelledBy,
            operation_id: operationId,
            last_operation_id: operationId,
            revision: itemRevision + 1,
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
            createdBy: cancelledBy,
            operationId,
          }))
        })
        for (const delta of balanceDeltas.values()) {
          const snap = balanceSnaps.get(delta.id)
          const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
          tx.set(doc(db, 'inventory_balances', delta.id), balancePayload(delta, current + delta.delta, operationId, cancelledBy), { merge: true })
        }

        let currentTimeline: any[] = []
        try {
          const parsed = JSON.parse(String(currentRequest.request_timeline_json || '[]'))
          currentTimeline = Array.isArray(parsed) ? parsed : []
        } catch {}
        const nextTimeline = appendExportLifecycleTimeline(currentTimeline, {
          action: 'warehouse_export_cancel',
          title: 'Kho hủy xuất và hoàn tồn',
          actor: cancelledBy,
          actorName: appUser.value?.display_name || cancelledBy,
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
            actor: cancelledBy,
            reason,
            operationId,
            timelineJson: JSON.stringify(nextTimeline),
          }),
          warehouse_handled_at: serverTimestamp(),
          last_cancelled_at: serverTimestamp(),
          revision: revisionOf(currentRequest) + 1,
          updated_at: serverTimestamp(),
        })
        if (request.order_id && input.orderSummaryPatch) {
          tx.update(doc(db, 'orders', request.order_id), {
            ...input.orderSummaryPatch,
            updated_at: serverTimestamp(),
          })
        }
        tx.set(doc(collection(db, 'activity_logs')), activity('export_orders', 'cancel_from_request', exportCode, {
          request_id: request.request_id || requestDocId,
          export_order_id: exportOrderId,
          reason,
        }, operationId))
        tx.set(doc(collection(db, 'activity_logs')), activity('order_export_requests', 'warehouse_export_cancel', request.request_id || requestDocId, {
          export_order_id: exportOrderId,
          export_code: exportCode,
          reason,
        }, operationId))
        notificationRefs.forEach((notificationRef, index) => {
          tx.set(notificationRef, buildNotificationPayload({
            type: 'warehouse_export_request_cancelled',
            title: 'Kho đã hủy xuất và hoàn tồn',
            message: `${request.request_id || requestDocId} · Phiếu ${exportCode} đã được hủy. Lý do: ${reason}`,
            route: '/export-requests',
            entity_collection: 'order_export_requests',
            entity_id: requestDocId,
            entity_code: request.request_id || requestDocId,
            created_by: cancelledBy,
            to_email: saleRecipients[index],
            metadata: {
              order_id: request.order_id || '',
              order_code: request.order_code || '',
              export_order_id: exportOrderId,
              export_code: exportCode,
              reason,
            },
          }))
        })
      })
    } catch (error) {
      await failWarehouseOperation(db, operationId, 'export_request_cancel', cancelledBy, error).catch(() => undefined)
      throw error
    }

    await completeWarehouseOperation(db, {
      operationId,
      action: 'export_request_cancel',
      targetCollection: 'export_orders',
      targetId: exportOrderId,
      resultCode: exportCode,
      targetRevision: resultRevision,
      createdBy: cancelledBy,
    })
    invalidateWarehouseCaches()
    return {
      id: exportOrderId,
      code: exportCode,
      revision: resultRevision,
      operationId,
      alreadyProcessed,
      notificationCount: alreadyProcessed ? 0 : saleRecipients.length,
    }
  }

  async function getInventoryBalanceId'''

regex_once(
    'composables/useWarehouseTransactions.ts',
    r"  async function processExportRequestToExportOrder\(input: \{.*?\n  async function getInventoryBalanceId",
    new_process_functions,
)
replace_once(
    'composables/useWarehouseTransactions.ts',
    """    processExportRequestToExportOrder,
    getInventoryBalanceId,
""",
    """    processExportRequestToExportOrder,
    cancelExportRequestRelease,
    getInventoryBalanceId,
""",
)

# ---------------------------------------------------------------------------
# Warehouse request UI
# ---------------------------------------------------------------------------
replace_once(
    'pages/warehouse-export-requests.vue',
    """import { reportFirebaseError } from '~/utils/firebaseErrors'
""",
    """import { reportFirebaseError } from '~/utils/firebaseErrors'
// @ts-ignore Shared lifecycle helper is also executed by Node client tests.
import { canCancelExportRequestRelease } from '~/utils/exportLifecycle.mjs'
""",
)
replace_once(
    'pages/warehouse-export-requests.vue',
    """const { processExportRequestToExportOrder } = useWarehouseTransactions()
""",
    """const { processExportRequestToExportOrder, cancelExportRequestRelease } = useWarehouseTransactions()
""",
)
replace_once(
    'pages/warehouse-export-requests.vue',
    """const actionType = ref<'accept' | 'reject' | 'release' | ''>('')
""",
    """const actionType = ref<'accept' | 'reject' | 'release' | 'cancel_release' | ''>('')
""",
)
replace_once(
    'pages/warehouse-export-requests.vue',
    """function canReleaseRequest(row: any) {
  return canReleaseAction.value && !requestHasExported(row)
    && ['da_tiep_nhan', 'cho_xuat_kho', 'loi'].includes(String(row.status || ''))
}
""",
    """function canReleaseRequest(row: any) {
  return canReleaseAction.value && !requestHasExported(row)
    && ['da_tiep_nhan', 'cho_xuat_kho', 'loi'].includes(String(row.status || ''))
}

function canCancelReleasedRequest(row: any) {
  return canReleaseAction.value && canCancelExportRequestRelease(row)
}
""",
)
replace_once(
    'pages/warehouse-export-requests.vue',
    """  if (actionType.value === 'release') return canReleaseRequest(row)
  return false
""",
    """  if (actionType.value === 'release') return canReleaseRequest(row)
  if (actionType.value === 'cancel_release') return canCancelReleasedRequest(row)
  return false
""",
)
replace_once(
    'pages/warehouse-export-requests.vue',
    """function openAction(row: any, type: 'accept' | 'reject' | 'release') {
""",
    """function openAction(row: any, type: 'accept' | 'reject' | 'release' | 'cancel_release') {
""",
)
replace_once(
    'pages/warehouse-export-requests.vue',
    """  if (type === 'release' && !canReleaseRequest(row)) return showToast('Yêu cầu phải được tiếp nhận trước khi cho xuất kho.', 'error')
""",
    """  if (type === 'release' && !canReleaseRequest(row)) return showToast('Yêu cầu phải được tiếp nhận trước khi cho xuất kho.', 'error')
  if (type === 'cancel_release' && !canCancelReleasedRequest(row)) return showToast('Yêu cầu không có phiếu xuất đang hoạt động để hủy.', 'error')
""",
)
replace_once(
    'pages/warehouse-export-requests.vue',
    """  if (actionType.value === 'release') return 'Cho xuất kho'
  return 'Xử lý yêu cầu xuất kho'
""",
    """  if (actionType.value === 'release') return 'Cho xuất kho'
  if (actionType.value === 'cancel_release') return 'Hủy xuất và hoàn tồn'
  return 'Xử lý yêu cầu xuất kho'
""",
)
replace_once(
    'pages/warehouse-export-requests.vue',
    """  if (actionType.value === 'release') return 'Cho xuất kho'
  return 'Xác nhận'
""",
    """  if (actionType.value === 'release') return 'Cho xuất kho'
  if (actionType.value === 'cancel_release') return 'Hủy xuất và hoàn tồn'
  return 'Xác nhận'
""",
)
replace_once(
    'pages/warehouse-export-requests.vue',
    """      orderSummaryPatch: orderPatchAfter(row, 'da_xuat', { warehouse_export_code: 'pending_firestore' }),
""",
    """      orderSummaryPatch: orderPatchAfter(row, 'da_xuat', { warehouse_export_code: 'pending_firestore' }),
      expected_revision: toNumber(row.revision),
""",
)
replace_once(
    'pages/warehouse-export-requests.vue',
    """async function submitAction() {
""",
    """async function submitCancelRelease(row: any) {
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
    notification_recipients: saleNotificationRecipients(row),
    orderSummaryPatch: orderPatchAfter(row, 'da_tiep_nhan', {
      active_export_order_id: '',
      export_order_id: '',
      warehouse_export_order_id: '',
    }),
    operation_id: `export_request_cancel:${row.id}:${toNumber(row.revision)}`,
    expected_request_revision: toNumber(row.revision),
  })
  showToast(
    result.notificationCount
      ? `Đã hủy phiếu ${result.code}, hoàn tồn và mở lại yêu cầu.`
      : `Đã hủy phiếu ${result.code} và hoàn tồn, nhưng không xác định được Sale để gửi thông báo.`,
    result.notificationCount ? 'success' : 'info',
  )
}

async function submitAction() {
""",
)
replace_once(
    'pages/warehouse-export-requests.vue',
    """    if (actionType.value === 'release') await submitRelease(row)
""",
    """    if (actionType.value === 'release') await submitRelease(row)
    if (actionType.value === 'cancel_release') await submitCancelRelease(row)
""",
)
replace_once(
    'pages/warehouse-export-requests.vue',
    """                  <button v-if="canReleaseRequest(row)" class="btn-sm btn-view" @click="openAction(row, 'release')">Cho xuất kho</button>
                  <button v-if="canRejectRequest(row)" class="btn-sm btn-delete" @click="openAction(row, 'reject')">Từ chối</button>
                  <button v-if="!canAcceptRequest(row) && !canReleaseRequest(row) && !canRejectRequest(row)" class="btn-sm" disabled>Khóa</button>
""",
    """                  <button v-if="canReleaseRequest(row)" class="btn-sm btn-view" @click="openAction(row, 'release')">Cho xuất kho</button>
                  <button v-if="canCancelReleasedRequest(row)" class="btn-sm btn-delete" @click="openAction(row, 'cancel_release')">Hủy xuất/Hoàn tồn</button>
                  <button v-if="canRejectRequest(row)" class="btn-sm btn-delete" @click="openAction(row, 'reject')">Từ chối</button>
                  <button v-if="!canAcceptRequest(row) && !canReleaseRequest(row) && !canCancelReleasedRequest(row) && !canRejectRequest(row)" class="btn-sm" disabled>Khóa</button>
""",
)
replace_once(
    'pages/warehouse-export-requests.vue',
    """        <div class="detail-item"><label>Ghi chú kho</label><strong>{{ selectedRequest.warehouse_note || '-' }}</strong></div>
""",
    """        <div class="detail-item"><label>Ghi chú kho</label><strong>{{ selectedRequest.warehouse_note || '-' }}</strong></div>
        <div class="detail-item"><label>Lần xuất</label><strong>{{ selectedRequest.release_sequence || (selectedRequest.export_order_id ? 1 : 0) }}</strong></div>
        <div class="detail-item"><label>Phiếu đã hủy gần nhất</label><strong>{{ selectedRequest.last_cancelled_export_code || '-' }}</strong></div>
""",
)
replace_once(
    'pages/warehouse-export-requests.vue',
    """        <label>{{ actionType === 'reject' ? 'Lý do từ chối' : 'Ghi chú kho' }}</label>
""",
    """        <label>{{ actionType === 'reject' ? 'Lý do từ chối' : actionType === 'cancel_release' ? 'Lý do hủy xuất' : 'Ghi chú kho' }}</label>
""",
)
replace_once(
    'pages/warehouse-export-requests.vue',
    """      <p v-if="actionType === 'release'" class="small subtle">Khi cho xuất kho, hệ thống sẽ check tồn, tạo export_orders/export_order_items, ghi stock_movements và trừ inventory_balances bằng transaction.</p>
""",
    """      <p v-if="actionType === 'release'" class="small subtle">Khi cho xuất kho, hệ thống sẽ check tồn, tạo export_orders/export_order_items, ghi stock_movements và trừ inventory_balances bằng transaction.</p>
      <p v-if="actionType === 'cancel_release'" class="small subtle">Hệ thống sẽ hủy mềm phiếu xuất liên kết, hoàn inventory_balances, ghi stock_movements đảo và mở lại yêu cầu trong cùng transaction.</p>
""",
)

# ---------------------------------------------------------------------------
# Firestore Rules lifecycle linkage
# ---------------------------------------------------------------------------
lifecycle_helpers = r'''    function exportRequestPath(requestId) {
      return /databases/$(database)/documents/order_export_requests/$(requestId);
    }

    function exportOrderPath(exportOrderId) {
      return /databases/$(database)/documents/export_orders/$(exportOrderId);
    }

    function generatedExportOrderData(data) {
      return data.get('source_request_id', '') is string
        && data.get('source_request_id', '') != ''
        && (
          data.get('source', '') == 'kingcup_firestore'
          || data.get('sync_source', '').matches('^kingcup_firestore:.*')
        );
    }

    function generatedExportCreateMatchesRequest(exportOrderId) {
      let requestId = request.resource.data.get('source_request_id', '');
      let path = exportRequestPath(requestId);
      return generatedExportOrderData(request.resource.data)
        && request.resource.data.get('lifecycle_status', '') == 'released'
        && request.resource.data.get('request_operation_id', '') != ''
        && exists(path)
        && existsAfter(path)
        && getAfter(path).data.get('status', '') == 'da_xuat'
        && getAfter(path).data.get('lifecycle_status', '') == 'released'
        && getAfter(path).data.get('active_export_order_id', '') == exportOrderId
        && getAfter(path).data.get('export_order_id', '') == exportOrderId
        && getAfter(path).data.get('release_sequence', 0) == request.resource.data.get('release_sequence', -1)
        && getAfter(path).data.get('operation_id', '') == request.resource.data.get('request_operation_id', '');
    }

    function generatedExportCancelMatchesRequest(exportOrderId) {
      let requestId = resource.data.get('source_request_id', '');
      let path = exportRequestPath(requestId);
      return generatedExportOrderData(resource.data)
        && generatedExportOrderData(request.resource.data)
        && warehouseSoftDeleteOnly()
        && request.resource.data.get('lifecycle_status', '') == 'cancelled'
        && exists(path)
        && existsAfter(path)
        && get(path).data.get('status', '') == 'da_xuat'
        && get(path).data.get('active_export_order_id', '') == exportOrderId
        && getAfter(path).data.get('status', '') in ['da_tiep_nhan', 'cho_xuat_kho']
        && getAfter(path).data.get('lifecycle_status', '') == 'release_cancelled'
        && getAfter(path).data.get('active_export_order_id', '') == ''
        && getAfter(path).data.get('last_cancelled_export_order_id', '') == exportOrderId
        && getAfter(path).data.get('operation_id', '') == request.resource.data.get('operation_id', '');
    }

    function generatedExportItemCreateAllowed() {
      let exportOrderId = request.resource.data.get('export_order_id', '');
      let path = exportOrderPath(exportOrderId);
      return exportOrderId is string
        && exportOrderId != ''
        && existsAfter(path)
        && generatedExportOrderData(getAfter(path).data)
        && getAfter(path).data.get('deleted', false) != true
        && getAfter(path).data.get('active', true) != false;
    }

    function generatedExportItemCancelAllowed() {
      let exportOrderId = resource.data.get('export_order_id', '');
      let path = exportOrderPath(exportOrderId);
      return exportOrderId is string
        && exportOrderId != ''
        && warehouseSoftDeleteOnly()
        && exists(path)
        && existsAfter(path)
        && generatedExportOrderData(get(path).data)
        && getAfter(path).data.get('deleted', false) == true
        && getAfter(path).data.get('active', true) == false
        && getAfter(path).data.get('lifecycle_status', '') == 'cancelled'
        && request.resource.data.get('operation_id', '') == getAfter(path).data.get('operation_id', '');
    }

    function exportRequestReleaseLinkValid() {
      let exportOrderId = request.resource.data.get('active_export_order_id', '');
      let path = exportOrderPath(exportOrderId);
      return exportOrderId is string
        && exportOrderId != ''
        && request.resource.data.get('export_order_id', '') == exportOrderId
        && request.resource.data.get('warehouse_export_order_id', '') == exportOrderId
        && request.resource.data.get('warehouse_export_id', '') == exportOrderId
        && request.resource.data.get('release_sequence', 0) == resource.data.get('release_sequence', 0) + 1
        && existsAfter(path)
        && generatedExportOrderData(getAfter(path).data)
        && getAfter(path).data.get('source_request_id', '') == docId
        && getAfter(path).data.get('release_sequence', -1) == request.resource.data.get('release_sequence', -2)
        && getAfter(path).data.get('request_operation_id', '') == request.resource.data.get('operation_id', '');
    }

    function exportRequestCancelLinkValid() {
      let exportOrderId = resource.data.get('active_export_order_id', '');
      let path = exportOrderPath(exportOrderId);
      return resource.data.get('status', '') == 'da_xuat'
        && exportOrderId is string
        && exportOrderId != ''
        && request.resource.data.get('active_export_order_id', '') == ''
        && request.resource.data.get('last_cancelled_export_order_id', '') == exportOrderId
        && request.resource.data.get('release_sequence', -1) == resource.data.get('release_sequence', -2)
        && exists(path)
        && existsAfter(path)
        && generatedExportOrderData(get(path).data)
        && getAfter(path).data.get('deleted', false) == true
        && getAfter(path).data.get('active', true) == false
        && getAfter(path).data.get('lifecycle_status', '') == 'cancelled'
        && getAfter(path).data.get('operation_id', '') == request.resource.data.get('operation_id', '');
    }

    function exportCreateAllowed() {'''
regex_once(
    'firestore.rules',
    r"    function exportCreateAllowed\(\) \{",
    lifecycle_helpers,
)

new_process_rule = r'''    function exportWarehouseProcessAllowed() {
      let path = userPath();
      let user = get(path).data;
      let permissions = user.get('permissions_flat', []);
      let admin = adminUserData(user);
      let legacyProcess = admin
        || (
          permissions is list
          && 'export_requests.process' in permissions
        );
      let beforeStatus = resource.data.get('status', '');
      let afterStatus = request.resource.data.get('status', '');
      return signedIn()
        && exists(path)
        && activeUserData(user)
        && onlyChanged([
          'status', 'lifecycle_status', 'release_sequence', 'active_export_order_id',
          'warehouse_export_code', 'warehouse_handled_by', 'warehouse_handled_at',
          'warehouse_note', 'warehouse_export_id', 'warehouse_export_order_id',
          'export_order_id', 'exported_at', 'actual_exported_at',
          'actual_export_summary_json', 'stock_movement_ids', 'request_timeline_json',
          'operation_id', 'last_operation_id', 'revision', 'last_released_export_order_id',
          'last_released_export_code', 'last_released_by', 'last_cancelled_export_order_id',
          'last_cancelled_export_code', 'last_cancelled_by', 'last_cancel_reason',
          'last_cancelled_at', 'cancel_count', 'updated_at'
        ])
        && ownEmailField(request.resource.data, 'warehouse_handled_by')
        && (
          (
            afterStatus in ['da_tiep_nhan', 'cho_xuat_kho']
            && beforeStatus in ['cho_xu_ly', 'pending']
            && (
              legacyProcess
              || (permissions is list && 'export_requests.accept' in permissions)
            )
          )
          || (
            afterStatus == 'tu_choi'
            && !(beforeStatus in ['tu_choi', 'da_xuat'])
            && (
              legacyProcess
              || (permissions is list && 'export_requests.reject' in permissions)
            )
          )
          || (
            afterStatus == 'da_xuat'
            && beforeStatus in ['da_tiep_nhan', 'cho_xuat_kho', 'loi']
            && (
              legacyProcess
              || (permissions is list && 'export_requests.release' in permissions)
            )
            && exportRequestReleaseLinkValid()
          )
          || (
            afterStatus in ['da_tiep_nhan', 'cho_xuat_kho']
            && beforeStatus == 'da_xuat'
            && (
              legacyProcess
              || (permissions is list && 'export_requests.release' in permissions)
            )
            && exportRequestCancelLinkValid()
          )
        );
    }
'''
regex_once(
    'firestore.rules',
    r"    function exportWarehouseProcessAllowed\(\) \{.*?\n    \}\n\n    // ---------------------------------------------------------------------\n    // Users, roles and settings",
    new_process_rule + "\n    // ---------------------------------------------------------------------\n    // Users, roles and settings",
)

new_export_rules = r'''    match /export_orders/{docId} {
      allow read: if hasAnyPerm(['export.view', 'export_requests.release', 'export_requests.process']);
      allow create: if ownEmailField(request.resource.data, 'created_by')
        && (
          (
            hasAnyPerm(['export.create'])
            && manualExportOrderData(request.resource.data)
          )
          || (
            hasAnyPerm(['export_requests.release', 'export_requests.process'])
            && generatedExportCreateMatchesRequest(docId)
          )
        );
      allow update: if isAdmin()
        || (
          hasAnyPerm(['export.edit'])
          && manualExportOrderData(resource.data)
          && manualExportOrderData(request.resource.data)
          && warehouseDocIdentitySafe()
          && unchanged([
            'source_request_id', 'sync_source', 'deleted', 'active', 'status',
            'deleted_at', 'deleted_by', 'deleted_reason', 'cancelled_at',
            'cancelled_by', 'cancel_reason'
          ])
        )
        || (
          hasAnyPerm(['export.delete'])
          && manualExportOrderData(resource.data)
          && manualExportOrderData(request.resource.data)
          && warehouseDocIdentitySafe()
          && unchanged(['source_request_id', 'sync_source'])
          && warehouseSoftDeleteOnly()
        )
        || (
          hasAnyPerm(['export_requests.release', 'export_requests.process'])
          && generatedExportCancelMatchesRequest(docId)
          && unchanged([
            'source_request_id', 'sync_source', 'source', 'release_sequence',
            'source_request_revision', 'request_operation_id', 'created_at', 'created_by'
          ])
        );
      allow delete: if isAdmin();
    }

    match /export_order_items/{docId} {
      allow read: if hasAnyPerm(['export.view', 'export_requests.release', 'export_requests.process']);
      allow create: if request.resource.data.export_order_id is string
        && quantityIsNumber(request.resource.data)
        && request.resource.data.get('quantity', 0) > 0
        && ownEmailField(request.resource.data, 'created_by')
        && (
          (
            hasAnyPerm(['export.create'])
            && manualExportOrderById(request.resource.data.export_order_id)
          )
          || (
            hasAnyPerm(['export_requests.release', 'export_requests.process'])
            && generatedExportItemCreateAllowed()
          )
          || (
            hasAnyPerm(['export.edit'])
            && manualExportOrderById(request.resource.data.export_order_id)
          )
        );
      allow update: if isAdmin()
        || (
          hasAnyPerm(['export.edit'])
          && resource.data.export_order_id is string
          && manualExportOrderById(resource.data.export_order_id)
          && unchanged(['export_order_id', 'created_at', 'created_by', 'source'])
          && quantityIsNumber(request.resource.data)
          && request.resource.data.get('quantity', 0) > 0
        )
        || (
          hasAnyPerm(['export.delete'])
          && resource.data.export_order_id is string
          && manualExportOrderById(resource.data.export_order_id)
          && unchanged(['export_order_id', 'created_at', 'created_by', 'source'])
          && warehouseSoftDeleteOnly()
        )
        || (
          hasAnyPerm(['export_requests.release', 'export_requests.process'])
          && unchanged(['export_order_id', 'created_at', 'created_by', 'source'])
          && generatedExportItemCancelAllowed()
        );
      allow delete: if isAdmin();
    }
'''
regex_once(
    'firestore.rules',
    r"    match /export_orders/\{docId\} \{.*?\n    match /inventory_adjustments/\{docId\} \{",
    new_export_rules + "\n    match /inventory_adjustments/{docId} {",
)

# ---------------------------------------------------------------------------
# Types and test command
# ---------------------------------------------------------------------------
replace_once(
    'types/models.ts',
    """  request_timeline_json?: string
}

export interface ShipmentDoc""",
    """  request_timeline_json?: string
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

export interface ShipmentDoc""",
)

package = Path('package.json')
source = package.read_text(encoding='utf-8')
needle = 'tests/order-relations.rules.test.mjs tests/firebase-error-message.static.test.mjs'
replacement = 'tests/order-relations.rules.test.mjs tests/export-lifecycle.client.test.mjs tests/export-lifecycle.rules.test.mjs tests/firebase-error-message.static.test.mjs'
if needle not in source:
    raise SystemExit('Missing package test insertion point')
package.write_text(source.replace(needle, replacement, 1), encoding='utf-8')

print('Step 8 export lifecycle patches applied')
