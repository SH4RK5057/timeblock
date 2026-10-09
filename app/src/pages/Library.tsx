import { useEffect, useState, type FormEvent } from 'react'
import { usuallyTakes, type Activity, type Context, type ContextKind, type Overlay } from '@timeblock/shared'
import { useData } from '../data'
import { useAuth } from '../auth'
import { notificationsSupported, requestPermission, showNotification, startAlarmSound, stopAlarmSound, unlockAudio } from '../alerts'
import { addItem, patchItem, pruneHistory, removeItem, saveSettings } from '../actions'
import { splitList } from '../util'
import Modal from '../components/Modal'
import { archiveCount, exportArchive, requestPersistence } from '../archive'

function ActivityForm({ initial, onDone }: { initial?: Activity; onDone: () => void }) {
  const { uid, contexts } = useData()
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? '#4f7cff')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [sites, setSites] = useState((initial?.blockedSites ?? []).join(', '))
  const [locs, setLocs] = useState<string[]>(initial?.locationIds ?? [])
  const [mats, setMats] = useState<string[]>(initial?.materialIds ?? [])

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const data = {
      name: name.trim(),
      color,
      notes,
      blockedSites: splitList(sites),
      locationIds: locs,
      materialIds: mats,
    }
    if (initial) await patchItem(uid, 'activities', initial.id, data)
    else await addItem(uid, 'activities', { ...data, recentMinutes: [], archived: false })
    onDone()
  }

  const chips = (kind: ContextKind, sel: string[], set: (v: string[]) => void) =>
    contexts
      .filter((c) => c.kind === kind && !c.archived)
      .map((c) => (
        <label key={c.id} className={'chip' + (sel.includes(c.id) ? ' on' : '')}>
          <input type="checkbox" checked={sel.includes(c.id)} onChange={() => toggle(sel, set, c.id)} />
          {c.name}
        </label>
      ))

  return (
    <form className="form" onSubmit={submit}>
      <label>
        Name
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="row">
        <label>
          Color
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        {initial && (
          <div className="muted small">
            Usually takes: {usuallyTakes(initial) ? `${usuallyTakes(initial)} min (learned)` : 'still learning (needs 3 sessions)'}
          </div>
        )}
      </div>
      <label>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <label>
        Blocked sites (comma separated)
        <input value={sites} onChange={(e) => setSites(e.target.value)} placeholder="reddit.com, youtube.com" />
      </label>
      <div>
        <div className="label">Doable at any of (none = anywhere)</div>
        <div className="chips">{chips('location', locs, setLocs)}</div>
      </div>
      <div>
        <div className="label">Needs all of</div>
        <div className="chips">{chips('material', mats, setMats)}</div>
      </div>
      <button className="primary">Save</button>
    </form>
  )
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const toTime = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const fromTime = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** A fixed weekly commitment (class, shift) shown behind the planner. Each day has its own times. */
function OverlayForm({ initial, onDone }: { initial?: Overlay; onDone: () => void }) {
  const { uid } = useData()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [color, setColor] = useState(initial?.color ?? '#7a869a')
  const [times, setTimes] = useState<Record<number, { start: string; end: string }>>(() => {
    const t: Record<number, { start: string; end: string }> = {}
    for (const sl of initial?.slots ?? []) t[sl.day] = { start: toTime(sl.startMin), end: toTime(sl.endMin) }
    if (!initial) for (const d of [0, 1, 2, 3, 4]) t[d] = { start: '09:00', end: '10:00' }
    return t
  })
  const days = Object.keys(times).map(Number).sort()
  const valid = (d: number) => fromTime(times[d].end) > fromTime(times[d].start)
  const ok = title.trim() && days.length > 0 && days.every(valid)

  const toggle = (d: number) =>
    setTimes((t) => {
      const next = { ...t }
      if (d in next) delete next[d]
      else {
        const last = days.length ? t[days[days.length - 1]] : { start: '09:00', end: '10:00' }
        next[d] = { ...last } // new days start with the same times as the previous one
      }
      return next
    })
  const setTime = (d: number, k: 'start' | 'end', v: string) => setTimes((t) => ({ ...t, [d]: { ...t[d], [k]: v } }))
  const copyFirstToAll = () => setTimes((t) => Object.fromEntries(days.map((d) => [d, { ...t[days[0]] }])))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ok) return
    const data = {
      title: title.trim(),
      color,
      slots: days.map((d) => ({ day: d, startMin: fromTime(times[d].start), endMin: fromTime(times[d].end) })),
    }
    if (initial) await patchItem(uid, 'overlays', initial.id, data)
    else await addItem(uid, 'overlays', data)
    onDone()
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="row">
        <label>
          Name
          <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Calculus class" />
        </label>
        <label className="colorpick">
          Color
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
      </div>
      <div className="label">Days and times (each day can differ)</div>
      <div className="dayrows">
        {DAY_NAMES.map((n, i) => (
          <div key={n} className="dayrow">
            <label className={'chip' + (i in times ? ' on' : '')}>
              <input type="checkbox" checked={i in times} onChange={() => toggle(i)} />
              {n}
            </label>
            {i in times ? (
              <>
                <input type="time" value={times[i].start} onChange={(e) => setTime(i, 'start', e.target.value)} required />
                <span className="muted">to</span>
                <input type="time" value={times[i].end} onChange={(e) => setTime(i, 'end', e.target.value)} required />
                {!valid(i) && <span className="overdue small">end after start</span>}
              </>
            ) : (
              <span className="muted small">off</span>
            )}
          </div>
        ))}
      </div>
      {days.length > 1 && (
        <button type="button" className="link left" onClick={copyFirstToAll}>
          Use {DAY_NAMES[days[0]]}'s times for every selected day
        </button>
      )}
      <button className="primary" disabled={!ok}>
        Save
      </button>
    </form>
  )
}

