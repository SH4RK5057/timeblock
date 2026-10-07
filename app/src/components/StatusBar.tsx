import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { formatDuration, minutesBetween, type Block } from '@timeblock/shared'
import { useData, useRunningSession } from '../data'
import { endSession, startSession } from '../actions'
import { blockName } from '../util'

export function useTick(ms: number) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function useSchedule(now: Date) {
  const { blocks } = useData()
  const current = blocks.filter((b) => b.startAt <= now && now < b.endAt).sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
  const next =
    blocks.filter((b) => b.startAt > now).sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0] ?? null
  return { current, next }
}

const clock = (secs: number) => {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`
}

/** Persistent strip: what's running, what you should be doing, or what's next. */
export default function StatusBar() {
  const { uid, activities, tasks, blocks } = useData()
  const running = useRunningSession()
  const now = useTick(1000)
  const { current, next } = useSchedule(now)

  const startBlock = (b: Block) => startSession(uid, { blockId: b.id, activityId: b.activityId, taskId: b.taskId })
  const name = (b: Block) => blockName(b, activities, tasks)

  const runningBlock = running?.blockId ? blocks.find((b) => b.id === running.blockId) : null
  const runningName = running
    ? runningBlock
      ? name(runningBlock)
      : tasks.find((t) => t.id === running.taskId)?.title ??
        activities.find((a) => a.id === running.activityId)?.name ??
        'Unscheduled session'
    : ''
  const pending = current.filter((b) => b.id !== running?.blockId)

  if (running) {
    const secs = Math.max(0, Math.floor((now.getTime() - running.startedAt.getTime()) / 1000))
    return (
      <div className="status running">
        <div className="grow">
          <div className="small">Doing now</div>
          <b>{runningName}</b> <span className="clock">{clock(secs)}</span>
          {pending.length > 0 && (
            <div className="small">
              Also scheduled:{' '}
              {pending.map((b) => (
                <button key={b.id} className="chipbtn" onClick={() => startBlock(b)}>
                  Switch to {name(b)}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="endbtn" onClick={() => endSession(uid)}>
          End
        </button>
      </div>
    )
  }

  if (pending.length) {
    return (
      <div className="status should">
        <div className="grow">
          <div className="small">Should be doing{pending.length > 1 ? ' both' : ''} · not started</div>
          {pending.map((b) => (
            <div key={b.id} className="srow">
              <b>{name(b)}</b>
              <span className="small"> until {format(b.endAt, 'p')} ({formatDuration(minutesBetween(now, b.endAt))} left)</span>
              <button className="chipbtn" onClick={() => startBlock(b)}>
                Start
              </button>
            </div>
          ))}
          {pending.length > 1 && <div className="small">Only one can run at a time; starting one pauses the other.</div>}
        </div>
      </div>
    )
  }

  if (next) {
    return (
      <div className="status next">
        <div className="grow">
          <span className="small">Free now · next: </span>
          <b>{name(next)}</b>
          <span className="small">
            {' '}
            at {format(next.startAt, 'p')} (in {formatDuration(minutesBetween(now, next.startAt))})
          </span>
        </div>
      </div>
    )
  }
  return (
    <div className="status next">
      <span className="small">Free now · nothing else scheduled</span>
    </div>
  )
}
