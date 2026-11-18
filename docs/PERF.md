# Performance

Measured on 2026-11-18 with [`scripts/perf.mjs`](../scripts/perf.mjs) against the TEST build (production build plus
the `window.__MIW__` debug hooks) of commit `9a7d431` with that day's uncommitted working tree.

> **Applied after this measurement (2026-11-18):** recommendation 1 (shaders now precompile with
> `compileAsync` behind the loading screen; the canvas frame loop stays at `'never'` until then) and
> recommendation 6 (auto quality steps down below 28 fps instead of 34). The load-time and first-frame-stall
> figures below were measured *before* the precompile gate. Re-run `scripts/perf.mjs` to refresh them.

## Summary

- **Frame rate on real hardware (a weak GPU).** On an Intel UHD Graphics integrated GPU (Core i7-10850H laptop),
  reached through WSL2's Direct3D 12 translation, the whole scene runs at 1280×720 (DPR 1) at:
  - **29–51 fps** on low
  - **27–39 fps** on medium
  - **27–37 fps** on high

  The frame loop costs only 4–8 ms of main-thread time per frame, so the GPU is the bottleneck.
- **Budgets hold, but triangles are tight.** Medium peaks at **294 draw calls** (budget ~450) at spawn and at
  **635k triangles** (budget ~700k, 91 %) in the production aisle. The triangle count includes the shadow pass.
- **Loading is dominated by shader compilation.** On this machine the world reports ready after **24–36 s**.
  **19–32 s** of that is the main thread blocked while **136–208 shader programs** compile and link, at about 150 ms
  each. In five of the six loads where it was measured, the page went **13–15 s without rendering a single frame**. The top bar shows within
  **0.15–2.4 s**.
- **First visit to the production aisle hitches.** Teleporting there produces one 1.2–1.7 s frame. No new shader
  programs are linked; instead 21–25 geometries and 6 textures upload the first time they come into view.
- **Download size.** The top bar needs **103 KiB gzip** (HTML, entry JS and CSS) plus 117 KiB of woff2 fonts. Reaching ready transfers **1,727 KiB gzip**
  in 48 requests. **784 KiB of that is Rapier's physics WASM, inlined as base64.** Shipping it as a binary `.wasm` would
  save about 212 KiB gzip.
- **SwiftShader numbers are not representative.** The CPU rasterizer used by the e2e suite and `scripts/shot.mjs`
  manages **0.4–1.6 fps** on the same views. It shows whether things render correctly, not how fast they run for
  visitors.

## How to reproduce

```bash
npm run build:test && npm run preview:test                      # TEST build on http://127.0.0.1:4174/
node scripts/perf.mjs --url http://127.0.0.1:4174/ --dist dist-test --json perf.json
node scripts/perf.mjs --url http://127.0.0.1:4174/ --gl swiftshader   # software baseline (slow)
npm run build && node scripts/perf.mjs --sizes dist             # production bundle sizes only
node scripts/perf.mjs --probe                                   # which WebGL backends work on this machine
```

`--gl auto` (the default) probes the hardware backends in order: `d3d12` (WSL2 only), `vulkan`, `gl`, then `egl`. It
uses the first one whose `WEBGL_debug_renderer_info` renderer string is not a software rasterizer (SwiftShader,
llvmpipe, lavapipe, softpipe), and falls back to SwiftShader. The script prints Markdown tables and, with `--json`,
writes every raw number. Other options are `--qualities`, `--views`, `--size`, `--settle`, `--sample`, `--minFrames`,
`--headful` and `--timeout` (see the header of the script).

## Method

- **One cold load per quality tier.** Each tier gets a fresh browser context (empty HTTP cache) loading
  `?quality=<tier>&noevents=1`. The URL parameter fixes the tier at load time, so geometry, textures and particle
  pools are built for that tier. `noevents=1` turns off ambient gags so runs are comparable. All three tiers share one
  browser process, so only the first tier pays for starting the GPU process.
- **Six viewpoints per tier.** For each one the script calls `__MIW__.player.teleport(x, z, yaw)` and puts the camera
  behind the worker at the default boom (`__MIW__.camera.set({yaw, pitch: 10°, distance: 5.5})`). It then waits 4 s
  and at least 6 frames to settle, and samples for 5 s and at least 6 frames.

  | Viewpoint | x, z | yaw (facing) |
  |---|---|---|
  | Spawn (Visitor Intake) | 0, 32 | 0 (north, up the main aisle) |
  | Production aisle | 0, 12 | 0 |
  | Tower plaza | 0, −2 | 0 (toward the assembly tower) |
  | Launch yard | 6, −20 | −0.62 (toward the pad) |
  | Server hall | −36, −9 | π/2 (west, inside the hall) |
  | Rec yard | 38, −14 | −π/2 (east) |

