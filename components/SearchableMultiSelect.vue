<script setup lang="ts">
type SelectValue = string | number

type OptionItem = {
  value: SelectValue
  label: string
  subLabel?: string
  search?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  modelValue?: SelectValue[]
  options: OptionItem[]
  placeholder?: string
  disabled?: boolean
  noResultText?: string
  searchPlaceholder?: string
}>(), {
  modelValue: () => [],
  placeholder: 'Chọn dữ liệu',
  disabled: false,
  noResultText: 'Không tìm thấy dữ liệu phù hợp',
  searchPlaceholder: 'Gõ để tìm...',
})

const emit = defineEmits<{
  'update:modelValue': [value: SelectValue[]]
  change: [value: SelectValue[]]
}>()

const open = ref(false)
const keyword = ref('')
const rootRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const panelStyle = ref<Record<string, string>>({})

function valueKey(value: SelectValue) {
  return `${typeof value}:${String(value)}`
}

function normalize(value: any) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim()
}

const selectedKeys = computed(() => new Set((props.modelValue || []).map(valueKey)))
const selectedOptions = computed(() => props.options.filter(option => selectedKeys.value.has(valueKey(option.value))))
const previewOptions = computed(() => selectedOptions.value.slice(0, 3))
const remainingCount = computed(() => Math.max(0, selectedOptions.value.length - previewOptions.value.length))
const filtered = computed(() => {
  const query = normalize(keyword.value)
  if (!query) return props.options.slice(0, 100)
  return props.options
    .filter(option => normalize(`${option.label} ${option.subLabel || ''} ${option.search || ''}`).includes(query))
    .slice(0, 100)
})

function isSelected(option: OptionItem) {
  return selectedKeys.value.has(valueKey(option.value))
}

function emitValue(value: SelectValue[]) {
  emit('update:modelValue', value)
  emit('change', value)
}

function toggleOption(option: OptionItem) {
  if (option.disabled) return
  const current = [...(props.modelValue || [])]
  const key = valueKey(option.value)
  const index = current.findIndex(value => valueKey(value) === key)
  if (index >= 0) current.splice(index, 1)
  else current.push(option.value)
  emitValue(current)
}

function removeOption(option: OptionItem) {
  const key = valueKey(option.value)
  emitValue((props.modelValue || []).filter(value => valueKey(value) !== key))
}

function clearAll() {
  emitValue([])
}

function updatePanelPosition() {
  if (!process.client || !rootRef.value) return
  const rect = rootRef.value.getBoundingClientRect()
  const gap = 8
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const width = Math.min(Math.max(rect.width, 280), Math.max(280, viewportWidth - gap * 2))
  const left = Math.min(Math.max(gap, rect.left), Math.max(gap, viewportWidth - width - gap))
  const bottomSpace = Math.max(0, viewportHeight - rect.bottom - gap)
  const topSpace = Math.max(0, rect.top - gap)
  const openAbove = bottomSpace < 320 && topSpace > bottomSpace
  const availableSpace = Math.max(160, (openAbove ? topSpace : bottomSpace) - 6)
  const maxHeight = Math.min(420, availableSpace)

  panelStyle.value = {
    position: 'fixed',
    left: `${left}px`,
    right: 'auto',
    width: `${width}px`,
    zIndex: '150',
    maxHeight: `${maxHeight}px`,
    top: openAbove ? 'auto' : `${rect.bottom + 6}px`,
    bottom: openAbove ? `${viewportHeight - rect.top + 6}px` : 'auto',
  }
}

async function toggleOpen() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) {
    await nextTick()
    updatePanelPosition()
    inputRef.value?.focus()
  }
}

function onOutside(event: MouseEvent) {
  const target = event.target as Node
  if (rootRef.value?.contains(target) || panelRef.value?.contains(target)) return
  open.value = false
}

function onWindowMove() {
  if (open.value) updatePanelPosition()
}

watch(open, value => {
  if (value) nextTick(updatePanelPosition)
  else keyword.value = ''
})

onMounted(() => {
  document.addEventListener('click', onOutside)
  window.addEventListener('resize', onWindowMove)
  window.addEventListener('scroll', onWindowMove, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onOutside)
  window.removeEventListener('resize', onWindowMove)
  window.removeEventListener('scroll', onWindowMove, true)
})
</script>

