import * as THREE from 'three'

/**
 * onBeforeCompile patches for MeshStandardMaterial-based environment materials.
 * Adds cheap, stylized surface richness without extra textures or draw calls:
 *  - macro brightness variation from world-space value noise
 *  - height-based ambient occlusion (objects darken toward the ground)
 *  - optional vertical grime streaks (walls)
 *  - optional "ground" mode: two-scale world-space texture sampling (no visible
 *    tiling), saw-cut slab joints, oil stains (lower roughness), and contact
 *    shadows near building footprints / the perimeter wall.
 */
export interface EnvPatch {
  macro?: number
  aoMin?: number
  aoHeight?: number
  streaks?: number
  ground?: {
    tileA: number
    tileB: number
    joint?: number
    jointDark?: number
    stains?: number
    /** Footprints that darken the ground around them (contact AO). */
    rects?: THREE.Vector4[]
    /** Walkable bounds: ground darkens near the perimeter wall. */
    bounds?: THREE.Vector4
  }
}

const f = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`)

const NOISE = /* glsl */ `
varying vec3 vEnvW;
float envStain;
float envHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float envNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 fr = fract(p);
  vec2 u = fr * fr * (3.0 - 2.0 * fr);
  return mix(mix(envHash(i), envHash(i + vec2(1.0, 0.0)), u.x), mix(envHash(i + vec2(0.0, 1.0)), envHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`

export function applyEnvPatch<T extends THREE.Material>(mat: T, opts: EnvPatch, key: string): T {
  const macro = opts.macro ?? 0.08
  const aoMin = opts.aoMin ?? 0.62
  const aoH = opts.aoHeight ?? 1.5
  const g = opts.ground
  const nRects = g?.rects?.length ?? 0
  const defines: string[] = [`#define ENV_MACRO ${f(macro)}`, `#define ENV_AO_MIN ${f(aoMin)}`, `#define ENV_AO_H ${f(aoH)}`]
  if (opts.streaks) defines.push(`#define ENV_STREAKS ${f(opts.streaks)}`)
  if (g) {
    defines.push('#define ENV_GROUND 1', `#define ENV_TILE_A ${f(g.tileA)}`, `#define ENV_TILE_B ${f(g.tileB)}`, `#define ENV_STAINS ${f(g.stains ?? 0)}`)
    if (g.joint && g.jointDark) defines.push(`#define ENV_JOINT ${f(g.joint)}`, `#define ENV_JOINT_DARK ${f(g.jointDark)}`)
    if (nRects) defines.push(`#define ENV_RECTS ${nRects}`)
    if (g.bounds) defines.push('#define ENV_BOUNDS 1')
  }
  const head = defines.join('\n') + '\n'

  mat.onBeforeCompile = (shader) => {
    if (g?.rects?.length) shader.uniforms.uEnvRects = { value: g.rects }
    if (g?.bounds) shader.uniforms.uEnvBounds = { value: g.bounds }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vEnvW;`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  vec4 envWp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    envWp = instanceMatrix * envWp;
  #endif
  vEnvW = ( modelMatrix * envWp ).xyz;`,
      )
    let frag = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\n${head}${NOISE}
#ifdef ENV_RECTS
uniform vec4 uEnvRects[ENV_RECTS];
#endif
#ifdef ENV_BOUNDS
uniform vec4 uEnvBounds;
#endif`,
    )
    if (g) {
      frag = frag.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec2 envGp = vEnvW.xz;
  vec4 envTa = texture2D( map, envGp / ENV_TILE_A );
  vec4 envTb = texture2D( map, mat2( 0.8, -0.6, 0.6, 0.8 ) * envGp / ENV_TILE_B + vec2( 0.37, 0.11 ) );
  diffuseColor *= mix( envTa, envTb, 0.45 );
#endif`,
      )
    }
    frag = frag.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
  {
    vec3 w = vEnvW;
    envStain = 0.0;
    float n1 = envNoise( w.xz * 0.045 + vec2( w.y * 0.07, -w.y * 0.05 ) );
    float n2 = envNoise( w.xz * 0.21 + vec2( -w.y * 0.13, w.y * 0.17 ) + 17.3 );
    float macro = n1 * 0.62 + n2 * 0.38;
    diffuseColor.rgb *= 1.0 + ENV_MACRO * ( macro - 0.5 ) * 2.0;
    #ifdef ENV_STREAKS
      float st = envNoise( vec2( ( w.x + w.z ) * 2.1, w.y * 0.32 ) );
      float stm = smoothstep( 0.6, 0.95, st ) * smoothstep( 0.4, 3.0, w.y );
      diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.7, 0.58, 0.48 ), stm * ENV_STREAKS );
    #endif
    diffuseColor.rgb *= mix( ENV_AO_MIN, 1.0, smoothstep( 0.0, ENV_AO_H, w.y ) );
    #ifdef ENV_GROUND
      #ifdef ENV_JOINT
        vec2 jg = abs( fract( w.xz / ENV_JOINT + 0.5 ) - 0.5 ) * ENV_JOINT;
        vec2 fw = fwidth( w.xz );
        float jl = 1.0 - min( smoothstep( 0.012, 0.012 + fw.x * 1.5, jg.x ), smoothstep( 0.012, 0.012 + fw.y * 1.5, jg.y ) );
        jl *= 1.0 - smoothstep( 0.03, 0.15, max( fw.x, fw.y ) );
        diffuseColor.rgb *= 1.0 - ENV_JOINT_DARK * jl;
      #endif
      float sn = envNoise( w.xz * 0.055 + 3.7 ) * 0.68 + envNoise( w.xz * 0.27 - 1.3 ) * 0.32;
      envStain = smoothstep( 0.66, 0.8, sn ) * ENV_STAINS;
      diffuseColor.rgb *= 1.0 - 0.34 * envStain;
      float cd = 100.0;
      #ifdef ENV_RECTS
        for ( int i = 0; i < ENV_RECTS; i ++ ) {
          vec4 r = uEnvRects[ i ];
          vec2 d = max( vec2( r.x - w.x, r.y - w.z ), vec2( w.x - r.z, w.z - r.w ) );
          cd = min( cd, length( max( d, 0.0 ) ) + min( max( d.x, d.y ), 0.0 ) );
        }
      #endif
      #ifdef ENV_BOUNDS
        cd = min( cd, min( min( w.x - uEnvBounds.x, uEnvBounds.z - w.x ), min( w.z - uEnvBounds.y, uEnvBounds.w - w.z ) ) );
      #endif
      diffuseColor.rgb *= mix( 0.58, 1.0, smoothstep( 0.0, 1.8, cd ) );
    #endif
  }`,
    )
    if (g) {
      frag = frag.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.5, envStain );`,
      )
    }
    shader.fragmentShader = frag
  }
  mat.customProgramCacheKey = () => `env:${key}:${head}`
  return mat
}
