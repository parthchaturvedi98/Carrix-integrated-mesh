import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy API + mock-system routes to the Python backend on :8000 so the React app and the
// orchestrator share one origin in dev (SSE included).
const backend = 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/tos': { target: backend, changeOrigin: true },
      '/emodal': { target: backend, changeOrigin: true },
      '/ais': { target: backend, changeOrigin: true },
      '/as400': { target: backend, changeOrigin: true },
    },
  },
})
