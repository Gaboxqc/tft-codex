# TFT Codex — Implementation Tasks

Each task is meant to be small enough to implement and test in one sitting, and to build only on tasks above it — no task requires code that a later task hasn't been written yet. Check off as you go. `_Requirements: ..._` links each task back to `requirements.md`.

**v2 change log:** Phase 7 (mobile) removed. Phase 5 rewritten around Overwolf (`ow-electron` + GEP) instead of a standalone Tauri app. Phase 0 and Phase 2 gained tasks to start the Riot/Overwolf approval process early and to enforce the augment-compliance rule structurally, not just in the UI.

**v3 change log (see `review-and-roadmap.md`):** 0.7 amended to explicitly surface the Tier-3 recommendation-timing question to Riot during approval. New tasks added: 1.15 (web monetization), 2.13 (Tier-2/Tier-3 feature flag), 2.14 (breakpoint reference), 3.14 (pre-game lobby intel), 3.15 (post-game AI coaching narrative), 4.8 (multi-carry itemization optimizer), 5.21 (streamer-safe overlay), X.7 (standing recommendation-timing compliance re-check).

---

## Phase 0 — Foundations

- [x] 0.1 Scaffold a monorepo (Turborepo or Nx) with `apps/web`, `apps/api`, `apps/overwolf`, `packages/shared-types`, `packages/ui`
  - _Requirements: —_
  - _Done: npm workspaces + Turborepo. `apps/api` and `apps/overwolf` are scaffolded in Phase 1 and Phase 5 respectively, when there is code for them._
- [x] 0.2 Configure TypeScript strict mode, ESLint, Prettier, and a GitHub Actions workflow that blocks merge on lint/type/test failure
  - _Requirements: —_
  - _Done: `.github/workflows/ci.yml`. The two Riot compliance suites run as a separate required check so a red PR distinguishes "leaks augment win rates" from "a snapshot drifted"._
