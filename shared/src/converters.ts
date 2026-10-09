import type { Activity, Block, Context, Overlay, Session, Settings, Task } from './types'
import { DEFAULT_SETTINGS } from './types'

type Raw = Record<string, any>

/** Firestore Timestamps expose toDate(); turn them (shallowly) into Dates. */
function dates(data: Raw): Raw {
  const out: Raw = {}
  for (const [k, v] of Object.entries(data)) {
    out[k] = v && typeof v === 'object' && typeof v.toDate === 'function' ? v.toDate() : v
  }
  return out
}

export const fromContext = (id: string, d: Raw): Context => {
  const r = dates(d)
  return { id, kind: r.kind ?? 'location', name: r.name ?? '', archived: !!r.archived }
}

export const fromActivity = (id: string, d: Raw): Activity => {
  const r = dates(d)
  return {
    id,
    name: r.name ?? '',
    color: r.color ?? '#4f7cff',
    notes: r.notes ?? '',
    locationIds: r.locationIds ?? [],
    materialIds: r.materialIds ?? [],
    blockedSites: r.blockedSites ?? [],
    recentMinutes: r.recentMinutes ?? [],
    archived: !!r.archived,
  }
}

export const fromTask = (id: string, d: Raw): Task => {
  const r = dates(d)
  return {
    id,
    activityId: r.activityId ?? null,
    title: r.title ?? '',
    notes: r.notes ?? '',
    dueAt: r.dueAt ?? null,
    estimateMinutes: r.estimateMinutes ?? null,
    locationIds: r.locationIds ?? null,
    materialIds: r.materialIds ?? null,
    doneAt: r.doneAt ?? null,
    repeat: r.repeat ?? 'none',
  }
}

export const fromBlock = (id: string, d: Raw): Block => {
  const r = dates(d)
  return {
    id,
    startAt: r.startAt,
    endAt: r.endAt,
    activityId: r.activityId ?? null,
    taskId: r.taskId ?? null,
    title: r.title ?? null,
    details: r.details ?? '',
    blockedSites: r.blockedSites ?? [],
    alert: r.alert ?? 'default',
  }
}

export const fromSession = (id: string, d: Raw): Session => {
  const r = dates(d)
  return {
    id,
    blockId: r.blockId ?? null,
    activityId: r.activityId ?? null,
    taskId: r.taskId ?? null,
    startedAt: r.startedAt,
    endedAt: r.endedAt ?? null,
    plannedEndAt: r.plannedEndAt ?? null,
    notes: r.notes ?? '',
  }
}

export const fromSettings = (d: Raw | undefined): Settings => ({
  ...DEFAULT_SETTINGS,
  ...(d ?? {}),
  notify: { ...DEFAULT_SETTINGS.notify, ...(d?.notify ?? {}) },
  autoClean: { ...DEFAULT_SETTINGS.autoClean, ...(d?.autoClean ?? {}) },
})

export const fromOverlay = (id: string, d: Raw): Overlay => ({
  id,
  title: d.title ?? '',
  color: d.color ?? '#7a869a',
  days: d.days ?? [],
  startMin: d.startMin ?? 540,
  endMin: d.endMin ?? 600,
})
