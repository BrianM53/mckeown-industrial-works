# McKeown Industrial Works
## Implementation-ready creative and engineering specification
**Version:** 1.1 — November 17, 2026 (third-person camera and navigation revision)
**Deliverable:** Production-deployable, browser-based, explorable 3D personal portfolio
**Primary audience:** Autonomous coding harness / engineering agent
**Project owner:** Brian McKeown
**Motto:** *The factory can be dysfunctional. The website cannot.*

---

# 0. Agent instructions: read before coding

Build a complete, polished website, not a static mockup, slideshow, generic template, or proof-of-concept. The experience is a small, richly detailed, freely explorable, immersive third-person 3D factory. An anonymous worker explores it, discovers the owner's work, interacts with eccentric employees, operates a forklift, and watches a production line assemble and launch comically unreliable rockets. The factory should feel like a serious industrial simulation that produces unserious consequences.

**Autonomy:** Make tasteful creative and implementation decisions without requesting approval for minor details. Favor completeness, stability, responsiveness, and player delight over maximal scope. Do not introduce features that require user-supplied secrets or assets to make the base site work. Use placeholder *content* only where clearly labeled and sourced content is genuinely unavailable; never invent credentials, accomplishments, job dates, links, podcast transcripts, or project results.

**Definition of done:** A deployed, working site with playable navigation, meaningful portfolio destinations, coherent visuals, reliable physics/recovery, responsive UI, layered audio, functional links, and automated smoke tests. Provide a deployment URL, repository, README, configuration instructions, test results, and a list of any remaining limitations. A build that merely compiles is not finished.

**Priority order:** (1) navigation and portfolio discoverability; (2) compelling factory world and rocket loop; (3) robust interactions, NPCs, audio and humor; (4) forklift and optimization minigame; (5) extra polish and secrets. Never sacrifice (1) or (2) for a fancy but brittle mechanic.

**Non-goals:** Full Factorio-style construction, multiplayer, persistent user accounts, combat, enemies, realistic fluid simulation, realistic rocket aerodynamics, user-generated layouts, complicated backend infrastructure, and real OSHA branding presented as official endorsement.

---

# 1. Product vision and feel

Imagine a fully explorable industrial playground: Factorio's aggressive density of pipes, belts, tanks, presses, gantries, smoke, and warning stripes, combined with Kerbal Space Program's charming mechanical incompetence and Bruno Simon's instantly legible, playful portfolio navigation. The world is physically industrial, not horror-themed: soot, weathered steel, warm furnace glow, dusty concrete, teal-grey shadows, colorful signal lights, and thick steam. The factory is alive and busy from the first frame.

Visitors control an anonymous worker with WASD or arrow keys. A player-centered, freely orbiting third-person perspective camera follows, like the navigation experience in Roblox or a casual third-person adventure game—not Roblox's visual style. They can explore a single contiguous factory campus with no level-select loading between zones. Factory areas are visually distinct, signposted, and linked by clear paths. The world should invite wandering while allowing a time-pressed recruiter to open any destination immediately.

**Creative principles**
1. Aggressively factory: every scene contains recognizable industrial operations, not generic sci-fi corridors.
2. Serious simulation, unserious consequences: convincing machinery with cartoon slapstick, never gore.
3. Discoverable in seconds, rewarding for minutes: meaningful destinations immediately visible; optional secrets deeper inside.
4. Responsive, forgiving controls: arcade game feel over physical realism.
5. Humor every few turns, not nonstop interruptions: environmental jokes are common, disruptive events are rare and recoverable.
6. Real professional information stays factual. The fictional CEO mythology is clearly a joke within the factory universe; Brian's actual role is founding engineer at Harmony AI.
7. Every interaction should deliver immediate audiovisual feedback and a clear exit.

**Perspective acceptance gate:** At spawn, the worker fills a meaningful portion of the frame and the visitor looks forward through the factory at approximately character height. The full factory is *not* visible as a board.

**Desired first impression:** Within 10 seconds the player has moved, noticed a rocket assembly line, and seen at least one amusing detail. Within 60 seconds they can reach or directly open all five major portfolio destinations.

---

# 2. Visual direction and reference research

