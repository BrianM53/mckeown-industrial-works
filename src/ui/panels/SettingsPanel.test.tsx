import { cleanup, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useSettings } from '@/state/settings'
import { renderInMode, resetUIState } from '../testing/helpers'
import SettingsPanel from './SettingsPanel'

beforeEach(() => resetUIState())
afterEach(() => cleanup())

const s = () => useSettings.getState()

describe('Settings panel', () => {
  it('every control is labelled', () => {
    renderInMode(<SettingsPanel onClose={() => {}} />)
    for (const name of [
      'Mute all sound',
      'Captions for sound cues',
      'Reduce motion',
      'Ambient gags & announcements',
      'Invert vertical look',
      'Mouse-look (pointer lock)',
      'Show FPS counter',
    ]) {
      expect(screen.getByRole('switch', { name })).toBeInTheDocument()
    }
    for (const name of ['Master volume', 'Music volume', 'Effects volume', 'Camera sensitivity']) expect(screen.getByRole('slider', { name })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Render quality' })).toBeInTheDocument()
  })

  it('switches update the settings store', async () => {
    const user = userEvent.setup()
    renderInMode(<SettingsPanel onClose={() => {}} />)
    await user.click(screen.getByRole('switch', { name: 'Mute all sound' }))
    expect(s().muted).toBe(true)
    await user.click(screen.getByRole('switch', { name: 'Captions for sound cues' }))
    expect(s().captions).toBe(false)
    await user.click(screen.getByRole('switch', { name: 'Ambient gags & announcements' }))
    expect(s().ambientEvents).toBe(false)
    await user.click(screen.getByRole('switch', { name: 'Invert vertical look' }))
    expect(s().invertY).toBe(true)
    await user.click(screen.getByRole('switch', { name: 'Mouse-look (pointer lock)' }))
    expect(s().pointerLock).toBe(true)
    await user.click(screen.getByRole('switch', { name: 'Show FPS counter' }))
    expect(s().showFps).toBe(true)
  })

  it('reduced motion becomes an explicit user choice, and can go back to the system setting', async () => {
    const user = userEvent.setup()
    useSettings.setState({ reducedMotion: false, reducedMotionSource: 'system' })
    renderInMode(<SettingsPanel onClose={() => {}} />)
    await user.click(screen.getByRole('switch', { name: 'Reduce motion' }))
    expect(s().reducedMotion).toBe(true)
    expect(s().reducedMotionSource).toBe('user')
    await user.click(screen.getByRole('button', { name: 'Use system setting' }))
    expect(s().reducedMotionSource).toBe('system')
  })

  it('sliders update volumes and camera sensitivity', () => {
    renderInMode(<SettingsPanel onClose={() => {}} />)
    fireEvent.change(screen.getByRole('slider', { name: 'Master volume' }), { target: { value: '0.3' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Music volume' }), { target: { value: '0.1' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Effects volume' }), { target: { value: '0.65' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Camera sensitivity' }), { target: { value: '2.5' } })
    expect(s().masterVolume).toBeCloseTo(0.3)
    expect(s().musicVolume).toBeCloseTo(0.1)
    expect(s().sfxVolume).toBeCloseTo(0.65)
    expect(s().cameraSensitivity).toBeCloseTo(2.5)
    expect(screen.getByRole('slider', { name: 'Master volume' })).toHaveAttribute('aria-valuetext', '30%')
  })

  it('sliders are native range inputs (keyboard operable) with sensible bounds', () => {
    renderInMode(<SettingsPanel onClose={() => {}} />)
    for (const name of ['Master volume', 'Music volume', 'Effects volume']) {
      const el = screen.getByRole('slider', { name })
      expect(el.tagName).toBe('INPUT')
      expect(el).toHaveAttribute('type', 'range')
      expect(el).toHaveAttribute('min', '0')
      expect(el).toHaveAttribute('max', '1')
    }
    const cam = screen.getByRole('slider', { name: 'Camera sensitivity' })
    expect(cam).toHaveAttribute('min', '0.25')
    expect(cam).toHaveAttribute('max', '3')
  })

  it('quality radio group updates the quality preference', async () => {
    const user = userEvent.setup()
    renderInMode(<SettingsPanel onClose={() => {}} />)
    await user.click(screen.getByRole('radio', { name: 'Low' }))
    expect(s().quality).toBe('low')
    await user.click(screen.getByRole('radio', { name: 'High' }))
    expect(s().quality).toBe('high')
    expect(screen.getByRole('radio', { name: 'High' })).toBeChecked()
  })

  it('"Enable sound" records consent and unmutes; it never happens on its own', async () => {
    const user = userEvent.setup()
    renderInMode(<SettingsPanel onClose={() => {}} />)
    expect(s().audioConsent).toBe(false)
    await user.click(screen.getByRole('button', { name: /enable sound/i }))
    expect(s().audioConsent).toBe(true)
    expect(s().muted).toBe(false)
  })

  it('in the HTML fallback explains where the preferences apply and offers no sound switch', () => {
    renderInMode(<SettingsPanel onClose={() => {}} />, 'fallback')
    expect(screen.getByTestId('settings-fallback-note')).toHaveTextContent(/saved in this browser/i)
    expect(screen.queryByRole('button', { name: /enable sound/i })).toBeNull()
    expect(screen.getByRole('switch', { name: 'Reduce motion' })).toBeInTheDocument()
  })

  it('reset restores defaults but keeps this visit’s sound consent', async () => {
    const user = userEvent.setup()
    const defaults = { ...s() }
    useSettings.setState({ audioConsent: true, masterVolume: 0.1, invertY: !defaults.invertY, showFps: !defaults.showFps, quality: 'low' })
    renderInMode(<SettingsPanel onClose={() => {}} />)
    await user.click(screen.getByTestId('settings-reset'))
    expect(s().masterVolume).toBe(defaults.masterVolume)
    expect(s().invertY).toBe(defaults.invertY)
    expect(s().showFps).toBe(defaults.showFps)
    expect(s().quality).toBe(defaults.quality)
    expect(s().audioConsent).toBe(true)
  })
})
