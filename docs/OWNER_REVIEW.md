# Owner review checklist

Every real fact on the site comes from a source you control: your GitHub profile, your current site (brianm53.github.io), your Code Story episode page, or tryharmony.ai. These were researched and adversarially re-verified on 2026-11-17. Nothing below blocks the site from working. Each item is a confirm-or-edit decision, and each one is a one-line change in `src/content/*.ts`.

## Identity & contact (`src/content/profile.ts`, `src/content/links.ts`)
- [ ] **Headline**: "Founding Engineer at Harmony AI". Your GitHub bio and the Code Story title agree. Your current site says "Harmony" and GitHub says "Harmony AI". The site uses "Harmony AI".
- [ ] **Location**: the site shows **Chattanooga, TN** (from Code Story and your current site). Your GitHub profile still says Plano, TX. Confirm which one.
- [ ] **Contact email**: none is published. No public email exists in any of your sources, and the site never invents one. To add an email button, set `PROFILE.email`. Until then, Contact shows LinkedIn, GitHub and your website.
- [ ] **LinkedIn**: `https://www.linkedin.com/in/brian-mckeown-49b225229/` (published on your GitHub profile and current site). LinkedIn blocks automated checks (HTTP 999), so please click it once to confirm it's current.
- [ ] **Personal details** from the Code Story page: grew up in Dallas, rec athletics at Texas A&M (used in the Rec Yard copy). Your age is deliberately not shown. Opt out by editing `PROFILE.summary` / `REC_YARD`.

## Résumé (`src/content/resume.ts`)
- [ ] The résumé panel is **compiled from your current site's page.tsx** and labeled "pending review". Confirm the roles and dates: Harmony AI (2026–present), Antera Software (2025–2026), Tetra Pak (2024), IDLife Corporate (2023).
- [ ] **Metrics** (Apdex +50%, checkout times −80%, manual tickets −50%+) are self-reported on your site and can't be independently verified. Keep or remove them.
- [ ] **Education**: "Computer Science, Statistics minor · Texas A&M · Class of 2025 · GPA 3.8" (self-reported). No source states the degree title (e.g. B.S.). Confirm, and decide whether to show the GPA.
- [ ] **PDF**: there is no download link until you supply one. Put the PDF in `public/` and set `RESUME.pdfUrl`. Then set `status: 'approved'`.

## Code Story (`src/content/stations.ts → PODCAST`)
- [ ] The episode title says "Founding Engineer at Harmony AI", but the URL slug contains `ceo-of-harmony-ai`. The site uses the published title as link text and never displays the raw URL. Optionally, ask Code Story to fix the slug.
- [ ] Only show-level Apple Podcasts and Spotify links exist, so the site links those, labeled "show page". Send episode-level links if you have them.
- [ ] No audio is embedded or streamed. The site opens the episode page.

## Harmony AI (`src/content/stations.ts → HARMONY`)
- [ ] The description paraphrases tryharmony.ai ("the AI operating system for American manufacturing"…). No customer names or case studies are repeated. Confirm the wording is OK to publish.
- [ ] The Control Room telemetry is explicitly labeled a fictional simulation (not customer data).

## Projects (`src/content/projects.ts`)
- [ ] Approve the one-liners and caveats:
  - **Gaussian-SLAM**: five-person capstone (CSCE 482, Spring 2025) "for SpatialGen", built on upstream open-source Gaussian-SLAM. Your documented role is scope/deliverables/backlog. Is naming SpatialGen OK?
  - **Row-Pergfect 1.0**: solo CSCE 462 project. The site quotes the report's numbers (pauses almost always, rushes and left/right ~80%), not the "90%+" figure on your current site.
  - **React POS System**: team course project, you as PM plus the cashier/ordering features. The Render demo is suspended (HTTP 503) and is not linked.
  - **OS Projects**: coursework on instructor starter code (pinned, listed in the Server Hall, not featured).
  - **Y86-64 CPU**: team project, your part being the memory stage plus a share of PC update. It's listed because your current site lists it. The repo description's "bubble sort / matrix multiplication" programs aren't in the repo, so the site doesn't claim them.
- [ ] Left off for lack of a public repo or owner confirmation: asl-translator, sentiment-analysis-nlp, Bookalytic, Malware-Analysis (the repo holds a live malware sample, so never link the zip), JavaFX-POS-System (README only).

## Hosting
- [ ] Deployed to GitHub Pages at `https://brianm53.github.io/mckeown-industrial-works/`. Your existing site at `https://brianm53.github.io/` is untouched. Decide whether this should replace it, or move to a custom domain (set `SITE_URL` and `BASE_PATH`, see README).

## Licensing
- [ ] All 3D, textures and audio are original and procedural. The fonts are OFL. See `ASSET_LICENSES.md`.