<template>
  <div ref="rootRef" class="searchable-multi-select" :class="{ disabled }">
    <button
      type="button"
      class="searchable-multi-select-trigger"
      :disabled="disabled"
      :aria-expanded="open"
      @click.stop="toggleOpen"
    >
      <span v-if="selectedOptions.length" class="selected-summary">
        <b>{{ selectedOptions.length }} lựa chọn</b>
        <small>{{ previewOptions.map(option => option.label).join(', ') }}<template v-if="remainingCount"> và {{ remainingCount }} tỉnh khác</template></small>
      </span>
      <span v-else class="placeholder">{{ placeholder }}</span>
      <span class="chevron">⌄</span>
    </button>

    <div v-if="selectedOptions.length" class="selected-chips">
      <button
        v-for="option in selectedOptions"
        :key="valueKey(option.value)"
        type="button"
        class="selected-chip"
        :disabled="disabled"
        :title="`Bỏ chọn ${option.label}`"
        @click.stop="removeOption(option)"
      >
        <span>{{ option.label }}</span><span aria-hidden="true">×</span>
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="open"
        ref="panelRef"
        class="searchable-multi-select-panel"
        :style="panelStyle"
        @click.stop
      >
        <div class="panel-header">
          <input
            ref="inputRef"
            v-model="keyword"
            class="input"
            :placeholder="searchPlaceholder"
            @keydown.esc="open = false"
          />
          <button v-if="selectedOptions.length" type="button" class="clear-button" @click="clearAll">Bỏ chọn hết</button>
        </div>

        <div class="option-list">
          <button
            v-for="option in filtered"
            :key="valueKey(option.value)"
            type="button"
            class="option-item"
            :class="{ active: isSelected(option), disabled: option.disabled }"
            @click="toggleOption(option)"
          >
            <span class="check-box" aria-hidden="true">{{ isSelected(option) ? '✓' : '' }}</span>
            <span class="option-text"><b>{{ option.label }}</b><small v-if="option.subLabel">{{ option.subLabel }}</small></span>
          </button>
          <div v-if="!filtered.length" class="empty-option">{{ noResultText }}</div>
        </div>

        <div class="panel-footer">
          <span>{{ selectedOptions.length.toLocaleString('vi-VN') }} đã chọn</span>
          <button type="button" class="done-button" @click="open = false">Xong</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.searchable-multi-select { width: 100%; }
.searchable-multi-select.disabled { opacity: .65; }
.searchable-multi-select-trigger { width: 100%; min-height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 9px; background: #fff; color: #0f172a; text-align: left; cursor: pointer; }
.searchable-multi-select-trigger:focus { outline: 2px solid rgba(37, 99, 235, .18); border-color: #2563eb; }
.searchable-multi-select-trigger:disabled { cursor: not-allowed; }
.selected-summary { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.selected-summary small { color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.placeholder { color: #94a3b8; }
.chevron { flex: 0 0 auto; color: #64748b; }
.selected-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.selected-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 5px 9px; border: 1px solid #bfdbfe; border-radius: 999px; background: #eff6ff; color: #1d4ed8; font-size: 12px; cursor: pointer; }
.selected-chip span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.searchable-multi-select-panel { display: flex; flex-direction: column; overflow: hidden; border: 1px solid #cbd5e1; border-radius: 12px; background: #fff; box-shadow: 0 18px 45px rgba(15, 23, 42, .2); }
.panel-header { flex: 0 0 auto; display: flex; gap: 8px; padding: 10px; border-bottom: 1px solid #e2e8f0; }
.panel-header .input { min-width: 0; flex: 1 1 auto; }
.clear-button, .done-button { flex: 0 0 auto; border: 0; border-radius: 8px; font-weight: 700; cursor: pointer; }
.clear-button { padding: 0 8px; background: transparent; color: #dc2626; }
.option-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 6px; }
.option-item { width: 100%; display: flex; align-items: flex-start; gap: 10px; padding: 9px 10px; border: 0; border-radius: 8px; background: transparent; color: #0f172a; text-align: left; cursor: pointer; }
.option-item:hover { background: #f8fafc; }
.option-item.active { background: #eff6ff; color: #1d4ed8; }
.option-item.disabled { opacity: .55; cursor: not-allowed; }
.check-box { width: 19px; height: 19px; flex: 0 0 19px; display: inline-flex; align-items: center; justify-content: center; margin-top: 1px; border: 1px solid #94a3b8; border-radius: 5px; font-size: 13px; font-weight: 800; }
.option-item.active .check-box { border-color: #2563eb; background: #2563eb; color: #fff; }
.option-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.option-text small { color: #64748b; }
.empty-option { padding: 22px 12px; color: #64748b; text-align: center; }
.panel-footer { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 10px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 13px; }
.done-button { padding: 8px 14px; background: #2563eb; color: #fff; }
@media (max-width: 560px) { .panel-header { flex-direction: column; } .clear-button { min-height: 34px; } }
</style>
