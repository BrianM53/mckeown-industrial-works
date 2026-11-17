# Asset & third-party licenses

McKeown Industrial Works ships **no third-party 3D models, textures, images, or audio files**.

- **3D geometry**: everything (buildings, machinery, rocket, forklift, workers, props) is procedural, built in code from three.js primitives. Original work.
- **Textures**: generated at runtime on `<canvas>` (concrete, hazard stripes, grime, grating, belts, signage, screens). Original work.
- **Audio**: every sound and the music are synthesized live with the Web Audio API (oscillators, filtered noise, envelopes). There are no recordings or samples. Original work. No podcast audio is embedded or streamed. The Code Story episode opens on its own site.
- **Open Graph image** (`public/og-image.png`): rendered from original HTML/vector art (`scripts/make-og.mjs`).

## Fonts (bundled, self-hosted — no remote font requests)

| Font | Copyright | License | Used for |
|---|---|---|---|
| Barlow / Barlow Condensed | © 2017 The Barlow Project Authors (https://github.com/jpt/barlow) | SIL Open Font License 1.1 | UI text, headings, 3D signage |
| IBM Plex Mono | © 2017 IBM Corp. | SIL Open Font License 1.1 | Data readouts, terminals, 3D signage |

These fonts are distributed via the `@fontsource/*` npm packages. The `.woff` files in `public/fonts/` were copied from them, and the license texts are in `public/fonts/OFL-*.txt`.

## Runtime libraries (npm)

| Package | License |
|---|---|
| react, react-dom | MIT |
| three | MIT |
| @react-three/fiber, @react-three/drei | MIT |
| @react-three/rapier | MIT |
| @dimforge/rapier3d-compat (Rapier physics) | Apache-2.0 |
| troika-three-text (via drei `<Text>`) | MIT |
| zustand | MIT |

Dev-only tooling (Vite, TypeScript, Vitest, Playwright, Testing Library, axe-core) is not shipped to visitors.

## Trademarks & references

- "Harmony AI" and "Code Story" are named factually as Brian's employer and the podcast that interviewed him. No logos are reproduced.
- The fictional "Site Safety Inspector" is a generic parody character. It uses no OSHA branding and implies no government affiliation.
- Design inspirations named in the spec (Factorio, Kerbal Space Program, Bruno Simon's portfolio, Roblox camera controls) are interaction and mood references only. No assets, layouts, characters or UI from them are copied.