**Reference inspirations, not assets to copy:**
- Factorio: dense, readable, interconnected production machinery and conveyor logic.
- Kerbal Space Program: lovable, unstable rockets and cartoon engineering mishaps.
- Bruno Simon's interactive portfolio: playful exploration and obvious points of interest. Reference: https://bruno-simon.com/
- Human: Fall Flat and other forgiving slapstick physics games: recoverable comedy, not punishing simulation.
- Third-person exploration games: richly staged worlds designed to be read at human scale, with sightlines, landmark silhouettes, and navigable ground-level paths.
- Roblox third-person controls: camera orbit, mouse-look, player-relative navigation, and readable character framing; reference interaction model only, **not** blocky Roblox graphics.
- Modern third-person adventure games: collision-aware follow cameras, responsive locomotion, occlusion handling, and intuitive camera-relative controls.

**Originality requirement:** Do not copy copyrighted models, textures, sounds, characters, level layouts, logos, or UI from these games. Make an original visual language. Third-party assets must have compatible licenses; record attribution and licenses in `ASSET_LICENSES.md`.

**Palette:** charcoal #252B2B, gunmetal #465356, concrete #85857D, oxidized rust #A95E39, hazard yellow #E9B63F, safety orange #E57D35, furnace glow #FFB05A, muted teal #638C88, cream #EAE3D2. These are guidelines, not a requirement to color-match everything.

**Materials:** chunky low-to-mid-poly silhouettes; bevelled sheet metal; rivets; grates; pipes with elbows; moving belts; oxidized paint; dusty windows; rotating fans; sparks and steam particles. Strong silhouette readability from a shoulder-height, player-following camera; design machinery to look impressive when approached at ground level. Prefer baked or stylized lighting, selective emissive surfaces, lightweight instancing, and modest real-time shadows. Avoid visual noise obscuring walking paths.

**Lighting:** permanent cinematic late-afternoon industrial ambience, with warm furnace glow and cool shadows. No actual day/night cycle. An optional **NIGHT SHIFT** button triggers a brief, reversible comedic blackout/emergency-light event; never leaves the site unreadable or unnavigable.

**UI:** industrial HMI/control-panel-inspired overlays, not generic glassmorphism. Stamped labels, restrained monospaced data, big legible headings, warm paper panels for longer text, clear close/return controls. Distinguish genuine portfolio information from in-world fiction.

---

# 3. World topology and navigation

**One contiguous factory campus**, sized for comfortable ground-level third-person traversal, with clear sightlines, connected walkways, believable vertical scale, and a central main aisle. The exact dimensions may be tuned for gameplay. The rocket assembly tower and launchpad are the visual landmark. Five principal portfolio destinations plus an optional R&D annex are arranged around a legible loop, with shortcuts and a forklift route. Avoid empty corridors and dead-end wandering.

**Recommended zones:**
1. **Visitor Intake / Personnel Office** — spawn, welcome signage, résumé.
2. **Manufacturing Control Room** — Harmony AI, industrial operations, factory telemetry.
3. **Broadcast / Radio Booth** — Code Story podcast.
4. **Server Hall** — GitHub overview and selected repositories.
5. **Recreation Yard** — soccer and volleyball micro-interactions.
6. **R&D Annex** — Gaussian-SLAM scanning machine, Row-Pergfect sensor tester, optional additional verified projects.
7. **Production Spine** — five visibly distinct process lines feeding the rocket assembly tower.
8. **Launch Yard** — workers roll out rockets, countdown, launch and outcome counter.
9. **Maintenance Bay** — drivable forklift and optional controls tutorial.

The five principal destinations must be accessible via a **factory directory** opened by `M` or a clearly labeled UI control. Directory entries place a visible world-space waypoint and offer an optional assisted route or explicit fast-travel action. Never abruptly detach or teleport the camera without player consent. Include a small, accessible **Portfolio / Quick Links** overlay that works even if WebGL fails. A user must never have to play the game to access the actual résumé, podcast, Harmony, GitHub, or contact information.

**Wayfinding:** human-height directional signs plus overhead gantry signs, painted floor arrows, zone colors, beacon lights, distinct building silhouettes, and contextual `E — Inspect` prompts. Avoid a permanent giant minimap; optional simple map is fine. On spawn, show a brief non-blocking controls hint, then fade it. First destination should be visible without moving.

