# TFT Codex — Implementation Tasks

Each task is meant to be small enough to implement and test in one sitting, and to build only on tasks above it — no task requires code that a later task hasn't been written yet. Check off as you go. `_Requirements: ..._` links each task back to `requirements.md`.

**v2 change log:** Phase 7 (mobile) removed. Phase 5 rewritten around Overwolf (`ow-electron` + GEP) instead of a standalone Tauri app. Phase 0 and Phase 2 gained tasks to start the Riot/Overwolf approval process early and to enforce the augment-compliance rule structurally, not just in the UI.

**v3 change log (see `review-and-roadmap.md`):** 0.7 amended to explicitly surface the Tier-3 recommendation-timing question to Riot during approval. New tasks added: 1.15 (web monetization), 2.13 (Tier-2/Tier-3 feature flag), 2.14 (breakpoint reference), 3.14 (pre-game lobby intel), 3.15 (post-game AI coaching narrative), 4.8 (multi-carry itemization optimizer), 5.21 (streamer-safe overlay), X.7 (standing recommendation-timing compliance re-check).

---

## Phase 0 — Foundations

- [ ] 0.1 Scaffold a monorepo (Turborepo or Nx) with `apps/web`, `apps/api`, `apps/overwolf`, `packages/shared-types`, `packages/ui`
  - _Requirements: —_
- [ ] 0.2 Configure TypeScript strict mode, ESLint, Prettier, and a GitHub Actions workflow that blocks merge on lint/type/test failure
  - _Requirements: —_
- [ ] 0.3 Add `docker-compose.yml` for local Postgres + Redis; document setup in root `README.md`
  - _Requirements: —_
- [ ] 0.4 Apply for a Riot Developer application key; build a `RiotApiClient` wrapper in `packages/riot-client` with a configurable Redis-backed token-bucket rate limiter
  - _Requirements: 12.2_
- [ ] 0.5 Define shared TypeScript interfaces from `design.md` §4 (`Champion`, `Trait`, `Item`, `Augment`, `Comp`, `PatchVersion`, `LobbyIntelEntry`) in `packages/shared-types`, with unit tests validating example fixtures parse against each type — confirm the `Augment` type has no `winRate`/`avgPlacement` fields as a review checklist item, not just a convention
  - _Requirements: 3.1_
- [ ] 0.6 Write the Riot legal disclaimer component (no Riot logo) and add it to the web app's global footer
  - _Requirements: 12.3_
- [ ] 0.7 **Start now, runs in parallel with everything below:** submit Riot's third-party application approval request via Riot's Developer Portal. **Explicitly describe the Tier-3 adaptive recommendation engine's board-state-reactive behavior (`design.md` §8) in the submission and request written confirmation of its acceptability** — don't submit a generic description and discover the answer at rejection time. Track status; this gates both a production Riot API key and Overwolf publication later, and typically has real review lead time
  - _Requirements: 13.1, 3.7_
- [ ] 0.8 **Start now, runs in parallel:** submit the Overwolf app idea for whitelisting as a **Public** app, including a public-facing feature description, UI/UX plan, and a monetization plan (even if "no ads at launch"). Overwolf will not grant API access before this is approved
  - _Requirements: 13.2_

## Phase 1 — Meta Intelligence MVP

- [ ] 1.1 Build a seed-player crawler: pull Challenger/Grandmaster/Master league entries via `league-v1`, store seed PUUIDs
  - _Requirements: 1.1, 12.2_
- [ ] 1.2 Build a match-ID crawler that walks `match-v1` for each seed PUUID and queues new (deduplicated) match IDs
  - _Requirements: 1.1, 12.2_
- [ ] 1.3 Build a match-detail fetch worker that pulls full match JSON and upserts it into a `raw_matches` Postgres table keyed by `matchId`
  - _Requirements: 1.1_
- [ ] 1.4 Write the comp-signature registry schema (core traits + carry → named comp) and seed it manually for the current patch
  - _Requirements: 1.3_
- [ ] 1.5 Build the comp-detection function: given a participant's final board, return the best-matching registered comp ID or `null`
  - _Requirements: 4.2 (reused later), 1.3_
  - _Test: fixture boards with known expected comp assignments_
- [ ] 1.6 Build the aggregation job: compute per-comp `avgPlacement`, `top4Rate`, `winRate`, `playRate`, `sampleSize` into ClickHouse (or Timescale) from matches ingested since the last run
  - _Requirements: 1.1, 1.2_
- [ ] 1.7 Implement the tier-scoring formula from `design.md` §3 as a pure, unit-tested function; wire it to run after each aggregation pass and publish a versioned tier-list snapshot to Redis
  - _Requirements: 1.3, 1.4_
