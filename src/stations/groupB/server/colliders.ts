import { boxCollider, type ColliderDef } from '../shared/colliders'
import { FAN, KIOSK, RACK, RACK_ROWS, TERMINAL, kioskLayout } from './layout'

/** Static colliders for the Server Hall (pure data; checked by layout tests). */
export function serverColliders(): ColliderDef[] {
  const out: ColliderDef[] = []
  for (const row of RACK_ROWS)
    out.push(boxCollider(`server:row:${row.id}`, { minX: row.x - RACK.d / 2, maxX: row.x + RACK.d / 2, minZ: row.z0, maxZ: row.z1 }, 0, RACK.h + 0.1))
  for (const k of kioskLayout()) {
    const along = Math.abs(Math.sin(k.yaw)) > 0.5 // facing east/west: width runs along z
    const hw = (along ? KIOSK.d : KIOSK.w) / 2
    const hd = (along ? KIOSK.w : KIOSK.d) / 2
    out.push(boxCollider(`server:kiosk:${k.id}`, { minX: k.x - hw, maxX: k.x + hw, minZ: k.z - hd, maxZ: k.z + hd }, 0, KIOSK.h))
  }
  // main terminal desk (+ monitors); facing east, so its width runs along z
  out.push(
    boxCollider('server:terminal', { minX: TERMINAL.x - TERMINAL.d / 2, maxX: TERMINAL.x + TERMINAL.d / 2, minZ: TERMINAL.z - TERMINAL.w / 2 - 0.05, maxZ: TERMINAL.z + TERMINAL.w / 2 + 0.05 }, 0, 1.55),
  )
  // the fan housing (keeps visitors out of the blades)
  out.push(boxCollider('server:fan', { minX: FAN.x, maxX: FAN.cageX + 0.08, minZ: FAN.z - 2.9, maxZ: FAN.z + 2.9 }, 0, FAN.y + 2.9))
  return out
}
