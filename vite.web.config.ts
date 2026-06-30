import { resolve } from 'path'
import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Removes the Electron-oriented CSP meta tag, which would block the inlined
// script in the single-file web build.
function stripCsp(): PluginOption {
  return {
    name: 'strip-csp',
    transformIndexHtml(html) {
      return html.replace(
        /\s*<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/i,
        ''
      )
    }
  }
}

// Standalone browser build: produces a single self-contained dist-web/index.html
// that can be opened directly or hosted on GitHub Pages.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  plugins: [react(), stripCsp(), viteSingleFile()],
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true
  }
})
