import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  runTransaction,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { db } from './firebase'

type Fields = Record<string, unknown>

/** Firestore rejects undefined; drop those keys. */
const clean = (f: Fields): Fields => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined))

export const col = (uid: string, name: string) => collection(db, `users/${uid}/${name}`)
export const ref = (uid: string, name: string, id: string) => doc(db, `users/${uid}/${name}/${id}`)

export const addItem = (uid: string, name: string, f: Fields) => addDoc(col(uid, name), clean(f))
export const saveItem = (uid: string, name: string, id: string, f: Fields) =>
  setDoc(ref(uid, name, id), clean(f), { merge: true })
export const patchItem = (uid: string, name: string, id: string, f: Fields) =>
  updateDoc(ref(uid, name, id), clean(f))
export const removeItem = (uid: string, name: string, id: string) => deleteDoc(ref(uid, name, id))

export const saveSettings = (uid: string, f: Fields) =>
  setDoc(doc(db, `users/${uid}/meta/settings`), clean(f), { merge: true })

/**
 * Starts a session. In one transaction: ends the running session (if any),
 * creates the new one, and repoints settings.runningSessionId.
 */
export async function startSession(
  uid: string,
  link: { blockId?: string | null; activityId?: string | null; taskId?: string | null },
) {
  const settingsRef = doc(db, `users/${uid}/meta/settings`)
  const newRef = doc(collection(db, `users/${uid}/sessions`))
  const now = new Date()
  await runTransaction(db, async (tx) => {
    const s = await tx.get(settingsRef)
    const runningId = s.data()?.runningSessionId as string | null | undefined
    if (runningId) {
      const rr = doc(db, `users/${uid}/sessions/${runningId}`)
      const rs = await tx.get(rr)
      if (rs.exists() && !rs.data().endedAt) tx.update(rr, { endedAt: now })
    }
    tx.set(newRef, {
      blockId: link.blockId ?? null,
      activityId: link.activityId ?? null,
      taskId: link.taskId ?? null,
      startedAt: now,
      endedAt: null,
      notes: '',
    })
    tx.set(settingsRef, { runningSessionId: newRef.id }, { merge: true })
  })
}

export async function endSession(uid: string) {
  const settingsRef = doc(db, `users/${uid}/meta/settings`)
  const now = new Date()
  await runTransaction(db, async (tx) => {
    const s = await tx.get(settingsRef)
    const runningId = s.data()?.runningSessionId as string | null | undefined
    if (!runningId) return
    const rr = doc(db, `users/${uid}/sessions/${runningId}`)
    const rs = await tx.get(rr)
    if (rs.exists() && !rs.data().endedAt) tx.update(rr, { endedAt: now })
    tx.set(settingsRef, { runningSessionId: null }, { merge: true })
  })
}