**Camera — NON-NEGOTIABLE THIRD-PERSON REQUIREMENT:** Use a **perspective** camera behind and slightly above the worker, similar in interaction to default Roblox third-person exploration. The character remains visible in the foreground, approximately lower-center of the screen, and the camera faces outward into the world. The player sees nearby machines from human scale, not the entire factory board. **Do not implement an orthographic, isometric, fixed-angle, top-down, RTS, Polytopia-style, miniature-board, or overview camera as the default gameplay view.** A temporary optional directory/map overview is acceptable, but it must never replace normal third-person play.

**Camera implementation contract:**
- Mouse drag / pointer-lock mouse-look rotates the camera freely around the character; yaw is unrestricted and pitch is clamped to a comfortable range (suggested approximately -20° to +65° relative to horizontal, tune by playtest). Right mouse drag should orbit in desktop free-cursor mode; optional pointer-lock mode may be toggled explicitly. Avoid unexpectedly trapping the pointer.
- Default follow distance around 4–7 meters, adjustable with mouse wheel/pinch within a constrained near/far range; start at a medium, human-scale distance, not a bird's-eye overview. A slightly offset shoulder framing is optional if it improves visibility.
- WASD movement is **camera-relative**: W moves in the horizontal direction the camera faces; A/D strafe relative to camera orientation; S moves backward. Smoothly rotate the worker toward the movement vector; normalize diagonal input. Shift runs. No shooting, weapons, or combat—the 'third-person shooter vibe' refers **only** to camera and locomotion.
- Use a spring-arm / collision-aware camera boom: sphere-cast or raycast between character and desired camera position, bring the camera inward smoothly near walls, then restore distance without popping or clipping. Fade obstructing props selectively when needed. Prevent camera passing through ceilings, machinery, or walls.
- When walking indoors, preserve close third-person framing with roof cutaways/visibility masks where useful. Do not automatically switch to overhead camera in narrow areas. Design doors, aisles, and machinery spacing around this camera.
- Camera smoothing should feel responsive, not floaty; use frame-rate-independent damping and a stable fixed-step player controller. Limit camera shake, especially around rocket launches and OSHA tackles, and honor reduced-motion preferences.
- On forklift entry, transition smoothly to a slightly higher/wider chase camera behind the vehicle; camera-relative steering must remain predictable. Restore player camera on exit. Offer manual recenter camera (e.g., `C`) and a reset-view action.
- On mobile, a left virtual joystick controls movement and a right-side touch drag orbits the camera; pinch zoom if practical. Interaction and menu buttons stay reachable. Do not rotate camera when tapping UI.

**First-person/third-person experience test:** Within five seconds of spawn, the visitor should be able to rotate the camera 360° around the worker, walk toward a looming machine, pass beside it, and see its scale from the worker's viewpoint. If a screenshot resembles a complete board, tabletop diorama, or Polytopia map, the implementation has failed the brief.

---

# 4. Player controls and interaction contract

**Desktop:** WASD move relative to camera; mouse drag or mouse-look orbits camera; mouse wheel zooms camera distance; Shift runs; E interacts; M opens directory/map; R recovers/unsticks; C recenters camera; Esc closes overlays/unlocks pointer/pauses. Controller support optional. Mouse-controlled camera orbit is required (with a keyboard-accessible alternative).

**Mobile/tablet:** left touch joystick for movement, right swipe to orbit camera, large interaction button, map/menu, reset control, pinch zoom when feasible. If the full 3D experience cannot run well on a device, present a polished lightweight fallback with full portfolio content. Never show a blank canvas.

**Movement:** acceleration/deceleration feel snappy; walk speed comfortable for a compact campus; diagonal movement normalized. Camera-follow lag subtle, not floaty; camera-relative motion and ground-level framing are mandatory. Character is charming and anonymous: chunky safety helmet, high-vis vest, boots, simple readable silhouette. Idle fidgets and small interaction gestures; no need for facial detail.

**Interaction system:** consistent proximity trigger, icon/highlight, and single action key. Interaction prompt only appears when available; prioritize closest/most relevant target. UI panels pause or appropriately suppress player controls, trap keyboard focus correctly, and always close with Esc or visible X. Clicking external links uses ordinary safe anchors (`target=_blank`, `rel=noopener noreferrer`).

