import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const busPort = Number(process.env.BUS_PORT ?? 5190)

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/bus': { target: `ws://localhost:${busPort}`, ws: true },
    },
  },
})
