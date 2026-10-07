// Offscreen document: the only place an MV3 extension can play audio from the background.
let ctx: AudioContext | null = null
let timer: ReturnType<typeof setInterval> | undefined

function beep() {
  ctx ??= new AudioContext()
  void ctx.resume()
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

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return
  if (timer) clearInterval(timer)
  timer = undefined
  if (msg.type === 'play-alarm') {
    beep()
    timer = setInterval(beep, 1200)
    setTimeout(() => timer && clearInterval(timer), 60_000)
  }
})
