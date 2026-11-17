import { useRef } from 'react'
import { events } from '@/core/events'
import { useInteractable } from '@/core/interaction'
import { ANCHORS } from '@/world/layout'
import { EXEC_PEEK_LINES } from '../data/text'

/**
 * The locked executive office (break room, SE corner). You cannot get in; you
 * can only Peek through the glass at the single giant pie chart labeled
 * SYNERGY. Unlocks the hidden 'synergy' achievement.
 */
export function ExecutiveOffice() {
  const peeks = useRef(0)
  const [ix, iz] = ANCHORS.executiveOffice.interact
  useInteractable({
    id: 'env:executive-office',
    label: 'Executive Office',
    verb: 'Peek',
    radius: 2.2,
    getPosition: () => ({ x: ix, y: 0, z: iz }),
    onInteract: () => {
      const line = EXEC_PEEK_LINES[peeks.current % EXEC_PEEK_LINES.length]
      peeks.current++
      events.emit('achievement', { id: 'synergy' })
      events.emit('toast', { text: line, kind: 'info', duration: 5 })
      events.emit('sfx', { name: 'interact', position: [ix, 1.4, iz] })
    },
  })
  return null
}
