# McKeown Industrial Works — Architecture & Agent Contract

Read this fully before writing code. The product spec is `docs/SPEC.md` (read the sections relevant to your module).
**Motto: the factory can be dysfunctional, the website cannot.**

## 1. Stack & commands

Vite 7 + React 19 + TypeScript 5.9 (strict) · three r187 · @react-three/fiber 9 · @react-three/drei 10 · @react-three/rapier 2 (Rapier physics) · zustand 5 · Vitest 4 (jsdom) · Playwright 1.65.

| Command | What |
|---|---|
| `npm run dev` | dev server (a shared one usually runs at http://127.0.0.1:5173) |
| `npm run typecheck` | `tsc --noEmit` over the whole repo |
| `npx vitest run <path>` | unit/component tests (files `*.test.ts(x)` next to code or in `tests/unit`) |
| `node scripts/shot.mjs ...` | headless screenshot/drive helper (see header of the file) |
| `npm run build` | production build (+ static portfolio prerender) |
| `npm run build:test` | build with debug hooks (`dist-test`) for Playwright |

**Never run `npm install`/`npm uninstall`, never run git commands that change state** (commit, checkout, reset, stash). If you truly need a dependency, say so in your final report. Available deps: everything in package.json (three, fiber, drei, rapier, zustand, fontsource fonts, testing-library, playwright, axe-core).

Dev server: a shared server runs at `http://127.0.0.1:5173`. If it is down, start your own on your assigned port with its own optimizer cache:
`VITE_CACHE_DIR=node_modules/.vite-<you> npx vite --port <port> --strictPort &` (then pass `--url http://127.0.0.1:<port>/` to shot.mjs). Kill it when done.

## 2. Coordinates & conventions (MUST follow)

- Meters. **Y up. North = −Z, East = +X.** Ground top surface is y = 0.
- **yaw** rotates about +Y; `forward(yaw) = (−sin yaw, 0, −cos yaw)`. yaw 0 = north, π/2 = west, −π/2 = east, π = south. Helpers in `src/core/math.ts` (`forwardFromYaw`, `yawToward`, `cameraRelativeMove`, `damp`, `dampAngle`).
- **All models face −Z in local space**; set `group.rotation.y = yaw`. Worker ≈ 1.85 m tall, feet at y = 0.
- World layout (zones, buildings, lines, tower, pad, anchors, checkpoints, restricted zones, waypoints) is defined ONLY in `src/world/layout.ts` (ASCII map at the top). Place your content relative to those definitions. Do not invent conflicting coordinates. If a definition is wrong, report it.
- Keep **paths clear**: main aisle x∈[−3.5,3.5]; cross aisle z∈[19.5,23.5]; avenues; walkways; every straight segment between linked waypoints; building door spans. Machinery must leave ≥ 2.5 m clear walking width on aisles/avenues and never block doors.
- Physics: `<Physics>` is already mounted (fixed 60 Hz, interpolation, gravity −18, auto-colliders OFF). `WorldBase` provides the ground slab and perimeter walls. **Every collider sets `collisionGroups` from `GROUPS` in `src/core/collision.ts`.** Prefer `CuboidCollider`/`CylinderCollider` primitives; never trimesh for buildings. Heavy machinery = fixed bodies. Camera spring-arm casts hit `STATIC` + `CAMERA` groups only.

## 3. Module map & ownership

Each module is lazy-loaded into an isolated slot (`src/world/Scene.tsx` → `ModuleSlot`) with its own error boundary. **You may only create/edit files inside directories you own.** Everything else is read-only for you. Shared contracts are integrator-owned: if you need a contract change, describe it in your final report instead of editing.

| Module | Owns | Root |
|---|---|---|
| integrator | `src/core/**`, `src/state/**`, `src/world/{layout,nav,Scene,GameCanvas,ModuleSlot,WorldBase}.ts(x)`, `src/systems/director.ts`, `src/app/**` (except fallback), `src/content/{types,achievements}.ts`, `src/systems/factory/types.ts`, `index.html`¹, `vite.config.ts`, `package.json`, `docs/ARCHITECTURE.md` | — |
| ui | `src/ui/**`, `src/styles/**` | `src/ui/UIRoot.tsx` (HTML overlay, outside the canvas) |
| portfolio-static | `src/portfolio/**`, `scripts/prerender.tsx`, `scripts/check-links.ts`, `scripts/smoke.mjs`, `public/robots.txt`, deploy configs (`netlify.toml`, `vercel.json`, `.github/workflows/**`), `index.html` head/noscript¹ | `src/portfolio/FallbackPortfolio.tsx` |
| player | `src/player/**`, `src/world/WorkerModel.tsx` | `src/player/index.tsx` |
| environment | `src/environment/**`, `src/world/materials.ts`, `src/world/palette.ts` (extend only — never rename/remove exports) | `src/environment/index.tsx` |
| factory-sim | `src/systems/factory/**` (except `types.ts`), `src/factory/ui/**` | `src/systems/factory/index.ts`, `src/factory/ui/ConsolePanel.tsx` |
| audio | `src/audio/**` | `src/audio/scene.tsx` (+ `src/audio/api.ts` implementation) |
| production | `src/factory/lines/**` | `src/factory/lines/index.tsx` |
| rocket | `src/factory/rocket/**` | `src/factory/rocket/index.tsx` |
| stations-a | `src/stations/groupA/**` | personnel office, control room, radio booth, contact mailbox, directory kiosk |
| stations-b | `src/stations/groupB/**` | server hall, rec yard, R&D annex |
| npc | `src/npc/**`, `src/content/dialogue.ts` | `src/npc/index.tsx` |
| safety | `src/safety/**` | OSHA inspector, restricted zones, Night Shift, PA announcer |
| vehicles | `src/vehicles/**` | forklift + bumpable props |

¹ index.html: integrator created it; portfolio-static may edit `<head>` meta and `<noscript>` only.
Content facts live in `src/content/{profile,projects,resume,stations}.ts` (integrator-owned, verified). Read them; never hard-code personal facts elsewhere.

## 4. Shared contracts (read the source — they are short and documented)

- **`core/events.ts`** — typed notification bus `events.emit/on`, hook `useGameEvent`. Generic channels anyone may emit: `sfx`, `shake`, `caption`, `toast`, `achievement`. Domain events: rocket/forklift/osha/nightshift/gag/player/panel.
- **`core/actions.ts`** — input intents (`interact`, `recover`, `recenter`, `map`, `menu`, `help`, `quicklinks`, `horn`) triggered by keys or touch buttons. Ownership: player handles interact/recover/recenter (and keys WASD/arrows/Shift/E/R/C/orbit/zoom); ui handles map/menu/help/quicklinks (keys M, Esc, ?); vehicles handles horn (H/Space while driving). Global keydown handlers must ignore events when `isTypingTarget(e.target)` or when `isOverlayBlocking()` (except the overlay's own keys).
- **`core/services.ts`** — commands across modules: `player` (teleport w/ fade, respawn, tackle, setLocked, setVisible), `camera` (recenter, follow player|forklift, set), `forklift` (enter, exit, recover, isOccupied). Provide on mount, remove on unmount; callers tolerate `undefined`.
- **`core/runtime.ts`** — mutable per-frame state (player position/facing/speed/mode, camera yaw/pitch/distance/position, forklift, touch input, lighting level/emergency, interior zone, fps). One writer per field (documented). Read in `useFrame`.
- **`core/interaction.ts`** — `useInteractable({...})` registers E-targets. Player selects with `selectTarget` (nearest in radius, facing bias, priority, modes, enabled) and calls `onInteract` (never while an overlay is open).
- **`core/clock.ts`** — `simClock` (scaled, clamped sim time; debug can fast-forward). All pure-logic systems tick from it, not from their own timers.
- **`core/rng.ts`** — seeded RNG. Use for anything tests must reproduce.
- **`core/debug.ts`** — `registerDebug(namespace, api)` exposes dev/test hooks on `window.__MIW__` (stripped in production). Expected namespaces: `player`, `camera`, `ui`, `factory`, `forklift`, `osha`, `nightShift`, `npc`, `audio`, `interaction`, `clock`.
- **`systems/director.ts`** — humor pacing: `director.request({id, kind:'ambient'|'disruptive'|'player', cooldown, duration})` before starting any gag/event; `director.end(id)` after. Suppresses involuntary events while a panel/dialogue is open or ambient events are disabled.
- **`state/ui.ts`** — panels (`openPanel(id, params)`), dialogue bubble, interaction prompt, route target, fade overlay, recovery hint. `isOverlayBlocking()`.
- **`state/settings.ts`** — persisted visitor prefs (volumes, mute, consent, reducedMotion, quality, sensitivity, invertY, pointerLock, captions, ambientEvents).
- **`state/game.ts`** — status, quality tier, player mode, nightShift flag, current zone, achievements.
- **`world/layout.ts`, `world/nav.ts`** — world map + waypoint graph + `routeToZone`.
- **`world/materials.ts`, `world/palette.ts`** — shared cached materials (`mats.steel()`, `mats.hazardStripes()`, `colorMat('#hex')`…). Reuse; never create materials per frame.
- **`world/WorkerModel.tsx`** — the shared procedural worker (`look`, `anim` incl. getters, `speed`, `seed`). Use for every human.
- **`audio/api.ts`** — `audio.play(name, {position})`, `audio.loop(name, opts) → handle`, `audio.duck()`. Or emit `events.emit('sfx', {...})`.
- **`systems/factory/types.ts`** — factory sim contract (`factory.state`, `useFactory(selector)`, params, rocket phases, counters).

## 5. Quality bar

- **Visuals:** chunky low/mid-poly, bevelled/rivets/grates/pipes, palette from `palette.ts`, selective emissives, stylized not realistic. **No placeholder cubes as final machinery** — compose recognizable silhouettes from several primitives (cylinders, tori, extrusions, `RoundedBox`, lathe). Machines must read at human scale from a shoulder-height camera 4–7 m away. Everything moving should move (belts, fans, presses, lights). Text in 3D: drei `<Text>` with local fonts `/fonts/BarlowCondensed-Bold.woff`, `/fonts/BarlowCondensed-SemiBold.woff`, `/fonts/IBMPlexMono-SemiBold.woff` (never remote fonts), or canvas textures.
- **Performance budget (medium tier, whole scene):** ≤ ~450 draw calls, ≤ ~700k triangles, 1 shadow-casting directional light, ≤ 8 non-shadow point/spot lights total (environment owns most), particles pooled & capped. Use `InstancedMesh`/drei `<Instances>` for anything repeated > ~10×. Share geometries/materials (module-level constants). Nothing allocates in `useFrame` (reuse vectors). Respect `useGameStore(s => s.quality)`: low = fewer particles/NPCs/details, no shadows.
- **Robustness:** effects must be StrictMode-safe (mount→unmount→mount) and clean up listeners, intervals, simClock/event subscriptions, audio handles, physics bodies. No uncaught errors. Guard against NaN positions.
- **Accessibility & comfort:** respect `useSettings(s => s.reducedMotion)` (no shake, gentle transitions, fewer flashes); captions for sound-only cues via `events.emit('caption', …)`; never block reading (involuntary events go through the director).
- **Content truth:** real facts only from `src/content/*`. Jokes are clearly in-world fiction. Never invent dates, titles, achievements, emails, or links.
- **No external network requests at runtime** except user-clicked links. No remote fonts/models/CDNs.

## 6. Verification you must do before reporting

1. `npm run typecheck` — zero errors in files you own (ignore other modules' in-progress errors, but mention them).
2. Unit tests for any logic you wrote (FSMs, models, schedulers) — `npx vitest run <your paths>` passing.
3. Visual check: `node scripts/shot.mjs --shots '[...]'` at representative positions; **open the PNGs with the Read tool and critique them honestly** (silhouette, scale vs worker, color, clutter, clipping, z-fighting). Iterate until it looks good. Save final screenshots under `shots/<module>/`.
4. Check the shot output for console errors / `__MIW__.errors` / module status `error` and fix yours.
5. Final report: what you built (files), how to see it (coords/debug calls), tests run + results, known issues, any contract change requests, and anything other modules must do to integrate with you.
