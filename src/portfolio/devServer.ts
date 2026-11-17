import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { resolveSiteUrl } from './site'

/**
 * Optional Vite plugin: serves the static portfolio at `<base>portfolio/` during `vite dev`,
 * rendered from the same code as the production prerender (scripts/prerender.tsx). Without it
 * the dev server's SPA fallback answers /portfolio/ with the 3D app, so "View portfolio page"
 * links only work in builds.
 *
 * Enable in vite.config.ts (integrator-owned):
 *   import { portfolioDevServer } from './src/portfolio/devServer'
 *   plugins: [react(), portfolioDevServer()]
 *
 * Dev only (`apply: 'serve'`); reload the page to see edits (no HMR for this static page).
 */
export function portfolioDevServer(): Plugin {
  return {
    name: 'miw:portfolio-dev-server',
    apply: 'serve',
    configureServer(server) {
      // Registered directly (not returned), so it runs before Vite's own SPA fallback.
      server.middlewares.use(async (req, res, next) => {
        const base = server.config.base || '/'
        const path = (req.url ?? '').split(/[?#]/)[0]
        const target = `${base}portfolio/`
        if (path === `${base}portfolio`) {
          res.statusCode = 301
          res.setHeader('Location', target)
          res.end()
          return
        }
        if (path !== target && path !== `${target}index.html`) return next()
        try {
          const mod = (await server.ssrLoadModule('/src/portfolio/staticPage.tsx')) as typeof import('./staticPage')
          const root = server.config.root
          const css = mod.PORTFOLIO_CSS_FILES.map((file) => readFileSync(resolve(root, file), 'utf8')).join('\n')
          const fonts = mod.PORTFOLIO_FONTS.map((f) => ({
            family: f.family,
            weight: f.weight,
            preload: f.preload,
            href: `${base}node_modules/@fontsource/${f.pkg}/files/${f.file}`,
          }))
          const html = mod.renderPortfolioPage({ basePath: base, siteUrl: resolveSiteUrl(process.env), css, fonts })
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(html)
        } catch (err) {
          if (err instanceof Error) server.ssrFixStacktrace(err)
          next(err)
        }
      })
    },
  }
}
