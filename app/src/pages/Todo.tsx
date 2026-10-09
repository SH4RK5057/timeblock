import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import Modal from '../components/Modal'
import { dueFromDate, nextDue, taskGroup, type Repeat, type Task, type TaskGroup } from '@timeblock/shared'
import { useData } from '../data'
import { addItem, patchItem, removeItem } from '../actions'

const GROUPS: [TaskGroup, string][] = [
  ['overdue', 'Overdue'],
  ['today', 'Today'],
  ['week', 'This week'],
  ['later', 'Later'],
  ['none', 'No date'],
]

export default function Todo() {
  const { uid, tasks, activities } = useData()
  const nav = useNavigate()
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [activityId, setActivityId] = useState('')
  const [estimate, setEstimate] = useState('')
  const [repeat, setRepeat] = useState<Repeat>('none')
  const [showDone, setShowDone] = useState(false)
  const [more, setMore] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    let dueAt: Date | null = null
    const dueDate = date || (repeat !== 'none' ? format(new Date(), 'yyyy-MM-dd') : '')
    if (dueDate) {
      const day = new Date(dueDate + 'T00:00')
      if (time) {
        const [h, m] = time.split(':').map(Number)
        dueAt = new Date(day)
        dueAt.setHours(h, m, 0, 0)
      } else dueAt = dueFromDate(day)
    }
    await addItem(uid, 'tasks', {
      title: title.trim(),
      notes: '',
      activityId: activityId || null,
      dueAt,
      estimateMinutes: estimate ? Number(estimate) : null,
      locationIds: null,
      materialIds: null,
      doneAt: null,
      repeat,
    })
    setRepeat('none')
    setTitle('')
    setDate('')
    setTime('')
    setEstimate('')
  }

  const open = tasks.filter((t) => !t.doneAt)
  const done = tasks.filter((t) => t.doneAt)
  const now = new Date()
  const byDue = (a: Task, b: Task) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity)

  const row = (t: Task) => (
    <li key={t.id} className={'task' + (t.doneAt ? ' done' : '')}>
      <input
        type="checkbox"
        checked={!!t.doneAt}
        onChange={(e) =>
          e.target.checked && t.repeat !== 'none'
            ? patchItem(uid, 'tasks', t.id, { dueAt: nextDue(t.dueAt ?? new Date(), t.repeat) })
            : patchItem(uid, 'tasks', t.id, { doneAt: e.target.checked ? new Date() : null })
        }
      />
      <div className="grow">
        <div>{t.title}</div>
        <div className="muted small">
          {activities.find((a) => a.id === t.activityId)?.name}
          {t.repeat !== 'none' && ` · ↻ ${t.repeat}`}
          {t.dueAt && ` · due ${format(t.dueAt, 'EEE MMM d, p')}`}
          {t.estimateMinutes ? ` · ${t.estimateMinutes}m` : ''}
        </div>
      </div>
      <button className="link" onClick={() => setEditing(t)}>
        Edit
      </button>
      {!t.doneAt && (
        <button className="link" onClick={() => nav(`/week?task=${t.id}`)}>
          Schedule
        </button>
      )}
      <button className="link" aria-label="Delete" onClick={() => removeItem(uid, 'tasks', t.id)}>
        ✕
      </button>
    </li>
  )

  return (
    <div>
      <form className="quickadd" onSubmit={add}>
        <input placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button type="button" className="more" onClick={() => setMore(!more)}>{more ? 'Less' : 'Options'}</button>
        <button className="primary">Add</button>
        {more && <div className="opts">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!date} />
        <select value={activityId} onChange={(e) => setActivityId(e.target.value)}>
          <option value="">No activity</option>
          {activities
            .filter((a) => !a.archived)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
        <input
          type="number"
          min={5}
          step={5}
          placeholder="min"
          className="narrow"
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
        />
        <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)} title="Repeat">
          <option value="none">Doesn't repeat</option>
          <option value="daily">Repeats daily</option>
          <option value="weekly">Repeats weekly</option>
        </select>
        </div>}
      </form>

      {GROUPS.map(([g, label]) => {
        const items = open.filter((t) => taskGroup(t.dueAt, now) === g).sort(byDue)
        if (!items.length) return null
        return (
          <section key={g}>
            <h3 className={g === 'overdue' ? 'overdue' : ''}>{label}</h3>
            <ul className="list">{items.map(row)}</ul>
          </section>
        )
      })}
      {!open.length && <p className="muted">No open tasks.</p>}

      {done.length > 0 && (
        <section>
          <h3>
            <button className="link" onClick={() => setShowDone(!showDone)}>
              {showDone ? '▾' : '▸'} Done ({done.length})
            </button>
            {showDone && (
              <button
                className="link"
                onClick={() => done.forEach((t) => removeItem(uid, 'tasks', t.id))}
              >
                Clear
              </button>
            )}
          </h3>
          {showDone && <ul className="list">{done.map(row)}</ul>}
        </section>
      )}
      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function TaskEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const { uid, activities } = useData()
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const [date, setDate] = useState(task.dueAt ? format(task.dueAt, 'yyyy-MM-dd') : '')
  const [time, setTime] = useState(task.dueAt && format(task.dueAt, 'HH:mm') !== '23:59' ? format(task.dueAt, 'HH:mm') : '')
  const [activityId, setActivityId] = useState(task.activityId ?? '')
  const [estimate, setEstimate] = useState(task.estimateMinutes?.toString() ?? '')
  const [repeat, setRepeat] = useState<Repeat>(task.repeat)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    let dueAt: Date | null = null
    const dueDate = date || (repeat !== 'none' ? format(new Date(), 'yyyy-MM-dd') : '')
    if (dueDate) {
      const day = new Date(dueDate + 'T00:00')
      if (time) {
        const [h, m] = time.split(':').map(Number)
        dueAt = new Date(day)
        dueAt.setHours(h, m, 0, 0)
      } else dueAt = dueFromDate(day)
    }
    await patchItem(uid, 'tasks', task.id, {
      title: title.trim(),
      notes,
      dueAt,
      activityId: activityId || null,
      estimateMinutes: estimate ? Number(estimate) : null,
      repeat,
    })
    onClose()
  }

  return (
    <Modal title="Edit task" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label>
          Title
          <input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="row">
          <label>
            Due date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            Time (optional)
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!date} />
          </label>
        </div>
        <div className="row">
          <label>
            Activity
            <select value={activityId} onChange={(e) => setActivityId(e.target.value)}>
              <option value="">No activity</option>
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
            Estimate (min)
            <input type="number" min={5} step={5} value={estimate} onChange={(e) => setEstimate(e.target.value)} />
          </label>
        </div>
        <label>
          Repeat
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)} title="Repeat">
          <option value="none">Doesn't repeat</option>
          <option value="daily">Repeats daily</option>
          <option value="weekly">Repeats weekly</option>
        </select>
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button className="primary">Save</button>
      </form>
    </Modal>
  )
}