- [ ] 1.8 Schedule the crawler + aggregation + scoring pipeline to run on a 30-minute cycle; add a healthcheck metric for "minutes since last successful publish"
  - _Requirements: 1.2, 1.6, 11.5_
- [ ] 1.9 Build `GET /v1/meta/tier-list` with `patch`, `tier`, `playstyle`, `difficulty` query params, cached at the gateway with TTL matching the refresh cycle
  - _Requirements: 1.7, 11.1_
- [ ] 1.10 Build `GET /v1/comps` (search/filter) and `GET /v1/comps/:id` (full detail) endpoints backed by Postgres (comp metadata) joined with the latest ClickHouse stats row
  - _Requirements: 2.1, 2.6_
- [ ] 1.11 Build the web Tier List page: filter controls, comp cards, patch/refresh timestamp display, stale-data banner
  - _Requirements: 1.5, 1.6, 1.7_
- [ ] 1.12 Build the web Comp Detail view: stats, units/items table, formation, augment priority (category labels only), curated augment list, explanation, stage guide
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
- [ ] 1.13 Write integration tests for both endpoints covering cache hit/miss and the "provisional" (low sample size) comp state
  - _Requirements: 1.4_
- [ ] 1.14 Deploy Phase 1 to a staging environment and manually validate against real current-patch data before enabling public access
  - _Requirements: —_
- [ ] 1.15 Stand up web display-ad slots (non-core-content placements only — never inside tier list/comp/augment core UI) and the free/paid tier gate ahead of public launch, per `design-system.md`'s component rules for ad placement
  - _Requirements: 18.1, 18.2, 18.3, 18.4_

## Phase 2 — Augment Intelligence & Comp Explanations (Compliance-Gated)

- [ ] 2.1 Extend the match ingestion schema to capture each participant's augment picks per game round (internal storage only)
  - _Requirements: 3.1_
