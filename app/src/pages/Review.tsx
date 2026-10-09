import { useEffect, useState } from 'react'
import { addDays, format, isSameDay, startOfDay, subDays } from 'date-fns'
import { formatDuration, minutesBetween, weekStart, type Block, type Session } from '@timeblock/shared'
import { useData } from '../data'
import { readArchive } from '../archive'
import SessionModal from '../components/SessionModal'

/** Minutes of [a, b) that fall inside [from, to), never counting time that hasn't happened yet. */
const overlap = (a: Date, b: Date, from: Date, to: Date, now: Date) => {
  const s = Math.max(a.getTime(), from.getTime())
  const e = Math.min(b.getTime(), to.getTime(), now.getTime())
  return e > s ? Math.round((e - s) / 60000) : 0
}

const at = (d: Date, h: number) => new Date(new Date(d).setHours(h, 0, 0, 0))

export default function Review() {
  const { blocks: liveBlocks, sessions: liveSessions, activities, tasks } = useData()
  const { uid } = useData()
  const [day, setDay] = useState(() => startOfDay(new Date()))
  const [view, setView] = useState<'day' | 'week'>('day')
  const [editing, setEditing] = useState<Session | null>(null)
  const [logging, setLogging] = useState(false)
  const now = new Date()

  const from = view === 'day' ? day : weekStart(day)
  const to = addDays(from, view === 'day' ? 1 : 7)
  const step = view === 'day' ? 1 : 7

  // Days older than the loaded 60-day window come from this device's local archive.
  const [old, setOld] = useState<{ blocks: Block[]; sessions: Session[] }>({ blocks: [], sessions: [] })
  const needsArchive = from < subDays(now, 58)
  useEffect(() => {
    if (!needsArchive) return setOld({ blocks: [], sessions: [] })
    Promise.all([readArchive<Block>(uid, 'blocks', from, to), readArchive<Session>(uid, 'sessions', from, to)]).then(
      ([b, s]) => setOld({ blocks: b, sessions: s }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, from.getTime(), to.getTime(), needsArchive])
  const blocks = [...liveBlocks, ...old.blocks]
  const sessions = [...liveSessions, ...old.sessions]
  const liveIds = new Set(liveSessions.map((x) => x.id))

  const actOf = (activityId: string | null, taskId: string | null) =>
    activityId ?? tasks.find((t) => t.id === taskId)?.activityId ?? null

  // Planned counts only what has already started; future blocks are not "missed" yet.
  const rows = new Map<string | null, { planned: number; actual: number }>()
  const bump = (k: string | null, f: 'planned' | 'actual', m: number) => {
    if (m <= 0) return
    const r = rows.get(k) ?? { planned: 0, actual: 0 }
    r[f] += m
    rows.set(k, r)
  }
  for (const b of blocks) if (b.startAt <= now) bump(actOf(b.activityId, b.taskId), 'planned', overlap(b.startAt, b.endAt, from, to, now))
  const inRange = sessions
    .filter((s) => s.startedAt < to && (s.endedAt ?? now) > from)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
  for (const s of inRange) bump(actOf(s.activityId, s.taskId), 'actual', overlap(s.startedAt, s.endedAt ?? now, from, to, now))

  const name = (k: string | null) => activities.find((a) => a.id === k)?.name ?? 'No activity'
  const fmt = (m: number) => (m ? formatDuration(Math.abs(m)) : '0m')
  const sessionName = (s: Session) =>
    tasks.find((t) => t.id === s.taskId)?.title ?? activities.find((a) => a.id === s.activityId)?.name ?? 'Session'
  const total = [...rows.values()].reduce((t, r) => ({ planned: t.planned + r.planned, actual: t.actual + r.actual }), { planned: 0, actual: 0 })
  const strip = Array.from({ length: 7 }, (_, i) => addDays(weekStart(day), i))

  return (
    <div>
      <div className="weekbar">
        <button onClick={() => setDay(addDays(day, -step))}>‹</button>
        <button onClick={() => setDay(startOfDay(new Date()))}>Today</button>
        <button onClick={() => setDay(addDays(day, step))}>›</button>
        <strong className="grow title">
          {view === 'day' ? format(day, 'EEEE, MMM d') : `${format(from, 'MMM d')} – ${format(addDays(from, 6), 'MMM d')}`}
        </strong>
        <div className="seg">
          <button className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>Day</button>
          <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>Week</button>
        </div>
      </div>

      <div className="strip">
        {strip.map((d) => (
          <button
            key={d.toISOString()}
            className={'chipday' + (view === 'day' && isSameDay(d, day) ? ' sel' : '') + (isSameDay(d, now) ? ' today' : '')}
            onClick={() => {
              setDay(d)
              setView('day')
            }}
          >
            <span>{format(d, 'EEE')}</span>
            <b>{format(d, 'd')}</b>
          </button>
        ))}
      </div>

      <h3>Plan vs. actual</h3>
      <table className="review">
        <thead>
          <tr><th>Activity</th><th>Planned</th><th>Actual</th><th>Diff</th></tr>
        </thead>
        <tbody>
          {[...rows.entries()].map(([k, r]) => {
            const d = r.actual - r.planned
            return (
              <tr key={k ?? 'none'}>
                <td>{name(k)}</td>
                <td>{fmt(r.planned)}</td>
                <td>{fmt(r.actual)}</td>
                <td className={d < 0 ? 'overdue' : ''}>{d === 0 ? '—' : (d > 0 ? '+' : '−') + fmt(d)}</td>
              </tr>
            )
          })}
          {rows.size > 1 && (
            <tr className="total">
              <td>Total</td><td>{fmt(total.planned)}</td><td>{fmt(total.actual)}</td>
              <td>{total.actual === total.planned ? '—' : (total.actual > total.planned ? '+' : '−') + fmt(total.actual - total.planned)}</td>
            </tr>
          )}
          {!rows.size && (
            <tr>
              <td colSpan={4} className="muted">
                {needsArchive ? 'Nothing on this device for that period.' : 'Nothing has started or been recorded yet.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h3>
        What happened <button className="link" onClick={() => setLogging(true)}>+ Log something I did</button>
      </h3>
      <ul className="list">
        {inRange.map((s) => (
          <li key={s.id}>
            <span className="grow">
              <div>{sessionName(s)}</div>
              <div className="muted small">
                {format(s.startedAt, view === 'week' ? 'EEE p' : 'p')} – {s.endedAt ? format(s.endedAt, 'p') : 'running'} ·{' '}
                {formatDuration(minutesBetween(s.startedAt, s.endedAt ?? now))}
                {s.notes && ` · ${s.notes}`}
              </div>
            </span>
            {liveIds.has(s.id) && <button className="link" onClick={() => setEditing(s)}>Edit</button>}
          </li>
        ))}
        {!inRange.length && <li className="muted">Nothing recorded.</li>}
      </ul>

      {editing && <SessionModal session={editing} onClose={() => setEditing(null)} />}
      {logging && (
        <SessionModal
          initial={view === 'day' && !isSameDay(day, now) ? { start: at(day, 9), end: at(day, 10) } : undefined}
          onClose={() => setLogging(false)}
        />
      )}
    </div>
  )
}
