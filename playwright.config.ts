import { defineConfig, devices } from '@playwright/test'

/**
 * E2E suite for SPEC §12 "Must-pass automated tests" (tests/e2e/*.spec.ts).
 *
 *   npm run test:e2e          # builds dist-test (debug hooks on) then runs every project
 *   npx playwright test       # run against an existing dist-test build
 *   E2E_PORT=4300 npx playwright test tests/e2e/forklift.spec.ts
 *
 * Runs against the TEST build (`npm run build:test` → dist-test, window.__MIW__ hooks enabled)
 * served by `vite preview`. Headless Chromium renders WebGL with SwiftShader (~1–5 fps), so the
 * specs load the game once per file (?quality=low&noevents=1), drive state through __MIW__ and
 * poll with generous timeouts instead of waiting for wall-clock animation.
 */
const PORT = Number(process.env.E2E_PORT ?? 4174)
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

/** Same flags as scripts/shot.mjs: software WebGL that works in headless containers. */
const SWIFTSHADER = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=user-gesture-required']

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  outputDir: 'test-results/e2e-artifacts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: Number(process.env.E2E_WORKERS ?? 2),
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-report.json' }]],
  use: {
    baseURL: BASE_URL,
    actionTimeout: 30_000,
    navigationTimeout: 120_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: { args: SWIFTSHADER },
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /mobile\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, launchOptions: { args: SWIFTSHADER } },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts$/,
      use: { ...devices['Pixel 7'], launchOptions: { args: SWIFTSHADER } },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx vite preview --outDir dist-test --port ${PORT} --strictPort`,
        url: `${BASE_URL}/health.json`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
})
