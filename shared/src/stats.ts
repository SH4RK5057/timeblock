import type { Activity, Session, Task } from './types'
import { isDueSoon, minutesBetween, roundMinutesTo15 } from './time'

const MIN_SESSION_MINUTES = 5
const SAMPLE = 10
const MIN_SAMPLES = 3

/** Median of the last 10 completed sessions (ignoring <5 min), rounded to 15; default until 3 exist. */
export function usuallyTakes(activity: Activity | undefined, sessions: Session[]): number | null {
  if (!activity) return null
  const mins = sessions
    .filter((s) => s.activityId === activity.id && s.endedAt)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .map((s) => minutesBetween(s.startedAt, s.endedAt!))
    .filter((m) => m >= MIN_SESSION_MINUTES)
    .slice(0, SAMPLE)
  if (mins.length < MIN_SAMPLES) return activity.defaultMinutes
  mins.sort((a, b) => a - b)
  const mid = Math.floor(mins.length / 2)
  const median = mins.length % 2 ? mins[mid] : (mins[mid - 1] + mins[mid]) / 2
  return roundMinutesTo15(median)
}

export interface PickerInput {
  activities: Activity[]
  tasks: Task[]
  sessions: Session[]
  locationId: string | null
  materialIds: string[]
  now?: Date
}

export interface PickerResult {
  dueSoon: Task[]
  groups: { activity: Activity | null; uses: number; tasks: Task[] }[]
}

export function buildPicker(input: PickerInput): PickerResult {
  const { activities, tasks, sessions, locationId, materialIds } = input
  const now = input.now ?? new Date()

  const eligible = (locs: string[], mats: string[]) =>
    (locs.length === 0 || (!!locationId && locs.includes(locationId))) &&
    mats.every((m) => materialIds.includes(m))

  const actById = new Map(activities.map((a) => [a.id, a]))
  const taskEligible = (t: Task) => {
    const a = t.activityId ? actById.get(t.activityId) : undefined
    return eligible(t.locationIds ?? a?.locationIds ?? [], t.materialIds ?? a?.materialIds ?? [])
  }

  const openTasks = tasks.filter((t) => !t.doneAt && taskEligible(t))
  const dueSoon = openTasks
    .filter((t) => isDueSoon(t.dueAt, now))
    .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime())
  const dueIds = new Set(dueSoon.map((t) => t.id))

  const usage = new Map<string, { n: number; last: number }>()
  for (const s of sessions) {
    if (!s.activityId) continue
    const u = usage.get(s.activityId) ?? { n: 0, last: 0 }
    u.n++
    u.last = Math.max(u.last, s.startedAt.getTime())
    usage.set(s.activityId, u)
  }

  const groups = activities
    .filter((a) => !a.archived && eligible(a.locationIds, a.materialIds))
    .map((a) => ({
      activity: a as Activity | null,
      uses: usage.get(a.id)?.n ?? 0,
      last: usage.get(a.id)?.last ?? 0,
      tasks: openTasks
        .filter((t) => t.activityId === a.id && !dueIds.has(t.id))
        .sort((x, y) => (x.dueAt?.getTime() ?? Infinity) - (y.dueAt?.getTime() ?? Infinity)),
    }))
    .sort((a, b) => b.uses - a.uses || b.last - a.last)
    .map(({ activity, uses, tasks }) => ({ activity, uses, tasks }))

  const loose = openTasks.filter((t) => !t.activityId && !dueIds.has(t.id))
  if (loose.length) groups.push({ activity: null, uses: 0, tasks: loose })

  return { dueSoon, groups }
}