**Recovery:** R resets an overturned forklift to an upright nearby safe surface; if on foot and stuck, move to last valid safe checkpoint. Never reset the whole site unnecessarily. Detect immobility/penetration and offer an unstuck action. Prevent softlocks around NPCs, moving machinery, walls, and overlays. OSHA tackle always respawns at a safe visitor checkpoint in under 4 seconds, without losing any portfolio state.

**Accessibility:** full content available without keyboard game controls; readable text at 200% browser zoom; keyboard-operable directory and panels; high contrast; reduced-motion mode disables intense camera shake and particle overload; captions for important sound-only cues; independent music/SFX sliders and mute; pause/disable autoplay-like ambient events. Provide a visible **Skip game / View portfolio** route.

---

# 5. Portfolio content and stations

**Content provenance policy:** Treat the following as user-provided or previously identified leads, not permission to invent details. Before publishing, verify exact URLs and titles against the owner's current sources. If verification fails, retain the station but use an accurate generic description and a configurable link; do not fabricate achievements. Store content in a typed, editable JSON/TS data file, separate from rendering logic. All factual biography and job dates must be owner-reviewable.

## 5.1 Personnel Office — résumé
A comically overengineered stamping/printing machine produces a clean résumé sheet when the player presses E. Show an accessible HTML résumé panel with experience, skills, education, projects, contact, and a **Download PDF** link once an owner-approved résumé PDF is supplied. Until then, provide a clearly labeled content-pending state rather than a fake PDF. Include a print-friendly HTML view and editable résumé data. An absurd mechanical printer can dramatically stamp **APPROVED FOR EMPLOYMENT** after the content loads.

## 5.2 Control Room — Harmony AI
A working industrial control room with animated telemetry, status lights, and an exaggerated dashboard. Explain factually that Brian is a founding engineer at Harmony AI, working on software for manufacturing. Provide a direct link to https://tryharmony.ai/ (verify canonical URL). The dashboard can display **fictional factory data** labeled as a simulation. Avoid implying real customer telemetry or disclosing confidential client information. Joke: an NPC claims the founder can smell inefficiency; do not present it as a factual professional endorsement.

## 5.3 Radio Booth — Code Story
A radio station with animated equalizer, tuning dial, speakers, and on-air light. Link to the owner's Code Story interview. Candidate URL requiring final verification: https://www.codestory.co/episodes/s13-bonus-eliminating-paperwork-manual-data-entry-in-manufacturing-with-brian-mckeown-ceo-of-harmony-ai/ . Verify episode title and role attribution; if the external episode calls Brian CEO but the site identifies him as founding engineer, do not silently repeat an inconsistent role claim. Default to **Open episode** rather than streaming copyrighted audio without a licensed embeddable player. A short original radio jingle or royalty-free station noise is acceptable.

## 5.4 Server Hall — GitHub
An industrial server hall with blinking racks, terminal-like project cards, and a giant cooling fan. Owner GitHub: https://github.com/BrianM53 . Display verified pinned or curated repositories from local config; do not depend on a live GitHub API request for core rendering. Optionally fetch metadata at build time with caching and rate-limit fallback. Candidate repositories to verify: Gaussian-SLAM, Row-Pergfect-1.0, React-POS-System, OS-Projects. Do not include Connect Four or FlightDash without independent owner verification. Every repo has a one-sentence plain-language explanation, technologies if verified, and an external link. Avoid fake contribution counts or real-time activity claims.

## 5.5 Recreation Yard — personality
A small outdoor/roofed recreation zone with soccer and volleyball. Simple playful interactions: kick a soccer ball toward a tiny goal; tap/bump a volleyball over a net with forgiving hit detection. NPCs occasionally miss spectacularly, argue about the rules, or celebrate an own goal. This is a personal-interest area, not a full sports simulator. Keep interaction short and optional.

## 5.6 R&D Annex — featured projects
**Gaussian-SLAM:** a rotating 3D scanner reconstructs a miniature object using stylized point clouds / Gaussian-like particles; panel links to verified repo and explains the project factually. The visualization need not implement the actual research algorithm. **Row-Pergfect:** a goofy industrial rowing-handle test rig with animated sensors and a form-feedback gauge; panel links to verified repository. Add a modular project-station schema so future verified work can be added without editing scene architecture.