- [x] 0.3 Add `docker-compose.yml` for local Postgres + Redis; document setup in root `README.md`
  - _Requirements: —_
  - _Done: also ClickHouse, with an init script creating the restricted `tftcodex_gateway` user that has no grant on `augment_internal_stats` (R3.1's structural layer)._
- [x] 0.4 Apply for a Riot Developer application key; build a `RiotApiClient` wrapper in `packages/riot-client` with a configurable Redis-backed token-bucket rate limiter
  - _Requirements: 12.2_
  - _Done: client + Redis and in-memory limiters with per-lane isolation (live/backfill/lobby/player) so backfill cannot starve the R1.2 refresh SLA. **The key application itself is still yours to file** — see `approvals.md`._
- [x] 0.5 Define shared TypeScript interfaces from `design.md` §4 (`Champion`, `Trait`, `Item`, `Augment`, `Comp`, `PatchVersion`, `LobbyIntelEntry`) in `packages/shared-types`, with unit tests validating example fixtures parse against each type — confirm the `Augment` type has no `winRate`/`avgPlacement` fields as a review checklist item, not just a convention
  - _Requirements: 3.1_
  - _Done: Zod schemas with inferred types. `compliance.ts` owns the single definition of "forbidden field" so the gateway middleware, the component props and the CI suite cannot drift apart._
- [x] 0.6 Write the Riot legal disclaimer component (no Riot logo) and add it to the web app's global footer
  - _Requirements: 12.3_
  - _Done: `packages/ui` also carries the design-system.md tokens and the components whose prop types enforce R3.1/R11.3 structurally._
- [ ] 0.7 **Start now, runs in parallel with everything below:** submit Riot's third-party application approval request via Riot's Developer Portal. **Explicitly describe the Tier-3 adaptive recommendation engine's board-state-reactive behavior (`design.md` §8) in the submission and request written confirmation of its acceptability** — don't submit a generic description and discover the answer at rejection time. Track status; this gates both a production Riot API key and Overwolf publication later, and typically has real review lead time
  - _Requirements: 13.1, 3.7_
  - _**Blocked on you — this is a submission, not code.** `approvals.md` spells out exactly what the application has to say and which two questions it must ask. Nothing in Phases 1–4 waits on it; all of Phase 5 does._
- [ ] 0.8 **Start now, runs in parallel:** submit the Overwolf app idea for whitelisting as a **Public** app, including a public-facing feature description, UI/UX plan, and a monetization plan (even if "no ads at launch"). Overwolf will not grant API access before this is approved
  - _Requirements: 13.2_
  - _**Blocked on you.** Needs one product decision first: Overwolf monetization on or off at launch. See `approvals.md`._

## Phase 1 — Meta Intelligence MVP

- [x] 1.1 Build a seed-player crawler: pull Challenger/Grandmaster/Master league entries via `league-v1`, store seed PUUIDs
  - _Requirements: 1.1, 12.2_
  - _Done: `Crawler.seedPlayers`. One failing tier doesn't abort the seed — a region can genuinely have no Challenger entries early in a set._
- [x] 1.2 Build a match-ID crawler that walks `match-v1` for each seed PUUID and queues new (deduplicated) match IDs
  - _Requirements: 1.1, 12.2_
  - _Done: dedup is `ON CONFLICT DO NOTHING` on `discovered_matches`. Apex players share lobbies, so the same id arrives from up to 8 seeds — this is the biggest single saving on rate-limit budget._
- [x] 1.3 Build a match-detail fetch worker that pulls full match JSON and upserts it into a `raw_matches` Postgres table keyed by `matchId`
  - _Requirements: 1.1_
  - _Done: non-ranked queues and unparseable `game_version`s are skipped permanently rather than re-fetched every cycle._
- [x] 1.4 Write the comp-signature registry schema (core traits + carry → named comp) and seed it manually for the current patch
  - _Requirements: 1.3_
  - _Schema done (`comp_signatures`). **The manual seed is still outstanding** — it needs a live Riot key and knowledge of the current Set's traits/carries, so it's a data task for whoever holds the key, not something to invent._
- [x] 1.5 Build the comp-detection function: given a participant's final board, return the best-matching registered comp ID or `null`
  - _Requirements: 4.2 (reused later), 1.3_
  - _Test: fixture boards with known expected comp assignments_
  - _Done: carries weighted equal to traits so "Vanguard Zoe" and "Vanguard Jinx" don't collapse into each other; ties break toward the more specific signature._
- [x] 1.6 Build the aggregation job: compute per-comp `avgPlacement`, `top4Rate`, `winRate`, `playRate`, `sampleSize` into ClickHouse (or Timescale) from matches ingested since the last run
  - _Requirements: 1.1, 1.2_
  - _Done: writes deltas into SummingMergeTree tables. ClickHouse lands before Postgres marks matches consumed — a crash between the two re-counts a batch rather than silently dropping it. Also rolls up unit and trait stats._
- [x] 1.7 Implement the tier-scoring formula from `design.md` §3 as a pure, unit-tested function; wire it to run after each aggregation pass and publish a versioned tier-list snapshot to Redis
  - _Requirements: 1.3, 1.4_
  - _Done: two-phase publish (write snapshot, then flip pointer) so a mid-write crash leaves the previous list live. Provisional comps sort last regardless of score._
- [x] 1.8 Schedule the crawler + aggregation + scoring pipeline to run on a 30-minute cycle; add a healthcheck metric for "minutes since last successful publish"
  - _Requirements: 1.2, 1.6, 11.5_
  - _Healthcheck done (`GET /v1/meta/health`), jobs are one-shot entry points (`npm run crawl` / `npm run aggregate`). **The 30-minute schedule itself is deployment config** — cron/ECS already handles retries, overlap and alerting better than an in-process timer would._
- [x] 1.9 Build `GET /v1/meta/tier-list` with `patch`, `tier`, `playstyle`, `difficulty` query params, cached at the gateway with TTL matching the refresh cycle
  - _Requirements: 1.7, 11.1_
  - _Done: serves the published snapshot; staleness is computed at read time, not stored._
- [x] 1.10 Build `GET /v1/comps` (search/filter) and `GET /v1/comps/:id` (full detail) endpoints backed by Postgres (comp metadata) joined with the latest ClickHouse stats row
  - _Requirements: 2.1, 2.6_
  - _Done: joined against the published snapshot rather than a fresh ClickHouse query, so comp detail and the tier list can never disagree._
- [x] 1.11 Build the web Tier List page: filter controls, comp cards, patch/refresh timestamp display, stale-data banner
  - _Requirements: 1.5, 1.6, 1.7_
  - _Done: filters live in the URL so a filtered view is shareable and survives reload._
- [x] 1.12 Build the web Comp Detail view: stats, units/items table, formation, augment priority (category labels only), curated augment list, explanation, stage guide
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
- [x] 1.13 Write integration tests for both endpoints covering cache hit/miss and the "provisional" (low sample size) comp state
  - _Requirements: 1.4_
  - _Done: driven through `app.inject()` against the real app assembly, so routing, the compliance hook and cache behaviour under test are the real ones._
- [ ] 1.14 Deploy Phase 1 to a staging environment and manually validate against real current-patch data before enabling public access
  - _Requirements: —_
  - _**Blocked on infrastructure and a Riot key.** Verified locally against a fixture API instead (tier list, filters, comp detail, 404, and the degraded path with the API killed mid-session). That is not a substitute for real current-patch data._
- [ ] 1.15 Stand up web display-ad slots (non-core-content placements only — never inside tier list/comp/augment core UI) and the free/paid tier gate ahead of public launch, per `design-system.md`'s component rules for ad placement
  - _Requirements: 18.1, 18.2, 18.3, 18.4_
  - _**Not started — needs a product decision first:** which ad network, and which features sit behind the paid tier. R18.2's "transformative" standard means the paid tier has to add insight, not just remove friction, so the candidate list (extended history, CSV/JSON export, custom notification rules) is a real choice rather than a default. Deliberately not guessed at._

## Phase 2 — Augment Intelligence & Comp Explanations (Compliance-Gated)

- [x] 2.1 Extend the match ingestion schema to capture each participant's augment picks per game round (internal storage only)
  - _Requirements: 3.1_
  - _Done: the aggregator counts each participant's picks twice — once globally, once scoped to the detected comp, since "good in this comp" is a better recommendation signal than "good overall"._
- [x] 2.2 Extend the aggregation job to compute `AugmentInternalStats` (win rate, avg placement, global and per-comp) into a ClickHouse table with **no gateway route to it** — verify this structurally (integration test that the gateway's DB credentials cannot query the table), not just by convention
  - _Requirements: 3.1_
  - _Table, grants and write path done. `AugmentInternalRepository` requires the admin client and is not reachable from `AppContext`, so no route handler can obtain one._
  - _**The structural integration test this task asks for is NOT written.** It needs a live ClickHouse to assert the gateway user's query genuinely fails, and Docker isn't available in this environment. This is the one place Phase 2 currently rests on configuration being correct rather than proving it. Write it as part of task 1.14's staging work._
- [x] 2.3 Build categorical augment tier scoring (S/A/B/C) from `AugmentInternalStats`, writing only the letter grade + play rate to the public `Augment` record
  - _Requirements: 3.2, 3.3_
  - _Done: `tierAugments` computes scores, ranks with them, and discards them — the caller cannot leak a number it was never handed. Augments use their own weights, not the comp formula: publishing an augment's composite score would be an invertible win rate._
- [x] 2.4 Build `GET /v1/augments/tier-list` and `GET /v1/augments/:id` returning only compliant fields
  - _Requirements: 3.1, 3.2, 3.3_
- [x] 2.5 Add the API gateway response-schema allowlist middleware for `/v1/augments/*`, stripping any field not in the compliant `Augment` type
  - _Requirements: 3.1_
  - _Done as two layers: `toPublicAugment` constructs the response field by field rather than spreading the row, and the `preSerialization` guard scans outbound payloads — throwing in dev/test, stripping and alerting in production._
- [x] 2.6 Write the augment-compliance test suite: asserts `winRate`/`avgPlacement` never appear in any `/v1/augments/*` or `/v1/recommendations` response body; wire it into CI as a release-blocking check on every PR
  - _Requirements: 3.1_
  - _Done, plus two additions the task didn't ask for: a test that no augment *reason string* contains a digit (the field-name scan wouldn't catch a number in prose), and a test that walks Fastify's route table and fails if a route under a guarded prefix has no case in the suite. Verified the latter bites by temporarily adding an uncovered route._
- [x] 2.7 Build the web Augment Explorer page (tier badges + play rate; no numeric win rate or placement anywhere in the UI, including tooltips and CSVs/exports if any)
  - _Requirements: 3.1, 3.2, 3.3_
  - _Done: no exports exist yet, so there is nothing to leak through one. Revisit if R18.2's CSV/JSON export for the paid tier gets built — that is exactly the "if any" this task anticipates._
- [x] 2.8 Implement the v1 recommendation scoring function (`design.md` §8): reads `AugmentInternalStats` server-side, ranks internally, emits a qualitative reason string from a template bank — unit-test that the reason strings never contain a number sourced from placement/win-rate data
  - _Requirements: 3.4_
  - _Done: templates have no numeric placeholder to substitute into, and `reasonFor` throws rather than returning text containing a digit. There is also a test against comparative-to-outcome phrasing, which is a placement claim in prose form._
- [x] 2.9 Build `POST /v1/recommendations` accepting board state and optional augment options, returning `RecommendationResponse`
  - _Requirements: 3.4, 3.5_
  - _Never cached — a cached recommendation keyed by board state would be a stored record of what a player was holding._
- [x] 2.10 Build an in-app "what should I pick" widget on the web comp detail page that calls `/v1/recommendations`, for quick testing before the Overwolf app exists
  - _Requirements: 3.4_
  - _Options are typed by the player; nothing reads or infers game state, so the widget is Tier-1 regardless of how R3.7 is answered._
- [ ] 2.11 Set up an editorial workflow (internal admin route or CMS) for writing/approving each comp's "why it works" explanation, curated augment list, and stage-by-stage guide copy, informed by the aggregated leveling/econ curves
  - _Requirements: 2.2, 2.3, 2.4_
  - _**Not started — needs a product decision:** an internal admin route inside `apps/api` versus an external CMS. The schema already holds every field the workflow would write (`comps.explanation`, `curated_augments`, `stage_guides`), so this is a tooling choice rather than a modelling one._
- [ ] 2.12 Backfill explanations, curated augment lists, and stage guides for all current S/A tier comps before marking Phase 2 complete
  - _Requirements: 2.2, 2.3, 2.4_
  - _**Blocked on 2.11 and on real current-patch data.** This is editorial content about a live meta; writing it without either would be fabrication, not a backfill._
- [x] 2.13 Implement the Tier-2/Tier-3 mode split from `design.md` §8: build Tier-2 ("offered augments only" lookup + snapshot-on-open comp matching) as the default; add the server-side `mode` field handling and the gateway kill switch that downgrades any `tier3-adaptive` request to `tier2-lookup` unless the deployment's Riot-confirmation flag is set. Ship with the flag off
  - _Requirements: 3.4, 3.7_
  - _Done, flag off. The split is enforced by what each function can **read**, not a conditional: `recommendTier2` takes no board-state parameter at all, so it cannot be made reactive by accident. A test asserts a downgraded response differs from a confirmed Tier-3 one — if they matched, the gate would be doing nothing._
  - _`config.ts` also refuses to boot with the flag set but no confirmation reference recorded, so enabling Tier-3 leaves an audit trail rather than being a one-character change._
- [x] 2.14 Build `GET /v1/reference/breakpoints`: a static, patch-sourced XP/gold breakpoint table (not wired to any live player state), and the corresponding web/overlay reference component
  - _Requirements: 17.1, 17.2_
  - _The route accepts no player-state parameter, and a test asserts passing `gold` and `level` changes nothing. The overlay half lands with Phase 5; the shared styles are already in `packages/ui`._

## Phase 3 — Personal Performance Analytics

- [x] 3.1 Implement RSO OAuth start/callback endpoints and secure token/session handling
  - _Requirements: 7.1, 7.2_
  - _PKCE, verifier stored server-side keyed by state, constant-time state comparison, single-use flow rows (`DELETE … RETURNING`). Sessions are verified twice per request — signature, then a database lookup — because a JWT alone cannot be revoked and unlinking has to log you out immediately._
  - _**RSO credentials are not yet issued** (they come with Riot's approval), so linking returns 503 pointing at `approvals.md`. Everything else boots without them._
- [x] 3.2 Build the account-linking UI flow (sign in with Riot button → callback → profile created)
  - _Requirements: 7.1, 7.4_
  - _The sign-in page is a link, not a form. Verified in a browser that it contains zero input elements — the strongest version of "never ask for Riot credentials" is having nowhere to type them._
- [x] 3.3 Build a per-user match-sync job: on link, pull recent ranked match history for the linked PUUID; on a schedule, sync new matches
  - _Requirements: 4.1_
  - _Known match ids are filtered **before** fetching, so a repeat sync costs almost no Riot budget. Runs on the `player` lane, capped below `live`, so a burst of signups cannot starve the R1.2 refresh._
- [x] 3.4 Reuse the Phase 1 comp-detection function to tag each synced match with a `detectedCompId`
  - _Requirements: 4.2_
- [x] 3.5 Build the leveling-curve and gold-curve extraction from match timeline data, stored on `MatchSummary`
  - _Requirements: 4.3_
  - _**Riot's TFT API has no match timeline.** `match-v1` returns final state only — ending level, `gold_left`, `last_round` — and there is no TFT equivalent of League's `match-v5` timeline endpoint. A true per-round curve can only be captured live from Overwolf's GEP, which is Phase 5._
  - _Built instead: one honest data point at the elimination round, tagged `curveSource: "final-state"` so the UI says so rather than drawing a line through a single point. When GEP capture lands it writes `curveSource: "gep-capture"` and every consumer works unchanged. Synthesising intermediate points was rejected — it produces a chart that looks like data and is fiction._
- [x] 3.6 Build `GET /v1/players/me/matches` and `GET /v1/players/me/matches/:matchId`, the latter comparing the user's curves against the comp's top-4 average curve
  - _Requirements: 4.3_
  - _There is deliberately no `/v1/players/:puuid` route — an id in the path is an invitation to forget the ownership check._
- [x] 3.7 Build the improvement-suggestion generator: rule-based comparisons (leveling timing, econ deviation, augment choice vs. recommendation) producing at least one concrete, qualitative suggestion per match — no augment win-rate/placement numbers surfaced here either
  - _Requirements: 4.5, 3.1_
  - _Headlines leveling over econ because leveling is upstream — falling behind on level often causes the gold dip, and pointing at the symptom is how advice becomes useless. Cites the **first** round behind rather than the largest gap, since the first slip is the decision._
- [x] 3.8 Build `GET /v1/players/me/analytics` aggregating average placement by comp/playstyle/carry over a date range
  - _Requirements: 4.4_
  - _By comp and date range. Playstyle/carry breakdowns are a straightforward extension of the same query once there is real data to check them against._
- [x] 3.9 Build the web Match Review screen and Personal Dashboard screen
  - _Requirements: 4.3, 4.4, 4.5_
  - _The review leads with the coaching narrative; the stat view stands alone beneath it because R15.4 lets the narrative be absent entirely._
- [x] 3.10 Implement `GET/DELETE /v1/players/me` including the 30-day hard-delete job for unlinking
  - _Requirements: 7.3, 12.4_
  - _Serving stops and every session is revoked immediately; the purge hard-deletes within 30 days. Every personal table cascades from `player_profiles`, so the retention guarantee is a foreign key rather than a script someone must remember._
- [x] 3.11 Write a privacy-policy page and link it from account settings
  - _Requirements: 12.4_
  - _Every claim on the page is one the schema enforces, and the file comment names each enforcement so it can be checked rather than trusted._
- [ ] 3.12 **Gate, don't skip:** before building any "your placement broken down by augment picked" personal-analytics feature, explicitly re-check it against Riot's approval feedback (R4.7) rather than assuming personal data is exempt from the augment-display restriction — get a written answer, then build or drop it
  - _Requirements: 4.7_
- [x] 3.13 Tests: OAuth flow with mocked RSO responses, match-sync idempotency (re-running sync doesn't duplicate), analytics aggregation correctness against fixture data
  - _Requirements: 4.6_
  - _Route tests issue a genuine signed token against a seeded session, so they exercise the real verification path rather than stubbing authentication out. Includes a test that a validly signed token whose session was revoked is rejected._
- [x] 3.14 Build the Lobby Intel Service (`design.md` §2): one-shot loading-screen lookup of each visible participant's recent match history via Riot API, `GET /v1/lobby/intel`, cached per match, explicitly not refreshed or extended once combat starts. Unit-test that it never fires a second query for the same match
  - _Requirements: 14.1, 14.2, 14.3, 14.4_
  - _`intelFor` has no `refresh`, `force` or `maxAge` parameter — the absence **is** the R14.2 guarantee, and a test asserts the method arity so adding one is a visible change. Another test enumerates which Riot methods were actually called and asserts they are exactly the three historical, public ones (R14.3)._
  - _The service is built; the `GET /v1/lobby/intel` route lands with Phase 5, since the loading-screen participant list comes from GEP and there is no other caller yet._
- [x] 3.15 Build the post-game AI coaching narrative generator (`GET /v1/matches/:matchId/coaching`): natural-language summary built from 3.7's existing signals, citing the specific stage of biggest deviation, with a raw-stats opt-out toggle in the Match Review screen
  - _Requirements: 15.1, 15.2, 15.3, 15.4_
  - _R15.1's 3–5 sentence budget is enforced by construction, not trimmed afterwards. Suggestion messages are two sentences each, so a naive assembly produced six — caught by a test._
  - _R15.4's opt-out is honoured at the API with a 409, not only in the UI: a client ignoring the preference would otherwise still receive the text._

## Phase 4 — Comp Builder / Sandbox

- [ ] 4.1 Build the board editor UI: hex-grid placement (or simplified front/back rows if full hex geometry is deferred), champion picker, item assignment per unit
  - _Requirements: 6.1_
- [x] 4.2 Build live trait-count computation as the board changes, including "one unit away from next breakpoint" highlighting
  - _Requirements: 6.2_
  - _A champion counts once per trait however many copies are on the board, and emblems fall out of the same Set-keyed-by-champion mechanism rather than needing a special case. Sub-breakpoint traits stay in the panel marked inactive — "3 Vanguard, one more unlocks it" is the most useful thing it says._
  - _Analysis requests carry a sequence number and stale responses are discarded, so a slow earlier request cannot land after a fast later one and leave the panel describing a board the player no longer has._
- [x] 4.3 Build `POST /v1/builder/comps` (save) and `GET /v1/builder/comps/:id` (load), with a URL-safe shareable ID
  - _Requirements: 6.3_
  - _12 random bytes, not a serial — a sequential id in a public URL lets anyone walk every board ever saved. Saving works logged out (R7.4); only updating needs a session, and it 404s rather than 403s on someone else's board so the id's existence is not confirmed._
- [x] 4.4 Implement signature matching against the registry so a saved custom board that matches a tracked comp displays that comp's live stats inline
  - _Requirements: 6.4_
  - _Reuses `detectComp` from the ingestion path, so a builder board is matched exactly the way a real match is rather than by a parallel implementation._
- [x] 4.5 Add an "import into builder" action on the Comp Detail page (Phase 1) that pre-fills the board editor
  - _Requirements: 6.5_
- [x] 4.6 Add a rough tankiness/damage estimate heuristic (documented formula, clearly labeled as an estimate, not a simulator)
  - _Requirements: 6.1_
  - _Emits a 0–100 index with a confidence that never reaches "high", ships its formula version, and lists what it ignored. A test asserts the result carries no placement or win-rate field — an estimate, not a forecast dressed up as one._
- [x] 4.7 Component and integration tests for trait counting, save/load round-trip, and signature matching
  - _Requirements: 6.2, 6.3, 6.4_
  - _69 tests across the four areas. The share round-trip was also verified in a browser end to end: import → edit → save → reopen the link._
- [x] 4.8 Build the multi-carry itemization optimizer (`POST /v1/items/optimize`): given held components and board units, suggest an allocation across units with trade-off explanations, as a builder/pre-post-game tool only (Tier-1, no live bench polling)
  - _Requirements: 16.1, 16.2, 16.3_
  - _Greedy by role rather than an optimal assignment, deliberately: an optimum would maximise a board-strength number the player cannot see and does not share our weights, whereas carry-first matches how players actually reason. Every trade-off names both units, why the winner won, and how to overrule it._
  - _Tier-1 by construction — it takes an explicit item list and has no parameter through which a live bench could reach it._

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
