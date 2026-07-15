<script setup lang="ts">
import { formatDateTime } from '~/utils/format'

const open = ref(false)
const busy = ref(false)
const panel = ref<HTMLElement | null>(null)
const { appUser } = useAuth()
const { items, unreadCount, loading, error, start, stop, markRead, markAllRead } = useNotifications()

watch(
  () => [appUser.value?.email, JSON.stringify(appUser.value?.permissions_flat || [])],
  () => start(),
  { immediate: true },
)

onBeforeUnmount(stop)

async function openNotification(item: any) {
  try {
    await markRead(item.id)
  } finally {
    open.value = false
    if (item.route) await navigateTo(item.route)
  }
}

async function readAll() {
  busy.value = true
  try {
    await markAllRead()
  } finally {
    busy.value = false
  }
}

function closeOnOutside(event: MouseEvent) {
  if (!open.value) return
  const target = event.target as Node
  if (panel.value?.contains(target)) return
  open.value = false
}

onMounted(() => document.addEventListener('click', closeOnOutside))
onBeforeUnmount(() => document.removeEventListener('click', closeOnOutside))
</script>

<template>
  <div ref="panel" class="notification-center">
    <button class="notification-trigger" type="button" @click.stop="open = !open">
      <span>Thông báo</span>
      <span v-if="unreadCount" class="notification-count">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
    </button>

    <Teleport to="body">
      <div v-if="open" class="notification-panel" @click.stop>
        <div class="notification-panel-header">
          <div>
            <strong>Thông báo</strong>
            <div class="small subtle">{{ unreadCount }} chưa đọc</div>
          </div>
          <button class="btn-sm" :disabled="busy || !unreadCount" @click="readAll">
            Đánh dấu đã đọc
          </button>
        </div>

        <div v-if="loading && !items.length" class="notification-empty">Đang tải...</div>
        <div v-else-if="error && !items.length" class="notification-empty">{{ error }}</div>
        <div v-else-if="!items.length" class="notification-empty">Chưa có thông báo.</div>
        <div v-else class="notification-list">
          <button
            v-for="item in items"
            :key="item.id"
            type="button"
            class="notification-item"
            :class="{ unread: !item.is_read }"
            @click="openNotification(item)"
          >
            <span class="notification-dot" />
            <span class="notification-content">
              <strong>{{ item.title || 'Thông báo' }}</strong>
              <span>{{ item.message || '-' }}</span>
              <small>{{ formatDateTime(item.created_at) }}</small>
            </span>
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