## 5.7 Contact
A prominently discoverable **Contact / Hire / Say Hello** control accessible from the directory and résumé. Use only owner-provided email/social URLs. Until provided, show GitHub and LinkedIn if verified; never invent an address. An in-world pneumatic-tube mailbox can open the contact panel.

---

# 6. Rocket factory: the world centerpiece

**Production loop:** Five distinct process lines visibly move different items toward a final assembly tower. Example chain: metal smelting and sheet stamping; pipe and valve machining; electronics and guidance boards; fuel-tank fabrication; payload packing/quality control. Belted crates, gears, panels, tanks, and circuit boards are recognizable and varied. Materials advance continuously with simplified deterministic simulation. NPCs perform assembly gestures and occasionally carry components.

**Rocket assembly:** The central tower constructs an intentionally ugly, jagged, asymmetric rocket in stages: chassis, tanks, fins, nose cone, questionable attachments. The silhouette should visibly change during construction. When finished, a small crew wheels/transports the rocket to a nearby launchpad. Every few minutes, contingent on production progress, an automated countdown begins; warning lights flash, workers scatter, engines ignite, and the rocket launches with heavy smoke and satisfying rumble.

**Outcomes:** A seeded probabilistic result produces a successful ascent, a wobbly partial failure, a comical breakup, or an occasional dramatic non-gory explosion. Parts may tumble harmlessly with stylized particles. Sometimes an NPC forgets to disembark, is launched, falls in cartoon fashion, gets up, dusts off, and returns to work. Never imply realistic harm. Use choreographed, deterministic animations with limited rigid bodies rather than simulating true rocket aerodynamics. Launch sequence should not freeze navigation or obscure the entire screen for long.

**Counter:** Near the pad, an illuminated industrial sign reads `TIME SINCE LAST UNSCHEDULED DISASSEMBLY` and a timer. Include small `SUCCESSFUL LAUNCHES` and `UNSCHEDULED DISASSEMBLIES` counters if space permits. The timer resets after failures. Numbers can be local-session simulation, clearly not real operational metrics. On first visit, show a believable nonzero history for comedy if desired, but don't falsely claim real-time historical data.

**Cadence:** Target 3–5 minutes per launch in normal play, tunable via config. Do not force a player to wait for a launch to access content. Provide a clear view of the pad from the main aisle and optional observation platform. Optimize so rockets continue producing without offscreen full-physics simulation.

**Optimization minigame:** A compact control console near the production spine allows adjusting 2–3 variables (e.g., conveyor speed, inspection thoroughness, press allocation) to improve throughput versus defect rate. Provide a short, solvable, clearly explained challenge with baseline, feedback, and success state in 2–4 minutes. Better settings measurably improve simulated rocket success odds but never eliminate funny failures entirely. No machine repositioning, no Factorio construction, no unwinnable puzzles. Reset puzzle to defaults anytime. Use a small transparent deterministic simulation model, not random success feedback unrelated to player action.

---

# 7. Forklift and physics

At least one parked forklift is enterable with E. On entry, camera smoothly switches to a behind-the-forklift chase view; WASD steers/accelerates/brakes with intentionally clumsy but controllable arcade handling. Optional horn, reverse beep, subtle suspension wobble, forgiving wall collisions, and bumpable lightweight props. Forklift cannot permanently destroy portfolio stations or block routes. The player can exit safely with E at a valid nearby position.

Use a mature browser-compatible physics library such as **Rapier** (`@react-three/rapier` if using React Three Fiber). Fixed physics timestep, visual interpolation, sensible collision layers, capped impulses, and continuous collision detection where needed. Avoid expensive mesh colliders for complex buildings; use compound primitives and simplified proxies. Heavy machinery is static or kinematic; light crates and comedic props are dynamic with sleeping enabled. Do not simulate hundreds of individual belt items as independent rigid bodies.

**Recovery requirements:** R upright/respawn vehicle at last safe spot, with visible confirmation. Automatic unstuck detection after repeated failed movement, with non-intrusive recovery prompt. Vehicle collisions cannot softlock pedestrians. Avoid jittering, tunneling, or uncontrolled chain reactions. Fun handling beats physically accurate forklifts.

---

# 8. NPC simulation and humor

