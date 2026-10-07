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
          <p className="muted">Nothing is scheduled right now. Pick something to do:</p>
          <Picker />
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
