# Screenshots

Curated captures of McKeown Industrial Works, taken on 2026-11-18 from the dev server (commit `9a7d431` plus the
uncommitted working tree of that day). Unless noted, each image is 1600×900 at `?quality=medium&noevents=1`, rendered
by a real GPU: Intel UHD Graphics through WSL2 GPU paravirtualization (Mesa D3D12 + ANGLE GL-EGL), not SwiftShader.

| # | File | Caption |
|---|---|---|
| 01 | [01-spawn.png](01-spawn.png) | Third-person spawn at Visitor Intake: the "You are here" marker, the greeter, the wayfinding gantry and the first-visit controls hint. |
| 02 | [02-production-spine.png](02-production-spine.png) | Looking north up the Production Spine's main aisle, with production lines on both sides and the Quality Control arch overhead. |
| 03 | [03-rocket-assembly.png](03-rocket-assembly.png) | A rocket mid-assembly (stage 3 of 6) in the assembly tower, seen from the east side of the tower plaza. |
| 04 | [04-rollout.png](04-rollout.png) | Rollout: Crawler No. 2 carries the finished rocket out of the tower toward the pad. |
| 05 | [05-launch-ignition.png](05-launch-ignition.png) | Ignition seen from the observation deck: smoke at the pad, the "Ignition · stand clear" sim strip and the countdown caption. |
| 06 | [06-launch-failure.png](06-launch-failure.png) | A forced explosion 0.4 s after the outcome reveal: fireball over the launch yard, two achievements and the announcer's line. |
| 07 | [07-disassembly-counter.png](07-disassembly-counter.png) | The "Time since last unscheduled disassembly" board, 42 s after that explosion. |
| 08 | [08-forklift.png](08-forklift.png) | Driving the forklift up the main aisle in the chase camera while the line workers react. |
| 09 | [09-osha-tackle.png](09-osha-tackle.png) | Mid-tackle: the OSHA inspector dives at the visitor inside the wet-paint restricted zone. |
| 10 | [10-night-shift.png](10-night-shift.png) | Night Shift: the production spine in blackout under emergency lighting, with the power-failure caption and the PA line. |
| 11 | [11-resume-panel.png](11-resume-panel.png) | The Résumé panel open over the Personnel Office. |
| 12 | [12-directory.png](12-directory.png) | The Factory Directory: destinations with Open now / Show route / Travel there, beside the schematic site map. |
| 13 | [13-server-hall.png](13-server-hall.png) | The Server Hall (code on GitHub): repository racks, terminals and the big fan, with a Read prompt. |
| 14 | [14-rec-yard.png](14-rec-yard.png) | The Recreation Yard: a kicked ball beats the diving keeper; scoreboard, staff-league banner and goal toast. |
| 15 | [15-rnd-annex.png](15-rnd-annex.png) | The R&D Annex: the Gaussian-SLAM scanner at 64 % scan progress. |
| 16 | [16-control-room.png](16-control-room.png) | The Harmony AI Manufacturing Control Room: telemetry wall and operator console. |
| 17 | [17-portfolio-static.png](17-portfolio-static.png) | The static HTML portfolio at `/portfolio/`, with no 3D at all. |
| 18 | [18-mobile.png](18-mobile.png) | Phone layout, 390×844 CSS px at 2× with touch emulation: joystick, Recover / Recenter / Run, Interact, Map and Pause. Quality is left on auto, which picks low on touch devices. |
| 19 | [19-lite-fallback.png](19-lite-fallback.png) | The lite fallback at `/?lite=1`: the same portfolio content in HTML, under the game's top bar. |

## How they were staged

Every scene was staged in one page load through the `window.__MIW__` debug hooks (dev server or TEST build only).
`at` is the worker's position and yaw, passed to `__MIW__.player.teleport(x, z, yaw)`. `cam` is
`[yaw, pitch, distance]`, passed to `__MIW__.camera.set({…, immediate: true})`. Yaw 0 faces north (−Z), and a
positive pitch looks down.

| # | at | cam | Hooks |
|---|---|---|---|
| 01 | 0, 32, 0 | 0, 0.17, 5.5 | `ui.setControlsHint(true)` |
| 02 | 0, 17, 0 | 0, 0.45, 7 | — |
| 03 | 9, −15, 2.078 | 2.078, −0.15, 8 | `factory.skipToStage(3, 0.6)` |
| 04 | 8, −19, π | π, −0.25, 7 | `factory.skipToPhase('rollout'); factory.advance(6.5); clock.setTimeScale(0)` |
| 05 | 4.2, −28, −1.10 | −0.75, −0.12, 6.5 | `factory.forceNextOutcome('success'); skipToPhase('countdown'); advance(9.6)`, then wait until phase `ignition` ≥ 1.6 s and `clock.setTimeScale(0)` |
| 06 | −6, −20, −1.0 | −1.0, −0.33, 6 | `forceNextOutcome('explosion', true); skipToPhase('countdown'); advance(14.4)`, then wait until `flight` ≥ 3.2 s and freeze the clock |
| 07 | 19.8, −19, −0.8 | −0.8, 0.05, 4 | `clock.setTimeScale(1); factory.advance(40)` |
| 08 | (forklift) | chase camera | `forklift.enter(); forklift.teleport(−1.5, 27, 0); forklift.drive(1, 0, 4000)` |
| 09 | (set by trigger) | π, 0.3, 7 | `osha.trigger('wet-paint', {force: true, hatch: true})`, captured about 1.2 s later |
| 10 | −1.5, 15.5, −0.25 | −0.25, 0.25, 7 | `nightShift.start(); clock.advance(3.5)` |
| 11 | 9.6, 29, −π/2 | −π/2, 0.17, 5.5 | `ui.openPanel('resume')` |
| 12 | (same) | (same) | `ui.openPanel('directory')` |
| 13 | −33, −9, π/2 | π/2, 0.15, 4 | — |
| 14 | 38.4, −12, 0 | 0, 0.28, 7 | `rec.kick()` |
| 15 | −36.6, −31.6, 2.01 | 2.01, 0.15, 4 | `rnd.setScanProgress(0.64)` |
| 16 | −34.6, 13, π/2 | π/2, 0.12, 4 | — |
| 17 | — | — | `http://127.0.0.1:5173/portfolio/` |
| 18 | 0, 32, 0 | default | `ui.forceTouch(true)`, with `--size 390x844`, device scale factor 2 and touch emulation |
| 19 | — | — | `http://127.0.0.1:5173/?lite=1` |

To retake a shot, use `scripts/shot.mjs` with `--size 1600x900 --query "quality=medium&noevents=1"`. On a WSL2 machine,
prefix the command with `GALLIUM_DRIVER=d3d12` and add `--gpu` to render on the GPU, which is about 5–10× faster than
the default SwiftShader (see [../PERF.md](../PERF.md)). Shots 05, 06, 08 and 10 depend on timing. Wait for the
condition in the table before capturing; `shot.mjs` currently has no wait-until option, so a fixed `wait` may need
tuning.
