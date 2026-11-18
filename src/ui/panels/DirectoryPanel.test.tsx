import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { provideService, type PlayerService } from '@/core/services'
import { useUIStore } from '@/state/ui'
import { PRINCIPAL_ZONES, ZONES } from '@/world/layout'
import { contactChannels, DESTINATIONS } from '../lib/destinations'
import { renderInMode, resetUIState } from '../testing/helpers'
import DirectoryPanel from './DirectoryPanel'
import { compassFromSiteCentre, SITE_DESCRIPTION } from './SiteMap'

let removePlayer: (() => void) | null = null

beforeEach(() => resetUIState())
afterEach(() => {
  cleanup()
  removePlayer?.()
  removePlayer = null
})

function destKeys(): string[] {
  return screen.getAllByTestId(/^dest-/).map((el) => el.getAttribute('data-dest') ?? '')
}

function mockPlayer(): PlayerService {
  const svc: PlayerService = {
    teleport: vi.fn(),
    respawn: vi.fn(),
    tackle: vi.fn(async () => {}),
    setLocked: vi.fn(),
    setVisible: vi.fn(),
  }
  removePlayer = provideService('player', svc)
  return svc
}

describe('Directory panel', () => {
  it('lists the five principal destinations first, then contact, R&D, console, launch yard, maintenance', () => {
    renderInMode(<DirectoryPanel onClose={() => {}} />, 'game')
    const keys = destKeys()
    expect(keys.slice(0, 5)).toEqual(PRINCIPAL_ZONES)
    expect(keys.slice(5)).toEqual(['contact', 'rnd', 'production', 'launch', 'maintenance'])
    for (const id of PRINCIPAL_ZONES) {
      const row = screen.getByTestId(`dest-${id}`)
      expect(row).toHaveTextContent(ZONES[id].name)
      expect(row).toHaveTextContent(ZONES[id].shortName)
      expect(row).toHaveTextContent(ZONES[id].blurb)
    }
  })

  it('"Open now" opens the matching panel for every destination that has one', () => {
    renderInMode(<DirectoryPanel onClose={() => {}} />, 'game')
    for (const d of DESTINATIONS) {
      const row = screen.getByTestId(`dest-${d.key}`)
      const open = within(row).queryByRole('button', { name: /open now/i })
      if (!d.panel) {
        expect(open).toBeNull()
        continue
      }
      fireEvent.click(open!)
      expect(useUIStore.getState().panel?.id).toBe(d.panel)
    }
    expect(useUIStore.getState().panel?.id).toBe('console')
    const expected: Record<string, string> = { personnel: 'resume', control: 'harmony', radio: 'codestory', server: 'github', rec: 'rec' }
    for (const id of PRINCIPAL_ZONES) expect(DESTINATIONS.find((d) => d.key === id)?.panel).toBe(expected[id])
  })

  it('is keyboard operable', async () => {
    const user = userEvent.setup()
    renderInMode(<DirectoryPanel onClose={() => {}} />, 'game')
    const open = within(screen.getByTestId('dest-personnel')).getByRole('button', { name: /open now/i })
    open.focus()
    await user.keyboard('{Enter}')
    expect(useUIStore.getState().panel?.id).toBe('resume')
  })

  it('"Show route" sets the route target and closes; pressing it again clears the route', () => {
    const onClose = vi.fn()
    renderInMode(<DirectoryPanel onClose={onClose} />, 'game')
    fireEvent.click(within(screen.getByTestId('dest-radio')).getByRole('button', { name: /show route/i }))
    expect(useUIStore.getState().routeTarget).toBe('radio')
    expect(onClose).toHaveBeenCalledTimes(1)
    cleanup()
    renderInMode(<DirectoryPanel onClose={onClose} />, 'game')
    const hide = within(screen.getByTestId('dest-radio')).getByRole('button', { name: /hide route/i })
    expect(hide).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(hide)
    expect(useUIStore.getState().routeTarget).toBeNull()
  })

  it('routes Contact to the intake mailbox area', () => {
    renderInMode(<DirectoryPanel onClose={() => {}} />, 'game')
    fireEvent.click(within(screen.getByTestId('dest-contact')).getByRole('button', { name: /show route/i }))
    expect(useUIStore.getState().routeTarget).toBe('intake')
  })

  it('"Travel there" fast-travels via the player service with a fade, then closes', () => {
    const player = mockPlayer()
    const onClose = vi.fn()
    renderInMode(<DirectoryPanel onClose={onClose} />, 'game')
    fireEvent.click(within(screen.getByTestId('dest-personnel')).getByRole('button', { name: /travel there/i }))
    const z = ZONES.personnel
    expect(player.teleport).toHaveBeenCalledWith(z.entrance[0], z.entrance[1], z.entranceYaw, { fade: true })
    expect(onClose).toHaveBeenCalled()
  })

  it('disables "Travel there" until the player service exists, then enables it without reopening', async () => {
    renderInMode(<DirectoryPanel onClose={() => {}} />, 'game')
    const travel = within(screen.getByTestId('dest-personnel')).getByRole('button', { name: /travel there/i })
    expect(travel).toBeDisabled()
    mockPlayer() // the world finished loading while the directory was open
    await waitFor(() => expect(travel).toBeEnabled())
  })

  it('fallback mode offers only "Open now" and hides world-only destinations', () => {
    renderInMode(<DirectoryPanel onClose={() => {}} />, 'fallback')
    expect(screen.queryAllByRole('button', { name: /show route|travel there/i })).toHaveLength(0)
    const keys = destKeys()
    expect(keys.slice(0, 5)).toEqual(PRINCIPAL_ZONES)
    expect(keys).not.toContain('launch')
    expect(keys).not.toContain('maintenance')
    expect(screen.getAllByRole('button', { name: /open now/i })).toHaveLength(keys.length)
  })

  it('draws a schematic map from the layout', () => {
    renderInMode(<DirectoryPanel onClose={() => {}} />, 'game')
    const map = screen.getByTestId('site-map')
    expect(map).toHaveAttribute('role', 'img')
    for (const id of PRINCIPAL_ZONES) expect(map).toHaveTextContent(ZONES[id].shortName)
    expect(map).toHaveTextContent('YOU')
  })

  it('describes the map in text derived from the layout (names and compass directions)', () => {
    for (const id of PRINCIPAL_ZONES) {
      const dir = compassFromSiteCentre(ZONES[id].center)
      expect(SITE_DESCRIPTION).toContain(`${ZONES[id].name} (${ZONES[id].shortName}) ${dir === 'centre' ? 'in the middle' : `to the ${dir}`}`)
    }
    expect(compassFromSiteCentre([0, -4])).toBe('centre')
    expect(compassFromSiteCentre([0, -40])).toBe('north')
    expect(compassFromSiteCentre([45, -4])).toBe('east')
    expect(compassFromSiteCentre([-40, 30])).toBe('south-west')
  })

  it('names only the configured contact channels in the Contact entry', () => {
    const contact = DESTINATIONS.find((d) => d.key === 'contact')
    expect(contact?.blurb.startsWith(`${contactChannels()} links.`)).toBe(true)
    expect(contactChannels()).toMatch(/GitHub/)
  })
})
