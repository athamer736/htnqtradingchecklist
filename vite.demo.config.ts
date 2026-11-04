import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server for the standalone preview pages (no Supabase, no Electron).
// Used by `npm run demo:nda`.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: { alias: { '@renderer': resolve(__dirname, 'src/renderer/src') } },
  server: { port: 5199, strictPort: false }
})
