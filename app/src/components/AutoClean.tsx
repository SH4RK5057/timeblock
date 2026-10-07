import { useEffect, useRef } from 'react'
import { useData } from '../data'
import { pruneHistory, saveSettings } from '../actions'

const MONTH_MS = 30 * 86_400_000

/** Once a month (on app open), moves old history off the server, optionally keeping a local copy first. */
export default function AutoClean() {
  const { uid, settings, ready } = useData()
  const ran = useRef(false)
  const { enabled, keepLocal, days, lastRunMs } = settings.autoClean

  useEffect(() => {
    if (!ready || ran.current || !enabled) return
    if (lastRunMs && Date.now() - lastRunMs < MONTH_MS) return
    ran.current = true
    pruneHistory(uid, days, keepLocal)
      .then(() => saveSettings(uid, { autoClean: { ...settings.autoClean, lastRunMs: Date.now() } }))
      .catch(() => {
        /* local save failed: leave server data alone and retry next launch */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, enabled])

  return null
}
