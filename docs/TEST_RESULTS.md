# Test results

_Run on 2026-11-18 on the development machine (WSL2 Linux, Node 24, headless Chromium with SwiftShader software rendering)._ Raw outputs are in `test-results/`: `summary.json`, `e2e-output.txt`, `e2e-report.json`, `unit-output.txt` and `e2e-link-audit.json`.

| Suite | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **0 errors** |
| Unit & component (Vitest) | `npm test` | **850 / 850 passed** (66 files) |
| End-to-end (Playwright) | `npm run test:e2e` (builds `dist-test`, desktop 1280×720 + Pixel 7 projects, 2 workers) | **61 / 61 passed**, 0 flaky, in **three full runs** (16.7, 17.1 and, after the final loading-gate change, 14.4 min) |
| Production smoke (local) | `npm run smoke -- http://127.0.0.1:4173/` | 11 / 11 passed |
| Production smoke (live) | `npm run smoke -- https://brianm53.github.io/mckeown-industrial-works/` | 11 / 11 passed |
| Live browser boot | `npm run check:live -- <url> shots/live.png` | Top bar visible in 0.7 s; world loaded; 0 console errors; no debug hooks in production |
| Link audit | `npm run check:links -- --network` | All URLs syntactically valid. LinkedIn returns HTTP 999 to bots, so it's flagged for a manual check. |

## Spec §12 must-pass coverage (e2e)

| § | Covered by | What is asserted |
|---|---|---|
| 12.1 | `smoke.spec.ts` | Build output, health.json, sitemap, robots, `/portfolio/` with and without JS, 404/SPA fallback, `?panel=` deep links, game boot with every module ready |
| 12.2 | `lite.spec.ts` | Lite mode creates no WebGL context. Tab order and accessible names, M / P / ? shortcuts, focus trapped in dialogs, Esc closes and returns focus |
| 12.3 | `lite.spec.ts`, `player.spec.ts` | "Open now" for all five principal stations (content and links), closing via Esc and ✕. "Travel there" to all five entrances in 3D |
| 12.4 | `smoke.spec.ts` | Offline link audit: every URL valid, unverified ones flagged. Rendered external links use `target=_blank rel=noopener noreferrer` |
| 12.5 | `player.spec.ts` | Real WASD in 4 cardinal and 4 diagonal directions with the camera rotated (direction error ≤ 0.4°). Arrow keys, Shift-run, walls at the world bounds |
| 12.6 | `player.spec.ts` | PerspectiveCamera (fov 55, 5.5 m, shallow pitch, worker on screen), full 360° mouse orbit with pitch limits, zoom clamped to 2.2–9 m, camera-relative WASD after orbit, wall pull-in, indoor boom ≤ 4.2 m below the eaves, C recenters |
| 12.7 | `player.spec.ts` | Nearby station prompt and E opens its panel; no prompt out of range; E and W are inert while an overlay is open |
| 12.8 | `forklift.spec.ts` | Enter, drive, steer, exit (×2). Knocks props over and stops at a wall. Flip then R-recover (×2), then drives again. On foot, E rights a tipped forklift |
| 12.9 | `factory.spec.ts` | All 6 stages built naturally. Exact phase order assembling → rollout → pad → countdown → ignition → flight → aftermath → reset → assembling. HUD countdown, next rocket id, outcome history and counters (incl. a forced explosion) |
| 12.10 | `factory.spec.ts` | Console opened in-world with E. Keyboard slider/radio changes match the model (`factory.evaluate`) and change the live line rates. Reset restores the exact baseline in data and UI |
| 12.11 | `safety.spec.ts` | Walking into the transformer yard → tackle → respawn at intake (2.68 s measured); re-entry during cooldown gives a warning, no second tackle |
| 12.12 | `npc.spec.ts` | One gag at a time; aborted gags release actors; actors return to their spots. 600 sim-seconds of natural scheduling: 15+ gags, no repeats inside cooldown, no NPC left mid-gag |
| 12.13 | `safety.spec.ts` | Night Shift blackout (level ≈ 0.12 + emergency lights). The player can move and open panels during it. Lights restore, and the watchdog restores them even with the sim clock frozen |
| 12.14 | `audio.spec.ts` | No AudioContext before consent (also via a wrapped constructor). Sound button creates exactly one context. Mute → master 0 and suspend. Sliders map to gain = volume² |
| 12.15 | `mobile.spec.ts`, `lite.spec.ts` | Pixel 7: joystick moves the worker (real touch events); menu, directory and résumé fit and close; no horizontal scroll. WebGL blocked → HTML fallback with quick links works |
| 12.16 | `robustness.spec.ts` | After 10 panel cycles, a hard factory reset with a full launch, 2 forklift rides and 2 fast-travel trips, the counts are unchanged (events 54, clock subscribers 7, interactables 38, audio loops 15) |
| 12.17 | `motion.spec.ts` | `prefers-reduced-motion` turns the setting and CSS class on. Camera shake < 5 mm, versus visible shake with motion on. Night Shift dims without flicker and is captioned |
| 12.18 | `lite.spec.ts` | axe-core (WCAG 2.1 AA): no serious or critical violations on `/?lite=1`, `/portfolio/`, and the résumé, directory, settings and contact panels |

The unit suites cover the contracts and layout integrity (waypoint segments never cross walls, line strips or restricted zones), the optimization model (baseline fails, several settings certify, success odds always in [0.2, 0.75]), the launch FSM and cadence, OSHA and Night Shift FSMs, NPC routes and dialogue rules, forklift logic, camera math, audio consent and voice limits, UI panels, colour contrast, and the static portfolio.

## Not covered by automation

- Real-GPU frame rates (see [`PERF.md`](PERF.md)): headless runs use software rendering.
- Subjective feel tests from the spec (humor pacing, forklift "comically heavy" handling, whether the launch is funny) were judged from headless screenshots and debug-hook state during development, not by assertions. A human play-through on real hardware is still recommended.
