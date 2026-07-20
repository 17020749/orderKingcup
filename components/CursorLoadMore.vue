<script setup lang="ts">
const props = withDefaults(defineProps<{
  loadedCount: number
  hasMore?: boolean
  loading?: boolean
  mode?: 'cursor' | 'full'
}>(), {
  hasMore: false,
  loading: false,
  mode: 'cursor',
})

defineEmits<{ loadMore: [] }>()

const statusText = computed(() => {
  if (props.mode === 'full') return `Đã tải toàn bộ ${props.loadedCount} bản ghi trong phạm vi quyền.`
  return `Đã tải ${props.loadedCount} bản ghi.`
})
</script>

<template>
  <div class="cursor-load-more">
    <span class="small subtle">{{ statusText }}</span>
    <button
      v-if="mode === 'cursor' && hasMore"
      class="btn"
      type="button"
      :disabled="loading"
      @click="$emit('loadMore')"
    >
      {{ loading ? 'Đang tải…' : 'Tải thêm' }}
    </button>
    <span v-else-if="mode === 'cursor'" class="small subtle">Đã tải hết dữ liệu.</span>
  </div>
</template>

<style scoped>
.cursor-load-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 16px;
  border-top: 1px solid var(--border, #e5e7eb);
}
</style>
