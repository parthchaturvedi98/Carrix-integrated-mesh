import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base on build so the bundle works under a GitHub Pages subpath
// (https://<user>.github.io/<repo>/). Dev keeps "/". The proxy is only used when
// developing against the Python backend (VITE_USE_BACKEND=true); the default engine
// build needs no backend.
const backend = 'http://127.0.0.1:8000'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/tos': { target: backend, changeOrigin: true },
      '/emodal': { target: backend, changeOrigin: true },
      '/ais': { target: backend, changeOrigin: true },
      '/as400': { target: backend, changeOrigin: true },
    },
  },
}))
