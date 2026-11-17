/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// BASE_PATH: public base path (e.g. "/mckeown-industrial-works/" for GitHub Pages). Defaults to "/".
// OUT_DIR: build output directory ("dist" for production, "dist-test" for the test-hook build).
// VITE_CACHE_DIR: optional private optimizer cache (use one per concurrently running dev server).
const base = process.env.BASE_PATH ?? '/'
const outDir = process.env.OUT_DIR ?? 'dist'

export default defineConfig({
  base,
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  build: {
    outDir,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three'
          if (id.includes('@dimforge') || id.includes('@react-three/rapier')) return 'physics'
          if (id.includes('@react-three/')) return 'r3f'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    css: false,
  },
})
