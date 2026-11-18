import * as THREE from 'three'

/**
 * Procedural ball meshes (cached, module lifetime):
 *  - soccer ball: subdivided icosahedron; faces near the 12 icosahedron vertices
 *    are black, giving the classic pentagon pattern without a texture
 *  - volleyball: sphere whose panels follow the cube-face layout of a real
 *    volleyball (6 panels × 3 strips) in yellow / blue / white
 */
const T = (1 + Math.sqrt(5)) / 2
const ICO: THREE.Vector3[] = [
  [-1, T, 0],
  [1, T, 0],
  [-1, -T, 0],
  [1, -T, 0],
  [0, -1, T],
  [0, 1, T],
  [0, -1, -T],
  [0, 1, -T],
  [T, 0, -1],
  [T, 0, 1],
  [-T, 0, -1],
  [-T, 0, 1],
].map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize())

let soccerGeo: THREE.BufferGeometry | null = null
export function soccerBallGeometry(r: number): THREE.BufferGeometry {
  if (soccerGeo) return soccerGeo
  const g = new THREE.IcosahedronGeometry(r, 3)
  const pos = g.getAttribute('position')
  const n = pos.count
  const col = new Float32Array(n * 3)
  const nor = new Float32Array(n * 3)
  const c = new THREE.Vector3()
  const white = new THREE.Color('#f4f2ea')
  const black = new THREE.Color('#1c1e20')
  const cosLimit = Math.cos(0.335)
  for (let f = 0; f < n; f += 3) {
    c.set(0, 0, 0)
    for (let k = 0; k < 3; k++) c.add(new THREE.Vector3(pos.getX(f + k), pos.getY(f + k), pos.getZ(f + k)))
    c.normalize()
    let best = -1
    for (const v of ICO) best = Math.max(best, c.dot(v))
    const color = best > cosLimit ? black : white
    for (let k = 0; k < 3; k++) {
      col.set([color.r, color.g, color.b], (f + k) * 3)
      const len = Math.hypot(pos.getX(f + k), pos.getY(f + k), pos.getZ(f + k)) || 1
      nor.set([pos.getX(f + k) / len, pos.getY(f + k) / len, pos.getZ(f + k) / len], (f + k) * 3)
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  soccerGeo = g
  return g
}

let volleyGeo: THREE.BufferGeometry | null = null
export function volleyBallGeometry(r: number): THREE.BufferGeometry {
  if (volleyGeo) return volleyGeo
  const g = new THREE.SphereGeometry(r, 28, 20)
  const pos = g.getAttribute('position')
  const col = new Float32Array(pos.count * 3)
  const pal = [new THREE.Color('#f2c230'), new THREE.Color('#2d64b8'), new THREE.Color('#f5f3ec')]
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize()
    const a = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)]
    const axis = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2
    // strips run across each panel along the next axis
    const s = [v.x, v.y, v.z][(axis + 1) % 3] / Math.max(1e-3, a[axis])
    const strip = s < -0.33 ? 0 : s < 0.33 ? 1 : 2
    const c = pal[(axis + strip) % 3]
    col.set([c.r, c.g, c.b], i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  volleyGeo = g
  return g
}

let ballMat: THREE.MeshStandardMaterial | null = null
export function ballMaterial(): THREE.MeshStandardMaterial {
  if (!ballMat) {
    ballMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 })
    ballMat.name = 'stations-b:ball'
  }
  return ballMat
}
