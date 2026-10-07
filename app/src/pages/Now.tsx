import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { formatDuration, minutesBetween } from '@timeblock/shared'
import { useData, useRunningSession } from '../data'
import { endSession, startSession } from '../actions'
import { blockName } from '../util'
import Picker from '../components/Picker'

function useNow(ms = 15_000) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export default function Now() {
  const { uid, blocks, activities, tasks } = useData()
  const running = useRunningSession()
  const now = useNow()

  const current = blocks.find((b) => b.startAt <= now && now < b.endAt) ?? null
  const next =
    blocks
      .filter((b) => b.startAt > now)
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0] ?? null

  const runningBlock = running?.blockId ? blocks.find((b) => b.id === running.blockId) : null
  const runningName = running
    ? runningBlock
      ? blockName(runningBlock, activities, tasks)
      : tasks.find((t) => t.id === running.taskId)?.title ??
        activities.find((a) => a.id === running.activityId)?.name ??
        'Unscheduled session'
    : null

  const start = () =>
    current &&
    startSession(uid, { blockId: current.id, activityId: current.activityId, taskId: current.taskId })

  return (
    <div className="now">
      {running && (
        <section className="card running">
          <div className="muted">Running since {format(running.startedAt, 'p')}</div>
          <h1>{runningName}</h1>
          <div className="big">{formatDuration(Math.max(0, minutesBetween(running.startedAt, now)))}</div>
          <button className="primary huge danger" onClick={() => endSession(uid)}>
            End
          </button>
        </section>
      )}

      {current ? (
        <section className="card">
          <div className="muted">
            {format(current.startAt, 'p')} – {format(current.endAt, 'p')} ·{' '}
            {formatDuration(minutesBetween(now, current.endAt))} left
          </div>
          <h1>{blockName(current, activities, tasks)}</h1>
          {current.details && <p className="details">{current.details}</p>}
          {running?.blockId !== current.id && (
            <button className="primary huge" onClick={start}>
              Start
            </button>
          )}
        </section>
      ) : (
        !running && (
          <section className="card">
            <h1>Free time</h1>
            <p className="muted">Nothing is scheduled right now. Pick something to do:</p>
            <Picker />
          </section>
        )
      )}

      {next && (
        <section className="card subtle">
          <div className="muted">Next · {format(next.startAt, 'EEE p')}</div>
          <strong>{blockName(next, activities, tasks)}</strong>
        </section>
      )}
    </div>
  )
}
