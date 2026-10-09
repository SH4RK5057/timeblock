import { format } from 'date-fns'
import type { Activity, Block, Task } from '@timeblock/shared'

export const splitList = (s: string): string[] =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)

export const toLocalInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm")
export const fromLocalInput = (s: string) => new Date(s)

export function blockName(b: Block, activities: Activity[], tasks: Task[]): string {
  return (
    b.title ||
    tasks.find((t) => t.id === b.taskId)?.title ||
    activities.find((a) => a.id === b.activityId)?.name ||
    'Untitled'
  )
}

/** Parses typed times like "3:30pm", "330p", "1530", "15" into minutes after midnight. Null while it's not a time yet. */
export function parseTime(input: string): { minutes: number; hasMeridiem: boolean } | null {
  const m = input.trim().toLowerCase().match(/^(\d{1,2})(?::?(\d{2}))?\s*(a|p)?m?$/)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  if (min > 59 || h > 24) return null
  if (m[3]) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (m[3] === 'p' ? 12 : 0)
  }
  if (h === 24 && min === 0) return { minutes: 24 * 60, hasMeridiem: !!m[3] }
  if (h > 23) return null
  return { minutes: h * 60 + min, hasMeridiem: !!m[3] }
}
