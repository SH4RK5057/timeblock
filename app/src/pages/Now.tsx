import { useState } from 'react'
import { format } from 'date-fns'
import { formatDuration, minutesBetween } from '@timeblock/shared'
import { useData, useRunningSession } from '../data'
import { startSession } from '../actions'
import { blockName } from '../util'
import Picker from '../components/Picker'
import { useSchedule, useTick } from '../components/StatusBar'

export default function Now() {
  const { uid, activities, tasks } = useData()
  const running = useRunningSession()
  const now = useTick(15_000)
  const { current, next } = useSchedule(now)
  const both = current.length > 1

  // Free time defaults to the gap until the next block; you can shorten it (or stretch it back).
  const gap = next ? Math.max(1, minutesBetween(now, next.startAt)) : null
  const cap = gap ?? 480
  const [custom, setCustom] = useState<number | null>(null)
  const minutes = Math.max(5, Math.min(custom ?? gap ?? 60, cap))
  const setMinutes = (m: number) => setCustom(Math.max(5, Math.min(m, cap)))

  return (
    <div className="now">
      {both && <p className="muted center-text">You have {current.length} things scheduled at once.</p>}

      {current.map((b) => (
        <section key={b.id} className={'card' + (running?.blockId === b.id ? ' active' : '')}>
          <div className="muted">
            {format(b.startAt, 'p')} – {format(b.endAt, 'p')} · {formatDuration(minutesBetween(now, b.endAt))} left
          </div>
          <h1>{blockName(b, activities, tasks)}</h1>
          {b.details && <p className="details">{b.details}</p>}
          {running?.blockId === b.id ? (
            <p className="muted">Running. Use the bar above to end it.</p>
          ) : (
            <button
              className="primary huge"
              onClick={() => startSession(uid, { blockId: b.id, activityId: b.activityId, taskId: b.taskId })}
            >
              Start
            </button>
          )}
        </section>
      ))}

      {!current.length && !running && (
        <section className="card">
          <h1>Free time</h1>
          <p className="muted">
            {next ? `Free for ${formatDuration(gap!)} until ${format(next.startAt, 'p')}.` : 'Nothing else is scheduled.'}
          </p>
          <div className="window">
            <span className="small muted">I'll spend</span>
            <button onClick={() => setMinutes(minutes - 5)} aria-label="Shorter">−</button>
            <b>{formatDuration(minutes)}</b>
            <button onClick={() => setMinutes(minutes + 5)} aria-label="Longer">+</button>
            {[15, 30, 45, 60].filter((m) => m < cap).map((m) => (
              <button key={m} className={'chipbtn dark' + (minutes === m ? ' on' : '')} onClick={() => setMinutes(m)}>
                {m}m
              </button>
            ))}
            {gap && (
              <button className="chipbtn dark" onClick={() => setCustom(null)}>
                All of it
              </button>
            )}
          </div>
          <Picker minutes={minutes} />
        </section>
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
