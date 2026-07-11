import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'
import { getFirestore, initializeFirestore, setLogLevel, type Firestore } from 'firebase/firestore'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig().public
  const firebaseConfig = {
    apiKey: config.firebaseApiKey,
    authDomain: config.firebaseAuthDomain,
    projectId: config.firebaseProjectId,
    storageBucket: config.firebaseStorageBucket,
    messagingSenderId: config.firebaseMessagingSenderId,
    appId: config.firebaseAppId
  }

  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    console.warn('Thiếu cấu hình Firebase. Hãy tạo file .env từ .env.example')
  }

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)
  const auth = getAuth(app)
  let db: Firestore
  try {
    // Auto-detect long polling by default so normal networks keep the faster
    // transport. A problematic proxy/antivirus can explicitly force it with:
    // localStorage.setItem('kingcup.firestore.forceLongPolling', '1')
    const forceLongPolling = localStorage.getItem('kingcup.firestore.forceLongPolling') === '1'
    db = initializeFirestore(app, forceLongPolling
      ? {
          experimentalForceLongPolling: true,
          experimentalLongPollingOptions: { timeoutSeconds: 10 }
        }
      : {
          experimentalAutoDetectLongPolling: true
        }
    )
  } catch (error: any) {
    // Nuxt HMR may execute the plugin again after Firestore was initialized.
    // Reuse the existing instance instead of creating a second one.
    if (String(error?.code || '').includes('failed-precondition')) {
      db = getFirestore(app)
    } else {
      throw error
    }
  }
  if (localStorage.getItem('kingcup.firebase.debug') === '1') {
    setLogLevel('debug')
    console.info('[KINGCUP_PERMISSION] Firebase SDK debug đang bật. Tắt bằng: localStorage.removeItem("kingcup.firebase.debug"); location.reload()')
  }
  const googleProvider = new GoogleAuthProvider()
  googleProvider.setCustomParameters({ prompt: 'select_account' })

  return {
    provide: {
      firebaseApp: app,
      firebaseAuth: auth,
      firestore: db,
      googleProvider
    }
  }
})

declare module '#app' {
  interface NuxtApp {
    $firebaseApp: FirebaseApp
    $firebaseAuth: Auth
    $firestore: Firestore
    $googleProvider: GoogleAuthProvider
  }
}
