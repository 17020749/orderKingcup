import { addImports, createResolver, defineNuxtModule } from '@nuxt/kit'

export default defineNuxtModule({
  meta: {
    name: 'warehouse-cost-allocation',
  },
  setup() {
    const resolver = createResolver(import.meta.url)
    addImports({
      name: 'useWarehouseTransactionsClient',
      as: 'useWarehouseTransactions',
      from: resolver.resolve('../composables/useWarehouseTransactionsClient'),
      priority: 100,
    })
  },
})
