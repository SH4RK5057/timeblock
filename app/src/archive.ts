// Local (on-device) archive for history that has been cleaned off the server.
// Stored in IndexedDB, so it lives in this browser only; export it to keep a file copy.
import type { Block, Session } from '@timeblock/shared'

type Kind = 'sessions' | 'blocks'
interface Row {
  key: string
  uid: string
  kind: Kind
  t: number
  data: Session | Block
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('timeblock-archive', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'key' })
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })

const timeOf = (kind: Kind, x: Session | Block) =>
  kind === 'sessions' ? (x as Session).startedAt.getTime() : (x as Block).startAt.getTime()

/** Asks the browser not to evict the archive under storage pressure. */
export function requestPersistence() {
  void navigator.storage?.persist?.()
}

export async function archiveItems(uid: string, kind: Kind, items: (Session | Block)[]) {
  if (!items.length) return
  const db = await open()
  const tx = db.transaction('items', 'readwrite')
  const store = tx.objectStore('items')
  for (const x of items) store.put({ key: `${uid}/${kind}/${x.id}`, uid, kind, t: timeOf(kind, x), data: x } satisfies Row)
  await done(tx)
}

async function allRows(uid: string): Promise<Row[]> {
  const db = await open()
  const req = db.transaction('items').objectStore('items').getAll()
  const rows = await new Promise<Row[]>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as Row[])
    req.onerror = () => reject(req.error)
  })
  return rows.filter((r) => r.uid === uid)
}

export async function readArchive<T extends Session | Block>(uid: string, kind: Kind, from: Date, to: Date): Promise<T[]> {
  try {
    return (await allRows(uid)).filter((r) => r.kind === kind && r.t >= from.getTime() && r.t < to.getTime()).map((r) => r.data as T)
  } catch {
    return []
  }
}

export async function archiveCount(uid: string): Promise<number> {
  try {
    return (await allRows(uid)).length
  } catch {
    return 0
  }
}

export async function exportArchive(uid: string, extra: { sessions: Session[]; blocks: Block[] }) {
  const rows = await allRows(uid).catch(() => [] as Row[])
  const pick = (k: Kind) => rows.filter((r) => r.kind === k).map((r) => r.data)
  const payload = {
    exportedAt: new Date().toISOString(),
    archivedSessions: pick('sessions'),
    archivedBlocks: pick('blocks'),
    recentSessions: extra.sessions,
    recentBlocks: extra.blocks,
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `timeblock-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
