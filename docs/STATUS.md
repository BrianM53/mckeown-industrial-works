# Status, known limitations & deferred work

_Last updated: 2026-11-18._

## What's done

Every phase of the spec is implemented and running in one contiguous world:

- **Navigation & discoverability (priority 1):** third-person perspective orbit camera (spring arm, indoor framing, recenter, zoom, forklift chase cam) and camera-relative WASD. Also: interaction prompts, the factory directory (Open now / Show route / Travel there, schematic map), always-on Portfolio / Contact / Skip-game links, a static HTML portfolio at `/portfolio/`, the in-app lite mode (`?lite=1`) and automatic fallback without WebGL, touch controls, settings and help.
- **Factory world & rocket loop (priority 2):** a dense industrial campus with wayfinding signage. Five distinct production lines are driven by a deterministic simulation. An assembly tower builds a procedural, intentionally ugly rocket stage by stage. Then come rollout with a crew, countdown, ignition, four seeded outcomes (success, wobble, breakup, explosion) plus the stowaway gag, and the "time since last unscheduled disassembly" board. Launches run about every 3–4.5 min.
- **Interactions, NPCs, audio, humor (priority 3):** 6–14 NPCs by quality tier, with dialogue, routes and seven ambient gags paced by a global director with cooldowns. Also: the site safety inspector (restricted zones → tackle → respawn in under 4 s, with cooldown), Night Shift blackout with guaranteed restore, PA announcer, and fully procedural WebAudio (opt-in; music, spatial machinery, event sounds, ducking, captions).
- **Forklift & minigame (priority 4):** drivable forklift with arcade physics, overturn detection and R-recovery, auto-return if left blocking a route, 40 bumpable props, and the Line Supervisor Console optimization puzzle (transparent model, solvable target, reset).
- **Polish & secrets (priority 5):** achievements, Employee of the Month wall, DAYS WITHOUT INCIDENT 0.2, DO NOT PRESS → bigger button, QC "REJECTED — TOO MUCH INITIATIVE", the locked SYNERGY executive office, percussive maintenance, "Nominal" announcer and PA corporate awards.

## Deployment

- **Live:** https://brianm53.github.io/mckeown-industrial-works/ (static portfolio at `/portfolio/`), and on Google Cloud Run at **https://brianmckeown.us/** (`www.` redirects; service URL https://mckeown-industrial-works-130645867703.us-central1.run.app/; `npm run deploy:gcp`; nginx with the full security headers, which GitHub Pages can't send).
- **How:** `npm run deploy:pages` pushes a prebuilt site to the `gh-pages` branch. GitHub Actions jobs refuse to start on the owner's account ("account is locked due to a billing issue"), so the fully automated `.github/workflows/deploy.yml` (typecheck → tests → build → smoke → Pages deploy) is set to manual for now. To switch back, restore its `push` trigger and set Pages → Source to *GitHub Actions*.
- GitHub Pages can't send custom HTTP headers, so the CSP and security headers apply only on Netlify/Vercel (configs included). On a project site, `robots.txt` isn't read at the domain root, so submit `sitemap.xml` through Search Console.

## Waiting on the owner (not blockers)

See [`OWNER_REVIEW.md`](OWNER_REVIEW.md). In short: a public contact email (none is published, and the site never invents one), an approved résumé PDF, a manual check of the LinkedIn URL (LinkedIn blocks automated checks), which location to show, confirmation of the self-reported role metrics and GPA, and approval of the project one-liners.

## Known limitations

- **Performance was measured on one weak GPU only.** Real-hardware numbers come from an Intel UHD integrated GPU reached through WSL2's Direct3D 12 translation layer: 27–51 fps at 1280×720 across tiers. Medium peaks at about 294 draw calls and 635k triangles, including the shadow pass; the budget is ~450 and ~700k. Discrete desktop GPUs and phones haven't been profiled yet. See [`PERF.md`](PERF.md).
- **First load is shader-heavy.** The scene uses about 110–200 shader programs. On the measured WSL2/D3D12 stack each took ~150 ms to compile, so the world took 24–36 s to become ready, and the first frames stalled before the fix described here. Shaders now precompile behind the animated loading screen before the first frame (`compileAsync`, parallel where the browser supports it), and the top bar and portfolio stay usable throughout. Native drivers compile far faster. Remaining improvements, noted in PERF.md: merge near-duplicate materials to cut the program count, ship Rapier's WASM as a binary file (−212 KiB gzip) instead of inlined base64, and warm up geometry/texture uploads so the first look at the production aisle doesn't hitch for ~1.5 s.
- **Auto quality** steps down from medium to low only when fps stays under 28 for 4 s, so integrated-GPU laptops running ~30 fps keep shadows. Visitors can always pick a tier in Settings or with `?quality=`.
- **Pad sightline.** The payload monorail and QC scanner now sit off the aisle centerline, so the view up the aisle to the rocket stays clear. The launch pad is visible from the middle of the main aisle (about z 12–17), the north road and the observation deck. From the southern end of the aisle the assembly tower stands between you and the pad, because of where the pad is in the layout. Moving the pad to about (14, −30) would widen that window, but it's a cross-module layout change, so it was deferred.
- **Procedural audio** is synthesized live (no recorded samples), so it is stylized by design. Podcast audio is never embedded: the Code Story episode opens on its own site.
- **Small visual caveats:** the Gaussian-splat hologram brightens toward white where many splats overlap (additive). The circuit-line pick-and-place head is small from the walkway. QC arch light strips bloom at very close range. After a goal, the soccer ball can roll out of the net (it resets 3 s later). The pallet-jack standoff actors aren't solid for the ~10 s they roll through the aisle.
- **Shader warm-up** covers everything visible after load. Building interiors that are hidden until you enter can still hitch briefly on the first visit with a slow GPU.
- **Headless test timing.** E2E tests assert sim-time durations (e.g. OSHA tackle to respawn) rather than wall-clock time, because SwiftShader frames can take seconds. The product logic itself completes in under 4 s.

## Deferred nice-to-haves

- Real-device performance profiling and per-device tuning, and an optional GPU-tier detector.
- Gamepad support (optional in the spec).
- Recorded / composed audio assets, and an episode-level podcast player if Code Story offers an embeddable one.
- Custom domain and moving the existing brianm53.github.io site (owner decision).
- More R&D Annex machines as more verified projects are added (the `ProjectStation` bench already renders any new `featured` project).
