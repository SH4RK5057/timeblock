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
  type DocumentReference,
  type Unsubscribe,
} from 'firebase/firestore'
import { startOfDay } from 'date-fns'
import {
  fromActivity,
  fromBlock,
  fromSession,
  fromSettings,
  MIN_SESSION_MINUTES,
  pushMinutes,
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
  debug: { blocks: number; activities: number; sessions: number; global: number; source: string; error: string }
}

let lastError = ''
const fail = (where: string) => (e: Error) => {
  lastError = `${where}: ${e.message}`
  recompute()
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
    debug: {
      blocks: blocks.length,
      activities: activities.length,
      sessions: sessions.length,
      global: settings.globalBlockedSites.length,
      source: running ? `running session${running.blockId ? ' + its block' : ' (free time, no block)'}` : block ? 'scheduled block' : 'nothing active',
      error: lastError,
    },
  }
  await chrome.storage.local.set({ state })
  await scheduleBlockAlarms()

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
    }, fail('settings')),
    onSnapshot(query(collection(db, `${base}/blocks`), where('endAt', '>=', today)), (s) => {
      blocks = s.docs.map((d) => fromBlock(d.id, d.data()))
      recompute()
    }, fail('blocks')),
    onSnapshot(collection(db, `${base}/activities`), (s) => {
      activities = s.docs.map((d) => fromActivity(d.id, d.data()))
      recompute()
    }, fail('activities')),
    onSnapshot(query(collection(db, `${base}/sessions`), where('startedAt', '>=', today)), (s) => {
      sessions = s.docs.map((d) => fromSession(d.id, d.data()))
      recompute()
    }, fail('sessions')),
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
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name.startsWith('blk:')) void fireBlockAlert(a.name.split(':')[1])
  else void recompute()
})
chrome.runtime.onStartup.addListener(() => recompute())
chrome.runtime.onInstalled.addListener(() => recompute())

// ---- Block start alerts ----
const alertMode = (b: Block) => (b.alert === 'default' ? settings.notify.mode : b.alert)

/** One chrome.alarms entry per upcoming block, so alerts survive the service worker sleeping. */
async function scheduleBlockAlarms() {
  const wanted = new Map<string, number>()
  if (user) {
    const lead = settings.notify.leadMinutes * 60_000
    for (const b of blocks) {
      const mode = alertMode(b)
      const when = b.startAt.getTime() - lead
      if ((mode === 'notify' || mode === 'alarm') && when > Date.now()) wanted.set(`blk:${b.id}:${b.startAt.getTime()}`, when)
    }
  }
  const existing = await chrome.alarms.getAll()
  for (const a of existing) if (a.name.startsWith('blk:') && !wanted.has(a.name)) await chrome.alarms.clear(a.name)
  for (const [name, when] of wanted) if (!existing.some((a) => a.name === name)) chrome.alarms.create(name, { when })
}

async function fireBlockAlert(blockId: string) {
  const b = blocks.find((x) => x.id === blockId)
  if (!b) return
  const mode = alertMode(b)
  if (mode !== 'notify' && mode !== 'alarm') return
  const act = activities.find((a) => a.id === b.activityId)
  const name = b.title || act?.name || 'Time block'
  const when = settings.notify.leadMinutes ? `Starts at ${b.startAt.toLocaleTimeString([], { timeStyle: 'short' })}` : 'Starting now'
  chrome.notifications.create(`blk-${b.id}`, {
    type: 'basic',
    iconUrl: 'icon.png',
    title: name,
    message: b.details ? `${when}. ${b.details}` : when,
    requireInteraction: mode === 'alarm',
    priority: 2,
  })
  if (mode === 'alarm') {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
        justification: 'Play the block-start alarm sound',
      })
    }
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'play-alarm' })
  }
}

function stopAlarm() {
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => {})
}
chrome.notifications.onClosed.addListener(stopAlarm)
chrome.notifications.onClicked.addListener((id) => {
  stopAlarm()
  chrome.notifications.clear(id)
})

type Tx = Parameters<Parameters<typeof runTransaction>[1]>[0]
interface Running {
  ref: DocumentReference
  actRef: DocumentReference | null
  recent: number[]
  minutes: number
}

async function readRunning(tx: Tx, uid: string, now: Date): Promise<Running | null> {
  const s = await tx.get(doc(db, `users/${uid}/meta/settings`))
  const runId = s.data()?.runningSessionId as string | null | undefined
  if (!runId) return null
  const ref = doc(db, `users/${uid}/sessions/${runId}`)
  const rs = await tx.get(ref)
  if (!rs.exists() || rs.data().endedAt) return null
  const d = rs.data()
  let actRef: DocumentReference | null = null
  let recent: number[] = []
  if (d.activityId) {
    const r = doc(db, `users/${uid}/activities/${d.activityId}`)
    const as = await tx.get(r)
    if (as.exists()) {
      actRef = r
      recent = as.data().recentMinutes ?? []
    }
  }
  return { ref, actRef, recent, minutes: Math.round((now.getTime() - d.startedAt.toDate().getTime()) / 60000) }
}

function writeEnd(tx: Tx, r: Running, now: Date) {
  tx.update(r.ref, { endedAt: now })
  if (r.actRef && r.minutes >= MIN_SESSION_MINUTES) tx.update(r.actRef, { recentMinutes: pushMinutes(r.recent, r.minutes) })
}

async function startSession(blockId: string | null) {
  if (!user) return
  const uid = user.uid
  const settingsRef = doc(db, `users/${uid}/meta/settings`)
  const newRef = doc(collection(db, `users/${uid}/sessions`))
  const block = blocks.find((b) => b.id === blockId) ?? null
  const now = new Date()
  await runTransaction(db, async (tx) => {
    const running = await readRunning(tx, uid, now)
    if (running) writeEnd(tx, running, now)
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
    const running = await readRunning(tx, uid, now)
    if (running) writeEnd(tx, running, now)
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
