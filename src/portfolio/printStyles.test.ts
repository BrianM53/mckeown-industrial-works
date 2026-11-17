import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { minifyCss } from './staticPage'

// Regression guards for print bugs that only show up on paper. Vitest runs from the repository root.
const css = (file: string) => minifyCss(readFileSync(resolve(process.cwd(), 'src/portfolio', file), 'utf8'))
const printBlock = (minified: string) => {
  const start = minified.indexOf('@media print{')
  expect(start, 'has a print block').toBeGreaterThanOrEqual(0)
  return minified.slice(start)
}

describe('print styles', () => {
  it('in fallback mode, hides the app chrome only while no ui panel is open (a panel prints on its own)', () => {
    const print = printBlock(css('fallback.css'))
    // global.css prints only the open panel (hiding this layer); hiding .ui-root as well would print a blank page
    expect(print).toContain('body:has(.pf-fallback):not(:has(.miw-panel)) .ui-root{display:none !important}')
    expect(print).not.toMatch(/body:has\(\.pf-fallback\) \.ui-root\{/)
  })

  it('drops the plate rivet overlay, which print economy mode would paint as a white box over the text', () => {
    expect(printBlock(css('portfolio.css'))).toContain('.pf-plate::before{content:none}')
  })

  it('never prints light text on a dark chip that depends on "Background graphics"', () => {
    const print = printBlock(css('portfolio.css'))
    const rule = /\.pf-fiction__label span,\.pf-kicker__num\{([^}]*)\}/.exec(print)?.[1] ?? ''
    expect(rule).toContain('background:none !important')
    expect(rule).toContain('color:#000 !important')
  })
})
