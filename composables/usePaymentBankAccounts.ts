import type { AnyDoc } from '~/types/models'
import { isActive } from '~/utils/format'

export type PaymentBankAccountDoc = {
  id: string
  recipient_name: string
  account_number: string
  bank_name: string
  status?: string
  active?: boolean
  deleted?: boolean
  created_by?: string
  created_at?: any
  updated_at?: any
}

export function usePaymentBankAccounts() {
  const { appUser, isAdmin } = useAuth()
  const { listDocs, saveDoc, softDeleteDoc, q } = useRepo()

  function assertAdmin() {
    if (!isAdmin.value) throw new Error('Chỉ admin được thiết lập tài khoản nhận tiền.')
  }

  async function loadPaymentBankAccounts() {
    const values = await listDocs('payment_bank_accounts', [
      q.where('active', '==', true),
      q.where('deleted', '==', false),
    ])

    return values
      .filter(isActive)
      .map((value: AnyDoc): PaymentBankAccountDoc => ({
        id: String(value.id || value.firestore_id || ''),
        recipient_name: String(value.recipient_name || ''),
        account_number: String(value.account_number || ''),
        bank_name: String(value.bank_name || ''),
        status: value.status,
        active: value.active,
        deleted: value.deleted,
        created_by: value.created_by,
        created_at: value.created_at,
        updated_at: value.updated_at,
      }))
      .sort((a, b) => `${a.bank_name} ${a.account_number}`.localeCompare(`${b.bank_name} ${b.account_number}`, 'vi'))
  }

  async function persistPaymentBankAccount(
    account: Pick<PaymentBankAccountDoc, 'id' | 'recipient_name' | 'account_number' | 'bank_name'> & Partial<PaymentBankAccountDoc>,
    isCreate: boolean,
  ) {
    assertAdmin()
    const id = String(account.id || '').trim()
    if (!id) throw new Error('Thiếu ID tài khoản nhận tiền.')

    return await saveDoc('payment_bank_accounts', {
      ...account,
      id,
      status: 'active',
      active: true,
      deleted: false,
      created_by: account.created_by || appUser.value?.email || '',
    }, id, { isCreate }) as PaymentBankAccountDoc
  }

  async function deletePaymentBankAccount(account: PaymentBankAccountDoc) {
    assertAdmin()
    await softDeleteDoc(
      'payment_bank_accounts',
      account.id,
      `${account.bank_name} - ${account.account_number}`,
    )
  }

  return {
    loadPaymentBankAccounts,
    persistPaymentBankAccount,
    deletePaymentBankAccount,
  }
}
