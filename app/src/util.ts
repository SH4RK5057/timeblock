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