**Population:** Approximately 8–15 visible NPCs across active zones, tuned for device capability. Each has a role, short route, occasional idle behavior, and a small pool of contextual dialogue. Navigation via waypoint graphs or lightweight navmesh. Avoid expensive per-frame pathfinding and crowd simulation. Workers must not block primary paths indefinitely.

**Dialogue:** Press E near a worker to see a concise, readable dialogue bubble; 1–3 lines, occasional optional follow-up. Dialogue is authored and localized in data, not dependent on a live LLM or API key. Mix useful factory information, workplace gossip, absurd safety commentary, and occasional fictional hyperbolic praise of Brian as the mythical CEO. Keep the real biography correct and separate from these jokes. Avoid making every worker repeat his name.

**Sample dialogue tone:**
- "The CEO increased productivity 400% by pointing at a spreadsheet."
- "I've never met him, but they say he can smell inefficiency."
- "We haven't had an accident in fourteen minutes. New record."
- "This machine has two settings: ON and UNION NEGOTIATION."
- "The forklift is company property. The dents are company culture."

**Ambient gags:** a forklift standoff, a worker napping on a conveyor and getting boxed, a robot arm accidentally launching a worker, an oven producing a soot-covered worker who shakes it off, a green vat splashing a worker, a printer ejecting a ludicrously long memo. No blood, gore, prolonged distress, or realistic injury. Every gag has a clear recovery animation.

**OSHA inspector:** A recurring fictional safety-inspector NPC patrols and investigates marked hazards. When a player enters a clearly signed restricted tile, trigger whistle, chase/tackle animation, brief cartoon ragdoll, and quick respawn at visitor intake. The player should understand what happened, laugh, and resume within seconds. Inspector can also investigate NPC mishaps. Add cooldowns to prevent repeated unavoidable tackles; restricted zones must not gate portfolio content. Avoid official OSHA logo or suggesting governmental affiliation; an exaggerated generic safety inspector is acceptable, with optional tongue-in-cheek OSHA dialogue.

**Night Shift:** An oversized button triggers 10–20 seconds of dramatic power outage/emergency lighting, comedic NPC panic, then full restoration. No loss of navigation or content; reduced-motion mode uses a gentle lighting transition. Button cooldown and clear reset.

**Humor pacing:** Every 15–30 seconds of ordinary exploration, a curious player should be able to encounter an ambient joke or optional interaction, but involuntary cinematic interruptions should occur no more than occasionally. Never force jokes to delay reading a portfolio panel. Implement global event cooldowns and per-gag cooldowns; prevent multiple simultaneous disruptive events. Easter eggs may be hidden in obscure corners and rewarded with a small optional achievement list.

---

# 9. Audio design

Audio is **opt-in after a user gesture** to comply with browser autoplay restrictions. Layer a subtle original or properly licensed industrial-electronic ambient music loop with spatially positioned machinery sounds. Belts click, presses thump, steam hisses, forklifts beep, fans hum, and furnaces rumble. Attenuation follows distance, with reasonable minimum and maximum volumes, stereo positioning when available, and no harsh accumulation when multiple emitters overlap.

Use zone-specific ambience and pooled sound emitters. Major events (launch, OSHA tackle, blackout) briefly duck the soundtrack. Give controls for master, music, and SFX volume plus mute. Persist preferences locally if possible. Respect reduced-motion and user sound preferences; captions/visual cues for whistles, alarms, and countdowns. Never play podcast audio without explicit user action or appropriate embedding rights. Source/license every audio asset.

---

# 10. Recommended technical architecture

**Preferred stack:** TypeScript, React, Vite or Next.js with an appropriate client-only 3D boundary, Three.js via React Three Fiber, Drei helpers, Rapier physics, Zustand or equivalent lightweight state store, and a small CSS/design-token system for HTML overlays. Choose the simplest reliable setup supported by the target deployment. Avoid a backend unless clearly necessary; a static host/CDN should be sufficient for the core experience.

**Data-driven scene:** Define zones, points of interest, interactables, dialogue, and external links in typed configuration. Use event-driven finite state machines for rocket launch, OSHA chase/tackle, blackout, and NPC gags. Explicitly handle interruption, restart, cooldown, and cleanup. Clean up event listeners, animation frames, timers, physics objects, and audio nodes on unmount.

