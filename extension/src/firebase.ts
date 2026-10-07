import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth/web-extension'
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore'

export const app = initializeApp({
  apiKey: __API_KEY__,
  authDomain: __AUTH_DOMAIN__,
  projectId: __PROJECT_ID__,
  appId: __APP_ID__,
})
export const auth = getAuth(app)
export const db = initializeFirestore(app, { localCache: memoryLocalCache() })
export const APP_URL = __APP_URL__
