import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore'
import type { CustomerDoc } from '~/types/models'
import { generateCustomerCode, isValidCustomerCode } from '~/utils/customerCode'
import { makeId, normalizeEmail, normalizeText } from '~/utils/format'
import { invalidateScopedCache } from '~/composables/useScopedQueries'

type CustomerInput = Partial<CustomerDoc> & Record<string, any>

export function useCustomerManagement() {
  const { db } = useFirebaseServices()
  const { appUser } = useAuth()

  function actorEmail() {
    return normalizeEmail(appUser.value?.email || '')
  }

  function localCustomer(data: CustomerInput, id: string, customerCode: string, isCreate: boolean) {
    const now = new Date().toISOString()
    return {
      ...data,
      id,
      firestore_id: id,
      customer_code: customerCode,
      created_by: data.created_by || actorEmail(),
      active: data.active ?? true,
      deleted: data.deleted ?? false,
      updated_at: now,
      ...(isCreate && !data.created_at ? { created_at: now } : {}),
    } as CustomerDoc
  }

  async function saveCustomer(data: CustomerInput, existing?: CustomerDoc | null) {
    const actor = actorEmail()
    if (!actor) throw new Error('Bạn chưa đăng nhập.')

    const customerName = String(data.customer_name || '').trim()
    if (!customerName) throw new Error('Thiếu tên khách hàng.')

    let customerId = existing?.id || String(data.id || makeId('cus'))
    const isCreate = !existing
    const currentCode = String(existing?.customer_code || '').trim().toUpperCase()
    const preferredCode = String(data.customer_code || '').trim().toUpperCase()
    const maxAttempts = currentCode ? 1 : 12

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const customerCode = currentCode || (attempt === 0 && isValidCustomerCode(preferredCode)
        ? preferredCode
        : generateCustomerCode())
      const customerRef = doc(db, 'customers', customerId)
      const codeRef = doc(db, 'customer_codes', customerCode)
      const activityRef = doc(collection(db, 'activity_logs'))

      try {
        await runTransaction(db, async transaction => {
          const [customerSnapshot, codeSnapshot] = await Promise.all([
            transaction.get(customerRef),
            transaction.get(codeRef),
          ])

          if (isCreate && customerSnapshot.exists()) throw new Error('CUSTOMER_ID_COLLISION')
          if (codeSnapshot.exists() && codeSnapshot.data().customer_id !== customerId) {
            throw new Error('CUSTOMER_CODE_COLLISION')
          }

          const now = serverTimestamp()
          const payload = {
            ...data,
            id: customerId,
            customer_code: customerCode,
            customer_name: customerName,
            phone: String(data.phone || '').trim(),
            email: String(data.email || '').trim(),
            customer_name_norm: normalizeText(customerName),
            phone_norm: normalizeText(data.phone).replace(/\s/g, ''),
            updated_at: now,
            ...(isCreate ? {
              created_by: actor,
              created_at: now,
              active: true,
              deleted: false,
              status: data.status || 'active',
            } : {}),
          }
          delete payload.firestore_id

          transaction.set(customerRef, payload, { merge: !isCreate })
          if (!codeSnapshot.exists()) {
            transaction.set(codeRef, {
              customer_code: customerCode,
              customer_id: customerId,
              created_by: actor,
              created_at: now,
              active: true,
              deleted: false,
            })
          }
          transaction.set(activityRef, {
            module: 'customers',
            action: isCreate ? 'create' : 'update',
            item_code: customerCode,
            item_name: customerName,
            changed_by: actor,
            after_json: JSON.stringify({ ...data, id: customerId, customer_code: customerCode }),
            created_at: now,
            active: true,
            deleted: false,
          })
        })

        invalidateScopedCache('customers')
        invalidateScopedCache('customer_codes')
        invalidateScopedCache('activity_logs')
        return localCustomer(data, customerId, customerCode, isCreate)
      } catch (error: any) {
        if (error?.message === 'CUSTOMER_ID_COLLISION' && isCreate) {
          customerId = makeId('cus')
        }
        if (['CUSTOMER_CODE_COLLISION', 'CUSTOMER_ID_COLLISION'].includes(error?.message) && attempt + 1 < maxAttempts) {
          continue
        }
        throw error
      }
    }

    throw new Error('Không thể tạo Mã khách duy nhất. Vui lòng thử lại.')
  }

  return { saveCustomer }
}
