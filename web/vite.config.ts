import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The editor talks to the Atelier API (port 8100) for saving diagrams; the build is served by that API at /.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, proxy: { '/api': process.env.ATELIER_API || 'http://localhost:8100' } },
})
