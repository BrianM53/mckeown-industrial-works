/**
 * Decorative vector art for the HTML portfolio masthead and the social card
 * (scripts/make-og.mjs renders the same component). Pure SVG, no ids shared with
 * the rest of the page except the prefixed hazard pattern. Always aria-hidden.
 * Drawn for a dark (charcoal) background.
 */

const C = {
  far: '#313a3b',
  stack: '#3a4446',
  hall: '#465356',
  hallDark: '#3b4648',
  door: '#2a3233',
  ground: '#1a1e1f',
  rust: '#a95e39',
  hazard: '#e9b63f',
  safety: '#e57d35',
  glow: '#ffb05a',
  teal: '#638c88',
  cream: '#eae3d2',
  concrete: '#85857d',
  steel: '#5b686a',
  dim: '#5f5a4e',
}

const WINDOWS: [number, number, boolean][] = []
for (let row = 0; row < 2; row++) {
  for (let k = 0; k < 6; k++) WINDOWS.push([40 + 24 * k, 196 + 26 * row, (k * 7 + row * 3) % 5 !== 1])
}

const LATTICE_BAYS = [40, 81, 122, 163, 204, 245]

export function FactoryArt({ className, title, ground = true }: { className?: string; title?: string; ground?: boolean }) {
  // Without `ground`, the art is cropped at its baseline (y = 288) so a full-width CSS strip can carry the ground.
  return (
    <svg
      className={className}
      viewBox={ground ? '0 0 560 320' : '0 0 560 288'}
      preserveAspectRatio="xMidYMax slice"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <defs>
        <pattern id="pf-art-hazard" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="16" height="16" fill={C.ground} />
          <rect width="8" height="16" fill={C.hazard} />
        </pattern>
        <radialGradient id="pf-art-beacon">
          <stop offset="0" stopColor={C.glow} stopOpacity="0.9" />
          <stop offset="1" stopColor={C.glow} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* far skyline */}
      <path fill={C.far} d="M0 288V238h30v-20h26v20h30v-12h26v62zM300 288v-58h22v-16h18v74z" />

      {/* smoke */}
      <g fill={C.concrete}>
        <circle cx="68" cy="52" r="15" opacity="0.34" />
        <circle cx="88" cy="36" r="12" opacity="0.3" />
        <circle cx="60" cy="28" r="9" opacity="0.26" />
        <circle cx="104" cy="20" r="7" opacity="0.2" />
        <circle cx="108" cy="82" r="9" opacity="0.3" />
        <circle cx="120" cy="70" r="7" opacity="0.24" />
        <circle cx="129" cy="60" r="5" opacity="0.2" />
      </g>

      {/* chimneys */}
      <rect x="58" y="72" width="20" height="120" fill={C.stack} />
      <rect x="55" y="70" width="26" height="8" fill={C.rust} />
      <rect x="58" y="98" width="20" height="5" fill={C.hazard} opacity="0.8" />
      <rect x="100" y="98" width="14" height="94" fill={C.stack} />
      <rect x="98" y="96" width="18" height="6" fill={C.rust} />

      {/* main hall with sawtooth roof */}
      <path fill={C.hall} d="M24 288V146l52 30v-30l52 30v-30l52 30v-30l52 30v-30l52 30v112z" />
      <g fill={C.glow} opacity="0.85">
        <rect x="26" y="151" width="5" height="22" />
        <rect x="78" y="151" width="5" height="22" />
        <rect x="130" y="151" width="5" height="22" />
        <rect x="182" y="151" width="5" height="22" />
        <rect x="234" y="151" width="5" height="22" />
      </g>
      <rect x="24" y="176" width="260" height="6" fill={C.rust} />
      {WINDOWS.map(([x, y, lit]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="14" height="14" fill={lit ? C.glow : C.dim} opacity={lit ? 0.92 : 1} />
      ))}
      <rect x="40" y="252" width="134" height="20" fill={C.hallDark} />
      <rect x="44" y="258" width="60" height="8" fill={C.cream} opacity="0.55" />
      <rect x="110" y="258" width="22" height="8" fill={C.hazard} opacity="0.8" />
      <rect x="190" y="204" width="76" height="84" fill={C.door} />
      <rect x="190" y="204" width="76" height="10" fill="url(#pf-art-hazard)" />
      <g stroke={C.hallDark} strokeWidth="2">
        <path d="M190 236h76M190 262h76M228 214v74" />
      </g>

      {/* fuel tank + pipes */}
      <path d="M284 244h14M334 232h46" stroke={C.rust} strokeWidth="5" fill="none" />
      <rect x="298" y="212" width="36" height="76" rx="6" fill={C.steel} />
      <ellipse cx="316" cy="213" rx="18" ry="5" fill="#6d7a7c" />
      <rect x="298" y="236" width="36" height="5" fill={C.hazard} opacity="0.75" />

      {/* conveyor with crates */}
      <rect x="262" y="276" width="120" height="6" fill={C.ground} />
      <g fill={C.steel}>
        <circle cx="270" cy="285" r="3" />
        <circle cx="300" cy="285" r="3" />
        <circle cx="330" cy="285" r="3" />
        <circle cx="360" cy="285" r="3" />
      </g>
      <rect x="272" y="264" width="14" height="12" fill={C.rust} />
      <rect x="342" y="266" width="12" height="10" fill={C.hazard} />

      {/* gantry tower */}
      <g stroke={C.teal} fill="none">
        <path d="M380 40v248M444 40v248" strokeWidth="5" />
        {LATTICE_BAYS.map((y) => (
          <path key={y} d={`M380 ${y}h64M380 ${y}l64 41M444 ${y}l-64 41`} strokeWidth="2" opacity="0.85" />
        ))}
        <path d="M444 132l34 2M444 192l34 0" strokeWidth="4" />
        <path d="M412 36V22h112M520 22v40" strokeWidth="3" />
      </g>
      <rect x="372" y="34" width="80" height="6" fill={C.teal} />
      <circle cx="440" cy="16" r="14" fill="url(#pf-art-beacon)" />
      <circle cx="440" cy="16" r="4.5" fill={C.safety} />

      {/* the rocket: lopsided, patched, with a questionable side booster */}
      <g transform="rotate(3 492 272)">
        <rect x="508" y="160" width="11" height="62" rx="5" fill={C.concrete} />
        <path d="M508 160l5.5-14 5.5 14z" fill={C.rust} />
        <rect x="476" y="100" width="30" height="164" fill={C.cream} />
        <path d="M476 100q15-52 30 0z" fill={C.safety} />
        <rect x="478" y="150" width="13" height="24" fill={C.rust} />
        <rect x="476" y="204" width="30" height="7" fill={C.hazard} />
        <circle cx="492" cy="124" r="5.5" fill={C.ground} stroke={C.concrete} strokeWidth="2" />
        <path d="M506 176h3M506 208h3" stroke={C.ground} strokeWidth="3" />
        <path d="M476 228l-26 44 26-8z" fill={C.rust} />
        <path d="M506 238l14 26-14-4z" fill={C.teal} />
        <path d="M481 264l-4 12h28l-4-12z" fill={C.hall} />
        <g fill={C.concrete}>
          <circle cx="480" cy="190" r="1.4" />
          <circle cx="502" cy="190" r="1.4" />
          <circle cx="480" cy="240" r="1.4" />
          <circle cx="502" cy="240" r="1.4" />
        </g>
      </g>

      {/* ground + launch pad */}
      {ground && <rect x="0" y="288" width="560" height="32" fill={C.ground} />}
      <rect x="448" y="282" width="112" height="6" fill="url(#pf-art-hazard)" />
    </svg>
  )
}

/** Small factory mark (same shape as the favicon). */
export function FactoryMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M10 50V26l12 8V26l12 8V18h8v-6h6v6h6v32z" fill="currentColor" />
      <rect x="44" y="6" width="4" height="8" fill="#E57D35" />
    </svg>
  )
}
