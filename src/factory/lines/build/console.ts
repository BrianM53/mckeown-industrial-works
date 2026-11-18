/**
 * Line Supervisor Console (3D) at ANCHORS.console, facing WEST toward the main
 * aisle. A chunky HMI desk with a live screen (canvas texture, ~2 Hz), and
 * controls that visibly mirror the minigame params: belt-speed knob + dial,
 * inspection slider + 10-lamp bar, press-split lever + 6 press lamps (orange =
 * tank shells, cyan = fins/panels) and a LINE CERTIFIED beacon lit when
 * model.meetsTarget. Interacting opens the console panel (index.tsx).
 */
import * as THREE from 'three'
import { damp } from '@/core/math'
import { PARAM_SPECS, TOTAL_PRESSES } from '@/systems/factory'
import { CONSOLE } from '../config'
import { CH } from '../render/materials'
import { LAMP } from '../render/lamps'
import { ConsoleScreen } from '../render/screen'
import type { Animator, Frame, Kit } from './kit'
import { COL, st } from './parts'

export interface ConsoleAnimator extends Animator {
  screen: THREE.Mesh
  dispose(): void
}

const YAW = Math.PI / 2
const PANEL_PITCH = -0.29
/** Column x on the control panel (operator's left = +x). */
const SPX = 0.48
const PRX = -0.48