export default function Library() {
  const { uid, activities, contexts, settings, sessions, blocks, overlays } = useData()
  const [editingOverlay, setEditingOverlay] = useState<Overlay | 'new' | null>(null)
  const [archived, setArchived] = useState<number | null>(null)
  useEffect(() => {
    archiveCount(uid).then(setArchived)
  }, [uid])
  const [editing, setEditing] = useState<Activity | 'new' | null>(null)
  const [ctxName, setCtxName] = useState('')
  const [ctxKind, setCtxKind] = useState<ContextKind>('location')
  const { signOut } = useAuth()
  const [globalSites, setGlobalSites] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const match = (name: string) => name.toLowerCase().includes(q.trim().toLowerCase())
  const [pruneMsg, setPruneMsg] = useState('')

  const addCtx = async (e: FormEvent) => {
    e.preventDefault()
    if (!ctxName.trim()) return
    await addItem(uid, 'contexts', { kind: ctxKind, name: ctxName.trim(), archived: false })
    setCtxName('')
  }

  // Phase 2 adds session history; until then nothing references activities/contexts via sessions,
  // but blocks and tasks do, so archive rather than delete.
  const ctxRow = (c: Context) => (
    <li key={c.id} className={c.archived ? 'archived' : ''}>
      <span className="grow">{c.name}</span>
      <button className="link" onClick={() => patchItem(uid, 'contexts', c.id, { archived: !c.archived })}>
        {c.archived ? 'Restore' : 'Archive'}
      </button>
    </li>
  )

  return (
    <div className="library">
      <input
        type="search"
        className="search"
        placeholder="Search activities, locations, materials…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <section>
        <h3>
          Activities <button className="link" onClick={() => setEditing('new')}>+ New</button>
        </h3>
        <ul className="list">
          {activities.filter((a) => match(a.name)).map((a) => (
            <li key={a.id} className={a.archived ? 'archived' : ''}>
              <span className="dot" style={{ background: a.color }} />
              <span className="grow">
                {a.name}
                {usuallyTakes(a) ? <span className="muted small"> · usually {usuallyTakes(a)}m</span> : null}
              </span>
              <button className="link" onClick={() => setEditing(a)}>
                Edit
              </button>
              <button className="link" onClick={() => patchItem(uid, 'activities', a.id, { archived: !a.archived })}>
                {a.archived ? 'Restore' : 'Archive'}
              </button>
            </li>
          ))}
          {!activities.length && <li className="muted">No activities yet.</li>}
        </ul>
      </section>

      <section>
        <h3>
          Fixed schedule <button className="link" onClick={() => setEditingOverlay('new')}>+ New</button>
        </h3>
        <p className="muted small">
          Weekly commitments like classes or work. They show as a shaded background in the planner and don't count as
          activities, so they stay out of Review.
        </p>
        <ul className="list">
          {overlays.filter((o) => match(o.title)).map((o) => (
            <li key={o.id}>
              <span className="dot" style={{ background: o.color }} />
              <span className="grow">
                {o.title}
                <span className="muted small">
                  {' '}
                  · {o.slots.map((sl) => `${DAY_NAMES[sl.day]} ${toTime(sl.startMin)}–${toTime(sl.endMin)}`).join(', ')}
                </span>
              </span>
              <button className="link" onClick={() => setEditingOverlay(o)}>Edit</button>
              <button className="link" aria-label="Delete" onClick={() => removeItem(uid, 'overlays', o.id)}>✕</button>
            </li>
          ))}
          {!overlays.length && <li className="muted">Nothing yet.</li>}
        </ul>
      </section>

      <section>
        <h3>Locations</h3>
        <ul className="list">{contexts.filter((c) => c.kind === 'location' && match(c.name)).map(ctxRow)}</ul>
        <h3>Materials</h3>
        <ul className="list">{contexts.filter((c) => c.kind === 'material' && match(c.name)).map(ctxRow)}</ul>
        <form className="quickadd" onSubmit={addCtx}>
          <select value={ctxKind} onChange={(e) => setCtxKind(e.target.value as ContextKind)}>
            <option value="location">Location</option>
            <option value="material">Material</option>
          </select>
          <input placeholder="Home, Office, Laptop…" value={ctxName} onChange={(e) => setCtxName(e.target.value)} />
          <button className="primary">Add</button>
        </form>
      </section>

      <section>
        <h3>Always blocked sites</h3>
        <form
          className="quickadd"
          onSubmit={(e) => {
            e.preventDefault()
            if (globalSites !== null) saveSettings(uid, { globalBlockedSites: splitList(globalSites) })
            setGlobalSites(null)
          }}
        >
          <input
            value={globalSites ?? settings.globalBlockedSites.join(', ')}
            onChange={(e) => setGlobalSites(e.target.value)}
            placeholder="reddit.com, youtube.com"
          />
          <button className="primary">Save</button>
        </form>
        <p className="muted small">Used by the browser extension (phase 3).</p>
      </section>

      <section>
        <h3>Block start alerts</h3>
        <div className="quickadd">
          <label className="small muted">
            Default{' '}
            <select
              value={settings.notify.mode}
              onChange={async (e) => {
                const mode = e.target.value as typeof settings.notify.mode
                if (mode !== 'off') await requestPermission()
                saveSettings(uid, { notify: { ...settings.notify, mode } })
              }}
            >
              <option value="off">Off</option>
              <option value="notify">Notification</option>
              <option value="alarm">Alarm (plays a sound)</option>
            </select>
          </label>
          <label className="small muted">
            When{' '}
            <select
              value={settings.notify.leadMinutes}
              onChange={(e) => saveSettings(uid, { notify: { ...settings.notify, leadMinutes: Number(e.target.value) } })}
            >
              <option value={0}>At start</option>
              <option value={5}>5 min before</option>
              <option value={10}>10 min before</option>
              <option value={15}>15 min before</option>
            </select>
          </label>
          <button
            onClick={async () => {
              unlockAudio()
              await requestPermission()
              await showNotification('Timeblock test', 'Notifications work.', 'test', false)
              startAlarmSound()
              setTimeout(stopAlarmSound, 2500)
            }}
          >
            Test
          </button>
        </div>
        <p className="muted small">
          Each block can override this when you edit it. Alerts fire while Timeblock is open (a tab or the installed app)
          {notificationsSupported() && Notification.permission === 'denied' ? ', but notifications are blocked in your browser settings.' : '.'}
          {' '}Alarms need you to have clicked something on this page at least once so the browser allows sound. The Chrome
          extension also alerts, even when the Timeblock page is closed.
        </p>
      </section>

      <section>
        <h3>Browser extension</h3>
        <p className="muted small">
          Blocks your listed sites while a block or session is active. Sign in to it with email and password
          (guest accounts can't sync).
        </p>
        <a className="btnlink" href={`${import.meta.env.BASE_URL}timeblock-extension.zip`} download>
          Download the Chrome extension
        </a>
        <ol className="muted small">
          <li>Unzip the download.</li>
          <li>Open chrome://extensions and turn on Developer mode.</li>
          <li>Click Load unpacked and choose the unzipped folder.</li>
        </ol>
      </section>

      <section>
        <h3>Storage</h3>
        <p className="muted small">
          Timeblock only loads the last 60 days of blocks and sessions, and learns "usually takes" from 10 numbers per
          activity. Cleaning moves older history off the server; what it learned is kept.
        </p>
        <div className="quickadd">
          <label className="small muted">
            <input
              type="checkbox"
              checked={settings.autoClean.enabled}
              onChange={(e) => {
                if (e.target.checked) requestPersistence()
                saveSettings(uid, { autoClean: { ...settings.autoClean, enabled: e.target.checked } })
              }}
            />{' '}
            Auto-clean monthly
          </label>
          <label className="small muted">
            <input
              type="checkbox"
              checked={settings.autoClean.keepLocal}
              onChange={(e) => saveSettings(uid, { autoClean: { ...settings.autoClean, keepLocal: e.target.checked } })}
            />{' '}
            Keep a copy on this device
          </label>
          <label className="small muted">
            Older than{' '}
            <select
              value={settings.autoClean.days}
              onChange={(e) => saveSettings(uid, { autoClean: { ...settings.autoClean, days: Number(e.target.value) } })}
            >
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>1 year</option>
            </select>
          </label>
        </div>
        {settings.autoClean.enabled && !settings.autoClean.keepLocal && (
          <p className="overdue small">Without a local copy, cleaned history is gone for good.</p>
        )}
        <p className="muted small">
          Local copies live in this browser only, so they stay on the device that ran the cleanup. Download a backup file
          to keep them safely. {archived !== null && `${archived} item${archived === 1 ? '' : 's'} archived on this device.`}
          {settings.autoClean.lastRunMs && ` Last auto-clean: ${new Date(settings.autoClean.lastRunMs).toLocaleDateString()}.`}
        </p>
        <button
          onClick={async () => {
            const keep = settings.autoClean.keepLocal
            const days = settings.autoClean.days
            const warn = keep ? 'Move' : 'PERMANENTLY DELETE'
            if (!confirm(`${warn} all sessions and blocks older than ${days} days${keep ? ' to this device' : ''}?`)) return
            setPruneMsg('Working…')
            try {
              const n = await pruneHistory(uid, days, keep)
              setPruneMsg(`Cleaned ${n} old item${n === 1 ? '' : 's'}.`)
              archiveCount(uid).then(setArchived)
            } catch {
              setPruneMsg('Could not save a local copy, so nothing was deleted.')
            }
          }}
        >
          Clean now
        </button>{' '}
        <button onClick={() => exportArchive(uid, { sessions, blocks })}>Download backup</button>{' '}
        <span className="muted small">{pruneMsg}</span>
      </section>

      <section>
        <h3>Planner hours</h3>
        <div className="quickadd">
          {(['start', 'end'] as const).map((k) => (
            <label key={k} className="small muted">
              {k === 'start' ? 'From' : 'To'}{' '}
              <select
                value={settings.visibleHours[k]}
                onChange={(e) => {
                  const v = { ...settings.visibleHours, [k]: Number(e.target.value) }
                  if (v.end > v.start) saveSettings(uid, { visibleHours: v })
                }}
              >
                {Array.from({ length: 25 }, (_, h) => (
                  <option key={h} value={h}>{h}:00</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <button className="danger" onClick={() => signOut()}>Sign out</button>
      </section>

      {editingOverlay && (
        <Modal title={editingOverlay === 'new' ? 'New fixed schedule item' : 'Edit fixed schedule item'} onClose={() => setEditingOverlay(null)}>
          <OverlayForm initial={editingOverlay === 'new' ? undefined : editingOverlay} onDone={() => setEditingOverlay(null)} />
        </Modal>
      )}
      {editing && (
        <Modal title={editing === 'new' ? 'New activity' : 'Edit activity'} onClose={() => setEditing(null)}>
          <ActivityForm initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  )
}
