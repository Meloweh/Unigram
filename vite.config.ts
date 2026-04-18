import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import youtubeProxy from './server/viteYouTubePlugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), youtubeProxy()],
  test: {
    environment: 'happy-dom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['tests/**', 'node_modules/**'],
  },
})