- **FPS and frame times** come from the script's own `requestAnimationFrame` counter: frames ÷ elapsed time over the
  sample window, plus p50 and p95 frame intervals. **rAF CPU ms/frame** is the main-thread time spent inside the page's
  own rAF callbacks (the React Three Fiber loop: physics, simulation, scene updates and WebGL command submission),
  divided by the number of frames.
- **Renderer counters** come from `__MIW__.perf.stats()`, which reads three.js `renderer.info` for the last frame:
  draw calls, triangles (shadow pass included), live geometries, textures and shader programs.
- **Load marks.** *FCP* is the Paint Timing first-contentful-paint. *Top bar* is the first animation frame after
  `[data-testid="topbar"]` is laid out and visible. *First UI* is the later of those two, because a frame can be ready
  before the compositor manages to show it. *Ready* is when `__MIW__.ready` turns true (every module slot resolved
  and a few frames drawn). *Shader-blocked* is the main-thread time inside the synchronous WebGL program queries
  (`getProgramParameter`, `getUniformLocation`, …). Chrome answers those only after the GPU process has finished
  compiling and linking the program, so this is the shader cost the page actually waits for. *Longest frame gap* is the
  longest stretch before ready with no rendered frame, i.e. the page was frozen: no loading animation, and clicks
  wait. Bytes come from Resource Timing; the gzip column maps each fetched hashed asset to its gzip -9 size in the
  build being served.
- **Bundle sizes** are the gzip -9 and brotli q11 sizes of every file in `dist/assets` of a production build
  (`vite build` without the test hooks).

## Environment

| | |
|---|---|
| Machine | Laptop, Intel Core i7-10850H (6 cores / 12 threads, 2.7 GHz), 15 GB RAM visible to WSL2 |
| OS | Windows with WSL2 (kernel 5.15.167.4-microsoft-standard-WSL2), Ubuntu 24.04.1 LTS |
| GPU used | Intel UHD Graphics (Comet Lake iGPU) through WSL2 GPU paravirtualization (`/dev/dxg`) |
| Browser | Playwright Chromium 159.0.8154.6, headless, 1280×720 viewport, device pixel ratio 1 |
| Server | `vite preview` (gzip on) on localhost, serving the TEST build |
| Other load | Other agents share this machine. The load average is recorded with each run below. |

### Which renderer was actually used

`node scripts/perf.mjs --probe` and some one-off probes gave these renderer strings:

| Launch flags | Renderer string | Kind |
|---|---|---|
| (none, Playwright default) | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver) | software |
| `--use-angle=swiftshader` (what `scripts/shot.mjs` and the e2e suite use) | same SwiftShader | software |
| `--use-angle=vulkan --enable-features=Vulkan` | ANGLE (Mesa, Vulkan 1.4.318 (llvmpipe (LLVM 20.1.2 256 bits))) | software |
| `--use-angle=gl` or `--use-angle=gl-egl` (headless shell or full Chromium), `--use-angle=default` (full Chromium) | ANGLE (Mesa, llvmpipe (LLVM 20.1.2 256 bits), OpenGL ES 3.2) | software |
| `--use-gl=egl` | SwiftShader | software |
| **`GALLIUM_DRIVER=d3d12` + `--use-angle=gl-egl`** | **ANGLE (Microsoft Corporation, D3D12 (Intel(R) UHD Graphics), OpenGL ES 3.0)** | **hardware (used)** |
| same + `MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA` | still Intel UHD Graphics. The NVIDIA dGPU is not usable in this WSL2 session (`nvidia-smi`: "Failed to initialize NVML"). | hardware |
| `GALLIUM_DRIVER=d3d12` + `scripts/shot.mjs --gpu` flags | D3D12 (Intel UHD Graphics) | hardware |

A headed browser under Xvfb was not tried, because `xvfb-run` is not installed. A headed window on the WSLg display
would most likely go through the same Mesa/D3D12 stack. The GPU path exposes `KHR_parallel_shader_compile`; SwiftShader does not.

This GPU path is real hardware, but it is a weak integrated GPU behind several translation layers: WebGL → ANGLE →
OpenGL ES → Mesa's d3d12 driver → Direct3D 12 → the WDDM GPU-PV bridge. Expect a native browser on Windows or macOS
with the same or a better GPU to run faster, and expect shader compilation in particular to be much faster.

