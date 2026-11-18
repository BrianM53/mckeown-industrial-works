/**
 * Production-spine materials. Created per module instance (disposed on
 * unmount) and shared by every mesh of the module:
 *
 *  machine — MeshStandardMaterial + vertex colors × paint-wear map, with
 *            per-vertex roughness/metalness/emissive and 16 animated glow
 *            channels (uniform vec3 multipliers). Used by the merged static
 *            machinery, the skinned moving parts and every item InstancedMesh.
 *  fx      — additive soft glows (scan band, light volumes) with channels.
 *  belt    — scrolling conveyor surfaces: one draw call for every belt, each
 *            belt id scrolls independently (uniform float offsets).
 *  sign    — the sign atlas, slightly self-lit, with channels for lightboxes.
 *  lamp    — indicator lenses (InstancedMesh instance colors).
 */
import * as THREE from 'three'
import { textures } from '@/world/materials'

/** Glow channels (machine + sign materials). Index into uChan. */
export const CH = {
  CONST: 0,
  FURNACE: 1,
  POUR: 2,
  OVEN: 3,
  CLEANROOM: 4,
  ARCH: 5,
  REJECT: 6,
  WELD: 7,
  CAPWELD: 8,
  HOTROLL: 9,
  CERT: 10,
  POWER: 11,
  LEAK: 12,
  PRESSHOT: 13,
} as const
export const CHANNELS = 16

/** Additive FX channels. */
export const FX = {
  OFF: 0,
  SCAN: 1,
  CLEANROOM: 2,
  FURNACE: 3,
  OVEN: 4,
  RINGSCAN: 5,
  POUR: 6,
} as const

export const MAX_BELTS = 24

export interface LineMaterials {
  machine: THREE.MeshStandardMaterial
  fx: THREE.MeshBasicMaterial
  belt: THREE.MeshStandardMaterial
  sign: THREE.MeshStandardMaterial
  lamp: THREE.MeshBasicMaterial
  /** Glow channel multipliers (write with .set each frame). */
  chan: THREE.Vector3[]
  fxChan: THREE.Vector3[]
  beltOffsets: Float32Array
  dispose(): void
}

export function createMaterials(signTexture: THREE.Texture): LineMaterials {
  const chan = Array.from({ length: CHANNELS }, () => new THREE.Vector3(1, 1, 1))
  const fxChan = Array.from({ length: CHANNELS }, () => new THREE.Vector3(0, 0, 0))
  fxChan[0].set(0, 0, 0)
  const beltOffsets = new Float32Array(MAX_BELTS)
  const chanUniform = { value: chan }
  const fxUniform = { value: fxChan }
  const beltUniform = { value: beltOffsets }

  // ---- machine --------------------------------------------------------------
  const machine = new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.paintWear(), roughness: 0.62, metalness: 0.3 })
  machine.name = 'lines:machine'
  machine.onBeforeCompile = (shader) => {
    shader.uniforms.uChan = chanUniform
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aRM;
attribute float aEmis;
attribute float aChan;
uniform vec3 uChan[${CHANNELS}];
varying vec2 vRM;
varying vec3 vEmisMul;`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
vRM = aRM;
vEmisMul = aEmis * uChan[int(aChan + 0.5)];`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRM;\nvarying vec3 vEmisMul;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vEmisMul;')
  }
  machine.customProgramCacheKey = () => 'miw-lines-machine-v1'

  // ---- additive fx ------------------------------------------------------------
  const fx = new THREE.MeshBasicMaterial({
    vertexColors: true,
    map: textures.glowDot(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: true,
  })
  fx.name = 'lines:fx'
  fx.onBeforeCompile = (shader) => {
    shader.uniforms.uFx = fxUniform
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aChan;\nuniform vec3 uFx[${CHANNELS}];\nvarying vec3 vFx;`)
      .replace('#include <color_vertex>', '#include <color_vertex>\nvFx = uFx[int(aChan + 0.5)];')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFx;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vFx;')
  }
  fx.customProgramCacheKey = () => 'miw-lines-fx-v1'

  // ---- belts ------------------------------------------------------------------
  // Own clone of the shared belt texture: our transform never touches anyone else's.
  const beltTex = textures.belt().clone()
  beltTex.wrapS = beltTex.wrapT = THREE.RepeatWrapping
  beltTex.repeat.set(1, 1)
  beltTex.offset.set(0, 0)
  beltTex.needsUpdate = true
  const belt = new THREE.MeshStandardMaterial({ map: beltTex, color: '#c9c9c4', roughness: 0.86, metalness: 0.05 })
  belt.name = 'lines:belt'
  belt.onBeforeCompile = (shader) => {
    shader.uniforms.uBelt = beltUniform
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aBelt;\nuniform float uBelt[${MAX_BELTS}];`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv.y += uBelt[int(max(aBelt, 0.0) + 0.5)];')
  }
  belt.customProgramCacheKey = () => 'miw-lines-belt-v1'

  // ---- signs ------------------------------------------------------------------
  const sign = new THREE.MeshStandardMaterial({
    map: signTexture,
    emissiveMap: signTexture,
    emissive: '#ffffff',
    emissiveIntensity: 0.32,
    roughness: 0.6,
    metalness: 0.08,
    vertexColors: true,
  })
  sign.name = 'lines:sign'
  sign.onBeforeCompile = (shader) => {
    shader.uniforms.uChan = chanUniform
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aEmis;\nattribute float aChan;\nuniform vec3 uChan[${CHANNELS}];\nvarying vec3 vSignGlow;`)
      .replace('#include <color_vertex>', '#include <color_vertex>\nvSignGlow = aEmis * uChan[int(aChan + 0.5)];')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSignGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vSignGlow;')
  }
  sign.customProgramCacheKey = () => 'miw-lines-sign-v1'

  // ---- lamps ------------------------------------------------------------------
  const lamp = new THREE.MeshBasicMaterial({ color: '#ffffff' })
  lamp.name = 'lines:lamp'

  return {
    machine,
    fx,
    belt,
    sign,
    lamp,
    chan,
    fxChan,
    beltOffsets,
    dispose() {
      machine.dispose()
      fx.dispose()
      belt.dispose()
      beltTex.dispose()
      sign.dispose()
      lamp.dispose()
    },
  }
}
