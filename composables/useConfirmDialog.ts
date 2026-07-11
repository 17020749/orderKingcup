type ConfirmOptions = {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'primary'
}

export function useConfirmDialog() {
  const confirmState = reactive({
    show: false,
    title: 'Xác nhận thao tác',
    message: '',
    confirmLabel: 'Xác nhận',
    cancelLabel: 'Hủy',
    variant: 'danger' as 'danger' | 'primary'
  })

  let resolver: ((value: boolean) => void) | null = null

  function askConfirm(options: ConfirmOptions) {
    confirmState.title = options.title || 'Xác nhận thao tác'
    confirmState.message = options.message
    confirmState.confirmLabel = options.confirmLabel || 'Xác nhận'
    confirmState.cancelLabel = options.cancelLabel || 'Hủy'
    confirmState.variant = options.variant || 'danger'
    confirmState.show = true

    return new Promise<boolean>(resolve => {
      resolver = resolve
    })
  }

  function resolveConfirm(value: boolean) {
    confirmState.show = false
    if (resolver) resolver(value)
    resolver = null
  }

  return { confirmState, askConfirm, resolveConfirm }
}