## Results on the GPU (D3D12, Intel UHD Graphics)

The main GPU run (`run A`) had the machine nearly idle (1-minute load average 3.8 → 1.8). `Run B` repeated only the
loads (spawn view only) under moderate load (9.1 → 3.1) and added the frame-gap measurement. `Run C` was a final
low-tier check of the script (load 1.6 → 2.0).

### Load timing (TEST build, localhost, cold HTTP cache)

| Tier | Run | FCP | Top bar (rAF) | First UI | Ready | Shader-blocked before ready (programs linked) | Longest frame gap before ready |
|---|---|---:|---:|---:|---:|---:|---:|
| low | A | 2.40 s | 1.68 s | 2.40 s | 34.3 s | 27.3 s (167) | — (a 13.8 s long task) |
| medium | A | 0.19 s | 0.15 s | 0.19 s | 33.1 s | 27.8 s (181) | — (a 14.2 s long task) |
| high | A | 1.42 s | 0.15 s | 1.42 s | 36.4 s | 31.6 s (208) | — |
| low | B | 2.22 s | 1.52 s | 2.22 s | 24.1 s | 18.9 s (136) | 4.8 s |
| medium | B | 0.17 s | 0.12 s | 0.17 s | 33.9 s | 30.6 s (181) | 15.3 s |
| high | B | 0.15 s | 0.10 s | 0.15 s | 31.7 s | 26.5 s (181) | 14.7 s |
| low | C | 2.23 s | 1.48 s | 2.23 s | 29.8 s | 23.9 s (167) | 13.0 s (only 21 frames before ready) |

Every load made **48 requests** and fetched **4,895 KiB decoded / 1,727 KiB gzip** (1,793 KiB on the wire with
headers) before ready. The JS heap at ready was 82–125 MiB. The first tier of each run pays for starting the GPU process and
creating the first WebGL context, which is why its FCP is 2.2–2.4 s; later tiers show 0.15–1.4 s. Run A
measured long tasks instead of frame gaps. The Long Tasks API misses work done inside animation frames (it reported
only 5 s for the high tier), so the frame-gap measurement replaced it. Module slots resolve in two groups. Player,
lines, rocket, NPC, safety, vehicles and audio are ready after 6–9 s on some loads. Environment and both station
groups arrive last, together with `ready`.

### Frame rate per viewpoint (run A)

FPS is the mean over a 5 s window. The p95 frame interval is in brackets. Frame intervals are multiples of 16.7 ms
because headless Chromium paces frames at 60 Hz; 33 ms means every other tick.

| Viewpoint | Low | Medium | High | Main-thread rAF ms/frame (medium) |
|---|---:|---:|---:|---:|
| Spawn (Visitor Intake) | 28.8 (67 ms) | 27.8 (67 ms) | 27.2 (50 ms) | 7.3 |
| Production aisle | 32.1 (33 ms) | 26.5 (50 ms) | 26.9 (50 ms) | 7.3 |
| Tower plaza | 39.7 (33 ms) | 31.2 (50 ms) | 30.8 (50 ms) | 7.1 |
| Launch yard | 42.4 (33 ms) | 36.5 (33 ms) | 32.8 (33 ms) | 6.6 |
| Server hall | 37.7 (33 ms) | 31.2 (34 ms) | 30.7 (33 ms) | 6.1 |
| Rec yard | 51.1 (33 ms) | 39.4 (33 ms) | 36.6 (33 ms) | 6.3 |

At DPR 1, high costs about the same as medium: 2–4 % more triangles and a few more draw calls. The bigger difference
between them is the pixel-ratio cap (low 0.75–1, medium 1–1.5, high 1–2, set in `src/world/GameCanvas.tsx`), which
only matters on high-DPI displays.

### Renderer counters per viewpoint (run A, draw calls / triangles)

| Viewpoint | Low | Medium | High |
|---|---:|---:|---:|
| Spawn (Visitor Intake) | 178 / 319k | **294** / 580k | 307 / 593k |
| Production aisle | 154 / 330k | 276 / **635k** | 290 / 651k |
| Tower plaza | 127 / 284k | 218 / 564k | 226 / 587k |
| Launch yard | 103 / 232k | 177 / 491k | 180 / 495k |
| Server hall | 86 / 173k | 148 / 382k | 155 / 392k |
| Rec yard | 77 / 165k | 217 / 450k | 220 / 468k |
| After the tour: geometries / textures / programs | 230 / 57 / 163 | 289 / 64 / 177 | 296 / 68 / 204 |

