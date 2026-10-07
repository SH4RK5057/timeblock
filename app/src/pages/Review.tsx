import { useEffect, useState } from 'react'
import { addDays, format, subDays } from 'date-fns'
import { minutesBetween, weekStart, formatDuration, type Block, type Session } from '@timeblock/shared'
import { readArchive } from '../archive'
import { useData } from '../data'
import { patchItem, removeItem, endSession } from '../actions'
import { fromLocalInput, toLocalInput } from '../util'
import Modal from '../components/Modal'

export default function Review() {
  const { uid, blocks: liveBlocks, sessions: liveSessions, activities, tasks, settings } = useData()
  const [ws, setWs] = useState(() => weekStart(new Date()))
  const [editing, setEditing] = useState<Session | null>(null)
  const we = addDays(ws, 7)
  const now = new Date()

  // Weeks older than the loaded 60-day window come from this device's local archive.
  const [old, setOld] = useState<{ blocks: Block[]; sessions: Session[] }>({ blocks: [], sessions: [] })
  const needsArchive = ws < subDays(now, 58)
  useEffect(() => {
    if (!needsArchive) return setOld({ blocks: [], sessions: [] })
    Promise.all([readArchive<Block>(uid, 'blocks', ws, we), readArchive<Session>(uid, 'sessions', ws, we)]).then(([b, s]) =>
      setOld({ blocks: b, sessions: s }),
    )
  }, [uid, ws.getTime(), needsArchive])
  const blocks = [...liveBlocks, ...old.blocks]
  const sessions = [...liveSessions, ...old.sessions]
  const liveIds = new Set(liveSessions.map((x) => x.id))

  const actOf = (activityId: string | null, taskId: string | null) =>
    activityId ?? tasks.find((t) => t.id === taskId)?.activityId ?? null

  const rows = new Map<string | null, { planned: number; actual: number }>()
  const bump = (k: string | null, f: 'planned' | 'actual', m: number) => {
    const r = rows.get(k) ?? { planned: 0, actual: 0 }
    r[f] += m
    rows.set(k, r)
  }
  blocks
    .filter((b) => b.startAt >= ws && b.startAt < we)
    .forEach((b) => bump(actOf(b.activityId, b.taskId), 'planned', minutesBetween(b.startAt, b.endAt)))
  const weekSessions = sessions
    .filter((s) => s.startedAt >= ws && s.startedAt < we)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
  weekSessions.forEach((s) => bump(actOf(s.activityId, s.taskId), 'actual', minutesBetween(s.startedAt, s.endedAt ?? now)))

  const name = (k: string | null) => activities.find((a) => a.id === k)?.name ?? 'No activity'
  const fmt = (m: number) => (m ? formatDuration(Math.abs(m)) : '0m')
  const sessionName = (s: Session) =>
    tasks.find((t) => t.id === s.taskId)?.title ?? activities.find((a) => a.id === s.activityId)?.name ?? 'Session'

  return (
    <div>
      <div className="weekbar">
        <button onClick={() => setWs(addDays(ws, -7))}>‹</button>
        <button onClick={() => setWs(weekStart(new Date()))}>This week</button>
        <button onClick={() => setWs(addDays(ws, 7))}>›</button>
        <strong className="grow title">{format(ws, 'MMM d')} – {format(addDays(ws, 6), 'MMM d')}</strong>
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
          {!rows.size && <tr><td colSpan={4} className="muted">Nothing planned or recorded this week.</td></tr>}
        </tbody>
      </table>

      <h3>Sessions</h3>
      <ul className="list">
        {weekSessions.map((s) => (
          <li key={s.id}>
            <span className="grow">
              <div>{sessionName(s)}</div>
              <div className="muted small">
                {format(s.startedAt, 'EEE p')} – {s.endedAt ? format(s.endedAt, 'p') : 'running'} ·{' '}
                {formatDuration(minutesBetween(s.startedAt, s.endedAt ?? now))}
                {s.notes && ` · ${s.notes}`}
              </div>
            </span>
            {liveIds.has(s.id) && <button className="link" onClick={() => setEditing(s)}>Edit</button>}
          </li>
        ))}
        {!weekSessions.length && (
          <li className="muted">
            {needsArchive ? 'Nothing on this device for that week (older history is kept only where it was cleaned).' : 'No sessions this week.'}
          </li>
        )}
      </ul>

      {editing && (
        <SessionEditor
          s={editing}
          running={settings.runningSessionId === editing.id}
          onClose={() => setEditing(null)}
          onSave={async (d) => {
            await patchItem(uid, 'sessions', editing.id, d)
            setEditing(null)
          }}
          onEndNow={async () => {
            await endSession(uid)
            setEditing(null)
          }}
          onDelete={async () => {
            if (settings.runningSessionId === editing.id) await endSession(uid)
            await removeItem(uid, 'sessions', editing.id)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function SessionEditor(p: {
  s: Session
  running: boolean
  onClose: () => void
  onSave: (d: { startedAt: Date; endedAt: Date | null; notes: string }) => void
  onEndNow: () => void
  onDelete: () => void
}) {
  const [start, setStart] = useState(toLocalInput(p.s.startedAt))
  const [end, setEnd] = useState(p.s.endedAt ? toLocalInput(p.s.endedAt) : '')
  const [notes, setNotes] = useState(p.s.notes)
  const ok = !end || fromLocalInput(end) > fromLocalInput(start)
  return (
    <Modal title="Edit session" onClose={p.onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          if (ok) p.onSave({ startedAt: fromLocalInput(start), endedAt: end ? fromLocalInput(end) : null, notes })
        }}
      >
        <div className="row">
          <label>Start<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
          <label>End<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} disabled={p.running} /></label>
        </div>
        {p.running && <button type="button" onClick={p.onEndNow}>Forgot to end? End now</button>}
        <label>Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {!ok && <p className="overdue small">End must be after start.</p>}
        <div className="row">
          <button className="primary" disabled={!ok}>Save</button>
          <button type="button" className="danger" onClick={p.onDelete}>Delete</button>
        </div>
      </form>
    </Modal>
  )
}
