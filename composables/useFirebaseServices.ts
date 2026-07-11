import type { Auth, GoogleAuthProvider } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'

export function useFirebaseServices() {
  const nuxt = useNuxtApp()
  return {
    auth: nuxt.$firebaseAuth as Auth,
    db: nuxt.$firestore as Firestore,
    googleProvider: nuxt.$googleProvider as GoogleAuthProvider
  }
}
