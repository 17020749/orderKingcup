<script setup lang="ts">
type FilterOption = { label: string; value: string }
type FilterConfig = {
  key: string
  label?: string
  type?: 'select' | 'date'
  placeholder?: string
  allLabel?: string
  options?: FilterOption[]
  width?: string
}

const props = withDefaults(defineProps<{
  search?: string
  searchPlaceholder?: string
  searchWidth?: string
  filters?: FilterConfig[]
  values?: Record<string, string>
  resultCount?: number
  loading?: boolean
  resetLabel?: string
  refreshLabel?: string
  showRefresh?: boolean
}>(), {
  search: '', searchPlaceholder: 'Tìm kiếm...', searchWidth: '420px', filters: () => [],
  values: () => ({}), resultCount: undefined, loading: false,
  resetLabel: 'Xóa lọc', refreshLabel: 'Làm mới', showRefresh: false,
})

const emit = defineEmits<{
  'update:search': [value: string]
  'update:filter': [key: string, value: string]
  reset: []
  refresh: []
}>()

function filterValue(key: string) { return props.values?.[key] || '' }
</script>

<template>
  <div class="toolbar filter-toolbar">
    <div class="filter-field filter-field--search">
      <label class="filter-label" for="shared-filter-search">Tìm kiếm</label>
      <input id="shared-filter-search" :value="search" class="input" type="search" :style="{ maxWidth: searchWidth }" :placeholder="searchPlaceholder" @input="emit('update:search', ($event.target as HTMLInputElement).value)" />
    </div>

    <div v-for="filter in filters" :key="filter.key" class="filter-field">
      <label class="filter-label" :for="`shared-filter-${filter.key}`">{{ filter.label || filter.key }}</label>
      <input v-if="filter.type === 'date'" :id="`shared-filter-${filter.key}`" :value="filterValue(filter.key)" class="input" type="date" :aria-label="filter.label || filter.placeholder || filter.key" :style="{ maxWidth: filter.width || '170px' }" @input="emit('update:filter', filter.key, ($event.target as HTMLInputElement).value)" />
      <select v-else :id="`shared-filter-${filter.key}`" :value="filterValue(filter.key)" class="select" :aria-label="filter.label || filter.placeholder || filter.key" :style="{ maxWidth: filter.width || '200px' }" @change="emit('update:filter', filter.key, ($event.target as HTMLSelectElement).value)">
        <option value="">{{ filter.allLabel || filter.placeholder || filter.label || 'Tất cả' }}</option>
        <option v-for="option in filter.options || []" :key="`${filter.key}-${option.value}`" :value="option.value">{{ option.label }}</option>
      </select>
    </div>

    <div class="filter-actions">
      <button class="btn" type="button" @click="emit('reset')">{{ resetLabel }}</button>
      <button v-if="showRefresh" class="btn btn-primary" type="button" :disabled="loading" @click="emit('refresh')">{{ loading ? 'Đang tải...' : refreshLabel }}</button>
      <span v-if="typeof resultCount === 'number'" class="small subtle">{{ resultCount }} kết quả</span>
    </div>
  </div>
</template>