- [ ] 2.2 Extend the aggregation job to compute `AugmentInternalStats` (win rate, avg placement, global and per-comp) into a ClickHouse table with **no gateway route to it** — verify this structurally (integration test that the gateway's DB credentials cannot query the table), not just by convention
  - _Requirements: 3.1_
- [ ] 2.3 Build categorical augment tier scoring (S/A/B/C) from `AugmentInternalStats`, writing only the letter grade + play rate to the public `Augment` record
  - _Requirements: 3.2, 3.3_
- [ ] 2.4 Build `GET /v1/augments/tier-list` and `GET /v1/augments/:id` returning only compliant fields
  - _Requirements: 3.1, 3.2, 3.3_
- [ ] 2.5 Add the API gateway response-schema allowlist middleware for `/v1/augments/*`, stripping any field not in the compliant `Augment` type
  - _Requirements: 3.1_
- [ ] 2.6 Write the augment-compliance test suite: asserts `winRate`/`avgPlacement` never appear in any `/v1/augments/*` or `/v1/recommendations` response body; wire it into CI as a release-blocking check on every PR
  - _Requirements: 3.1_
- [ ] 2.7 Build the web Augment Explorer page (tier badges + play rate; no numeric win rate or placement anywhere in the UI, including tooltips and CSVs/exports if any)
  - _Requirements: 3.1, 3.2, 3.3_
- [ ] 2.8 Implement the v1 recommendation scoring function (`design.md` §8): reads `AugmentInternalStats` server-side, ranks internally, emits a qualitative reason string from a template bank — unit-test that the reason strings never contain a number sourced from placement/win-rate data
  - _Requirements: 3.4_
- [ ] 2.9 Build `POST /v1/recommendations` accepting board state and optional augment options, returning `RecommendationResponse`
  - _Requirements: 3.4, 3.5_
- [ ] 2.10 Build an in-app "what should I pick" widget on the web comp detail page that calls `/v1/recommendations`, for quick testing before the Overwolf app exists
  - _Requirements: 3.4_
- [ ] 2.11 Set up an editorial workflow (internal admin route or CMS) for writing/approving each comp's "why it works" explanation, curated augment list, and stage-by-stage guide copy, informed by the aggregated leveling/econ curves
  - _Requirements: 2.2, 2.3, 2.4_
- [ ] 2.12 Backfill explanations, curated augment lists, and stage guides for all current S/A tier comps before marking Phase 2 complete
  - _Requirements: 2.2, 2.3, 2.4_
- [ ] 2.13 Implement the Tier-2/Tier-3 mode split from `design.md` §8: build Tier-2 ("offered augments only" lookup + snapshot-on-open comp matching) as the default; add the server-side `mode` field handling and the gateway kill switch that downgrades any `tier3-adaptive` request to `tier2-lookup` unless the deployment's Riot-confirmation flag is set. Ship with the flag off
  - _Requirements: 3.4, 3.7_
- [ ] 2.14 Build `GET /v1/reference/breakpoints`: a static, patch-sourced XP/gold breakpoint table (not wired to any live player state), and the corresponding web/overlay reference component
  - _Requirements: 17.1, 17.2_

## Phase 3 — Personal Performance Analytics

- [ ] 3.1 Implement RSO OAuth start/callback endpoints and secure token/session handling
  - _Requirements: 7.1, 7.2_
- [ ] 3.2 Build the account-linking UI flow (sign in with Riot button → callback → profile created)
  - _Requirements: 7.1, 7.4_
- [ ] 3.3 Build a per-user match-sync job: on link, pull recent ranked match history for the linked PUUID; on a schedule, sync new matches
  - _Requirements: 4.1_
- [ ] 3.4 Reuse the Phase 1 comp-detection function to tag each synced match with a `detectedCompId`
  - _Requirements: 4.2_
- [ ] 3.5 Build the leveling-curve and gold-curve extraction from match timeline data, stored on `MatchSummary`
  - _Requirements: 4.3_
- [ ] 3.6 Build `GET /v1/players/me/matches` and `GET /v1/players/me/matches/:matchId`, the latter comparing the user's curves against the comp's top-4 average curve
  - _Requirements: 4.3_
- [ ] 3.7 Build the improvement-suggestion generator: rule-based comparisons (leveling timing, econ deviation, augment choice vs. recommendation) producing at least one concrete, qualitative suggestion per match — no augment win-rate/placement numbers surfaced here either
  - _Requirements: 4.5, 3.1_
- [ ] 3.8 Build `GET /v1/players/me/analytics` aggregating average placement by comp/playstyle/carry over a date range
  - _Requirements: 4.4_
- [ ] 3.9 Build the web Match Review screen and Personal Dashboard screen
  - _Requirements: 4.3, 4.4, 4.5_
- [ ] 3.10 Implement `GET/DELETE /v1/players/me` including the 30-day hard-delete job for unlinking
  - _Requirements: 7.3, 12.4_
- [ ] 3.11 Write a privacy-policy page and link it from account settings
  - _Requirements: 12.4_
- [ ] 3.12 **Gate, don't skip:** before building any "your placement broken down by augment picked" personal-analytics feature, explicitly re-check it against Riot's approval feedback (R4.7) rather than assuming personal data is exempt from the augment-display restriction — get a written answer, then build or drop it
  - _Requirements: 4.7_
- [ ] 3.13 Tests: OAuth flow with mocked RSO responses, match-sync idempotency (re-running sync doesn't duplicate), analytics aggregation correctness against fixture data
  - _Requirements: 4.6_
- [ ] 3.14 Build the Lobby Intel Service (`design.md` §2): one-shot loading-screen lookup of each visible participant's recent match history via Riot API, `GET /v1/lobby/intel`, cached per match, explicitly not refreshed or extended once combat starts. Unit-test that it never fires a second query for the same match
  - _Requirements: 14.1, 14.2, 14.3, 14.4_
- [ ] 3.15 Build the post-game AI coaching narrative generator (`GET /v1/matches/:matchId/coaching`): natural-language summary built from 3.7's existing signals, citing the specific stage of biggest deviation, with a raw-stats opt-out toggle in the Match Review screen
  - _Requirements: 15.1, 15.2, 15.3, 15.4_

## Phase 4 — Comp Builder / Sandbox

- [ ] 4.1 Build the board editor UI: hex-grid placement (or simplified front/back rows if full hex geometry is deferred), champion picker, item assignment per unit
  - _Requirements: 6.1_
- [ ] 4.2 Build live trait-count computation as the board changes, including "one unit away from next breakpoint" highlighting
  - _Requirements: 6.2_
- [ ] 4.3 Build `POST /v1/builder/comps` (save) and `GET /v1/builder/comps/:id` (load), with a URL-safe shareable ID
  - _Requirements: 6.3_
- [ ] 4.4 Implement signature matching against the registry so a saved custom board that matches a tracked comp displays that comp's live stats inline
  - _Requirements: 6.4_
- [ ] 4.5 Add an "import into builder" action on the Comp Detail page (Phase 1) that pre-fills the board editor
  - _Requirements: 6.5_
- [ ] 4.6 Add a rough tankiness/damage estimate heuristic (documented formula, clearly labeled as an estimate, not a simulator)
  - _Requirements: 6.1_
- [ ] 4.7 Component and integration tests for trait counting, save/load round-trip, and signature matching
  - _Requirements: 6.2, 6.3, 6.4_
- [ ] 4.8 Build the multi-carry itemization optimizer (`POST /v1/items/optimize`): given held components and board units, suggest an allocation across units with trade-off explanations, as a builder/pre-post-game tool only (Tier-1, no live bench polling)
  - _Requirements: 16.1, 16.2, 16.3_

## Phase 5 — Overwolf Desktop Companion

- [ ] 5.1 **Blocking checkpoint:** confirm both 0.7 (Riot third-party approval, including the Tier-3 recommendation-timing answer) and 0.8 (Overwolf whitelisting) are granted before starting feature work in this phase — if either is still pending, keep pushing on Phases 1–4 instead
  - _Requirements: 13.1, 13.2, 3.7_
- [ ] 5.2 Scaffold the `apps/overwolf` project on Overwolf Electron (`ow-electron`), importing `packages/ui` and `packages/shared-types` from the monorepo
  - _Requirements: 5.1, 10.2, 10.3_
- [ ] 5.3 Write `manifest.json`: declare only the permissions actually used (`GameInfo`, `Hotkeys`), and fill in the Appstore-required meta fields (`dock_button_title`, `icon_gray`, `launcher_icon`, `window_icon`); validate against Overwolf's manifest schema
  - _Requirements: 5.10, 13.5_
- [ ] 5.4 Integrate the Game Events Provider: call `overwolf.games.events.setRequiredFeatures()` for TFT-relevant features (augments, match_info, bench, roster) as early as possible after game launch, per Overwolf's run-order guidance
  - _Requirements: 5.2_
- [ ] 5.5 Implement TFT-vs-League session detection: listen to the LoL Launcher's `lobby_info` info-update and check `queueId` (1090/1100 = TFT, 1130 = Hyper Roll) before activating TFT-specific UI
  - _Requirements: 5.3_
- [ ] 5.6 Build the board/bench/augment-options state parser that turns GEP events into the shared `RecommendationRequest` shape, defaulting `mode` to `"tier2-lookup"`
  - _Requirements: 5.4, 3.7_
- [ ] 5.7 Wire the overlay to call `POST /v1/recommendations` on meaningful state changes (continuous in Tier-3, on-open/refresh only in Tier-2 per §8) and render suggested comps + missing units, respecting `modeServed` in the response to label the UI correctly
  - _Requirements: 5.4, 5.5, 3.7_
- [ ] 5.8 Wire augment-round detection to call `/v1/recommendations` with `augmentOptions` set and render the ranked, qualitative-only advice
  - _Requirements: 5.5, 3.4_
- [ ] 5.9 Build the "waiting for game data" idle state for when GEP hasn't registered yet or reports no data
  - _Requirements: 5.9_
- [ ] 5.10 Implement the show/hide hotkey via Overwolf's Hotkeys API, plus a persistent dock/taskbar window so the app always has a visible presence per Overwolf's public-app requirement
  - _Requirements: 5.6_
- [ ] 5.11 Build the overlay layout to remain legible and fully functional at reduced/second-screen widths; manually test on a secondary monitor setup
  - _Requirements: 5.7_
- [ ] 5.12 Persist overlay position, visibility, and hotkey preferences locally between sessions
  - _Requirements: 5.8_
- [ ] 5.13 Implement shared RSO session between web and the Overwolf app so a user signed in on one isn't asked to link again on the other
  - _Requirements: 7.5_
- [ ] 5.14 Add native OS notification delivery via Overwolf as an additional channel alongside email/web push
  - _Requirements: 9.2_
- [ ] 5.15 Profile idle CPU/RAM usage against Overwolf's documented performance guidelines and optimize the polling/render loop until it's comfortably inside budget
  - _Requirements: 11.7_
- [ ] 5.16 Build and sign the OPK package; re-validate `manifest.json` against Overwolf's schema as a pre-submission gate
  - _Requirements: 13.5_
- [ ] 5.17 Run the internal QA checklist mirroring Overwolf's own DevRel review: hotkey accessibility, multi-resolution testing, second-screen legibility, GEP registration timing under real game sessions
  - _Requirements: 5.6, 5.7, 5.9, 13.5_
- [ ] 5.18 Design review: confirm the app's UI, UX flows, and branding were built independently and don't mirror existing Overwolf TFT apps (MetaTFT, TFTAcademy, Mobalytics companion)
  - _Requirements: 13.4_
- [ ] 5.19 Run the augment-compliance test suite (2.6) specifically against the built Overwolf app's network calls before submission, not just the web app
  - _Requirements: 3.1, 13.6_
- [ ] 5.20 Submit the OPK to Overwolf DevRel QA; iterate on review feedback until approved
  - _Requirements: 13.5_
- [ ] 5.21 Build the streamer/creator-safe overlay display mode: hide account-identifying elements, provide a high-contrast/larger-scale variant for OBS capture legibility
  - _Requirements: 19.1, 19.2_

## Phase 6 — Patch Tracking, Notifications & Social

- [ ] 6.1 Build a patch-notes ingestion job that parses new Riot patch notes into structured balance-change records
  - _Requirements: 8.1_
- [ ] 6.2 Build an AI-drafted "meta impact" summary generator with a required editorial-approval step before publishing
  - _Requirements: 8.2_
- [ ] 6.3 Build meta-shift detection: compare consecutive tier-list snapshots and flag comps that moved more than one tier
  - _Requirements: 8.3_
- [ ] 6.4 Build the Patch History web page with browsable snapshots
  - _Requirements: 8.4_
- [ ] 6.5 Build the notification subscription data model and `GET/PUT /v1/notifications/prefs`
  - _Requirements: 9.1, 9.3, 9.4_
- [ ] 6.6 Implement email delivery (transactional email provider), web push delivery, and Overwolf native notification delivery for: patch summaries, bookmarked-comp tier changes, bookmarked-champion balance changes
  - _Requirements: 9.1, 9.2_
- [ ] 6.7 Build the bookmarking UI on comps and champions, on both web and the Overwolf app
  - _Requirements: 9.1_
- [ ] 6.8 (Optional/social) Build opt-in friends list and a comparison leaderboard using linked accounts
  - _Requirements: 7.1 (reused)_
- [ ] 6.9 Tests: notification preference persistence, unsubscribe-in-one-action flow, patch diff detection accuracy on fixture snapshots
  - _Requirements: 9.4, 8.3_

## Cross-Cutting (ongoing, not a single phase)

- [ ] X.1 Accessibility audit (contrast, keyboard nav, screen reader labeling) on every new web screen before it ships
  - _Requirements: 11.3_
- [ ] X.2 Respect `prefers-reduced-motion` in every new animated component, on both web and the Overwolf app
  - _Requirements: 11.4_
- [ ] X.3 Riot API error-rate and rate-limit-consumption dashboards + alerting, reviewed each time a new ingestion job is added
  - _Requirements: 11.5, 12.2_
- [ ] X.4 Externalize all user-facing strings into a localization-ready format from Phase 1 onward, even though only English ships at launch
  - _Requirements: 11.6_
- [ ] X.5 Weekly data-accuracy spot check comparing computed comp stats against an independent manual recount
  - _Requirements: 1.1 (data integrity)_
- [ ] X.6 Re-run the augment-compliance test suite (2.6) any time a new endpoint, export, or admin tool touches augment data — treat it as a standing CI gate, not a one-time check
  - _Requirements: 3.1_
- [ ] X.7 Re-run the recommendation-timing-compliance test suite (2.13) any time the recommendation engine, overlay state parser, or Lobby Intel Service changes — treat the Tier-2/Tier-3 boundary and the "no live opponent tracking" boundary (R14.3) as standing CI gates, not one-time checks
  - _Requirements: 3.7, 14.3_

---

## Suggested order of operations

Phase 0 → Phase 1 is the MVP that makes the product real (a live-computed tier list beats every static competitor). Start 0.7 (Riot approval, now including the Tier-3 disclosure) and 0.8 (Overwolf whitelisting) immediately — they run in the background for weeks and gate Phase 5, so the later they start, the more they delay the desktop app regardless of how fast you build it. Phases 2–4 are independent of each other and can be reordered or parallelized once Phase 1 is stable — pick based on what you want to demo next. New tasks 3.14 (lobby intel) and 3.15 (post-game coaching) are good candidates to pull forward early in Phase 3 since neither depends on any Riot Tier-3 answer landing first. Phase 5 (Overwolf) has the highest compliance overhead of any phase (Section 5.1's blocking checkpoint exists on purpose, now covering both the whitelisting and the Tier-3 question) but depends only on Phases 1–3, not on Phase 4 or 6 — it can be pulled forward the moment both approvals land, even if the builder or notifications aren't done yet, and it ships in Tier-2 mode regardless of whether Tier-3 gets confirmed in time. Phase 6 is the natural finishing phase once the core product and the Overwolf app both exist.