**Rendering:** instanced meshes for repeated belts/pipes/props, compressed glTF/GLB models, texture atlases where useful, frustum culling, LOD or distance-based activation, capped dynamic lights and shadows, and pooled particles. Animate belts using shader UV offsets or instanced transforms; avoid thousands of physical rigid bodies. Avoid huge postprocessing stacks. Profile on target devices.

**Asset pipeline:** Prefer original procedural geometry and small custom low-poly assets. If generating 3D meshes with tools, review topology and optimize before import. Do not use placeholder cubes as final machinery. A polished, coherent smaller world is better than an expansive unfinished one. Keep asset licenses and attributions.

**Performance targets:** aim for 60 FPS on a typical recent desktop at 1080p, gracefully degrade to ~30 FPS on capable mobile hardware, and provide a reliable HTML fallback on unsupported devices. Define a configurable quality tier for shadows, particles, NPC density, and render resolution. Track actual frame timings rather than claiming targets are met without measurement. Target initial meaningful UI in <3 seconds on a typical broadband desktop when feasible; stream/defer heavy scene assets and show clear progress indicators.

**Deployment:** Provide a reproducible build, env.example if needed, asset base-path handling, SPA fallback/routing config, compression/cache headers, HTTPS, proper external-link security, and a README with one-command local start/build/test/deploy instructions. Core site must work without secrets, GitHub tokens, or paid APIs. Add a simple health/smoke check for deployment.

**Search/discovery:** Although SEO is not the priority, include a real HTML About/Resume/Projects content route or server-rendered/static equivalent with correct title, meta description, Open Graph tags, sitemap, robots directives, semantic headings, and canonical links. Do not claim this guarantees ChatGPT or search-engine indexing.

---

# 11. UX failure modes to prevent

- User spawns and does not know how to move or find résumé.
- Camera loses the worker behind walls or rockets, clips into geometry, or drifts into a board-game overview.
- Clicking a panel also moves the character or triggers machinery.
- Interaction prompts overlap or select wrong object.
- Forklift flips, falls through floor, or permanently blocks the aisle.
- NPC blocks a doorway or runs through a portfolio panel.
- OSHA event repeats infinitely at respawn.
- Rocket launch causes an unresponsive tab or persistent particle overload.
- Audio plays without consent, clips, or continues after mute.
- Mobile visitors see tiny buttons or a blank WebGL scene.
- GitHub rate limits cause missing content.
- External links are broken, or fictitious achievements are displayed as facts.
- Unavailable résumé PDF silently downloads an invalid file.
- A visual gag interrupts reading or makes the portfolio inaccessible.
- Reduced-motion users receive forced screen shake or intense flashing.
- Site is impressive for 10 seconds but lacks usable content.

---

# 12. Acceptance tests and quality gates

Use Playwright or equivalent for browser tests, unit tests for state machines/simulation, and manual exploratory passes for feel. Where deterministic behavior is needed, seed randomness. Instrument dev/test-only debug controls to advance production, trigger launch outcomes, summon OSHA, enter/exit forklift, and reset state; do not expose debug controls to visitors.

## Must-pass automated tests
1. Site builds from a clean checkout with documented commands; deployed root and fallback routes load without console-breaking errors.
2. Main menu, directory, and portfolio panels render and are keyboard accessible without initializing 3D.
3. All five main stations are reachable via directory; every panel opens, closes, and exposes its intended content/link.
4. Every configured external URL is syntactically valid; run a link checker where network access permits. Unverified URLs are clearly flagged for owner review.
5. Player movement works in four cardinal directions and diagonals; player cannot leave world bounds.
6. Perspective third-person camera follows the visible worker at human scale; orbit works 360°; WASD is camera-relative; zoom, wall collision, indoor occlusion, and camera recenter work at representative locations. Reject any top-down/isometric/Polytopia-like default view.
7. Interaction selects nearby target, ignores out-of-range targets, and does not activate through open overlays.
8. Forklift enter, steer, collide, exit, overturn, and R-recover all work repeatedly without softlocks.
9. Rocket production reaches complete state, wheels out, counts down, launches, records outcome, and resets to produce another rocket.
10. Minigame parameters change throughput/defect outcomes according to a tested model; reset restores baseline.
11. OSHA restricted tile triggers inspector event, respawns at safe checkpoint, and respects cooldown.
12. NPC event scheduling respects cooldowns, has no impossible overlapping states, and returns workers to valid waypoints.
13. Night Shift restores normal lighting and cannot strand the player in darkness.
14. Mute and volume sliders control audio; no sound plays before consent.
15. UI is usable at desktop and mobile breakpoints; fallback remains functional without WebGL.
16. No uncaught runtime errors or leaking event handlers after repeated panel opens, scene resets, and navigation.
17. Reduced-motion preference disables major shake/flashes and provides alternate feedback.
18. Basic accessibility checks pass for HTML controls, focus order, labels, and contrast.

