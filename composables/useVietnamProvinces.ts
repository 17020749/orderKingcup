import {
  VIETNAM_PROVINCES_V1,
  VIETNAM_PROVINCES_V1_API_URL,
  type VietnamProvince,
} from '~/data/vietnamProvincesV1'
import { VIETNAM_DISTRICTS_V1_GZIP_BASE64 } from '~/data/vietnamDistrictsV1'
import { normalizeText } from '~/utils/format'

export type VietnamDistrict = {
  code: number
  name: string
  codename: string
  division_type: string
  province_code: number
}

const VIETNAM_PROVINCES_V1_DISTRICTS_API_URL = 'https://provinces.open-api.vn/api/v1/?depth=2'

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

function normalizeDistrictList(value: unknown): VietnamDistrict[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<number>()
  return value.flatMap((province: any) => Array.isArray(province?.districts)
    ? province.districts.map((district: any) => ({
        code: Number(district?.code),
        name: String(district?.name || '').trim(),
        codename: String(district?.codename || '').trim(),
        division_type: String(district?.division_type || '').trim(),
        province_code: Number(district?.province_code || province?.code),
      }))
    : [])
    .filter((district): district is VietnamDistrict => {
      if (!Number.isInteger(district.code) || district.code <= 0 || !district.name || !Number.isInteger(district.province_code) || district.province_code <= 0 || seen.has(district.code)) return false
      seen.add(district.code)
      return true
    })
    .sort((left, right) => left.province_code - right.province_code || left.name.localeCompare(right.name, 'vi'))
}

async function fallbackDistricts(): Promise<VietnamDistrict[]> {
  try {
    if (typeof atob !== 'function' || typeof DecompressionStream === 'undefined') return []
    const binary = atob(VIETNAM_DISTRICTS_V1_GZIP_BASE64)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    const response = new Response(stream)
    return normalizeDistrictList(JSON.parse(await response.text()))
  } catch {
    return []
  }
}

export function useVietnamProvinces() {
  const provinces = useState<VietnamProvince[]>('vietnam-provinces-v1.items', () => [...VIETNAM_PROVINCES_V1])
  const loading = useState<boolean>('vietnam-provinces-v1.loading', () => false)
  const attempted = useState<boolean>('vietnam-provinces-v1.attempted', () => false)
  const error = useState<string>('vietnam-provinces-v1.error', () => '')
  const districts = useState<VietnamDistrict[]>('vietnam-districts-v1.items', () => [])
  const districtsLoading = useState<boolean>('vietnam-districts-v1.loading', () => false)
  const districtsAttempted = useState<boolean>('vietnam-districts-v1.attempted', () => false)
  const districtsError = useState<string>('vietnam-districts-v1.error', () => '')

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
  const districtMap = computed(() => new Map(districts.value.map(district => [district.code, district])))

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

  function districtName(code: unknown) {
    const normalizedCode = Number(code)
    return Number.isInteger(normalizedCode) ? districtMap.value.get(normalizedCode)?.name || '' : ''
  }

  function districtNames(codes: unknown) {
    if (!Array.isArray(codes)) return []
    return Array.from(new Set(codes
      .map(code => districtName(code))
      .filter(Boolean)))
  }

  function districtOptionsForProvinceCodes(codes: unknown) {
    const provinceCodes = new Set(Array.isArray(codes)
      ? codes.map(code => Number(code)).filter(code => Number.isInteger(code) && code > 0)
      : [])
    return districts.value
      .filter(district => provinceCodes.has(district.province_code))
      .map(district => ({
        value: district.code,
        label: district.name,
        subLabel: provinceName(district.province_code),
        search: `${district.name} ${district.codename} ${district.division_type} ${provinceName(district.province_code)}`,
      }))
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

  async function loadDistricts(force = false) {
    if (districtsLoading.value || (districtsAttempted.value && !force)) return districts.value
    districtsLoading.value = true
    districtsError.value = ''
    try {
      const response = await $fetch<unknown>(VIETNAM_PROVINCES_V1_DISTRICTS_API_URL)
      const normalized = normalizeDistrictList(response)
      if (normalized.length < 600) throw new Error('Danh sách huyện chưa đầy đủ.')
      districts.value = normalized
    } catch (cause: any) {
      districts.value = await fallbackDistricts()
      districtsError.value = String(cause?.message || cause || 'Không tải được danh sách huyện.')
    } finally {
      districtsAttempted.value = true
      districtsLoading.value = false
    }
    return districts.value
  }

  return {
    provinces,
    districts,
    options,
    selectOptions,
    loading,
    error,
    districtsLoading,
    districtsError,
    loadProvinces,
    loadDistricts,
    provinceName,
    provinceNames,
    districtName,
    districtNames,
    districtOptionsForProvinceCodes,
    searchText,
  }
}