Against the medium budget in `docs/ARCHITECTURE.md` §5 (≤ ~450 draw calls, ≤ ~700k triangles), the worst views use 65 %
of the draw-call budget and 91 % of the triangle budget.

**First-visit hitches.** The worst frame after each teleport was 1.2–1.7 s at the production aisle (every tier),
0.3–0.35 s at the server hall, and ≤ 0.15 s elsewhere. None of these teleports linked a new shader program, because
everything was compiled during the load or by the `compileAsync` warm-up after ready. The aisle visit did add 21–25
geometries and 6 textures to `renderer.info.memory`, so first-use GPU uploads are the likely cause.

**Under heavy machine load** (an earlier run at load average 25 → 13, not tabulated), medium ran at 13.8–23.1 fps, the
main-thread frame cost rose to 18–30 ms, and ready took 108–110 s on low and medium. Contention from other processes
roughly halved the frame rate and tripled the load time.

## Results on SwiftShader (CPU rendering, for comparison only)

**These FPS numbers do not represent any real visitor.** SwiftShader is the software rasterizer behind
`scripts/shot.mjs` and the e2e suite. This run used the same build, viewport and viewpoints (load average 1.5 → 12.3).

| Viewpoint | Low fps | Medium fps | High fps |
|---|---:|---:|---:|
| Spawn (Visitor Intake) | 1.4 | 1.0 | 0.7 |
| Production aisle | 0.8 | 0.5 | 0.4 |
| Tower plaza | 0.8 | 0.8 | 0.4 |
| Launch yard | 0.6 | 1.1 | 0.5 |
| Server hall | 1.6 | 0.9 | 0.7 |
| Rec yard | 1.2 | 0.8 | 0.9 |

Draw calls and triangles match the GPU run to within the scene's own variation (medium spawn: 294 calls either way).
Ready took 19.7 s (low), 24.1 s (medium) and 22.8 s (high). Shader-blocked time was 14.6–18.6 s for 181–194
programs. SwiftShader compiles shaders faster than the D3D12 translation path but draws roughly 30–60× slower.
Worst frames after a teleport reached 6–8 s on medium and high. Use the `__MIW__.clock` and `__MIW__.factory` hooks
instead of real-time waits when driving tests in this mode.

## Bundle sizes (production build)

Built with `vite build`, no test hooks. Sizes are of `dist/assets/*`. The TEST build is 1.4 KiB larger.

| Kind | Files | Raw | Gzip -9 | Brotli q11 |
|---|---:|---:|---:|---:|
| JavaScript | 50 | 4,685 KiB | 1,625 KiB | 1,297 KiB |
| Fonts (woff2 + woff, all subsets) | 44 | 508 KiB | 508 KiB | 506 KiB |
| CSS | 3 | 108.5 KiB | 23.0 KiB | 20.3 KiB |
| **Total** | 97 | 5,301 KiB | 2,156 KiB | 1,823 KiB |

| What a visitor downloads | Gzip |
|---|---:|
| Up front, for the top bar and loading screen: `index.html` (1.4 KiB), entry JS and entry CSS | **103 KiB**, plus **117 KiB** for the six Latin woff2 fonts (already compressed) |
| Everything needed for `__MIW__.ready` (48 requests) | **1,727 KiB** |

The total font size overstates real traffic. Fontsource ships Latin, Latin-ext and Vietnamese subsets in both woff2
and woff, and browsers fetch only the woff2 subsets that the page uses. Here that is six files (Barlow 400/600,
Barlow Condensed 600/700 and IBM Plex Mono 400/600, all Latin), checked with `?lite=1`.

| Largest JS chunks | Raw | Gzip | Brotli | Contents |
|---|---:|---:|---:|---|
| `GameCanvas-*.js` | 2,394 KiB | 878 KiB | 660 KiB | React Three Fiber, drei parts, Rapier glue and **Rapier's WASM as base64 (2,043 KiB raw / 784 KiB gzip)** |
| `runtime-*.js` | 736 KiB | 188 KiB | 153 KiB | three.js core |
| `index-*.js` (entry, loaded up front) | 275 KiB | 87 KiB | 75 KiB | React, UI shell, content |
| `npc-*.js` | 217 KiB | 79 KiB | 68 KiB | NPC module and dialogue |
| `environment-*.js` | 173 KiB | 63 KiB | 53 KiB | environment module |
| `groupB-*.js` / `rocket-*.js` / `groupA-*.js` / `lines-*.js` | 103–129 KiB each | 39–48 KiB | 34–41 KiB | stations, rocket, production lines |