export function buildConsole(k: Kit): ConsoleAnimator {
  const b = k.center
  const S = k.skin
  const rig = k.rig
  const r = CONSOLE.rect
  const cx = (r.minX + r.maxX) / 2
  const cz = (r.minZ + r.maxZ) / 2
  const body = st.paint('#2c3a3e', 0.55, 0.3)
  const dark = st.paint(COL.black, 0.6, 0.3)
  const yellow = st.paint(COL.hazard, 0.5, 0.25)
  const W = r.maxZ - r.minZ
  const D = r.maxX - r.minX

  let speedKnob = 0
  let speedNeedle = 0
  let slider = 0
  let lever = 0
  const inspectLamps: number[] = []
  const pressLamps: number[] = []
  let certLamp = 0

  b.frame(cx, 0, cz, YAW, () => {
    // base desk
    b.rbox([0, 0.42, 0.02], [W, 0.84, D - 0.04], body, 0.05)
    b.box([0, 0.05, -D / 2 + 0.03], [W - 0.04, 0.1, 0.04], dark)
    for (const s of [-1, 1]) b.box([s * (W / 2 + 0.005), 0.45, 0.02], [0.02, 0.8, D - 0.1], yellow)
    // upper housing (screen)
    b.rbox([0, 1.6, 0.39], [W, 1.5, 0.6], body, 0.06)
    b.box([0, 1.74, 0.085], [1.34, 0.8, 0.02], dark)
    b.box([0, 2.37, 0.39], [W + 0.04, 0.05, 0.64], yellow)
    for (const s of [-1, 1]) b.box([s * 0.6, 2.47, 0.16], [0.05, 0.16, 0.05], dark)
    // cable conduit + feet
    b.cylY(0, 0, 0.6, 0.06, 2.0, st.paint(COL.gunmetal), 8)
    // slanted control panel
    b.frame(0, 1.0, -0.3, 0, () => {
      b.rbox([0, 0, 0], [W - 0.04, 0.07, 0.8], st.paint('#3b4a4f', 0.5, 0.3), 0.02)
      b.box([0, 0.036, 0.36], [W - 0.1, 0.004, 0.04], yellow)
      // The operator faces +z; their left is +x. Columns left → right: speed, inspection, press split.
      // speed column: dial (clockwise angle c: point = (x - sin c, z + cos c)) + knob
      b.cylY(SPX, 0.03, 0.14, 0.13, 0.02, st.paint(COL.cream, 0.6, 0.05), 24)
      b.torus([SPX, 0.05, 0.14], 0.13, 0.012, st.metal(COL.brass), 'y', Math.PI * 2, 5, 24)
      for (let i = 0; i <= 6; i++) {
        const c = -2.2 + (i / 6) * 4.4
        b.box([SPX - Math.sin(c) * 0.1, 0.052, 0.14 + Math.cos(c) * 0.1], [0.008, 0.004, 0.03], st.paint(i === 6 ? COL.red : COL.black), [0, -c, 0])
      }
      b.cylY(SPX, 0.03, -0.16, 0.09, 0.02, dark, 16)
      // inspection column: slider track
      b.box([0, 0.04, -0.16], [0.44, 0.01, 0.035], dark)
      // press column: lever base
      b.rbox([PRX, 0.05, -0.16], [0.14, 0.05, 0.1], dark, 0.01)
      // the supervisor's mug
      b.cylY(0.68, 0.035, -0.33, 0.045, 0.1, st.paint(COL.cream, 0.6, 0.05), 12)
      b.torus([0.73, 0.09, -0.33], 0.025, 0.007, st.paint(COL.cream), 'z', Math.PI * 2, 4, 8)

      const up = b.dirToWorld([0, 1, 0])
      for (let i = 0; i < 10; i++) inspectLamps.push(k.lamps.add(b.toWorld([0.18 - i * 0.04, 0.034, 0.14]), up, 0.016, 0.012))
      for (let i = 0; i < TOTAL_PRESSES; i++) pressLamps.push(k.lamps.add(b.toWorld([PRX + 0.15 - i * 0.06, 0.034, 0.14]), up, 0.021, 0.014))

      speedNeedle = rig.add('console:needle', 0, b.toWorld([SPX, 0.05, 0.14]), YAW, PANEL_PITCH)
      speedKnob = rig.add('console:knob', 0, b.toWorld([SPX, 0.05, -0.16]), YAW, PANEL_PITCH)
      slider = rig.add('console:slider', 0, b.toWorld([0, 0.05, -0.16]), YAW, PANEL_PITCH)
      lever = rig.add('console:lever', 0, b.toWorld([PRX, 0.07, -0.16]), YAW, PANEL_PITCH)
    }, PANEL_PITCH)
  })
  // skinned controls (built in the same nested frame so they match their bones)
  S.frame(cx, 0, cz, YAW, () => {
    S.frame(0, 1.0, -0.3, 0, () => {
      S.bone(speedNeedle, () => {
        S.box([SPX, 0.055, 0.14 + 0.05], [0.012, 0.006, 0.1], st.paint(COL.red, 0.5, 0.1))
        S.cylY(SPX, 0.05, 0.14, 0.015, 0.012, dark, 8)
      })
      S.bone(speedKnob, () => {
        S.cylY(SPX, 0.05, -0.16, 0.065, 0.06, st.paint(COL.charcoal, 0.4, 0.3), 16)
        S.box([SPX, 0.112, -0.16 + 0.035], [0.014, 0.006, 0.05], st.paint(COL.hazard))
      })
      S.bone(slider, () => {
        S.rbox([0, 0.07, -0.16], [0.05, 0.05, 0.07], st.paint(COL.teal, 0.4, 0.2), 0.012)
      })
      S.bone(lever, () => {
        S.cyl([PRX, 0.07, -0.16], [PRX, 0.25, -0.16], 0.012, st.metal(COL.chrome), 8)
        S.sphere([PRX, 0.27, -0.16], 0.035, st.paint(COL.red, 0.4, 0.2), 10, 8)
      })
    }, PANEL_PITCH)
  })
  // labels + certified label on the sign atlas (same frames)
  k.sign.frame(cx, 0, cz, YAW, () => {
    k.sign.frame(0, 1.0, -0.3, 0, () => {
      const lab = (key: string, x: number) => {
        const c = k.atlas.cells[key]
        if (c) k.sign.quad([x, 0.037, 0.3], 0.36, 0.36 / c.aspect, 0, st.white, c.uv, -Math.PI / 2)
      }
      lab('console:speed', SPX)
      lab('console:inspect', 0)
      lab('console:split', PRX)
      const pc = k.atlas.cells['console:press']
      if (pc) k.sign.quad([PRX, 0.037, 0.215], 0.33, 0.33 / pc.aspect, 0, st.white, pc.uv, -Math.PI / 2)
    }, PANEL_PITCH)
    const cc = k.atlas.cells['console:cert']
    if (cc) k.sign.quad([0, 1.24, 0.074], 0.95, 0.95 / cc.aspect, 0, { color: '#ffffff', emis: 1, chan: CH.CERT }, cc.uv)
    const tc = k.atlas.cells['console:title']
    if (tc) k.sign.quad([0, 2.62, 0.13], 1.42, 1.42 / tc.aspect, 0, st.white, tc.uv)
  })
  // title backing board
  b.frame(cx, 0, cz, YAW, () => {
    const tc = k.atlas.cells['console:title']
    const h = tc ? 1.42 / tc.aspect : 0.2
    b.box([0, 2.62, 0.17], [1.48, h + 0.06, 0.06], st.paint(COL.charcoal))
    certLamp = k.lamps.add(b.toWorld([0.62, 2.4, 0.5]), [0, 1, 0], 0.11, 0.17)
  })

  // screen (own mesh; canvas texture redrawn ~2 Hz)
  const screen = new ConsoleScreen()
  const geo = new THREE.PlaneGeometry(1.24, 0.7)
  const mat = new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false })
  const mesh = new THREE.Mesh(geo, mat)
  const sp = new THREE.Vector3(0, 1.74, 0.072)
  sp.applyAxisAngle(new THREE.Vector3(0, 1, 0), YAW)
  mesh.position.set(cx + sp.x, sp.y, cz + sp.z)
  mesh.rotation.set(0, YAW + Math.PI, 0)
  mesh.name = 'lines:console-screen'

  // ---------------------------------------------------------------- animation
  const sp0 = PARAM_SPECS.conveyorSpeed
  let knobA = 0
  let sliderX = 0
  let leverA = 0
  let redrawIn = 0
  let blink = false
  return {
    screen: mesh,
    dispose() {
      geo.dispose()
      mat.dispose()
      screen.dispose()
    },
    update(f: Frame) {
      const p = f.s.params
      const m = f.s.model
      const fx = f.fx
      const dt = f.dt
      const sNorm = (p.conveyorSpeed - sp0.min) / (sp0.max - sp0.min)
      const lam = f.reduced ? 4 : 9
      knobA = damp(knobA, -2.2 + 4.4 * sNorm, lam, dt)
      sliderX = damp(sliderX, -0.18 + 0.36 * p.inspection, lam, dt)
      const tanks = Math.round(p.pressesToTanks)
      leverA = damp(leverA, 0.65 - ((tanks - 1) / (TOTAL_PRESSES - 2)) * 1.3, lam, dt)
      rig.pose(speedKnob, 0, -knobA, 0)
      rig.pose(speedNeedle, 0, -knobA, 0)
      rig.pose(slider, 0, 0, 0, -sliderX, 0, 0)
      rig.pose(lever, 0, 0, leverA)
      const lit = Math.round(p.inspection * 10)
      for (let i = 0; i < inspectLamps.length; i++) fx.lamps.light(inspectLamps[i], i < 7 ? LAMP.green : LAMP.amber, i < lit ? 1 : 0)
      for (let i = 0; i < pressLamps.length; i++) fx.lamps.light(pressLamps[i], i < tanks ? LAMP.orange : LAMP.cyan, 0.95)
      const pulse = f.reduced ? 1 : 0.8 + 0.2 * Math.sin(f.t * 3)
      fx.lamps.light(certLamp, m.meetsTarget ? LAMP.green : LAMP.amber, m.meetsTarget ? pulse : 0.12)
      fx.chan[CH.CERT].set(m.meetsTarget ? 1.4 * pulse : 0.05, m.meetsTarget ? 2.2 * pulse : 0.1, m.meetsTarget ? 1.4 * pulse : 0.08)
      redrawIn -= dt
      if (redrawIn <= 0) {
        redrawIn = 0.5
        blink = !blink
        screen.draw(f.s, blink)
      }
      mat.color.setScalar(0.35 + 0.65 * f.power)
    },
  }
}
