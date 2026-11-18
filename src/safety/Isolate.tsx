import { Component, type ReactNode } from 'react'
import { recordDebugError } from '@/core/debug'

/**
 * Error boundary for one safety sub-system, so a visual problem in (say) the
 * inspector never takes the Night Shift watchdog or the PA down with it.
 * (The module slot has its own boundary around the whole module.)
 */
export class Isolate extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    const msg = `[module:safety/${this.props.name}] ${error?.message ?? error}`
    console.error(msg, error)
    recordDebugError(msg)
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
