export default defineNuxtConfig({
  ssr: false,

  devtools: {
    enabled: true
  },

  modules: [
    '~/modules/warehouse-cost',
    '~/modules/scoped-order-items'
  ],

  app: {
    head: {
      title: 'KINGCUP Dashboard',
      meta: [
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1'
        },
        {
          name: 'robots',
          content: 'noindex,nofollow'
        }
      ]
    }
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: {
      firebaseApiKey:
        process.env.NUXT_PUBLIC_FIREBASE_API_KEY || '',

      firebaseAuthDomain:
        process.env.NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',

      firebaseProjectId:
        process.env.NUXT_PUBLIC_FIREBASE_PROJECT_ID || '',

      firebaseStorageBucket:
        process.env.NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',

      firebaseMessagingSenderId:
        process.env.NUXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',

      firebaseAppId:
        process.env.NUXT_PUBLIC_FIREBASE_APP_ID || '',

      appName:
        process.env.NUXT_PUBLIC_APP_NAME || 'KINGCUP Dashboard'
    }
  },

  typescript: {
    strict: false
  }
})
