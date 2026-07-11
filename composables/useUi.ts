type ToastType = 'success' | 'error' | 'info'

export function useUi() {
  const loadingCount = useState<number>('ui.loadingCount', () => 0)
  const toast = useState<{ message: string; type: ToastType; visible: boolean }>('ui.toast', () => ({
    message: '',
    type: 'info',
    visible: false
  }))

  let timer: any

  function showLoading() {
    loadingCount.value += 1
  }

  function hideLoading() {
    loadingCount.value = Math.max(0, loadingCount.value - 1)
  }

  async function withLoading<T>(fn: () => Promise<T>) {
    showLoading()
    try {
      return await fn()
    } finally {
      hideLoading()
    }
  }

  function showToast(message: string, type: ToastType = 'info') {
    toast.value = { message, type, visible: true }
    clearTimeout(timer)
    timer = setTimeout(() => {
      toast.value.visible = false
    }, 4200)
  }

  function closeToast() {
    toast.value.visible = false
  }

  return {
    loadingCount,
    isLoading: computed(() => loadingCount.value > 0),
    toast,
    showLoading,
    hideLoading,
    withLoading,
    showToast,
    closeToast
  }
}
