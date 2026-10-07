import { MIN_SESSION_MINUTES, fromBlock, fromSession, pushMinutes } from '@timeblock/shared'
import { archiveItems, requestPersistence } from './archive'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  type DocumentReference,
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

type Tx = Parameters<Parameters<typeof runTransaction>[1]>[0]

interface Running {
  ref: DocumentReference
  actRef: DocumentReference | null
  recent: number[]
  minutes: number
}

/** Reads the running session (and its activity) first; Firestore needs all reads before writes. */
async function readRunning(tx: Tx, uid: string, now: Date): Promise<Running | null> {
  const s = await tx.get(doc(db, `users/${uid}/meta/settings`))
  const runId = s.data()?.runningSessionId as string | null | undefined
  if (!runId) return null
  const ref = doc(db, `users/${uid}/sessions/${runId}`)
  const rs = await tx.get(ref)
  if (!rs.exists() || rs.data().endedAt) return null
  const d = rs.data()
  const actId = d.activityId as string | null
  let actRef: DocumentReference | null = null
  let recent: number[] = []
  if (actId) {
    const r = doc(db, `users/${uid}/activities/${actId}`)
    const as = await tx.get(r)
    if (as.exists()) {
      actRef = r
      recent = as.data().recentMinutes ?? []
    }
  }
  return { ref, actRef, recent, minutes: Math.round((now.getTime() - d.startedAt.toDate().getTime()) / 60000) }
}

/** Ends the session and teaches the activity how long it took (sessions under 5 min are ignored). */
function writeEnd(tx: Tx, r: Running, now: Date) {
  tx.update(r.ref, { endedAt: now })
  if (r.actRef && r.minutes >= MIN_SESSION_MINUTES) tx.update(r.actRef, { recentMinutes: pushMinutes(r.recent, r.minutes) })
}

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
    const running = await readRunning(tx, uid, now)
    if (running) writeEnd(tx, running, now)
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
    const running = await readRunning(tx, uid, now)
    if (running) writeEnd(tx, running, now)
    tx.set(settingsRef, { runningSessionId: null }, { merge: true })
  })
}

/**
 * Removes sessions and blocks older than `days` days from the server. With keepLocal, they are first
 * saved to this device's archive; if that fails nothing is deleted. Returns how many docs were removed.
 */
export async function pruneHistory(uid: string, days: number, keepLocal: boolean): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000)
  const [sess, blks] = await Promise.all([
    getDocs(query(col(uid, 'sessions'), where('startedAt', '<', cutoff))),
    getDocs(query(col(uid, 'blocks'), where('endAt', '<', cutoff))),
  ])
  if (keepLocal) {
    requestPersistence()
    await archiveItems(uid, 'sessions', sess.docs.map((d) => fromSession(d.id, d.data())))
    await archiveItems(uid, 'blocks', blks.docs.map((d) => fromBlock(d.id, d.data())))
  }
  let removed = 0
  for (const snap of [sess, blks]) {
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db)
      snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref))
      await batch.commit()
    }
    removed += snap.size
  }
  return removed
}
