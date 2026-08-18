export function externalExportManifestCountMatches(exportOrder, observedItemCount) {
  const observed = Number(observedItemCount)
  if (!Number.isInteger(observed) || observed < 1) return false

  const rawCount = exportOrder?.item_count
  if (rawCount === undefined || rawCount === null) return true

  const declared = Number(rawCount)
  return Number.isInteger(declared) && declared >= 1 && declared === observed
}

function encodeNotificationIdPart(value) {
  return encodeURIComponent(String(value ?? '').trim())
}

export function notificationDocumentId(operation, requestId, recipient) {
  const encodedParts = [
    encodeNotificationIdPart(operation),
    encodeNotificationIdPart(requestId),
    encodeNotificationIdPart(String(recipient ?? '').trim().toLowerCase()),
  ]
  const framed = encodedParts.map(part => `${part.length}_${part}`).join('__')
  const id = `warehouse__${framed}`
  if (id.length > 1500) {
    throw new Error('Notification document ID exceeds Firestore limit.')
  }
  return id
}