## Manual feel tests
- First-time visitor can move and reach meaningful content in <60 seconds without instruction from a developer.
- At least three distinct machinery processes are recognizable at a glance; all five production lines look materially different.
- The world feels busy without being visually or sonically exhausting.
- Forklift feels comically heavy but controllable; bumping props is satisfying rather than frustrating.
- At least one rocket launch is visually legible and funny, and the factory keeps running afterward.
- The OSHA tackle is funny the first time and never annoying on repeat.
- NPC jokes vary, don't constantly name Brian, and don't drown out genuine portfolio content.
- A recruiter can open résumé, Harmony, podcast, GitHub, and contact in under two minutes without completing any game challenge.
- Performance remains acceptable after 15 minutes of continuous exploration and repeated launches.

## Definition of complete
A reviewer can use the site for 15 minutes, encounter the core rocket cycle, explore all five portfolio attractions, drive and recover a forklift, trigger an OSHA gag, play the optimization puzzle, use the directory, and leave with a clear understanding of who Brian is and how to contact him—without crashes, broken links, or developer intervention.

---

# 14. Final deliverables required from coding harness

1. Working source repository with readable, modular TypeScript and content configuration.
2. Publicly accessible deployment URL (or explicit explanation if deployment credentials are unavailable).
3. README with local run/build/test/deploy, controls, configuration, and how to edit portfolio content.
4. `ASSET_LICENSES.md` listing all non-original assets and licenses.
5. Automated tests and actual pass/fail output; basic performance measurements on representative hardware.
6. Short demo capture or screenshots showing spawn, rocket assembly, launch, forklift, OSHA event, and portfolio panels.
7. Owner-review checklist for factual content, contact details, résumé PDF, podcast URL, project descriptions, and licensing.
8. Honest list of known limitations and deferred nice-to-haves.

---

# 15. Owner-supplied content checklist (not blockers for functional prototype)

- [ ] Approved résumé text and PDF.
- [ ] Preferred professional email/contact method.
- [ ] LinkedIn canonical public URL.
- [ ] Confirm exact Code Story episode link and preferred attribution.
- [ ] Confirm Harmony AI canonical URL and approved description.
- [ ] Confirm GitHub pinned projects and factual descriptions.
- [ ] Optional personal headshot/logo for HTML About page (not for anonymous worker).
- [ ] Optional original music/audio assets and domain/hosting preference.

**Safe default:** Build the world and complete functional site now with clearly labeled, editable content gaps. Do not invent personal facts to make the site appear finished.

---

# 16. Suggested optional Easter eggs (only after core completion)

- Employee of the Month wall: every photo is the same exhausted forklift driver.
- Factory safety sign: "DAYS WITHOUT INCIDENT: 0.2".
- Pneumatic tube sends a résumé to a shredder before the real copy prints.
- A giant red button labeled "DO NOT PRESS" turns on a second, larger red button.
- Quality-control scanner stamps the visitor "REJECTED — TOO MUCH INITIATIVE".
- A mysterious locked executive office contains a single pie chart labeled "SYNERGY".
- An NPC tries to fix a machine by kicking it; the machine briefly runs faster.
- A launch announcer calmly says "Nominal" as the rocket sheds a fin.
- The factory PA periodically announces implausible corporate awards.

All optional events must be reversible, skippable, and low-cost. Do not build these before core navigation, portfolio content, and rocket production are solid.

---

# 17. Final creative directive

Build a place people want to explore, not a 3D wrapper around résumé cards. It should be instantly clear that this is a personal website, but the dominant emotional memory should be: *I wandered around a ridiculous, beautifully crafted factory, watched a terrible rocket launch, got tackled by a safety inspector, and somehow learned a lot about the engineer who made it.*

**The factory can be dysfunctional. The website cannot.**
