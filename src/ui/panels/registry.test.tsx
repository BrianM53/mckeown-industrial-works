import { cleanup, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { lazyPanel, panelRegistry } from './registry'

afterEach(() => cleanup())

const Loaded = () => <p>loaded panel</p>

describe('panel registry', () => {
  it('maps every PanelId, including the factory-sim console', () => {
    for (const id of ['resume', 'harmony', 'codestory', 'github', 'project', 'rec', 'rnd', 'contact', 'about', 'directory', 'settings', 'help', 'console', 'achievements', 'quicklinks']) {
      expect(typeof panelRegistry[id as keyof typeof panelRegistry]?.preload, id).toBe('function')
    }
  })

  it('suspends until the chunk arrives, then renders', async () => {
    let resolve!: (m: { default: typeof Loaded }) => void
    const P = lazyPanel('help', () => new Promise((r) => (resolve = r)))
    render(
      <Suspense fallback={<p>loading</p>}>
        <P onClose={() => {}} />
      </Suspense>,
    )
    expect(screen.getByText('loading')).toBeInTheDocument()
    resolve({ default: Loaded })
    expect(await screen.findByText('loaded panel')).toBeInTheDocument()
  })

  it('renders synchronously once preloaded (no fallback flash on panel switches)', async () => {
    const P = lazyPanel('help', () => Promise.resolve({ default: Loaded }))
    await P.preload()
    render(
      <Suspense fallback={<p>loading</p>}>
        <P onClose={() => {}} />
      </Suspense>,
    )
    expect(screen.queryByText('loading')).toBeNull()
    expect(screen.getByText('loaded panel')).toBeInTheDocument()
  })

  it('retries a chunk download that failed', async () => {
    let calls = 0
    const P = lazyPanel('help', () => (++calls === 1 ? Promise.reject(new Error('network down')) : Promise.resolve({ default: Loaded })))
    await expect(P.preload()).rejects.toThrow('network down')
    await expect(P.preload()).resolves.toEqual({ default: Loaded })
    expect(calls).toBe(2)
  })
})
