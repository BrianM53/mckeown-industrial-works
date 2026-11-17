/** HTML portfolio fallback (no WebGL / lite mode / fatal 3D error). TEMPORARY STUB — portfolio-static module replaces. */
export default function FallbackPortfolio({ reason }: { reason: 'requested' | 'no-webgl' | 'error' }) {
  return (
    <main style={{ padding: 32 }}>
      <h1>Brian McKeown</h1>
      <p>Portfolio (fallback: {reason})</p>
    </main>
  )
}
