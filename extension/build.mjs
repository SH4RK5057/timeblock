import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'

// Firebase config comes from the environment (CI) or app/.env.local (local).
const env = { ...process.env }
if (existsSync('../app/.env.local')) {
  for (const line of readFileSync('../app/.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !(m[1] in env)) env[m[1]] = m[2]
  }
}
const def = (k, fallback = '') => JSON.stringify(env[k] ?? fallback)

rmSync('dist', { recursive: true, force: true })
mkdirSync('dist', { recursive: true })
await build({
  entryPoints: { background: 'src/background.ts', popup: 'src/popup.ts', blocked: 'src/blocked.ts', offscreen: 'src/offscreen.ts' },
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: 'chrome110',
  define: {
    __API_KEY__: def('VITE_FIREBASE_API_KEY'),
    __AUTH_DOMAIN__: def('VITE_FIREBASE_AUTH_DOMAIN'),
    __PROJECT_ID__: def('VITE_FIREBASE_PROJECT_ID'),
    __APP_ID__: def('VITE_FIREBASE_APP_ID'),
    __APP_URL__: def('VITE_APP_URL', 'https://localhost:5173/timeblock/'),
  },
})
cpSync('public', 'dist', { recursive: true })
console.log('extension built -> extension/dist')
