import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import type { Block } from '@timeblock/shared'
import { useData } from '../data'
import { startSession } from '../actions'
import { blockName } from '../util'
import { showNotification, startAlarmSound, stopAlarmSound } from '../alerts'
import { useTick } from './StatusBar'

const FRESH_MS = 2 * 60_000 // skip stale alerts when the app is opened late

const firedKey = (b: Block) => `tb-fired-${b.id}-${b.startAt.getTime()}`
const wasFired = (b: Block) => {
  try {
    return !!localStorage.getItem(firedKey(b))
  } catch {
    return false
  }
}
const markFired = (b: Block) => {
  try {
    localStorage.setItem(firedKey(b), '1')
  } catch {
    /* ignore */
  }
}

/** Fires block-start notifications and alarms while the app is open. */
export default function AlertManager() {
  const { uid, blocks, activities, tasks, settings } = useData()
  const now = useTick(1000)
  const [ringing, setRinging] = useState<Block | null>(null)

  useEffect(() => {
    for (const b of blocks) {
      const mode = b.alert === 'default' ? settings.notify.mode : b.alert
      if (mode !== 'notify' && mode !== 'alarm') continue
      const lead = settings.notify.leadMinutes * 60_000
      const fireAt = b.startAt.getTime() - lead
      const t = now.getTime()
      if (t < fireAt || t - fireAt > FRESH_MS || wasFired(b)) continue
      markFired(b)
      const name = blockName(b, activities, tasks)
      const when = lead ? `Starts at ${format(b.startAt, 'p')}` : 'Starting now'
      showNotification(name, b.details ? `${when}. ${b.details}` : when, b.id, mode === 'alarm')
      if (mode === 'alarm') {
        setRinging(b)
        startAlarmSound()
      }
    }
  }, [now, blocks, activities, tasks, settings.notify])

  if (!ringing) return null
  const dismiss = () => {
    stopAlarmSound()
    setRinging(null)
  }
  return (
    <div className="backdrop alarm">
      <div className="modal">
        <h2>⏰ {blockName(ringing, activities, tasks)}</h2>
        <p className="muted">
          {format(ringing.startAt, 'p')} – {format(ringing.endAt, 'p')}
        </p>
        {ringing.details && <p className="details">{ringing.details}</p>}
        <button
          className="primary huge"
          onClick={() => {
            startSession(uid, { blockId: ringing.id, activityId: ringing.activityId, taskId: ringing.taskId })
            dismiss()
          }}
        >
          Start
        </button>
        <button className="huge" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </div>
  )
}
