import { addDays, endOfDay, endOfWeek, isBefore, startOfDay } from 'date-fns'

export const SLOT_MINUTES = 15
const MS_PER_MIN = 60_000

export function snapToSlot(d: Date, mode: 'round' | 'floor' | 'ceil' = 'round'): Date {
  const slot = SLOT_MINUTES * MS_PER_MIN
  const fn = Math[mode]
  return new Date(fn(d.getTime() / slot) * slot)
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_MIN)
}

export function roundMinutesTo15(m: number): number {
  return Math.max(SLOT_MINUTES, Math.round(m / SLOT_MINUTES) * SLOT_MINUTES)
}

/** A date-only due value becomes 11:59 pm local that day. */
export function dueFromDate(day: Date): Date {
  const d = endOfDay(day)
  d.setSeconds(0, 0)
  return d
}

/** Next occurrence of a repeating task, always strictly after both its current due date and now. */
export function nextDue(due: Date, repeat: 'daily' | 'weekly', now: Date = new Date()): Date {
  const step = repeat === 'weekly' ? 7 : 1
  let d = addDays(due, step)
  while (d <= now) d = addDays(d, step)
  return d
}

export type TaskGroup = 'overdue' | 'today' | 'week' | 'later' | 'none'

export function taskGroup(dueAt: Date | null, now: Date = new Date()): TaskGroup {
  if (!dueAt) return 'none'
  if (isBefore(dueAt, now)) return 'overdue'
  if (dueAt <= endOfDay(now)) return 'today'
  if (dueAt <= endOfWeek(now, { weekStartsOn: 1 })) return 'week'
  return 'later'
}

export function isDueSoon(dueAt: Date | null, now: Date = new Date()): boolean {
  return !!dueAt && dueAt <= addDays(now, 3)
}

export function weekStart(d: Date): Date {
  const s = startOfDay(d)
  const dow = (s.getDay() + 6) % 7 // Monday = 0
  return addDays(s, -dow)
}

export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h && m) return `${h}h ${m}m`
  return h ? `${h}h` : `${m}m`
}
