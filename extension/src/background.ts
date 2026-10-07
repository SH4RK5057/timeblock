import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth/web-extension'
import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { startOfDay } from 'date-fns'
import {
  fromActivity,
  fromBlock,
  fromSession,
  fromSettings,
  resolveBlocklist,
  type Activity,
  type Block,
  type Session,
  type Settings,
} from '@timeblock/shared'
import { APP_URL, auth, db } from './firebase'

export interface ExtState {
  signedIn: boolean
  email: string | null
  blockName: string | null
  details: string
  running: boolean
  domains: string[]
  appUrl: string
}

let settings: Settings = fromSettings(undefined)
let blocks: Block[] = []
let activities: Activity[] = []
let sessions: Session[] = []
let unsubs: Unsubscribe[] = []
let user: User | null = null

const label = (b: Block | null, s: Session | null) => {
  const act = activities.find((a) => a.id === (s?.activityId ?? b?.activityId))
  return b?.title || act?.name || (s ? 'Unscheduled session' : null)
}

async function recompute() {
  const now = new Date()
  const running = sessions.find((s) => s.id === settings.runningSessionId && !s.endedAt) ?? null
  const block = running
    ? blocks.find((b) => b.id === running.blockId) ?? null
    : blocks.find((b) => b.startAt <= now && now < b.endAt) ?? null

  let domains = user ? resolveBlocklist({ settings, runningSession: running, blocks, activities, now }) : []
  const { allowUntil = 0 } = await chrome.storage.local.get('allowUntil')
  if (allowUntil > Date.now()) domains = []

  const state: ExtState = {
    signedIn: !!user,
    email: user?.email ?? null,
    blockName: user ? label(block, running) : null,
    details: block?.details ?? '',
    running: !!running,
    domains,
    appUrl: APP_URL,
  }
  await chrome.storage.local.set({ state })

  // One redirect rule per domain; requestDomains also matches subdomains.
  const existing = await chrome.declarativeNetRequest.getDynamicRules()
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: domains.map((d, i) => ({
      id: i + 1,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
        redirect: { extensionPath: '/blocked.html' },
      },
      condition: {
        requestDomains: [d],
        resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
      },
    })),
  })
}

function listen(uid: string) {
  unsubs.forEach((u) => u())
  const base = `users/${uid}`
  const today = startOfDay(new Date())
  unsubs = [
    onSnapshot(doc(db, `${base}/meta/settings`), (s) => {
      settings = fromSettings(s.data())
      recompute()
    }),
    onSnapshot(query(collection(db, `${base}/blocks`), where('endAt', '>=', today)), (s) => {
      blocks = s.docs.map((d) => fromBlock(d.id, d.data()))
      recompute()
    }),
    onSnapshot(collection(db, `${base}/activities`), (s) => {
      activities = s.docs.map((d) => fromActivity(d.id, d.data()))
      recompute()
    }),
    onSnapshot(query(collection(db, `${base}/sessions`), where('startedAt', '>=', today)), (s) => {
      sessions = s.docs.map((d) => fromSession(d.id, d.data()))
      recompute()
    }),
  ]
}

onAuthStateChanged(auth, (u) => {
  user = u
  unsubs.forEach((x) => x())
  unsubs = []
  if (u) listen(u.uid)
  else {
    settings = fromSettings(undefined)
    blocks = []
    activities = []
    sessions = []
    recompute()
  }
})

// MV3 workers sleep, and block boundaries change the answer without any data change.
chrome.alarms.create('tick', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener(() => recompute())
chrome.runtime.onStartup.addListener(() => recompute())
chrome.runtime.onInstalled.addListener(() => recompute())

async function startSession(blockId: string | null) {
  if (!user) return
  const uid = user.uid
  const settingsRef = doc(db, `users/${uid}/meta/settings`)
  const newRef = doc(collection(db, `users/${uid}/sessions`))
  const block = blocks.find((b) => b.id === blockId) ?? null
  const now = new Date()
  await runTransaction(db, async (tx) => {
    const s = await tx.get(settingsRef)
    const runId = s.data()?.runningSessionId as string | undefined
    if (runId) {
      const rr = doc(db, `users/${uid}/sessions/${runId}`)
      const rs = await tx.get(rr)
      if (rs.exists() && !rs.data().endedAt) tx.update(rr, { endedAt: now })
    }
    tx.set(newRef, {
      blockId: block?.id ?? null,
      activityId: block?.activityId ?? null,
      taskId: block?.taskId ?? null,
      startedAt: now,
      endedAt: null,
      notes: '',
    })
    tx.set(settingsRef, { runningSessionId: newRef.id }, { merge: true })
  })
}

async function endSession() {
  if (!user) return
  const uid = user.uid
  const settingsRef = doc(db, `users/${uid}/meta/settings`)
  const now = new Date()
  await runTransaction(db, async (tx) => {
    const s = await tx.get(settingsRef)
    const runId = s.data()?.runningSessionId as string | undefined
    if (!runId) return
    const rr = doc(db, `users/${uid}/sessions/${runId}`)
    const rs = await tx.get(rr)
    if (rs.exists() && !rs.data().endedAt) tx.update(rr, { endedAt: now })
    tx.set(settingsRef, { runningSessionId: null }, { merge: true })
  })
}

/** Appends a line to the running session's notes so the override shows up in review. */
function logAllowance() {
  const s = sessions.find((x) => x.id === settings.runningSessionId)
  if (!user || !s) return
  const line = `Allowed 5 min of blocked sites at ${new Date().toLocaleTimeString()}`
  updateDoc(doc(db, `users/${user.uid}/sessions/${s.id}`), {
    notes: s.notes ? `${s.notes}\n${line}` : line,
  }).catch(() => {})
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  ;(async () => {
    try {
      switch (msg.type) {
        case 'signIn':
          await signInWithEmailAndPassword(auth, msg.email, msg.password)
          break
        case 'signUp':
          await createUserWithEmailAndPassword(auth, msg.email, msg.password)
          break
        case 'signOut':
          await signOut(auth)
          break
        case 'start': {
          const now = new Date()
          const cur = blocks.find((b) => b.startAt <= now && now < b.endAt)
          await startSession(cur?.id ?? null)
          break
        }
        case 'end':
          await endSession()
          break
        case 'allow5':
          await chrome.storage.local.set({ allowUntil: Date.now() + 5 * 60_000 })
          logAllowance()
          await recompute()
          break
        case 'refresh':
          await recompute()
          break
      }
      reply({ ok: true })
    } catch (e: any) {
      reply({ ok: false, error: String(e?.code ?? e?.message ?? e).replace('auth/', '') })
    }
  })()
  return true
})
