import {
  VIETNAM_PROVINCES_V1,
  VIETNAM_PROVINCES_V1_API_URL,
  type VietnamProvince,
} from '~/data/vietnamProvincesV1'
import { normalizeText } from '~/utils/format'

function normalizeProvinceList(value: unknown): VietnamProvince[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<number>()
  return value
    .map((item: any) => ({
      code: Number(item?.code),
      name: String(item?.name || '').trim(),
      codename: String(item?.codename || '').trim(),
    }))
    .filter((item) => {
      if (!Number.isInteger(item.code) || item.code <= 0 || !item.name || seen.has(item.code)) return false
      seen.add(item.code)
      return true
    })
    .sort((left, right) => left.code - right.code)
}

export function useVietnamProvinces() {
  const provinces = useState<VietnamProvince[]>('vietnam-provinces-v1.items', () => [...VIETNAM_PROVINCES_V1])
  const loading = useState<boolean>('vietnam-provinces-v1.loading', () => false)
  const attempted = useState<boolean>('vietnam-provinces-v1.attempted', () => false)
  const error = useState<string>('vietnam-provinces-v1.error', () => '')

  const options = computed(() => provinces.value.map(province => ({
    value: province.code,
    label: province.name,
    search: `${province.name} ${province.codename}`,
  })))

  const selectOptions = computed(() => provinces.value.map(province => ({
    value: String(province.code),
    label: province.name,
    search: `${province.name} ${province.codename}`,
  })))

  const provinceMap = computed(() => new Map(provinces.value.map(province => [province.code, province])))

  function provinceName(code: unknown) {
    const normalizedCode = Number(code)
    return Number.isInteger(normalizedCode) ? provinceMap.value.get(normalizedCode)?.name || '' : ''
  }

  function provinceNames(codes: unknown) {
    if (!Array.isArray(codes)) return []
    return Array.from(new Set(codes
      .map(code => provinceName(code))
      .filter(Boolean)))
  }

  function searchText(code: unknown) {
    const province = provinceMap.value.get(Number(code))
    return province ? normalizeText(`${province.name} ${province.codename}`) : ''
  }

  async function loadProvinces(force = false) {
    if (loading.value || (attempted.value && !force)) return provinces.value
    loading.value = true
    error.value = ''
    try {
      const response = await $fetch<unknown>(VIETNAM_PROVINCES_V1_API_URL)
      const normalized = normalizeProvinceList(response)
      if (normalized.length < 60) throw new Error('Danh sách tỉnh thành không đầy đủ.')
      provinces.value = normalized
    } catch (cause: any) {
      provinces.value = [...VIETNAM_PROVINCES_V1]
      error.value = String(cause?.message || cause || 'Không tải được danh sách tỉnh thành.')
    } finally {
      attempted.value = true
      loading.value = false
    }
    return provinces.value
  }

  return {
    provinces,
    options,
    selectOptions,
    loading,
    error,
    loadProvinces,
    provinceName,
    provinceNames,
    searchText,
  }
}
