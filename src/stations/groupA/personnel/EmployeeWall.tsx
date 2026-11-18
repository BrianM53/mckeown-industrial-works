import { useRef } from 'react'
import * as THREE from 'three'
import { events } from '@/core/events'
import { useInteractable } from '@/core/interaction'
import { ANCHORS, ZONES } from '@/world/layout'
import { Builder } from '../lib/builder'
import type { Atlas } from '../lib/canvas'
import { C } from '../lib/materials'
import { BuiltMeshes, useBuilt } from '../lib/react'
import { PORTRAIT_KEYS } from './art'

/**
 * Employee of the Month wall (Personnel Office east wall, ANCHORS.employeeWall):
 * six framed portraits of the same increasingly exhausted forklift driver,
 * under a brass header and the HUMAN RESOURCES (MOSTLY) sign. "Inspect" shows
 * a joke toast and unlocks the hidden 'employee-of-month' achievement.
 * Pure in-world fiction.
 */
const WALL_X = ZONES.personnel.building!.interior.maxX // inner face of the east wall
const CENTER_Z = ANCHORS.employeeWall.position[1]
const INTERACT = ANCHORS.employeeWall.interact as [number, number]

const JOKES = [
  'Employee of the Month: Dale, forklift operations. Again. He would like to go home now.',
  'Six months running. Dale is the only one with a forklift licence, so he is also the only candidate.',
  'Every photo was taken at the end of a double shift. You can tell by the eyes.',
  "Dale's prize is a reserved parking spot. He has not left the building long enough to use it.",
  'HR confirms the vote was fair. Dale was the only one awake for it.',
]

/** Frame layout on the wall: 2 rows × 3 columns (z = along the wall, y = height). */
export const PORTRAIT_SLOTS: { z: number; y: number }[] = [
  { z: CENTER_Z - 0.96, y: 2.68 },
  { z: CENTER_Z, y: 2.68 },
  { z: CENTER_Z + 0.96, y: 2.68 },
  { z: CENTER_Z - 0.96, y: 1.6 },
  { z: CENTER_Z, y: 1.6 },
  { z: CENTER_Z + 0.96, y: 1.6 },
]
const IMG_W = 0.72
const IMG_H = 0.9

function buildWall(atlas: Atlas): Builder {
  const b = new Builder()
  const x = WALL_X
  const ry = -Math.PI / 2 // planes facing west (into the room)
  const uv = (k: string) => atlas.cells[k]?.uv ?? null
  // a cork-and-oak display board behind everything
  b.box('paint', [x - 0.02, 2.35, CENTER_Z], [0.04, 2.55, 3.35], C.woodDark)
  b.box('paint', [x - 0.045, 2.35, CENTER_Z], [0.02, 2.4, 3.2], '#B58B5E')
  // portraits: frame + photo
  PORTRAIT_SLOTS.forEach((s, i) => {
    const fx = x - 0.07
    b.box('paint', [fx, s.y, s.z], [0.05, IMG_H + 0.12, IMG_W + 0.12], '#3a2618')
    b.box('metal', [fx - 0.027, s.y, s.z], [0.012, IMG_H + 0.05, IMG_W + 0.05], C.brass)
    b.plane('sign', [fx - 0.036, s.y, s.z], IMG_W, IMG_H, '#ffffff', [0, ry, 0], uv(PORTRAIT_KEYS[i]))
    // nail + little picture light per column on the top row
    if (s.y > 2) {
      b.tube('metal', [x - 0.06, s.y + IMG_H / 2 + 0.12, s.z], [x - 0.24, s.y + IMG_H / 2 + 0.22, s.z], 0.012, C.brass, 6)
      b.cylAxis('metal', [x - 0.27, s.y + IMG_H / 2 + 0.2, s.z], 'z', 0.035, 0.34, C.brass, 10)
      b.box('glow', [x - 0.27, s.y + IMG_H / 2 + 0.165, s.z], [0.03, 0.01, 0.3], new THREE.Color('#FFE2B0').multiplyScalar(2.2))
    }
  })
  // header plaque
  b.box('paint', [x - 0.05, 3.48, CENTER_Z], [0.04, 0.38, 2.9], '#3a2618')
  b.plane('sign', [x - 0.075, 3.48, CENTER_Z], 2.78, 0.33, '#ffffff', [0, ry, 0], uv('eotm'))
  // HUMAN RESOURCES (MOSTLY) sign high on the wall (visible over the machine from the door)
  b.box('paint', [x - 0.04, 4.45, CENTER_Z], [0.06, 0.62, 5.0], '#1b2222')
  b.plane('sign', [x - 0.075, 4.45, CENTER_Z], 4.86, 0.56, '#ffffff', [0, ry, 0], uv('hr'))
  for (const dz of [-2.3, 2.3]) b.tube('metal', [x - 0.02, 4.95, CENTER_Z + dz], [x - 0.02, 5.4, CENTER_Z + dz], 0.015, C.steel, 6)
  return b
}

export function EmployeeWall({ atlas, signMaterial, shadows }: { atlas: Atlas; signMaterial: THREE.Material; shadows: boolean }) {
  const meshes = useBuilt(() => buildWall(atlas), [atlas])
  const looks = useRef(0)

  useInteractable({
    id: 'station:employee-wall',
    label: 'Employee of the Month',
    verb: 'Inspect',
    radius: 2.1,
    getPosition: () => ({ x: INTERACT[0], y: 0, z: INTERACT[1] }),
    onInteract: () => {
      const text = JOKES[looks.current % JOKES.length]
      looks.current++
      events.emit('toast', { text, kind: 'info', duration: 6 })
      events.emit('achievement', { id: 'employee-of-month' })
    },
  })

  return <BuiltMeshes name="employee-wall" meshes={meshes} shadows={shadows} materialFor={(k) => (k === 'sign' ? signMaterial : undefined)} />
}
