import type { ExtState } from './background'

const root = document.getElementById('root')!
const send = (m: object): Promise<{ ok: boolean; error?: string }> => chrome.runtime.sendMessage(m)
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

async function render(err = '') {
  const { state } = (await chrome.storage.local.get('state')) as { state?: ExtState }
  if (!state?.signedIn) {
    root.innerHTML = `
      <h2>Timeblock</h2><div class="muted">Sign in with your Timeblock email and password.</div>
      <input id="e" type="email" placeholder="Email" /><input id="p" type="password" placeholder="Password" />
      <div class="err">${esc(err)}</div>
      <button id="in">Sign in</button>`
    document.getElementById('in')!.onclick = async () => {
      const email = (document.getElementById('e') as HTMLInputElement).value
      const password = (document.getElementById('p') as HTMLInputElement).value
      const r = await send({ type: 'signIn', email, password })
      render(r.ok ? '' : r.error)
    }
    return
  }
  const sites = state.domains.length ? ` · blocking ${state.domains.length} site${state.domains.length > 1 ? 's' : ''}` : ''
  root.innerHTML = `
    <h2>${esc(state.blockName ?? 'Free time')}</h2>
    <div class="muted">${state.running ? 'Session running' : state.blockName ? 'Scheduled now' : 'Nothing scheduled'}${sites}</div>
    ${state.details ? `<p>${esc(state.details)}</p>` : ''}
    ${state.running ? '<button id="end" class="end">End</button>' : state.blockName ? '<button id="start">Start</button>' : ''}
    <button id="open" class="link">Open Timeblock</button>
    <button id="out" class="link">Sign out (${esc(state.email ?? '')})</button>`
  const on = (id: string, f: () => unknown) => {
    const el = document.getElementById(id)
    if (el) el.onclick = f as () => void
  }
  on('start', async () => {
    await send({ type: 'start' })
  })
  on('end', async () => {
    await send({ type: 'end' })
  })
  on('open', () => chrome.tabs.create({ url: state.appUrl }))
  on('out', () => send({ type: 'signOut' }))
}

chrome.storage.onChanged.addListener(() => render())
send({ type: 'refresh' }).then(() => render())
