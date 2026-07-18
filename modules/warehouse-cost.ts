import { addImports, createResolver, defineNuxtModule } from '@nuxt/kit'

export default defineNuxtModule({
  meta: {
    name: 'warehouse-cost-allocation',
  },
  setup() {
    const resolver = createResolver(import.meta.url)
    addImports({
      name: 'useWarehouseCostTransactions',
      as: 'useWarehouseTransactions',
      from: resolver.resolve('../composables/useWarehouseCostTransactions'),
      priority: 100,
    })
  },
})
