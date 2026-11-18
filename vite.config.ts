/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { portfolioDevServer } from './src/portfolio/devServer'

// BASE_PATH: public base path (e.g. "/mckeown-industrial-works/" for GitHub Pages). Defaults to "/".
// OUT_DIR: build output directory ("dist" for production, "dist-test" for the test-hook build).
// VITE_CACHE_DIR: optional private optimizer cache (use one per concurrently running dev server).
const base = process.env.BASE_PATH ?? '/'
const outDir = process.env.OUT_DIR ?? 'dist'

export default defineConfig({
  base,
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  // portfolioDevServer: serves /portfolio/ (the static HTML portfolio) under `vite dev`; dev-only.
  plugins: [react(), portfolioDevServer()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  build: {
    outDir,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 3000,
    // No manualChunks: Rollup's natural splitting keeps three / r3f / Rapier inside the lazily
    // loaded GameCanvas graph, so the entry chunk (UI + content) stays small for lite visitors.
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    css: false,
  },
})
