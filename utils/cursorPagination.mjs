export function appendUniqueRows(existingRows = [], incomingRows = []) {
  const rows = new Map()
  for (const row of [...existingRows, ...incomingRows]) {
    const id = String(row?.id || row?.firestore_id || '').trim()
    if (!id) continue
    rows.set(id, row)
  }
  return Array.from(rows.values())
}

export function createCursorState() {
  return {
    cursor: null,
    hasMore: false,
    mode: 'cursor',
  }
}
