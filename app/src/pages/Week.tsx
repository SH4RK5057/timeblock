import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { addDays, addMinutes, format, isSameDay, startOfDay } from 'date-fns'
import { writeBatch, doc, collection } from 'firebase/firestore'
import { type AlertMode, minutesBetween, snapToSlot, usuallyTakes, SLOT_MINUTES, weekStart, type Block, type Session } from '@timeblock/shared'
import { useData } from '../data'
import { addItem, logSession, patchItem, removeItem } from '../actions'
import { db } from '../firebase'
import { blockName, fromLocalInput, splitList, toLocalInput } from '../util'
import Modal from '../components/Modal'
import SessionModal from '../components/SessionModal'




const ZOOM_MIN = 0.4
const ZOOM_MAX = 3

function useIsMobile() {
  const q = '(max-width: 720px)'
  const [m, setM] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const f = () => setM(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])
  return m
}

interface Draft {
  id: string | null // null = new
  startAt: Date
  endAt: Date
  activityId: string | null
  taskId: string | null
  title: string
  details: string
  blockedSites: string[]
  alert: AlertMode
}

type Drag = {
  kind: 'create' | 'move' | 'resize'
  id: string | null
  start: Date
  end: Date
  moved: boolean
}

export default function Week() {
  const { uid, blocks, activities, tasks, sessions, settings, overlays } = useData()
  const mobile = useIsMobile()
  const [view, setView] = useState<'day' | 'week'>(() => {
    try {
      return localStorage.getItem('tb-view') === 'week' ? 'week' : 'day'
    } catch {
      return 'day'
    }
  })
  const single = mobile || view === 'day'
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scrollY, setScrollY] = useState(0)
  const [scrollTick, setScrollTick] = useState(0)
  // Plan = what you scheduled, Actual = what happened (log it after the fact), Both = plan with an actuals strip.
  const [mode, setModeState] = useState<'plan' | 'actual' | 'both'>(() => {
    try {
      const m = localStorage.getItem('tb-mode')
      return m === 'plan' || m === 'actual' ? m : 'both'
    } catch {
      return 'both'
    }
  })
  const setMode = (m: 'plan' | 'actual' | 'both') => {
    setModeState(m)
    try {
      localStorage.setItem('tb-mode', m)
    } catch {
      /* ignore */
    }
  }
  const [showFixed, setShowFixed] = useState(() => {
    try {
      return localStorage.getItem('tb-fixed') !== '0'
    } catch {
      return true
    }
  })
  const [logDraft, setLogDraft] = useState<{ start: Date; end: Date } | null>(null)
  const [editSession, setEditSession] = useState<Session | null>(null)
  const [zoom, setZoomState] = useState(() => {
    try {
      const z = Number(localStorage.getItem('tb-zoom'))
      return z >= ZOOM_MIN && z <= ZOOM_MAX ? z : 1
    } catch {
      return 1
    }
  })
  const pxHour = (single ? 64 : 44) * zoom
  const pxMin = pxHour / 60
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const keepCenter = useRef<number | null>(null) // minutes-from-top at the viewport centre to hold steady

  /** Zoom in/out while keeping whatever time is in the middle of the view in the middle. */
  const setZoom = (next: number) => {
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
    const el = wrapRef.current
    if (el && z !== zoomRef.current) {
      const oldPxMin = ((single ? 64 : 44) * zoomRef.current) / 60
      keepCenter.current = (el.scrollTop + el.clientHeight / 2) / oldPxMin
    }
    zoomRef.current = z
    setZoomState(z)
    try {
      localStorage.setItem('tb-zoom', String(z))
    } catch {
      /* ignore */
    }
  }
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (el && keepCenter.current !== null) {
      el.scrollTop = Math.max(0, keepCenter.current * pxMin - el.clientHeight / 2)
      keepCenter.current = null
    }
  }, [zoom, pxMin])

  // Ctrl/Cmd + wheel (and trackpad pinch) zooms; two-finger pinch on touch screens.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom(zoomRef.current * Math.exp(-e.deltaY * 0.01))
    }
    let startDist = 0
    let startZoom = 1
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startDist = dist(e.touches)
        startZoom = zoomRef.current
      }
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && startDist) {
        e.preventDefault()
        setZoom(startZoom * (dist(e.touches) / startDist))
      }
    }
    const onEnd = () => (startDist = 0)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single])
  const changeView = (v: 'day' | 'week') => {
    setView(v)
    try {
      localStorage.setItem('tb-view', v)
    } catch {}
  }
  const [params, setParams] = useSearchParams()
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [draft, setDraft] = useState<Draft | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const lastPointer = useRef<string>('mouse')
  const touchX = useRef<number | null>(null)

  const hStart = settings.visibleHours.start
  const hEnd = settings.visibleHours.end
  const gridHeight = (hEnd - hStart) * pxHour

  const days = useMemo(() => {
    if (single) return [anchor]
    const ws = weekStart(anchor)
    return Array.from({ length: 7 }, (_, i) => addDays(ws, i))
  }, [anchor, single])

  const activityOf = (id: string | null) => activities.find((a) => a.id === id)
  const taskOf = (id: string | null) => tasks.find((t) => t.id === id)

  const defaultMinutes = (activityId: string | null, taskId: string | null) =>
    taskOf(taskId)?.estimateMinutes ?? usuallyTakes(activityOf(activityId)) ?? 60

  // "Schedule" from the to-do list: open a pre-filled new block.
  useEffect(() => {
    const tid = params.get('task')
    if (!tid) return
    const t = taskOf(tid)
    if (t) {
      const start = snapToSlot(new Date(), 'ceil')
      const mins = defaultMinutes(t.activityId, t.id)
      setAnchor(startOfDay(start))
      setDraft({
        id: null,
        startAt: start,
        endAt: addMinutes(start, mins),
        activityId: t.activityId,
        taskId: t.id,
        title: '',
        details: '',
        blockedSites: [], alert: 'default',
      })
    }
    setParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  /** Map a pointer position to a column day and a date/time. */
  function pointAt(clientX: number, clientY: number): Date | null {
    const grid = gridRef.current
    if (!grid) return null
    const cols = Array.from(grid.querySelectorAll<HTMLElement>('.daycol'))
    if (!cols.length) return null
    let idx = cols.findIndex((c) => {
      const r = c.getBoundingClientRect()
      return clientX >= r.left && clientX < r.right
    })
    if (idx < 0) idx = clientX < cols[0].getBoundingClientRect().left ? 0 : cols.length - 1
    const r = cols[idx].getBoundingClientRect()
    const mins = hStart * 60 + (clientY - r.top) / pxMin
    return addMinutes(days[idx], mins)
  }

  function beginDrag(e: RPointerEvent, init: Drag, grabOffsetMin = 0) {
    if (e.pointerType === 'touch') return
    e.preventDefault()
    const origin = pointAt(e.clientX, e.clientY)!
    const duration = minutesBetween(init.start, init.end)
    let current = init

    const onMove = (ev: PointerEvent) => {
      const p = pointAt(ev.clientX, ev.clientY)
      if (!p) return
      let next: Drag
      if (init.kind === 'create') {
        const a = snapToSlot(origin, 'floor')
        const b = snapToSlot(p, 'floor')
        const [s, en] = a <= b ? [a, addMinutes(b, SLOT_MINUTES)] : [b, addMinutes(a, SLOT_MINUTES)]
        next = { ...init, start: s, end: en, moved: true }
      } else if (init.kind === 'move') {
        const s = snapToSlot(addMinutes(p, -grabOffsetMin))
        next = { ...init, start: s, end: addMinutes(s, duration), moved: true }
      } else {
        const en = snapToSlot(p)
        next = { ...init, end: en <= init.start ? addMinutes(init.start, SLOT_MINUTES) : en, moved: true }
      }
      current = next
      setDrag(next)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDrag(null)
      finishDrag(current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    setDrag(init)
  }

  function finishDrag(d: Drag) {
    if (d.kind === 'create') {
      const end = d.moved ? d.end : addMinutes(d.start, 60)
      if (mode === 'actual') return setLogDraft({ start: d.start, end })
      setDraft({
        id: null,
        startAt: d.start,
        endAt: end,
        activityId: null,
        taskId: null,
        title: '',
        details: '',
        blockedSites: [], alert: 'default',
      })
      return
    }
    const b = blocks.find((x) => x.id === d.id)
    if (!b) return
    if (!d.moved) return openEdit(b)
    patchItem(uid, 'blocks', b.id, { startAt: d.start, endAt: d.end })
  }

  const openEdit = (b: Block) =>
    setDraft({
      id: b.id,
      startAt: b.startAt,
      endAt: b.endAt,
      activityId: b.activityId,
      taskId: b.taskId,
      title: b.title ?? '',
      details: b.details,
      blockedSites: b.blockedSites,
      alert: b.alert,
    })

  /** Touch: tap an empty slot to create a 1h block. */
  function onColumnClick(e: React.MouseEvent, day: Date) {
    if (lastPointer.current !== 'touch') return
    if ((e.target as HTMLElement).closest('.block')) return
    const p = pointAt(e.clientX, e.clientY)
    if (!p) return
    const s = snapToSlot(p, 'floor')
    if (mode === 'actual') return setLogDraft({ start: s, end: addMinutes(s, 60) })
    setDraft({
      id: null,
      startAt: s,
      endAt: addMinutes(s, 60),
      activityId: null,
      taskId: null,
      title: '',
      details: '',
      blockedSites: [], alert: 'default',
    })
    void day
  }

  function layout(day: Date) {
    const list = blocks
      .filter((b) => isSameDay(b.startAt, day))
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || b.endAt.getTime() - a.endAt.getTime())
    const laneEnds: Date[] = []
    const placed = list.map((b) => {
      let lane = laneEnds.findIndex((end) => end <= b.startAt)
      if (lane < 0) lane = laneEnds.length
      laneEnds[lane] = b.endAt
      return { b, lane }
    })
    return { placed, lanes: Math.max(1, laneEnds.length) }
  }

  /** Same lane packing as blocks, for sessions drawn as real blocks in Actual mode. */
  function layoutSessions(day: Date) {
    const end = (x: Session) => x.endedAt ?? new Date()
    const list = sessions.filter((x) => isSameDay(x.startedAt, day)).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    const laneEnds: Date[] = []
    const placed = list.map((x) => {
      let lane = laneEnds.findIndex((e) => e <= x.startedAt)
      if (lane < 0) lane = laneEnds.length
      laneEnds[lane] = end(x)
      return { x, lane }
    })
    return { placed, lanes: Math.max(1, laneEnds.length) }
  }

  async function logBlockDone(d: Draft) {
    await logSession(uid, {
      blockId: d.id,
      activityId: d.activityId,
      taskId: d.taskId,
      startedAt: d.startAt,
      endedAt: d.endAt < new Date() ? d.endAt : new Date(),
    })
    setDraft(null)
  }

  /** Short blocks collapse to a single line (title and time side by side) instead of overflowing. */
  const sizeClass = (h: number) => (h < 22 ? ' tiny' : h < 40 ? ' small' : '')

  const top = (d: Date) => Math.max(0, (d.getHours() * 60 + d.getMinutes() - hStart * 60) * pxMin)
  const heightOf = (s: Date, e: Date) => Math.max(10, minutesBetween(s, e) * pxMin)

  async function copyLastWeek() {
    const ws = weekStart(anchor)
    const prevStart = addDays(ws, -7)
    const prev = blocks.filter((b) => b.startAt >= prevStart && b.startAt < ws)
    if (!prev.length) return alert('No blocks last week.')
    const hasThis = blocks.some((b) => b.startAt >= ws && b.startAt < addDays(ws, 7))
    if (hasThis && !confirm('This week already has blocks. Copy last week on top?')) return
    const batch = writeBatch(db)
    for (const b of prev) {
      batch.set(doc(collection(db, `users/${uid}/blocks`)), {
        startAt: addDays(b.startAt, 7),
        endAt: addDays(b.endAt, 7),
        activityId: b.activityId,
        taskId: b.taskId,
        title: b.title,
        details: b.details,
        blockedSites: b.blockedSites,
        alert: b.alert,
      })
    }
    await batch.commit()
  }

  const step = single ? 1 : 7
  const strip = Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i))
  const now = new Date()
  const hours = Array.from({ length: hEnd - hStart }, (_, i) => hStart + i)

  function newBlockNow() {
    const s = isSameDay(anchor, now) ? snapToSlot(now, 'floor') : addMinutes(anchor, Math.max(hStart, 9) * 60)
    setDraft({ id: null, startAt: s, endAt: addMinutes(s, 60), activityId: null, taskId: null, title: '', details: '', blockedSites: [], alert: 'default' })
  }

  // Keep "now" in view: on load, on Today, and when switching views.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const n = new Date()
    const target = isSameDay(anchor, n) ? top(n) - 140 : (9 - hStart) * pxHour - 20
    el.scrollTop = Math.max(0, target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTick, single, anchor.getTime() === startOfDay(new Date()).getTime()])

  // Re-render each minute so the now-line moves.
  const [, setMinute] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setMinute((m) => m + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="week">
      <div className="weekbar">
        <button onClick={() => setAnchor(addDays(anchor, -step))} aria-label="Previous">‹</button>
        <button
          onClick={() => {
            setAnchor(startOfDay(new Date()))
            setScrollTick((n) => n + 1)
          }}
        >
          Today
        </button>
        <button onClick={() => setAnchor(addDays(anchor, step))} aria-label="Next">›</button>
        <strong className="grow title">
          {single ? format(anchor, 'EEEE, MMM d') : `${format(days[0], 'MMM d')} – ${format(days[6], 'MMM d')}`}
        </strong>
        <div className="seg" aria-label="Zoom">
          <button onClick={() => setZoom(zoom / 1.25)} aria-label="Zoom out" title="Zoom out (Ctrl + scroll)">−</button>
          <button onClick={() => setZoom(1)} aria-label="Reset zoom" title="Reset zoom">{Math.round(zoom * 100)}%</button>
          <button onClick={() => setZoom(zoom * 1.25)} aria-label="Zoom in" title="Zoom in">+</button>
        </div>
        {!mobile && (
          <div className="seg">
            <button className={view === 'day' ? 'on' : ''} onClick={() => changeView('day')}>Day</button>
            <button className={view === 'week' ? 'on' : ''} onClick={() => changeView('week')}>Week</button>
          </div>
        )}
        <button
          className="primary"
          onClick={() => (mode === 'actual' ? setLogDraft({ start: addMinutes(now, -60), end: now }) : newBlockNow())}
        >
          {mode === 'actual' ? '+ Log' : '+ Block'}
        </button>
      </div>

      <div className="modebar">
        <div className="seg" aria-label="What to show">
          <button className={mode === 'plan' ? 'on' : ''} onClick={() => setMode('plan')}>Plan</button>
          <button className={mode === 'both' ? 'on' : ''} onClick={() => setMode('both')}>Both</button>
          <button className={mode === 'actual' ? 'on' : ''} onClick={() => setMode('actual')}>What happened</button>
        </div>
        {overlays.length > 0 && (
          <button
            className={'chipbtn dark' + (showFixed ? ' on' : '')}
            onClick={() => {
              setShowFixed(!showFixed)
              try {
                localStorage.setItem('tb-fixed', showFixed ? '0' : '1')
              } catch {
                /* ignore */
              }
            }}
          >
            Fixed schedule
          </button>
        )}
        {mode === 'actual' && <span className="muted small">Drag on empty space to log something you did.</span>}
      </div>

      {single && (
        <div className="strip">
          {strip.map((d) => (
            <button
              key={d.toISOString()}
              className={'chipday' + (isSameDay(d, anchor) ? ' sel' : '') + (isSameDay(d, now) ? ' today' : '')}
              onClick={() => setAnchor(d)}
            >
              <span>{format(d, 'EEE')}</span>
              <b>{format(d, 'd')}</b>
              {blocks.some((x) => isSameDay(x.startAt, d)) && <i />}
            </button>
          ))}
        </div>
      )}

      <div className="gridwrap" ref={wrapRef} onScroll={(e) => setScrollY(e.currentTarget.scrollTop)}>
        {!single && <div className="dayheads" style={{ gridTemplateColumns: `44px repeat(${days.length}, 1fr)` }}>
          <div />
          {days.map((d) => (
            <div key={d.toISOString()} className={'dayhead' + (isSameDay(d, now) ? ' today' : '')}>
              {format(d, 'EEE d')}
            </div>
          ))}
        </div>}
        <div
          className="grid"
          style={{ gridTemplateColumns: `44px repeat(${days.length}, 1fr)`, height: gridHeight }}
          ref={gridRef}
          onTouchStart={(e) => (touchX.current = e.touches.length > 1 ? null : e.touches[0].clientX)}
          onTouchEnd={(e) => {
            if (touchX.current === null || !single) return
            const dx = e.changedTouches[0].clientX - touchX.current
            touchX.current = null
            if (Math.abs(dx) > 70) setAnchor(addDays(anchor, dx < 0 ? 1 : -1))
          }}
        >
          <div className="hours">
            {hours.map((h) => (
              <div key={h} style={{ height: pxHour }}>
                {format(new Date(2000, 0, 1, h), 'ha').toLowerCase()}
              </div>
            ))}
          </div>

          {days.map((day) => {
            const { placed, lanes } = layout(day)
            const daySessions = sessions.filter((s) => isSameDay(s.startedAt, day))
            const createPreview = drag && drag.kind === 'create' && isSameDay(drag.start, day) ? drag : null
            return (
              <div
                key={day.toISOString()}
                className="daycol"
                style={{
                  height: gridHeight,
                  backgroundSize: `100% ${pxHour}px`,
                }}
                onPointerDown={(e) => {
                  lastPointer.current = e.pointerType
                  if ((e.target as HTMLElement).closest('.block')) return
                  const p = pointAt(e.clientX, e.clientY)
                  if (!p) return
                  const s = snapToSlot(p, 'floor')
                  beginDrag(e, { kind: 'create', id: null, start: s, end: addMinutes(s, SLOT_MINUTES), moved: false })
                }}
                onClick={(e) => onColumnClick(e, day)}
              >
                {showFixed &&
                  overlays.flatMap((o) =>
                    o.slots
                      .filter((sl) => sl.day === (day.getDay() + 6) % 7)
                      .map((sl) => {
                        const a = Math.max(sl.startMin, hStart * 60)
                        const b = Math.min(sl.endMin, hEnd * 60)
                        if (b <= a) return null
                        return (
                          <div
                            key={o.id + sl.day}
                            className="fixed"
                            style={{ top: (a - hStart * 60) * pxMin, height: (b - a) * pxMin, ['--c' as string]: o.color }}
                          >
                            <span>{o.title}</span>
                          </div>
                        )
                      }),
                  )}

                {isSameDay(day, now) && now.getHours() >= hStart && now.getHours() < hEnd && (
                  <div className="nowline" style={{ top: top(now) }}>
                    <span>{format(now, 'h:mm')}</span>
                  </div>
                )}

                {placed.map(({ b, lane }) => {
                  const live = drag && drag.id === b.id ? drag : null
                  const s = live?.start ?? b.startAt
                  const e = live?.end ?? b.endAt
                  if (live && !isSameDay(s, day)) return null
                  const act = activityOf(b.activityId)
                  const overlaps = blocks.filter((o) => o.id !== b.id && o.startAt < b.endAt && o.endAt > b.startAt).length
                  return (
                    <div
                      key={b.id}
                      className={'block' + sizeClass(heightOf(s, e)) + (live ? ' dragging' : '') + (overlaps ? ' overlap' : '') + (mode === 'actual' ? ' ghost' : '')}
                      title={`${blockName(b, activities, tasks)} ${format(s, 'h:mm')}–${format(e, 'h:mma').toLowerCase()}${overlaps ? ' (overlaps another block: do both)' : ''}`}
                      style={{
                        top: top(s),
                        height: heightOf(s, e),
                        left: `${(lane / lanes) * 100}%`,
                        width: `calc(${100 / lanes}% - 8px)`,
                        background: act?.color ?? '#7a869a',
                      }}
                      onPointerDown={(ev) => {
                        lastPointer.current = ev.pointerType
                        ev.stopPropagation()
                        const p = pointAt(ev.clientX, ev.clientY)!
                        beginDrag(
                          ev,
                          { kind: 'move', id: b.id, start: b.startAt, end: b.endAt, moved: false },
                          minutesBetween(b.startAt, p),
                        )
                      }}
                      onClick={() => lastPointer.current === 'touch' && openEdit(b)}
                    >
                      <div className="btitle">{overlaps ? '⇄ ' : ''}{blockName(b, activities, tasks)}</div>
                      <div className="btime">
                        {format(s, 'h:mm')}–{format(e, 'h:mma').toLowerCase()}
                      </div>
                      <div
                        className="resize"
                        onPointerDown={(ev) => {
                          lastPointer.current = ev.pointerType
                          ev.stopPropagation()
                          beginDrag(ev, { kind: 'resize', id: b.id, start: b.startAt, end: b.endAt, moved: false })
                        }}
                      />
                    </div>
                  )
                })}

                {mode === 'actual' &&
                  (() => {
                    const { placed: sp, lanes: sl } = layoutSessions(day)
                    return sp.map(({ x, lane }) => {
                      const end = x.endedAt ?? now
                      const label =
                        tasks.find((t) => t.id === x.taskId)?.title ?? activityOf(x.activityId)?.name ?? 'Session'
                      return (
                        <div
                          key={x.id}
                          className={'block session' + sizeClass(heightOf(x.startedAt, end)) + (x.endedAt ? '' : ' live')}
                          title={`${label} ${format(x.startedAt, 'h:mm')}–${x.endedAt ? format(end, 'h:mma').toLowerCase() : 'now'}`}
                          style={{
                            top: top(x.startedAt),
                            height: heightOf(x.startedAt, end),
                            left: `${(lane / sl) * 100}%`,
                            width: `calc(${100 / sl}% - 8px)`,
                            background: activityOf(x.activityId)?.color ?? '#7a869a',
                          }}
                          onPointerDown={(ev) => ev.stopPropagation()}
                          onClick={() => setEditSession(x)}
                        >
                          <div className="btitle">{label}</div>
                          <div className="btime">
                            {format(x.startedAt, 'h:mm')}–{x.endedAt ? format(end, 'h:mma').toLowerCase() : 'now'}
                          </div>
                        </div>
                      )
                    })
                  })()}

                {mode === 'both' && daySessions.map((s) => {
                  const end = s.endedAt ?? now
                  return (
                    <div
                      key={s.id}
                      className="actual"
                      title={`Actual ${format(s.startedAt, 'p')}–${s.endedAt ? format(end, 'p') : 'now'}`}
                      style={{
                        top: top(s.startedAt),
                        height: heightOf(s.startedAt, end),
                        background: activityOf(s.activityId)?.color ?? '#333',
                      }}
                    />
                  )
                })}

                {createPreview && (
                  <div
                    className="block preview"
                    style={{ top: top(createPreview.start), height: heightOf(createPreview.start, createPreview.end) }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {(() => {
        const viewingToday = days.some((d) => isSameDay(d, now))
        const h = wrapRef.current?.clientHeight ?? 600
        const y = top(now) + (single ? 0 : 30)
        const inRange = now.getHours() >= hStart && now.getHours() < hEnd
        let label: string | null = null
        if (!viewingToday) label = 'Jump to today'
        else if (!inRange) label = `Now ${format(now, 'h:mm a')} (outside visible hours)`
        else if (y < scrollY) label = `↑ Now ${format(now, 'h:mm a')}`
        else if (y > scrollY + h - 20) label = `↓ Now ${format(now, 'h:mm a')}`
        if (!label) return null
        return (
          <button
            className="nowpill"
            onClick={() => {
              setAnchor(startOfDay(new Date()))
              setScrollTick((n) => n + 1)
            }}
          >
            {label}
          </button>
        )
      })()}

      {logDraft && <SessionModal initial={logDraft} onClose={() => setLogDraft(null)} />}
      {editSession && <SessionModal session={editSession} onClose={() => setEditSession(null)} />}

      {draft && (
        <BlockEditor
          draft={draft}
          onClose={() => setDraft(null)}
          defaultMinutes={defaultMinutes}
          onSave={async (d) => {
            const data = {
              startAt: d.startAt,
              endAt: d.endAt,
              activityId: d.activityId,
              taskId: d.taskId,
              title: d.title.trim() || null,
              details: d.details,
              blockedSites: d.blockedSites,
              alert: d.alert,
            }
            if (d.id) await patchItem(uid, 'blocks', d.id, data)
            else await addItem(uid, 'blocks', data)
            setDraft(null)
          }}
          onLogDone={draft.id && draft.startAt <= new Date() ? logBlockDone : undefined}
          onDelete={
            draft.id
              ? async () => {
                  await removeItem(uid, 'blocks', draft.id!)
                  setDraft(null)
                }
              : undefined
          }
        />
      )}
    </div>
  )
}

function BlockEditor({
  draft,
  onClose,
  onSave,
  onDelete,
  onLogDone,
  defaultMinutes,
}: {
  draft: Draft
  onClose: () => void
  onSave: (d: Draft) => void
  onDelete?: () => void
  onLogDone?: (d: Draft) => void
  defaultMinutes: (activityId: string | null, taskId: string | null) => number
}) {
  const { uid, activities, tasks } = useData()
  const [d, setD] = useState(draft)
  const [creating, setCreating] = useState(false)
  const [lenText, setLenText] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#4f7cff')

  const createActivity = async () => {
    if (!newName.trim()) return
    const created = await addItem(uid, 'activities', {
      name: newName.trim(),
      color: newColor,
      notes: '',
      recentMinutes: [],
      blockedSites: [],
      locationIds: [],
      materialIds: [],
      archived: false,
    })
    const p: Partial<Draft> = { activityId: created.id }
    setD((x) => ({ ...x, ...p }))
    setCreating(false)
    setNewName('')
  }
  const [sites, setSites] = useState(draft.blockedSites.join(', '))
  const isNew = draft.id === null
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))

  // For a new block, choosing an activity/task sets the length from "usually takes"/estimate.
  const pick = (activityId: string | null, taskId: string | null) => {
    const p: Partial<Draft> = { activityId, taskId }
    if (isNew && (activityId || taskId)) p.endAt = addMinutes(d.startAt, defaultMinutes(activityId, taskId))
    set(p)
  }

  const valid = d.endAt > d.startAt && (d.activityId || d.taskId || d.title.trim())

  return (
    <Modal title={isNew ? 'New block' : 'Edit block'} onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) onSave({ ...d, blockedSites: splitList(sites) })
        }}
      >
        <label>
          Activity
          <select value={d.activityId ?? ''} onChange={(e) => pick(e.target.value || null, d.taskId)}>
            <option value="">—</option>
            {activities
              .filter((a) => !a.archived || a.id === d.activityId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        {creating ? (
          <div className="newact">
            <input autoFocus placeholder="New activity name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} aria-label="Color" />
            <button type="button" className="primary" onClick={createActivity} disabled={!newName.trim()}>
              Add
            </button>
            <button type="button" className="link" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="link left" onClick={() => setCreating(true)}>
            + New activity
          </button>
        )}
        <label>
          Task
          <select
            value={d.taskId ?? ''}
            onChange={(e) => {
              const t = tasks.find((x) => x.id === e.target.value)
              pick(t?.activityId ?? d.activityId, e.target.value || null)
            }}
          >
            <option value="">—</option>
            {tasks
              .filter((t) => !t.doneAt || t.id === d.taskId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          Title (overrides the name)
          <input value={d.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <div className="row">
          <label>
            Start
            <input
              type="datetime-local"
              step={900}
              value={toLocalInput(d.startAt)}
              onChange={(e) => {
                if (!e.target.value) return
                const start = fromLocalInput(e.target.value)
                set({ startAt: start, endAt: new Date(start.getTime() + (d.endAt.getTime() - d.startAt.getTime())) })
              }}
            />
          </label>
          <label>
            End
            <input
              type="datetime-local"
              step={900}
              value={toLocalInput(d.endAt)}
              onChange={(e) => e.target.value && set({ endAt: fromLocalInput(e.target.value) })}
            />
          </label>
        </div>
        <div className="lenrow">
          <label>
            Length (minutes)
            <input
              type="number"
              inputMode="numeric"
              min={5}
              step={5}
              value={lenText ?? String(Math.max(0, minutesBetween(d.startAt, d.endAt)))}
              onChange={(e) => {
                setLenText(e.target.value)
                const n = Math.round(Number(e.target.value))
                if (n >= 1) set({ endAt: addMinutes(d.startAt, n) })
              }}
              onBlur={() => setLenText(null)}
            />
          </label>
          {[15, 30, 45, 60, 90].map((m) => (
            <button
              type="button"
              key={m}
              className={'chipbtn dark' + (minutesBetween(d.startAt, d.endAt) === m ? ' on' : '')}
              onClick={() => {
                setLenText(null)
                set({ endAt: addMinutes(d.startAt, m) })
              }}
            >
              {m}m
            </button>
          ))}
        </div>
        <DayMini
          start={d.startAt}
          end={d.endAt}
          id={d.id}
          onPick={(start) => set({ startAt: start, endAt: new Date(start.getTime() + (d.endAt.getTime() - d.startAt.getTime())) })}
        />
        <label>
          Details
          <textarea value={d.details} onChange={(e) => set({ details: e.target.value })} />
        </label>
        <label>
          Extra blocked sites
          <input value={sites} onChange={(e) => setSites(e.target.value)} placeholder="reddit.com" />
        </label>
        <label>
          Alert at start
          <select value={d.alert} onChange={(e) => set({ alert: e.target.value as AlertMode })}>
            <option value="default">Use my default</option>
            <option value="notify">Notification</option>
            <option value="alarm">Alarm (plays a sound)</option>
            <option value="none">No alert</option>
          </select>
        </label>
        {!valid && <p className="muted small">Pick an activity or task, or enter a title; end must be after start.</p>}
        <div className="row">
          <button className="primary" disabled={!valid}>
            Save
          </button>
          {onLogDone && (
            <button type="button" onClick={() => onLogDone(d)} title="Record this block as something you actually did">
              Log as done
            </button>
          )}
          {onDelete && (
            <button type="button" className="danger" onClick={onDelete}>
              Delete
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}

/** A strip of the day showing what's already planned and where this block lands. Click it to move the block. */
function DayMini({ start, end, id, onPick }: { start: Date; end: Date; id: string | null; onPick: (s: Date) => void }) {
  const { blocks, overlays, activities, settings } = useData()
  const day = startOfDay(start)
  const h0 = Math.min(settings.visibleHours.start, start.getHours())
  const h1 = Math.max(settings.visibleHours.end, Math.ceil((end.getHours() * 60 + end.getMinutes()) / 60) || 24)
  const span = (h1 - h0) * 60
  const pct = (d: Date) => ((d.getHours() * 60 + d.getMinutes() - h0 * 60) / span) * 100
  const dow = (day.getDay() + 6) % 7
  const others = blocks.filter((b) => b.id !== id && isSameDay(b.startAt, day))
  const now = new Date()
  const ticks = Array.from({ length: Math.floor((h1 - h0) / 3) + 1 }, (_, i) => h0 + i * 3).filter((h) => h <= h1)
  const clip = (a: number, b: number) => ({ left: `${Math.max(0, a)}%`, width: `${Math.max(0.6, Math.min(100, b) - Math.max(0, a))}%` })

  return (
    <div className="daymini">
      <div className="small muted">
        {format(start, 'EEEE, MMM d')} · {format(start, 'h:mm a')} – {format(end, 'h:mm a')} · tap the strip to move it
      </div>
      <div
        className="dmbar"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const mins = h0 * 60 + ((e.clientX - r.left) / r.width) * span
          onPick(snapToSlot(addMinutes(day, mins), 'floor'))
        }}
      >
        {overlays.flatMap((o) =>
          o.slots
            .filter((sl) => sl.day === dow)
            .map((sl) => (
              <div
                key={o.id + sl.day}
                className="dmfixed"
                title={o.title}
                style={{ ...clip(((sl.startMin - h0 * 60) / span) * 100, ((sl.endMin - h0 * 60) / span) * 100), ['--c' as string]: o.color }}
              />
            )),
        )}
        {others.map((b) => (
          <div
            key={b.id}
            className="dmblock"
            title={`${format(b.startAt, 'h:mm')}–${format(b.endAt, 'h:mma')}`}
            style={{ ...clip(pct(b.startAt), pct(b.endAt)), background: activities.find((a) => a.id === b.activityId)?.color ?? '#7a869a' }}
          />
        ))}
        {isSameDay(now, day) && <div className="dmnow" style={{ left: `${pct(now)}%` }} />}
        <div className="dmnew" style={clip(pct(start), pct(end))} />
      </div>
      <div className="dmticks">
        {ticks.map((h) => (
          <span key={h} style={{ left: `${((h - h0) / (h1 - h0)) * 100}%` }}>
            {format(new Date(2000, 0, 1, h % 24), 'ha').toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  )
}
