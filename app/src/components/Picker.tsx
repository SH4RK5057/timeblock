import { useMemo } from 'react'
import { format } from 'date-fns'
import { buildPicker, usuallyTakes, type Task } from '@timeblock/shared'
import { useData } from '../data'
import { saveSettings, startSession } from '../actions'

export default function Picker() {
  const { uid, contexts, activities, tasks, sessions, settings } = useData()
  const { locationId, materialIds } = settings.lastPicker
  const locations = contexts.filter((c) => c.kind === 'location' && !c.archived)
  const materials = contexts.filter((c) => c.kind === 'material' && !c.archived)

  const result = useMemo(
    () => buildPicker({ activities, tasks, sessions, locationId, materialIds }),
    [activities, tasks, sessions, locationId, materialIds],
  )

  const remember = (p: Partial<typeof settings.lastPicker>) =>
    saveSettings(uid, { lastPicker: { locationId, materialIds, ...p } })

  const taskMeta = (t: Task) => {
    const a = activities.find((x) => x.id === t.activityId)
    const mins = t.estimateMinutes ?? usuallyTakes(a, sessions)
    return [t.dueAt && `due ${format(t.dueAt, 'EEE MMM d, p')}`, mins && `~${mins}m`].filter(Boolean).join(' · ')
  }

  const row = (t: Task) => {
    const overdue = t.dueAt && t.dueAt < new Date()
    return (
      <li key={t.id}>
        <button className="pickrow" onClick={() => startSession(uid, { taskId: t.id, activityId: t.activityId })}>
          <span className="grow">
            <div>{t.title}</div>
            <div className={'small ' + (overdue ? 'overdue' : 'muted')}>
              {overdue && 'Overdue · '}
              {taskMeta(t)}
            </div>
          </span>
          <span>▶</span>
        </button>
      </li>
    )
  }

  return (
    <div className="picker">
      <div className="label">Where are you?</div>
      <div className="chips">
        {locations.map((c) => (
          <label key={c.id} className={'chip' + (locationId === c.id ? ' on' : '')}>
            <input type="radio" name="loc" checked={locationId === c.id} onChange={() => remember({ locationId: c.id })} />
            {c.name}
          </label>
        ))}
        {!locations.length && <span className="muted small">Add locations in Library.</span>}
      </div>
      <div className="label">What do you have?</div>
      <div className="chips">
        {materials.map((c) => {
          const on = materialIds.includes(c.id)
          return (
            <label key={c.id} className={'chip' + (on ? ' on' : '')}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => remember({ materialIds: on ? materialIds.filter((m) => m !== c.id) : [...materialIds, c.id] })}
              />
              {c.name}
            </label>
          )
        })}
      </div>

      {result.dueSoon.length > 0 && (
        <>
          <h3>Due soon</h3>
          <ul className="list">{result.dueSoon.map(row)}</ul>
        </>
      )}

      <h3>Everything else</h3>
      <ul className="list">
        {result.groups.map((g) => (
          <li key={g.activity?.id ?? 'loose'} className="group">
            {g.activity ? (
              <button
                className="pickrow"
                onClick={() => startSession(uid, { activityId: g.activity!.id })}
              >
                <span className="dot" style={{ background: g.activity.color }} />
                <span className="grow">
                  <div>{g.activity.name}</div>
                  <div className="small muted">
                    {[usuallyTakes(g.activity, sessions) && `usually ${usuallyTakes(g.activity, sessions)}m`, g.uses && `${g.uses}× lately`]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </span>
                <span>▶</span>
              </button>
            ) : (
              <div className="small muted pad">Other tasks</div>
            )}
            {g.tasks.length > 0 && <ul className="sub">{g.tasks.map(row)}</ul>}
          </li>
        ))}
        {!result.groups.length && <li className="muted">Nothing fits here. Check locations and materials on your activities.</li>}
      </ul>
    </div>
  )
}
