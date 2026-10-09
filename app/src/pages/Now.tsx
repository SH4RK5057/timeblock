import { useState } from 'react'
import { format } from 'date-fns'
import { formatDuration, minutesBetween } from '@timeblock/shared'
import { useData, useRunningSession } from '../data'
import { startSession } from '../actions'
import { blockName } from '../util'
import Picker from '../components/Picker'
import SessionModal from '../components/SessionModal'
import { useSchedule, useTick } from '../components/StatusBar'

export default function Now() {
  const { uid, activities, tasks } = useData()
  const running = useRunningSession()
  const now = useTick(15_000)
  const { current, next } = useSchedule(now)
  const both = current.length > 1
  const [logging, setLogging] = useState(false)

  // Free time defaults to the gap until the next block; you can shorten it (or stretch it back).
  const gap = next ? Math.max(1, minutesBetween(now, next.startAt)) : null
  const MAX_MIN = 720
  const [custom, setCustom] = useState<number | null>(null)
  const [typed, setTyped] = useState<string | null>(null) // what's in the box while you type
  const minutes = Math.max(5, Math.min(custom ?? gap ?? 60, MAX_MIN))
  const setMinutes = (m: number) => {
    setTyped(null)
    setCustom(Math.max(5, Math.min(m, MAX_MIN)))
  }

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
            <input
              type="number"
              inputMode="numeric"
              className="mins"
              min={5}
              max={MAX_MIN}
              step={5}
              aria-label="Minutes of free time"
              value={typed ?? String(minutes)}
              onChange={(e) => {
                setTyped(e.target.value)
                const n = Number(e.target.value)
                if (n >= 5) setCustom(Math.min(Math.round(n), MAX_MIN))
              }}
              onBlur={() => setTyped(null)}
            />
            <span className="small muted">min</span>
            <button onClick={() => setMinutes(minutes + 5)} aria-label="Longer">+</button>
            {[15, 30, 45, 60].filter((m) => !gap || m < gap).map((m) => (
              <button key={m} className={'chipbtn dark' + (minutes === m ? ' on' : '')} onClick={() => setMinutes(m)}>
                {m}m
              </button>
            ))}
            {gap && (
              <button className="chipbtn dark" onClick={() => { setTyped(null); setCustom(null) }}>
                All of it
              </button>
            )}
          </div>
          {gap && minutes > gap && (
            <p className="overdue small">That runs {formatDuration(minutes - gap)} into your next block.</p>
          )}
          <Picker minutes={minutes} />
        </section>
      )}

      {next && (
        <section className="card subtle">
          <div className="muted">Next · {format(next.startAt, 'EEE p')}</div>
          <strong>{blockName(next, activities, tasks)}</strong>
        </section>
      )}
      <p className="center-text">
        <button className="link" onClick={() => setLogging(true)}>
          + Log something I already did
        </button>
      </p>
      {logging && <SessionModal onClose={() => setLogging(false)} />}
    </div>
  )
}
