import { useState, type FormEvent } from 'react'
import { addMinutes } from 'date-fns'
import type { Session } from '@timeblock/shared'
import { useData } from '../data'
import { endSession, logSession, patchItem, removeItem } from '../actions'
import { fromLocalInput, toLocalInput } from '../util'
import Modal from './Modal'

/** Edit an existing session, or log one after the fact (when away from where you'd press Start). */
export default function SessionModal({
  session,
  initial,
  onClose,
}: {
  session?: Session
  initial?: { start: Date; end: Date }
  onClose: () => void
}) {
  const { uid, activities, tasks, settings } = useData()
  const editing = !!session
  const running = !!session && settings.runningSessionId === session.id
  const [activityId, setActivityId] = useState(session?.activityId ?? '')
  const [taskId, setTaskId] = useState(session?.taskId ?? '')
  const [start, setStart] = useState(toLocalInput(session?.startedAt ?? initial?.start ?? addMinutes(new Date(), -60)))
  const [end, setEnd] = useState(
    session ? (session.endedAt ? toLocalInput(session.endedAt) : '') : toLocalInput(initial?.end ?? new Date()),
  )
  const [notes, setNotes] = useState(session?.notes ?? '')

  const s = fromLocalInput(start)
  const e = end ? fromLocalInput(end) : null
  const timesOk = !!start && (running || (!!e && e > s))
  const ok = timesOk && (editing || !!activityId || !!taskId)

  const save = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!ok) return
    if (session) {
      await patchItem(uid, 'sessions', session.id, {
        startedAt: s,
        endedAt: running ? null : e,
        notes,
        activityId: activityId || null,
        taskId: taskId || null,
      })
    } else {
      await logSession(uid, { activityId: activityId || null, taskId: taskId || null, startedAt: s, endedAt: e!, notes })
    }
    onClose()
  }

  return (
    <Modal title={editing ? 'Edit session' : 'Log something I did'} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label>
          Activity
          <select value={activityId} onChange={(ev) => setActivityId(ev.target.value)}>
            <option value="">—</option>
            {activities
              .filter((a) => !a.archived || a.id === activityId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Task (optional)
          <select
            value={taskId}
            onChange={(ev) => {
              const t = tasks.find((x) => x.id === ev.target.value)
              setTaskId(ev.target.value)
              if (t?.activityId && !activityId) setActivityId(t.activityId)
            }}
          >
            <option value="">—</option>
            {tasks
              .filter((t) => !t.doneAt || t.id === taskId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        </label>
        <div className="row">
          <label>
            Start
            <input type="datetime-local" value={start} onChange={(ev) => setStart(ev.target.value)} required />
          </label>
          <label>
            End
            <input type="datetime-local" value={end} onChange={(ev) => setEnd(ev.target.value)} disabled={running} required={!running} />
          </label>
        </div>
        {running && (
          <button
            type="button"
            onClick={async () => {
              await endSession(uid)
              onClose()
            }}
          >
            Forgot to end? End now
          </button>
        )}
        <label>
          Notes
          <textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} />
        </label>
        {!timesOk && <p className="overdue small">End must be after start.</p>}
        {!editing && !activityId && !taskId && <p className="muted small">Pick an activity or a task.</p>}
        <div className="row">
          <button className="primary" disabled={!ok}>
            Save
          </button>
          {session && (
            <button
              type="button"
              className="danger"
              onClick={async () => {
                if (running) await endSession(uid)
                await removeItem(uid, 'sessions', session.id)
                onClose()
              }}
            >
              Delete
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}
