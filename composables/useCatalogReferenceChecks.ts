import { collection, getDocs, query, where } from 'firebase/firestore'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { catalogReferencePlan, summarizeCatalogReferenceUsage } from '~/utils/catalogReferencePlan.mjs'

export type CatalogReferenceTab = 'warehouses' | 'suppliers' | 'units'

function isActiveReference(row: Record<string, any>) {
  const status = String(row?.status || '').trim().toLowerCase()
  return row?.deleted !== true
    && row?.active !== false
    && status !== 'deleted'
    && status !== 'đã xóa'
}

export function useCatalogReferenceChecks() {
  const { db } = useFirebaseServices()

  async function checkCatalogUsage(tab: CatalogReferenceTab, row: Record<string, any>) {
    const plan = catalogReferencePlan(tab, row)
    const counts: Record<string, number> = {}
    const seenByGroup = new Map<string, Set<string>>()

    await Promise.all(plan.map(async (probe: any) => {
      if (!Array.isArray(probe.values) || !probe.values.length) return
      const snapshot = await getDocs(query(
        collection(db, probe.collection),
        probe.values.length === 1
          ? where(probe.field, '==', probe.values[0])
          : where(probe.field, 'in', probe.values),
      ))
      if (!seenByGroup.has(probe.group)) seenByGroup.set(probe.group, new Set())
      const seen = seenByGroup.get(probe.group)!
      snapshot.docs.forEach(document => {
        if (!isActiveReference(document.data() as Record<string, any>)) return
        seen.add(`${probe.collection}:${document.id}`)
      })
    }))

    seenByGroup.forEach((ids, group) => {
      counts[group] = ids.size
    })
    return summarizeCatalogReferenceUsage(tab, counts)
  }

  return { checkCatalogUsage }
}
