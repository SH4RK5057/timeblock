// Block-start alerts: system notifications plus an optional looping alarm sound (Web Audio).

let ctx: AudioContext | null = null
let timer: ReturnType<typeof setInterval> | undefined

/** Must be called from a user gesture at least once so the browser allows the alarm to play sound. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext()
    void ctx.resume()
  } catch {
    /* no audio support */
  }
}

function beep() {
  if (!ctx || ctx.state !== 'running') return
  for (const [i, freq] of [880, 660].entries()) {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'square'
    o.frequency.value = freq
    g.gain.value = 0.12
    o.connect(g).connect(ctx.destination)
    const t = ctx.currentTime + i * 0.3
    o.start(t)
    o.stop(t + 0.22)
  }
}

export function startAlarmSound() {
  stopAlarmSound()
  beep()
  timer = setInterval(beep, 1200)
  navigator.vibrate?.([400, 200, 400, 200, 400])
}

export function stopAlarmSound() {
  if (timer) clearInterval(timer)
  timer = undefined
}

export const notificationsSupported = () => 'Notification' in window

export async function requestPermission(): Promise<NotificationPermission> {
  unlockAudio()
  if (!notificationsSupported()) return 'denied'
  return Notification.requestPermission()
}

export async function showNotification(title: string, body: string, tag: string, urgent: boolean) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  const opts: NotificationOptions & { renotify?: boolean } = {
    body,
    tag,
    icon: `${import.meta.env.BASE_URL}icon.svg`,
    requireInteraction: urgent,
    renotify: true,
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) return void (await reg.showNotification(title, opts))
  } catch {
    /* fall through */
  }
  new Notification(title, opts)
}
