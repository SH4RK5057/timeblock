// Logical document types. Ids are Firestore doc ids (not stored in the doc body).
// Times are JS Dates in the client; Firestore stores them as Timestamps (UTC).

export type ContextKind = 'location' | 'material'

export interface Context {
  id: string
  kind: ContextKind
  name: string
  archived: boolean
}

export interface Activity {
  id: string
  name: string
  color: string
  notes: string
  /** Doable at ANY of these. Empty means anywhere. */
  locationIds: string[]
  /** Needs ALL of these. */
  materialIds: string[]
  blockedSites: string[]
  defaultMinutes: number | null
  archived: boolean
}

export interface Task {
  id: string
  activityId: string | null
  title: string
  notes: string
  dueAt: Date | null
  estimateMinutes: number | null
  /** null means inherit from the activity */
  locationIds: string[] | null
  materialIds: string[] | null
  doneAt: Date | null
}

export interface Block {
  id: string
  startAt: Date
  endAt: Date
  activityId: string | null
  taskId: string | null
  title: string | null
  details: string
  blockedSites: string[]
}

export interface Session {
  id: string
  blockId: string | null
  activityId: string | null
  taskId: string | null
  startedAt: Date
  endedAt: Date | null
  notes: string
}

export interface Settings {
  runningSessionId: string | null
  globalBlockedSites: string[]
  visibleHours: { start: number; end: number }
  lastPicker: { locationId: string | null; materialIds: string[] }
}

export const DEFAULT_SETTINGS: Settings = {
  runningSessionId: null,
  globalBlockedSites: [],
  visibleHours: { start: 6, end: 23 },
  lastPicker: { locationId: null, materialIds: [] },
}
