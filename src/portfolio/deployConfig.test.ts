import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest runs from the repository root.
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
const netlify = read('netlify.toml')
const vercel = JSON.parse(read('vercel.json')) as {
  buildCommand: string
  outputDirectory: string
  rewrites: { source: string; destination: string }[]
  headers: { source: string; headers: { key: string; value: string }[] }[]
}
const deploy = read('.github/workflows/deploy.yml')
const envExample = read('.env.example')

const vercelHeader = (source: string, key: string) => vercel.headers.find((h) => h.source === source)?.headers.find((x) => x.key === key)?.value
const netlifyValue = (key: string) => new RegExp(`${key} = "([^"]+)"`).exec(netlify)?.[1]
const directives = (csp: string) => Object.fromEntries(csp.split(';').map((s) => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v]))

describe('deployment configs', () => {
  it('Netlify and Vercel send the same CSP, compatible with the 3D app and strict elsewhere', () => {
    const csp = vercelHeader('/(.*)', 'Content-Security-Policy')!
    expect(csp).toBe(netlifyValue('Content-Security-Policy'))
    const d = directives(csp)
    expect(d['default-src']).toEqual(["'self'"])
    // Rapier compiles WASM; drei <Text> (troika) runs blob workers that importScripts() blob URLs.
    expect(d['script-src']).toEqual(expect.arrayContaining(["'self'", "'wasm-unsafe-eval'", 'blob:']))
    expect(d['script-src']).not.toContain("'unsafe-inline'")
    expect(d['script-src']).not.toContain("'unsafe-eval'")
    expect(d['worker-src']).toEqual(expect.arrayContaining(["'self'", 'blob:']))
    expect(d['style-src']).toEqual(["'self'", "'unsafe-inline'"])
    expect(d['img-src']).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:']))
    expect(d['connect-src']).not.toContain('*')
    expect(d['object-src']).toEqual(["'none'"])
    expect(d['frame-ancestors']).toEqual(["'none'"])
    expect(d['base-uri']).toEqual(["'self'"])
  })

  it('both hosts send nosniff and a referrer policy', () => {
    expect(vercelHeader('/(.*)', 'X-Content-Type-Options')).toBe('nosniff')
    expect(netlifyValue('X-Content-Type-Options')).toBe('nosniff')
    expect(vercelHeader('/(.*)', 'Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(netlifyValue('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
  })

  it('caches hashed assets forever and makes HTML revalidate', () => {
    expect(vercelHeader('/assets/(.*)', 'Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(netlify).toMatch(/for = "\/assets\/\*"\s+\[headers\.values\]\s+Cache-Control = "public, max-age=31536000, immutable"/)
    expect(vercelHeader('/', 'Cache-Control')).toBe('no-cache')
    expect(vercelHeader('/portfolio/(.*)', 'Cache-Control')).toBe('no-cache')
    for (const path of ['/', '/index.html', '/404.html', '/portfolio/*', '/health.json'])
      expect(netlify).toMatch(new RegExp(`for = "${path.replace(/[.*/]/g, '\\$&')}"\\s+\\[headers\\.values\\]\\s+Cache-Control = "no-cache"`))
    // a global Cache-Control would be merged into the asset rule on Netlify
    expect(netlify).not.toMatch(/for = "\/\*"\s+\[headers\.values\][^[]*Cache-Control/)
  })

  it('SPA fallback rewrites unknown paths but never shadows the static portfolio or assets', () => {
    expect(vercel.rewrites).toHaveLength(1)
    const rule = new RegExp(`^${vercel.rewrites[0].source}$`)
    expect(vercel.rewrites[0].destination).toBe('/index.html')
    for (const p of ['/', '/some/old/link/', '/resume']) expect(rule.test(p), p).toBe(true)
    for (const p of ['/portfolio/', '/portfolio', '/portfolio/index.html', '/assets/index-abc123.js']) expect(rule.test(p), p).toBe(false)
    expect(netlify).toMatch(/\[\[redirects\]\]\s+from = "\/\*"\s+to = "\/index\.html"\s+status = 200/)
    expect(netlify).not.toMatch(/force\s*=\s*true/)
  })

  it('both hosts build with npm run build and publish dist', () => {
    expect(vercel.buildCommand).toBe('npm run build')
    expect(vercel.outputDirectory).toBe('dist')
    expect(netlify).toMatch(/command = "npm run build"/)
    expect(netlify).toMatch(/publish = "dist"/)
  })

  it('GitHub Pages workflow verifies, builds with the project base path and deploys dist', () => {
    expect(deploy).toMatch(/PAGES_BASE_PATH: \/mckeown-industrial-works\//)
    expect(deploy).toMatch(/SITE_URL: https:\/\/brianm53\.github\.io\/mckeown-industrial-works\//)
    // The base path reaches the build and the preview server, never the unit tests (BASE_URL stays "/").
    expect(deploy).toMatch(/run: npm run build\n\s+env:\n\s+BASE_PATH: \$\{\{ env\.PAGES_BASE_PATH \}\}/)
    expect(deploy).not.toMatch(/^ {2}BASE_PATH:/m)
    expect(/- name: Unit tests\n\s+run: ([^\n]+)/.exec(deploy)?.[1]).toBe('npm test -- --testTimeout=20000')
    for (const s of ['npm ci', 'npm run typecheck', 'npm test', 'npm run build', 'scripts/smoke.mjs', 'actions/upload-pages-artifact', 'actions/deploy-pages', 'pages: write', 'id-token: write', 'concurrency:', 'node-version: 22', 'cache: npm'])
      expect(deploy, s).toContain(s)
    expect(deploy).toMatch(/path: dist/)
  })

  it('.env.example documents every build variable', () => {
    for (const v of ['SITE_URL', 'BASE_PATH', 'VITE_TEST_HOOKS', 'OUT_DIR']) expect(envExample).toMatch(new RegExp(`^${v}=`, 'm'))
  })
})
