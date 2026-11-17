/**
 * Environment module root: ground, roads, buildings, signage, lighting, sky, decor.
 * TEMPORARY STUB (basic lights + ground so other modules can be tested). The
 * environment module replaces this file.
 */
export default function Environment() {
  return (
    <>
      <hemisphereLight args={['#cfe3e6', '#4a4038', 1.1]} />
      <directionalLight position={[30, 40, 20]} intensity={1.6} castShadow />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[100, 88]} />
        <meshStandardMaterial color="#85857d" />
      </mesh>
      <color attach="background" args={['#8fa4a6']} />
    </>
  )
}
