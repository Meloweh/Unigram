import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import youtubeProxy from './server/viteYouTubePlugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), youtubeProxy()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['tests/**', 'node_modules/**'],
  },
})
