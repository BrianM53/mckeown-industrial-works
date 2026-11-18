/**
 * Shader materials for the engine flames (instanced double cone, additive) and
 * the cartoon fireball (displaced sphere). Module-lifetime singletons, created
 * lazily; uniforms are updated in place (no per-frame allocation).
 */
import * as THREE from 'three'

const NOISE = /* glsl */ `
float fxHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float fxNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fxHash(i), fxHash(i + vec2(1.0, 0.0)), u.x), mix(fxHash(i + vec2(0.0, 1.0)), fxHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`

/** Two nested open cones hanging from y = 0 down to y = -1 (outer layer 0, inner core layer 1). */
export function createFlameGeometry(): THREE.BufferGeometry {
  const outer = new THREE.CylinderGeometry(1, 0.32, 1, 16, 6, true)
  const inner = new THREE.CylinderGeometry(0.55, 0.08, 0.72, 12, 4, true)
  outer.translate(0, -0.5, 0)
  inner.translate(0, -0.36, 0)
  const parts = [outer, inner]
  let nv = 0
  let ni = 0
  for (const p of parts) {
    nv += p.getAttribute('position').count
    ni += p.index!.count
  }
  const P = new Float32Array(nv * 3)
  const N = new Float32Array(nv * 3)
  const U = new Float32Array(nv * 2)
  const L = new Float32Array(nv)
  const I = new Uint16Array(ni)
  let vo = 0
  let io = 0
  parts.forEach((p, layer) => {
    const pos = p.getAttribute('position')
    const nor = p.getAttribute('normal')
    const uv = p.getAttribute('uv')
    P.set(pos.array as Float32Array, vo * 3)
    N.set(nor.array as Float32Array, vo * 3)
    U.set(uv.array as Float32Array, vo * 2)
    L.fill(layer, vo, vo + pos.count)
    const idx = p.index!
    for (let k = 0; k < idx.count; k++) I[io++] = idx.getX(k) + vo
    vo += pos.count
    p.dispose()
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(P, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(U, 2))
  g.setAttribute('aLayer', new THREE.BufferAttribute(L, 1))
  g.setIndex(new THREE.BufferAttribute(I, 1))
  g.computeBoundingSphere()
  return g
}

let flameMat: THREE.ShaderMaterial | null = null

export function flameMaterial(): THREE.ShaderMaterial {
  if (flameMat) return flameMat
  flameMat = new THREE.ShaderMaterial({
    name: 'rocket:flame',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
attribute float aLayer;
varying vec2 vUv;
varying float vLayer;
varying float vRim;
varying float vPower;
uniform float uTime;
${NOISE}
void main() {
  vUv = uv;
  vLayer = aLayer;
  vec3 p = position;
  float tip = 1.0 - uv.y;
  float w = (fxNoise(vec2(atan(p.x, p.z) * 2.0, p.y * 3.0 - uTime * 8.0)) - 0.5) * 0.35 * tip;
  p.xz *= 1.0 + w;
  vec4 wp = vec4(p, 1.0);
  vPower = 1.0;
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vPower = instanceColor.r;
  #endif
  vec4 mv = modelViewMatrix * wp;
  vec3 objN = normal;
  #ifdef USE_INSTANCING
    objN = mat3(instanceMatrix) * normal;
  #endif
  vec3 nv = normalize(normalMatrix * objN);
  vRim = abs(dot(nv, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`,
    fragmentShader: /* glsl */ `
varying vec2 vUv;
varying float vLayer;
varying float vRim;
varying float vPower;
uniform float uTime;
${NOISE}
void main() {
  float v = vUv.y;
  float n = fxNoise(vec2(vUv.x * 9.0, v * 4.0 + uTime * 11.0)) * 0.6 + fxNoise(vec2(vUv.x * 21.0, v * 9.0 + uTime * 17.0)) * 0.4;
  vec3 outer = mix(vec3(1.0, 0.28, 0.06), vec3(1.0, 0.72, 0.28), v);
  vec3 inner = mix(vec3(1.0, 0.78, 0.4), vec3(1.0, 0.97, 0.86), v);
  vec3 col = mix(outer, inner, vLayer);
  float a = pow(v, 0.7) * (0.45 + 0.55 * n) * smoothstep(0.0, 0.55, vRim) * vPower;
  a *= mix(0.75, 1.15, vLayer);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a * 1.7, a);
}
`,
  })
  return flameMat
}

let fireballMat: THREE.ShaderMaterial | null = null

export function fireballMaterial(): THREE.ShaderMaterial {
  if (fireballMat) return fireballMat
  fireballMat = new THREE.ShaderMaterial({
    name: 'rocket:fireball',
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uAge: { value: 0 }, uOpacity: { value: 0 }, uHeat: { value: 1 } },
    vertexShader: /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vNoise;
uniform float uTime;
uniform float uAge;
${NOISE}
void main() {
  vec3 p = position;
  float n = fxNoise(p.xy * 2.2 + uTime * 1.3) * 0.55 + fxNoise(p.yz * 4.1 - uTime * 2.1) * 0.45;
  vNoise = n;
  p += normal * (n - 0.5) * (0.28 + uAge * 0.25);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`,
    fragmentShader: /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vNoise;
uniform float uAge;
uniform float uOpacity;
uniform float uHeat;
void main() {
  float facing = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float heat = clamp(facing * 1.1 + (vNoise - 0.5) * 0.6 - uAge * 0.55, 0.0, 1.0) * uHeat;
  vec3 hot = mix(vec3(0.85, 0.16, 0.05), vec3(1.0, 0.62, 0.15), smoothstep(0.1, 0.55, heat));
  hot = mix(hot, vec3(1.0, 0.95, 0.72), smoothstep(0.6, 0.95, heat));
  vec3 smoke = vec3(0.16, 0.14, 0.13);
  vec3 col = mix(hot * (1.0 + 1.4 * heat), smoke, smoothstep(0.35, 1.0, uAge) * (1.0 - heat * 0.6));
  float a = uOpacity * smoothstep(0.0, 0.35, facing + 0.15);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`,
  })
  return fireballMat
}
