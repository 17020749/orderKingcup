export default defineNuxtPlugin(() => {
  const { authReady, authorizationRevision } = useAuth()
  let initialRevision = authorizationRevision.value

  watch(authorizationRevision, (nextRevision, previousRevision) => {
    if (!authReady.value) {
      initialRevision = nextRevision
      return
    }
    if (previousRevision === 0 || nextRevision === initialRevision) return

    // Quyền có thể làm thay đổi route, nút thao tác, phạm vi query và listener
    // realtime trên cùng một màn hình. Reload một lần giúp tất cả thành phần dùng
    // cùng phiên bản permissions_flat, thay vì để từng page tự xử lý khác nhau.
    window.location.reload()
  })
})
