import { useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { params } from '@/core/params'
import { useGameStore } from '@/state/game'
import { useSettings } from '@/state/settings'
import type { QualityTier } from '@/core/types'
import { Scene } from './Scene'

/** Initial quality guess for 'auto': coarse pointers / low memory → low, else medium. */
export function initialQuality(): QualityTier {
  if (params.quality) return params.quality
  const s = useSettings.getState().quality
  if (s !== 'auto') return s
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    if (coarse || (mem !== undefined && mem <= 4)) return 'low'
  } catch {
    /* ignore */
  }
  return 'medium'
}

const DPR: Record<QualityTier, [number, number]> = {
  low: [0.75, 1],
  medium: [1, 1.5],
  high: [1, 2],
}

export default function GameCanvas() {
  const quality = useGameStore((s) => s.quality)
  const renderEnabled = useGameStore((s) => s.renderEnabled)
  const settingQuality = useSettings((s) => s.quality)

  useEffect(() => {
    useGameStore.getState().setQuality(initialQuality())
  }, [])
  useEffect(() => {
    if (settingQuality !== 'auto' && params.quality === null) useGameStore.getState().setQuality(settingQuality)
  }, [settingQuality])

  return (
    <div className="game-canvas" data-game-focus tabIndex={-1} role="region" aria-roledescription="3D view" aria-label="3D factory view. Use W A S D or arrow keys to walk, drag to look around.">
      <Canvas
        shadows={quality === 'low' ? false : { type: THREE.PCFShadowMap }}
        dpr={DPR[quality]}
        frameloop={renderEnabled ? 'always' : 'never'}
        gl={{ antialias: quality !== 'low', powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: 55, near: 0.1, far: 520, position: [0, 3.2, 38] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.05
        }}
      >
        <Scene />
      </Canvas>
    </div>
  )
}
