import type { Activity, Block, Session, Settings } from './types'

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
}

/** Domains include their subdomains: youtube.com also matches m.youtube.com. */
export function isBlocked(hostname: string, blocked: string[]): boolean {
  const h = hostname.toLowerCase()
  return blocked.some((d) => h === d || h.endsWith('.' + d))
}

/**
 * Union of the global list, the activity's list and the block's list.
 * Uses the running session (and its block/activity) if any, otherwise the block
 * scheduled right now. Nothing active means nothing is blocked.
 */
export function resolveBlocklist(args: {
  settings: Pick<Settings, 'globalBlockedSites'>
  runningSession: Session | null
  blocks: Block[]
  activities: Activity[]
  now?: Date
}): string[] {
  const { settings, runningSession, blocks, activities } = args
  const now = args.now ?? new Date()

  let block: Block | null = null
  let activityId: string | null = null
  if (runningSession) {
    block = blocks.find((b) => b.id === runningSession.blockId) ?? null
    activityId = runningSession.activityId ?? block?.activityId ?? null
  } else {
    block = blocks.find((b) => b.startAt <= now && now < b.endAt) ?? null
    if (!block) return []
    activityId = block.activityId
  }
  const activity = activities.find((a) => a.id === activityId)
  const all = [...settings.globalBlockedSites, ...(activity?.blockedSites ?? []), ...(block?.blockedSites ?? [])]
  return [...new Set(all.map(normalizeDomain).filter(Boolean))]
}
