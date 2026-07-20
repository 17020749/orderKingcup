import { RuntimeConfig as UserRuntimeConfig, PublicRuntimeConfig as UserPublicRuntimeConfig } from 'nuxt/schema'
import { NuxtModule, ModuleDependencyMeta } from '@nuxt/schema'
  interface SharedRuntimeConfig {
   app: {
      buildId: string,

      baseURL: string,

      buildAssetsDir: string,

      cdnURL: string,
   },

   nitro: {
      envPrefix: string,
   },
  }
  interface SharedPublicRuntimeConfig {
   firebaseApiKey: string,

   firebaseAuthDomain: string,

   firebaseProjectId: string,

   firebaseStorageBucket: string,

   firebaseMessagingSenderId: string,

   firebaseAppId: string,

   appName: string,
  }
declare module '@nuxt/schema' {
  interface ModuleDependencies {
    ["warehouse-cost-allocation"]?: ModuleDependencyMeta<typeof import("/home/runner/work/orderKingcup/orderKingcup/modules/warehouse-cost").default extends NuxtModule<infer O> ? O | false : Record<string, unknown>> | false
    ["scoped-order-items-by-parent"]?: ModuleDependencyMeta<typeof import("/home/runner/work/orderKingcup/orderKingcup/modules/scoped-order-items").default extends NuxtModule<infer O> ? O | false : Record<string, unknown>> | false
    ["@nuxt/devtools"]?: ModuleDependencyMeta<typeof import("@nuxt/devtools").default extends NuxtModule<infer O> ? O | false : Record<string, unknown>> | false
    ["@nuxt/telemetry"]?: ModuleDependencyMeta<typeof import("@nuxt/telemetry").default extends NuxtModule<infer O> ? O | false : Record<string, unknown>> | false
  }
  interface NuxtOptions {
    /**
     * Configuration for `/home/runner/work/orderKingcup/orderKingcup/modules/warehouse-cost`
     */
    ["warehouse-cost-allocation"]: typeof import("/home/runner/work/orderKingcup/orderKingcup/modules/warehouse-cost").default extends NuxtModule<infer O, unknown, boolean> ? O | false : Record<string, any> | false
    /**
     * Configuration for `/home/runner/work/orderKingcup/orderKingcup/modules/scoped-order-items`
     */
    ["scoped-order-items-by-parent"]: typeof import("/home/runner/work/orderKingcup/orderKingcup/modules/scoped-order-items").default extends NuxtModule<infer O, unknown, boolean> ? O | false : Record<string, any> | false
    /**
     * Configuration for `@nuxt/devtools`
     */
    ["devtools"]: typeof import("@nuxt/devtools").default extends NuxtModule<infer O, unknown, boolean> ? O | false : Record<string, any> | false
    /**
     * Configuration for `@nuxt/telemetry`
     */
    ["telemetry"]: typeof import("@nuxt/telemetry").default extends NuxtModule<infer O, unknown, boolean> ? O | false : Record<string, any> | false
  }
  interface NuxtConfig {
    /**
     * Configuration for `/home/runner/work/orderKingcup/orderKingcup/modules/warehouse-cost`
     */
    ["warehouse-cost-allocation"]?: typeof import("/home/runner/work/orderKingcup/orderKingcup/modules/warehouse-cost").default extends NuxtModule<infer O, unknown, boolean> ? Partial<O> | false : Record<string, any> | false
    /**
     * Configuration for `/home/runner/work/orderKingcup/orderKingcup/modules/scoped-order-items`
     */
    ["scoped-order-items-by-parent"]?: typeof import("/home/runner/work/orderKingcup/orderKingcup/modules/scoped-order-items").default extends NuxtModule<infer O, unknown, boolean> ? Partial<O> | false : Record<string, any> | false
    /**
     * Configuration for `@nuxt/devtools`
     */
    ["devtools"]?: typeof import("@nuxt/devtools").default extends NuxtModule<infer O, unknown, boolean> ? Partial<O> | false : Record<string, any> | false
    /**
     * Configuration for `@nuxt/telemetry`
     */
    ["telemetry"]?: typeof import("@nuxt/telemetry").default extends NuxtModule<infer O, unknown, boolean> ? Partial<O> | false : Record<string, any> | false
    modules?: (undefined | null | false | NuxtModule<any> | string | [NuxtModule | string, Record<string, any>] | ["~/modules/warehouse-cost", Exclude<NuxtConfig["warehouse-cost-allocation"], boolean>] | ["~/modules/scoped-order-items", Exclude<NuxtConfig["scoped-order-items-by-parent"], boolean>] | ["@nuxt/devtools", Exclude<NuxtConfig["devtools"], boolean>] | ["@nuxt/telemetry", Exclude<NuxtConfig["telemetry"], boolean>])[],
  }
  interface RuntimeConfig extends UserRuntimeConfig {}
  interface PublicRuntimeConfig extends UserPublicRuntimeConfig {}
}
declare module 'nuxt/schema' {
  interface ModuleDependencies {
    ["warehouse-cost-allocation"]?: ModuleDependencyMeta<typeof import("/home/runner/work/orderKingcup/orderKingcup/modules/warehouse-cost").default extends NuxtModule<infer O> ? O | false : Record<string, unknown>> | false
    ["scoped-order-items-by-parent"]?: ModuleDependencyMeta<typeof import("/home/runner/work/orderKingcup/orderKingcup/modules/scoped-order-items").default extends NuxtModule<infer O> ? O | false : Record<string, unknown>> | false
    ["@nuxt/devtools"]?: ModuleDependencyMeta<typeof import("@nuxt/devtools").default extends NuxtModule<infer O> ? O | false : Record<string, unknown>> | false
    ["@nuxt/telemetry"]?: ModuleDependencyMeta<typeof import("@nuxt/telemetry").default extends NuxtModule<infer O> ? O | false : Record<string, unknown>> | false
  }
  interface NuxtOptions {
    /**
     * Configuration for `/home/runner/work/orderKingcup/orderKingcup/modules/warehouse-cost`
     */
    ["warehouse-cost-allocation"]: typeof import("/home/runner/work/orderKingcup/orderKingcup/modules/warehouse-cost").default extends NuxtModule<infer O, unknown, boolean> ? O | false : Record<string, any> | false
    /**
     * Configuration for `/home/runner/work/orderKingcup/orderKingcup/modules/scoped-order-items`
     */
    ["scoped-order-items-by-parent"]: typeof import("/home/runner/work/orderKingcup/orderKingcup/modules/scoped-order-items").default extends NuxtModule<infer O, unknown, boolean> ? O | false : Record<string, any> | false
    /**
     * Configuration for `@nuxt/devtools`
     * @see https://www.npmjs.com/package/@nuxt/devtools
     */
    ["devtools"]: typeof import("@nuxt/devtools").default extends NuxtModule<infer O, unknown, boolean> ? O | false : Record<string, any> | false
    /**
     * Configuration for `@nuxt/telemetry`
     * @see https://www.npmjs.com/package/@nuxt/telemetry
     */
    ["telemetry"]: typeof import("@nuxt/telemetry").default extends NuxtModule<infer O, unknown, boolean> ? O | false : Record<string, any> | false
  }
  interface NuxtConfig {
    /**
     * Configuration for `/home/runner/work/orderKingcup/orderKingcup/modules/warehouse-cost`
     */
    ["warehouse-cost-allocation"]?: typeof import("/home/runner/work/orderKingcup/orderKingcup/modules/warehouse-cost").default extends NuxtModule<infer O, unknown, boolean> ? Partial<O> | false : Record<string, any> | false
    /**
     * Configuration for `/home/runner/work/orderKingcup/orderKingcup/modules/scoped-order-items`
     */
    ["scoped-order-items-by-parent"]?: typeof import("/home/runner/work/orderKingcup/orderKingcup/modules/scoped-order-items").default extends NuxtModule<infer O, unknown, boolean> ? Partial<O> | false : Record<string, any> | false
    /**
     * Configuration for `@nuxt/devtools`
     * @see https://www.npmjs.com/package/@nuxt/devtools
     */
    ["devtools"]?: typeof import("@nuxt/devtools").default extends NuxtModule<infer O, unknown, boolean> ? Partial<O> | false : Record<string, any> | false
    /**
     * Configuration for `@nuxt/telemetry`
     * @see https://www.npmjs.com/package/@nuxt/telemetry
     */
    ["telemetry"]?: typeof import("@nuxt/telemetry").default extends NuxtModule<infer O, unknown, boolean> ? Partial<O> | false : Record<string, any> | false
    modules?: (undefined | null | false | NuxtModule<any> | string | [NuxtModule | string, Record<string, any>] | ["~/modules/warehouse-cost", Exclude<NuxtConfig["warehouse-cost-allocation"], boolean>] | ["~/modules/scoped-order-items", Exclude<NuxtConfig["scoped-order-items-by-parent"], boolean>] | ["@nuxt/devtools", Exclude<NuxtConfig["devtools"], boolean>] | ["@nuxt/telemetry", Exclude<NuxtConfig["telemetry"], boolean>])[],
  }
  interface RuntimeConfig extends SharedRuntimeConfig {}
  interface PublicRuntimeConfig extends SharedPublicRuntimeConfig {}
}
declare module 'vue' {
        interface ComponentCustomProperties {
          $config: UserRuntimeConfig
        }
      }