Decoded to a binary, the Rapier WASM is 1,533 KiB raw, **572 KiB gzip and 419 KiB brotli**. Inlined as base64 it costs
784 KiB gzip and 579 KiB brotli.

On localhost the transfer takes no time. On a real connection, 1,727 KiB takes about 1.4 s at 10 Mbit/s and about 7 s
at 2 Mbit/s, before any of the render-side time above.

## Caveats

- **SwiftShader FPS is not representative of anything a visitor sees.** It is here only to calibrate the screenshot
  and e2e environment.
- **This is one weak integrated GPU behind several translation layers.** Treat these numbers as a pessimistic proxy,
  not a benchmark. A native browser on Windows (ANGLE → D3D11) or macOS (Metal) on the same laptop would very likely
  render faster and compile shaders much faster. Discrete GPUs would be far faster again.
- **Headless frame pacing.** Frames are paced to 60 Hz ticks, and nothing is presented to a real display, so there is
  no compositor or scan-out cost. Means between 30 and 60 fps are a mix of one-tick and two-tick frames.
- **The machine is shared and noisy.** Other agents were running headless browsers. The same build measured about
  twice as fast and loaded about three times faster at load average 2–4 as at 25. Treat differences under about 20 %
  as noise. Each tier/viewpoint pair has one sample.
- **The simulation keeps running.** Rocket phase, NPCs and crawler position differ between tiers and runs, so counters
  at the plaza and launch yard vary by a few percent. `noevents=1` removes only the ambient gags.
- **DPR 1 only.** On a 2× display, medium may render up to 1.5× DPR (2.25× the pixels measured here) and high up to
  2× (4×). Since this GPU is fill-bound, frame rates would drop roughly in proportion. Auto quality is meant to catch
  that.
- **Localhost serving.** There is no network latency or bandwidth limit. The HTTP cache is cold for each tier, but
  the browser and its GPU process are shared within a run.
- **Counter scope.** Draw calls and triangles cover the main `render()` call, including its shadow pass, on the last
  frame.

## Recommendations

1. **Compile shaders off the main thread, before the first visible frame.** This is the biggest win. The GPU path
   exposes `KHR_parallel_shader_compile`. `ReadySignal` in `src/world/Scene.tsx` already calls
   `gl.compileAsync(scene, camera)`, but only *after* ready, and by then every material in view has been compiled
   synchronously by the first frames: 19–32 s of blocking, including single freezes of 13–15 s. Awaiting
   `compileAsync` for each module's content before it first appears, behind the loading screen, would keep the page
   responsive. The total GPU work would stay the same, and the loading screen would keep
   animating. (Integrator: Scene/ModuleSlot.)
2. **Reduce the number of shader programs.** 163–208 programs is a lot for one scene. Each one costs about 150 ms on
   this stack, and even on a fast native driver about 200 programs add up. List
   `renderer.info.programs` by `cacheKey` to find near-duplicates: the same material type differing only in defines,
   `onBeforeCompile` variants, or cloned materials that differ only in color (instance or vertex colors avoid those).
   Route as much as possible through the shared `world/materials.ts`.
3. **Ship Rapier's WASM as a binary file.** It is 45 % of the bytes needed to reach ready. A separate `.wasm` would
   save about 212 KiB gzip (160 KiB brotli), compile while it streams, and cache on its own. `@react-three/rapier`
   uses `@dimforge/rapier3d-compat`, which inlines the WASM, so this needs a dependency or alias change: an
   integrator decision.
4. **Warm up GPU uploads during the load.** The first look at the production aisle stalls for 1.2–1.7 s with no
   shader work. Possible fixes: render one hidden frame with frustum culling disabled, or call
   `renderer.initTexture()` for canvas textures and draw once from each zone anchor behind the loading screen.
5. **Keep an eye on triangles at medium.** The production aisle sits at 91 % of the budget (635k, shadow pass
   included). Before adding geometry there, check `__MIW__.environment.breakdown()` and the shadow casters. Small props
   and signage that cast shadows count twice.
6. **Revisit the auto-quality threshold for integrated GPUs (product call).** `PerfMonitor` steps down when the
   smoothed fps stays below 34 for 4 s. On this GPU medium runs at 27–39 fps, so auto mode would drop a typical
   integrated-GPU laptop to low in most areas. On a 60 Hz display a steady 30 fps (every other vsync) is common, so a
   threshold near 28 fps would keep shadows on such machines, if 30 fps is acceptable.
