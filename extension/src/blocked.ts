import type { ExtState } from './background'

const root = document.getElementById('root')!
const CHALLENGES = 5
const CHARS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const rand = () => Array.from(crypto.getRandomValues(new Uint32Array(30)), (n) => CHARS[n % CHARS.length]).join('')
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

async function main() {
  const { state } = (await chrome.storage.local.get('state')) as { state?: ExtState }
  root.innerHTML = `
    <h1>This site is blocked</h1>
    <div class="muted">${state?.blockName ? `Right now: <b>${esc(state.blockName)}</b>` : 'A Timeblock block is active.'}</div>
    ${state?.details ? `<pre>${esc(state.details)}</pre>` : ''}
    <a href="${state?.appUrl ?? '#'}#/now" target="_blank">Open Timeblock</a>
    <button class="ghost" id="back">Go back</button>
    <hr style="border-color:#262d3a;margin:24px 0">
    <button class="ghost" id="allow">Allow 5 minutes…</button>
    <div id="challenge"></div>`
  document.getElementById('back')!.onclick = () => (history.length > 1 ? history.back() : window.close())
  document.getElementById('allow')!.onclick = startChallenge
}

/** Five retype challenges in a row; pasting is disabled and a wrong answer restarts the count. */
function startChallenge() {
  const box = document.getElementById('challenge')!
  let done = 0
  let target = rand()
  const draw = (msg = '') => {
    box.innerHTML = `
      <p class="muted">Retype exactly (${done}/${CHALLENGES}). Pasting is disabled; a mistake restarts the count.</p>
      <code>${target}</code><input id="ans" autocomplete="off" spellcheck="false" />
      <div class="err">${msg}</div>`
    const input = document.getElementById('ans') as HTMLInputElement
    input.addEventListener('paste', (e) => e.preventDefault())
    input.addEventListener('drop', (e) => e.preventDefault())
    input.focus()
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return
      if (input.value === target) {
        done++
        if (done >= CHALLENGES) {
          await chrome.runtime.sendMessage({ type: 'allow5' })
          box.innerHTML = '<p>Unblocked for 5 minutes. Reload the page.</p>'
          return
        }
        target = rand()
        draw()
      } else {
        done = 0
        target = rand()
        draw('Wrong. Starting over.')
      }
    })
  }
  draw()
}

main()
