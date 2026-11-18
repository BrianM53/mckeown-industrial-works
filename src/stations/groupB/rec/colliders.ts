import { boxCollider, cylCollider, segmentCollider, type ColliderDef } from '../shared/colliders'
import { BALL_CART, BLEACHERS, FENCE, FENCE_H, FLOOD_MASTS, GOAL, NET, RULES_BOARD, SCOREBOARD, WATER_COOLER } from './layout'

/**
 * Static colliders for the Recreation Yard (pure data; checked by layout tests).
 * The fence leaves the environment's gateway open; the goal is a hollow box so
 * balls can enter the mouth and hit the net.
 */
export function recColliders(): ColliderDef[] {
  const out: ColliderDef[] = []
  for (const seg of FENCE) out.push(segmentCollider(`rec:fence:${seg.id}`, seg.a, seg.b, 0.12, FENCE_H))
  out.push(boxCollider('rec:bleachers', BLEACHERS.rect, 0, BLEACHERS.tierH * BLEACHERS.tiers + 0.05))
  const r = BLEACHERS.rect
  for (const z of [r.minZ - 0.05, r.maxZ + 0.05]) out.push(cylCollider(`rec:canopy-post:${z}`, r.minX - 0.25, z, 0.09, 2.95))
  for (const s of [-1, 1]) out.push(cylCollider(`rec:score-post:${s}`, SCOREBOARD.x + 0.05, SCOREBOARD.z + s * (SCOREBOARD.w / 2 - 0.25), 0.11, SCOREBOARD.y0 + SCOREBOARD.h))
  FLOOD_MASTS.forEach(([x, z], i) => out.push(cylCollider(`rec:mast:${i}`, x, z, 0.2, 7.6)))
  // goal: posts, side panels, back net, roof net
  const hw = GOAL.width / 2
  for (const s of [-1, 1]) {
    out.push(cylCollider(`rec:goal-post:${s}`, GOAL.x + s * hw, GOAL.mouthZ, GOAL.post + 0.01, GOAL.height))
    out.push(boxCollider(`rec:goal-side:${s}`, { minX: GOAL.x + s * hw - 0.04, maxX: GOAL.x + s * hw + 0.04, minZ: GOAL.backZ, maxZ: GOAL.mouthZ - GOAL.post }, 0, GOAL.height))
  }
  out.push(boxCollider('rec:goal-back', { minX: GOAL.x - hw, maxX: GOAL.x + hw, minZ: GOAL.backZ - 0.05, maxZ: GOAL.backZ + 0.03 }, 0, GOAL.height))
  out.push(boxCollider('rec:goal-roof', { minX: GOAL.x - hw, maxX: GOAL.x + hw, minZ: GOAL.backZ, maxZ: GOAL.mouthZ }, GOAL.height - 0.04, GOAL.height + 0.04))
  for (const s of [-1, 1]) out.push(cylCollider(`rec:net-post:${s}`, NET.x + s * NET.half, NET.z, 0.12, NET.top + 0.18))
  out.push(boxCollider('rec:rules-board', { minX: RULES_BOARD.x - 0.02, maxX: RULES_BOARD.x + 0.12, minZ: RULES_BOARD.z - RULES_BOARD.w / 2 - 0.05, maxZ: RULES_BOARD.z + RULES_BOARD.w / 2 + 0.05 }, 0, RULES_BOARD.y0 + RULES_BOARD.h + 0.15))
  out.push(cylCollider('rec:water-cooler', WATER_COOLER[0], WATER_COOLER[1], 0.32, 1.3))
  out.push(boxCollider('rec:ball-cart', { minX: BALL_CART[0] - 0.38, maxX: BALL_CART[0] + 0.38, minZ: BALL_CART[1] - 0.28, maxZ: BALL_CART[1] + 0.28 }, 0, 0.9))
  return out
}
