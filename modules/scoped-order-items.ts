import { addImports, createResolver, defineNuxtModule } from '@nuxt/kit'

export default defineNuxtModule({
  meta: {
    name: 'scoped-order-items-by-parent',
  },
  setup() {
    const resolver = createResolver(import.meta.url)
    addImports({
      name: 'useScopedQueriesClient',
      as: 'useScopedQueries',
      from: resolver.resolve('../composables/useScopedQueriesClient'),
      priority: 110,
    })
  },
})
