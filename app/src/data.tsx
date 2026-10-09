import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  Timestamp,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore'
import { subDays } from 'date-fns'
import {
  fromActivity,
  fromBlock,
  fromContext,
  fromOverlay,
  fromSession,
  fromSettings,
  fromTask,
  type Activity,
  type Block,
  type Context,
  type Overlay,
  type Session,
  type Settings,
  type Task,
} from '@timeblock/shared'
import { db } from './firebase'
import { useAuth } from './auth'

export interface Data {
  uid: string
  ready: boolean
  contexts: Context[]
  activities: Activity[]
  tasks: Task[]
  blocks: Block[]
  sessions: Session[]
  overlays: Overlay[]
  settings: Settings
}

const Ctx = createContext<Data | null>(null)

function useSub<T>(path: string | null, conv: (id: string, d: any) => T, q?: (c: any) => any) {
  const [items, setItems] = useState<T[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!path) return
    const c = collection(db, path)
    return onSnapshot((q ? q(c) : c) as Query, (snap: QuerySnapshot) => {
      setItems(snap.docs.map((d: QueryDocumentSnapshot) => conv(d.id, d.data())))
      setLoaded(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])
  return [items, loaded] as const
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const uid = user!.uid
  const base = `users/${uid}`

  // Only a 60-day window of blocks and sessions is read: bounds reads and bandwidth.
  const since = useMemo(() => Timestamp.fromDate(subDays(new Date(), 60)), [])
  const [contexts, c1] = useSub(`${base}/contexts`, fromContext)
  const [activities, c2] = useSub(`${base}/activities`, fromActivity)
  const [tasks, c3] = useSub(`${base}/tasks`, fromTask)
  const [blocks, c4] = useSub(`${base}/blocks`, fromBlock, (c) => query(c, where('endAt', '>=', since)))
  const [sessions, c5] = useSub(`${base}/sessions`, fromSession, (c) => query(c, where('startedAt', '>=', since)))

  const [overlays, c7] = useSub(`${base}/overlays`, fromOverlay)

  const [settings, setSettings] = useState<Settings>(fromSettings(undefined))
  const [c6, setC6] = useState(false)
  useEffect(
    () =>
      onSnapshot(doc(db, `${base}/meta/settings`), (s) => {
        setSettings(fromSettings(s.data()))
        setC6(true)
      }),
    [base],
  )

  const value: Data = {
    uid,
    ready: c1 && c2 && c3 && c4 && c5 && c6 && c7,
    contexts,
    activities,
    tasks,
    blocks,
    sessions,
    overlays,
    settings,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData(): Data {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData outside DataProvider')
  return v
}

/** The currently running session, if any. */
export function useRunningSession(): Session | null {
  const { sessions, settings } = useData()
  return sessions.find((s) => s.id === settings.runningSessionId) ?? null
}
