import { useState, type FormEvent } from 'react'
import type { Activity, Context, ContextKind } from '@timeblock/shared'
import { useData } from '../data'
import { useAuth } from '../auth'
import { notificationsSupported, requestPermission, showNotification, startAlarmSound, stopAlarmSound, unlockAudio } from '../alerts'
import { addItem, patchItem, removeItem, saveSettings } from '../actions'
import { splitList } from '../util'
import Modal from '../components/Modal'

function ActivityForm({ initial, onDone }: { initial?: Activity; onDone: () => void }) {
  const { uid, contexts } = useData()
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? '#4f7cff')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [mins, setMins] = useState(initial?.defaultMinutes?.toString() ?? '')
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
      defaultMinutes: mins ? Number(mins) : null,
      blockedSites: splitList(sites),
      locationIds: locs,
      materialIds: mats,
    }
    if (initial) await patchItem(uid, 'activities', initial.id, data)
    else await addItem(uid, 'activities', { ...data, archived: false })
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
        <label>
          Usually takes (min)
          <input type="number" min={5} step={5} value={mins} onChange={(e) => setMins(e.target.value)} />
        </label>
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

export default function Library() {
  const { uid, activities, contexts, settings } = useData()
  const [editing, setEditing] = useState<Activity | 'new' | null>(null)
  const [ctxName, setCtxName] = useState('')
  const [ctxKind, setCtxKind] = useState<ContextKind>('location')
  const { signOut } = useAuth()
  const [globalSites, setGlobalSites] = useState<string | null>(null)

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
      <section>
        <h3>
          Activities <button className="link" onClick={() => setEditing('new')}>+ New</button>
        </h3>
        <ul className="list">
          {activities.map((a) => (
            <li key={a.id} className={a.archived ? 'archived' : ''}>
              <span className="dot" style={{ background: a.color }} />
              <span className="grow">
                {a.name}
                {a.defaultMinutes ? <span className="muted small"> · {a.defaultMinutes}m</span> : null}
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
        <h3>Locations</h3>
        <ul className="list">{contexts.filter((c) => c.kind === 'location').map(ctxRow)}</ul>
        <h3>Materials</h3>
        <ul className="list">{contexts.filter((c) => c.kind === 'material').map(ctxRow)}</ul>
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

      {editing && (
        <Modal title={editing === 'new' ? 'New activity' : 'Edit activity'} onClose={() => setEditing(null)}>
          <ActivityForm initial={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  )
}
