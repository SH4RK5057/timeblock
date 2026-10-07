import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves the site at /<repo>/. Override with VITE_BASE if the repo name differs.
const base = process.env.VITE_BASE ?? '/timeblock/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Timeblock',
        short_name: 'Timeblock',
        description: 'Plan the week in 15-minute blocks and track what actually happened.',
        theme_color: '#1f3a8a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
})
