<script setup lang="ts">
type OptionItem = {
  value: string
  label: string
  subLabel?: string
  search?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  modelValue?: string
  options: OptionItem[]
  placeholder?: string
  disabled?: boolean
  noResultText?: string
}>(), {
  modelValue: '',
  placeholder: 'Chọn dữ liệu',
  disabled: false,
  noResultText: 'Không tìm thấy dữ liệu phù hợp'
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const open = ref(false)
const keyword = ref('')
const rootRef = ref<HTMLElement | null>(null)

const selected = computed(() => props.options.find(option => option.value === props.modelValue))
const filtered = computed(() => {
  const q = normalize(keyword.value)
  if (!q) return props.options.slice(0, 80)
  return props.options.filter(option => normalize(`${option.label} ${option.subLabel || ''} ${option.search || ''}`).includes(q)).slice(0, 80)
})

function normalize(value: any) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function choose(option: OptionItem) {
  if (option.disabled) return
  emit('update:modelValue', option.value)
  emit('change', option.value)
  open.value = false
  keyword.value = ''
}

function onOutside(event: MouseEvent) {
  if (!rootRef.value?.contains(event.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('click', onOutside))
onBeforeUnmount(() => document.removeEventListener('click', onOutside))
</script>

<template>
  <div ref="rootRef" class="searchable-select" :class="{ disabled }">
    <button type="button" class="searchable-select-trigger" :disabled="disabled" @click.stop="open = !open">
      <span v-if="selected">
        <b>{{ selected.label }}</b>
        <small v-if="selected.subLabel">{{ selected.subLabel }}</small>
      </span>
      <span v-else class="placeholder">{{ placeholder }}</span>
      <span class="chevron">⌄</span>
    </button>

    <div v-if="open" class="searchable-select-panel" @click.stop>
      <input v-model="keyword" class="input searchable-select-input" placeholder="Gõ để tìm..." autofocus />
      <div class="searchable-select-options">
        <button
          v-for="option in filtered"
          :key="option.value"
          type="button"
          class="searchable-select-option"
          :class="{ active: option.value === modelValue, disabled: option.disabled }"
          @click="choose(option)"
        >
          <b>{{ option.label }}</b>
          <small v-if="option.subLabel">{{ option.subLabel }}</small>
        </button>
        <div v-if="!filtered.length" class="searchable-select-empty">{{ noResultText }}</div>
      </div>
    </div>
  </div>
</template>
