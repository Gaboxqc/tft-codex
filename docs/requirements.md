# TFT Codex — Requirements

## Scope note (read first)

**v2 scope change:** mobile is cut. This spec now targets **web** (the public meta engine, comp explorer, builder, personal analytics) and a **desktop companion published on Overwolf** (in-game overlay for League of Legends/TFT). Requirement 10 and Phase 7 from the mobile-inclusive version are gone; Requirement 5 has been rewritten around Overwolf's platform rather than a standalone Electron/Tauri app, and a new Requirement 13 covers Overwolf- and Riot-specific publishing compliance.

**Important correction from v1:** Riot's TFT developer policy prohibits third-party apps from displaying **Augment win rates, Augment average placements, or Legend win rates** — full stop, on any platform, not just Overwolf. Requirement 3 below has been rewritten to comply. This is not optional or Overwolf-specific; it would block Riot's own third-party app approval regardless of where the app is distributed.

**v3 addendum (see `review-and-roadmap.md`):** Riot's developer policy also restricts _real-time, board-state-reactive prescriptive recommendations_ and opponent/lobby scouting more broadly than just the augment-numbers rule above — this is a separate, previously-unaddressed constraint on Requirement 3's recommendation engine and Requirement 5's overlay. Requirement 3.7 below gates the highest-risk part of the recommendation engine behind explicit Riot confirmation. Requirements 14–19 are new, added by that review: pre-game lobby intel, post-game AI coaching, an itemization optimizer, a breakpoint reference, web monetization (previously unaddressed — only the Overwolf build had a monetization plan), and a streamer-safe overlay mode. A companion `design-system.md` also now exists alongside `design.md`, covering the visual/UI system (color, type, components) that `design.md` intentionally left to architecture only.

All data claims (tier lists, win rates, augment stats) are computed from real match data pulled via the official Riot Games TFT API. No requirement in this document permits scraping third-party sites — see Requirement 12.

---

## Glossary

| Term            | Meaning                                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comp            | A team composition — a target set of champions, traits, and items players build toward                                                                                              |
| Trait / Synergy | A bonus unlocked by playing enough champions that share an origin or class                                                                                                          |
| Augment         | A powerful modifier chosen at fixed rounds (2-1, 3-2, 4-2) that shapes a game plan                                                                                                  |
| Legend          | A pregame customization pick used in some TFT sets that grants passive bonuses and shapes available augments — subject to the same Riot display restrictions as augments            |
| Econ            | Gold economy — interest, win/loss streaks, and spending discipline                                                                                                                  |
| Reroll          | A playstyle that spends gold at a fixed level to buy copies of cheap units to 3-star them                                                                                           |
| Fast 8/9        | A playstyle that prioritizes leveling over rerolling to reach 8/9-cost-unit access early                                                                                            |
| Positioning     | Where units are placed on the hex board, split into front line (tanks) and back line (carries)                                                                                      |
| PUUID           | Riot's permanent, region-agnostic player identifier used across their APIs                                                                                                          |
| RSO             | Riot Sign-On — Riot's OAuth service for linking a player's Riot account to a third-party app                                                                                        |
| GEP             | Overwolf's Game Events Provider — the sanctioned real-time API Overwolf apps use to read in-game state, including TFT-specific data (augment picks, bench items, round/stage state) |
| OPK             | Overwolf's app installation package format (a signed zip) used to submit and distribute an Overwolf app                                                                             |
| Patch           | A versioned game update; TFT patches roughly every two weeks and rotates to a new "Set" every ~4 months                                                                             |

## Personas

- **The Climber** — ranked grinder, wants the fastest path up the ladder, cares about live in-game guidance and precise econ/leveling math.
- **The Casual** — plays for fun, wants plain-English explanations, gets overwhelmed by raw stat tables.
- **The Analyst** — coaches/streamers/theorycrafters who want deep stats, exportable data, and a sandbox to test ideas.
- **The New Player** — doesn't know the vocabulary yet, needs the app to teach fundamentals alongside the current meta.

---

## Requirement 1 — Live Meta Intelligence Engine

**User Story:** As a player, I want an always-current, data-backed tier list of comps, units, and traits, so that I can trust the rankings reflect what's actually winning right now rather than a stale or hand-picked list.

**Acceptance Criteria**

1.1 THE SYSTEM SHALL compute comp, unit, trait, and item statistics (play rate, average placement, top-4 rate, win rate) from real ranked match data ingested via the Riot TFT API.

1.2 WHEN new match data has been ingested for the current patch, THE SYSTEM SHALL recompute tier-list rankings on a fixed schedule not exceeding 30 minutes.

1.3 THE SYSTEM SHALL assign each tracked comp a tier (S/A/B/C) derived from a documented composite score (a weighted function of average placement, top-4 rate, and play rate), not an editorially assigned label.

1.4 IF fewer than a configured minimum sample size of games exists for a comp on the current patch, THEN THE SYSTEM SHALL mark it "provisional" rather than assigning a confident tier.

1.5 WHEN a user views the tier list, THE SYSTEM SHALL display the patch version and the timestamp of the last successful data refresh.

1.6 IF the data pipeline has not refreshed successfully within 2x its normal interval, THEN THE SYSTEM SHALL display a stale-data warning banner while continuing to serve the last known-good data.

1.7 THE SYSTEM SHALL allow filtering the tier list by tier, playstyle (Reroll / Fast 8 / Fast 9 / Slow Roll / Standard), and difficulty.

1.8 WHEN the active game Set rotates, THE SYSTEM SHALL retain and clearly archive the prior Set's data rather than deleting it.

_Note: this requirement covers comps, units, traits, and items — none of which are named in Riot's display restriction (Requirement 3). Only Augments and Legends are restricted._

## Requirement 2 — Comp Explorer & Guides

**User Story:** As a player, I want a detailed breakdown of any comp, so that I understand not just what to build but why it works and how to pilot it stage by stage.

**Acceptance Criteria**

2.1 WHEN a user opens a comp detail view, THE SYSTEM SHALL display: core traits, carry(s), full unit list with role (carry/tank/support) and recommended items, a front-line/back-line formation guide, and computed stats (avg placement, top-4 rate, win rate, play rate).

2.2 THE SYSTEM SHALL display a plain-language explanation of why the comp's synergy works, distinct from its raw stat block.

2.3 THE SYSTEM SHALL display a stage-by-stage game plan (early game, mid game, rolldown/late game) generated from aggregated leveling and econ curves of top-4 games that ran the comp.

2.4 THE SYSTEM SHALL display the comp's ideal augment priority order (by category, e.g. "Items > Combat > Econ") and a curated list of augments that suit it well.

2.5 THE SYSTEM SHALL display flexible/alternate unit slots the comp can run when core units are contested.

2.6 WHEN a user searches or filters comps by carry, trait, or name, THE SYSTEM SHALL return matching results in under 300ms for cached queries.

_Note: 2.4 intentionally says "curated list," not a ranked-by-win-rate list — see Requirement 3 for why augment rankings can't be presented as a stat-backed tier list._

## Requirement 3 — Augment Intelligence (Riot-Compliant)

**User Story:** As a player mid-game, I want good guidance on which augment to pick, so that I'm not flying blind — without the app doing the one thing Riot has explicitly barred third-party tools from doing.

**Acceptance Criteria**

3.1 THE SYSTEM SHALL NOT display, compute-and-expose, export, or otherwise surface to any user: augment win rates, augment average game placements, or Legend win rates, in any client (web, desktop, or API response), regardless of whether the underlying data was computed internally.

3.2 THE SYSTEM SHALL display a categorical augment tier (S/A/B/C) and/or a qualitative recommendation, sourced from the same composite scoring approach as Requirement 1.3, without exposing the underlying win-rate or placement figures that fed it.

3.3 THE SYSTEM SHALL be permitted to display augment **play rate** (pick frequency), since Riot's restriction names only win rate and average placement.

3.4 WHEN a user (via web input or the Overwolf overlay, Requirement 5) provides their current board state and the three augment options offered, THE SYSTEM SHALL return a ranked recommendation with a one-line qualitative reason for each option (e.g., "fits your Vanguard front line"), never a numeric win-rate or placement justification. This SHALL operate in the mode gated by 3.7.

3.5 IF the recommendation engine has insufficient contextual data for a given board/augment pairing, THEN THE SYSTEM SHALL fall back to the categorical global augment tier and indicate that the recommendation is not context-aware.

3.6 THE SYSTEM SHALL apply 3.1–3.5 identically to Legends if/when that mechanic is active in the current Set, without requiring a code change to re-enable compliance.

3.7 THE SYSTEM SHALL implement the recommendation engine (3.4, and Requirement 5's overlay guidance) with two selectable modes, gated by a feature flag: **Tier-2 (default/safe)** ranks only the augment options actually offered this round against the static, precomputed categorical tier list from 3.2 — a lookup, not a function of the player's live board state; **Tier-3 (adaptive)** additionally reads the player's live board/bench/gold to tailor the ranking and match closest comps in real time. IF Riot's third-party approval process (Requirement 13.1) has not explicitly confirmed that board-state-reactive, real-time recommendations are acceptable for this app, THEN THE SYSTEM SHALL run in Tier-2 mode only. Tier-3 SHALL NOT be enabled for any public build without that written confirmation on file. _Rationale: Riot's TFT developer policy separately restricts apps whose "recommendations adjust in real time based on the player's actions in game and give direct prescriptions of what to do" and apps that "make suggestions based on the player's current game state" — a broader rule than the augment-numbers restriction in 3.1–3.6, and one this spec did not originally account for. See `review-and-roadmap.md` §1 for the full policy citations and rationale._

## Requirement 4 — Personal Performance Analytics

**User Story:** As a returning player, I want to see how I actually perform — not just how the meta performs — so that I know what to change.

**Acceptance Criteria**

4.1 WHEN a user links their Riot account (Requirement 7), THE SYSTEM SHALL import their recent ranked TFT match history.

4.2 THE SYSTEM SHALL detect which tracked comp (if any) each of the user's matches most closely matches, based on final-board trait and unit composition.

4.3 WHEN a user opens a completed match's review, THE SYSTEM SHALL display their placement, detected comp, leveling curve, and econ curve, each compared against the average curve of top-4 finishers who played the same comp.

4.4 THE SYSTEM SHALL display a personal dashboard summarizing average placement by comp, by playstyle, and by carry, across a selectable date range.

4.5 THE SYSTEM SHALL surface at least one specific, actionable improvement suggestion per reviewed match (e.g., "you leveled to 8 two turns later than top-4 finishers in this comp").

4.6 THE SYSTEM SHALL NOT display or infer any data about other, non-consenting players beyond what Riot's API already exposes as public match participant data.

4.7 IF a personal analytics feature would surface a user's own placement broken down by augment picked, THEN THE SYSTEM SHALL treat this as in scope for Riot's third-party approval review rather than assuming personal (as opposed to aggregate/public) augment-placement data is automatically exempt — confirm explicitly during the Requirement 13 approval process before building it.

## Requirement 5 — Overwolf Desktop Companion (In-Game Overlay)

**User Story:** As a player mid-game, I want in-game guidance without alt-tabbing, delivered through the platform (Overwolf) players already trust and have installed for other League/TFT tools.

**Acceptance Criteria**

5.1 THE SYSTEM SHALL be built as an Overwolf app (Overwolf Electron/`ow-electron`, see `design.md` §6) rather than a standalone desktop shell, so it can be distributed through the Overwolf App Store.

5.2 THE SYSTEM SHALL read live game state exclusively through Overwolf's Game Events Provider (`overwolf.games.events`) for League of Legends/TFT — not through any unsanctioned memory-reading, network-interception, or injection technique.

5.3 WHEN the app detects the local player has entered a TFT match (queueID 1090, 1100, or 1130, distinguished from standard League queues per the LoL Launcher's `lobby_info`), THE SYSTEM SHALL activate TFT-specific overlay features; WHEN the detected queue is a standard League of Legends match, THE SYSTEM SHALL NOT activate TFT features.

5.4 WHEN the local player's board/bench/augment state changes (via GEP `new-game-event` / info updates) **and Requirement 3.7's Tier-3 mode is enabled**, THE SYSTEM SHALL update overlay suggestions within 2 seconds. WHILE running in Tier-2 mode (3.7 default), overlay suggestions SHALL update only in response to newly offered augment options or explicit user interaction, not continuous board/bench polling.

5.5 THE SYSTEM SHALL display, at minimum: the closest matching tracked comp(s) to the player's current board, missing pieces for the top suggestion, and — fully subject to Requirement 3 — qualitative augment guidance when an augment choice is detected. In Tier-2 mode, "closest matching comp" SHALL be computed from the augment/board state at the moment the panel is opened or refreshed by the user, not continuously.

5.6 THE SYSTEM SHALL provide a visible, always-accessible hotkey (configurable via Overwolf's Hotkeys API) to show/hide the overlay, and SHALL keep at least one app window visibly indicating the app is running, per Overwolf's public-app requirement.

5.7 THE SYSTEM SHALL support "second screen" usage — remaining fully usable and legible when the game runs on a primary display and the app window is moved to a secondary display.

5.8 THE SYSTEM SHALL persist the user's overlay position, visibility, and hotkey preferences between sessions.

5.9 IF the Game Events Provider reports an error or no data (e.g., GEP not yet registered after game launch), THEN THE SYSTEM SHALL show a clear "waiting for game data" state rather than a blank or broken UI.

5.10 THE SYSTEM SHALL declare only the Overwolf manifest permissions it actually uses (e.g., `GameInfo`, `Hotkeys`), and SHALL NOT request permissions unrelated to its function.

## Requirement 6 — Comp Builder / Sandbox

**User Story:** As a theorycrafter, I want to build and share my own comp ideas, so that I'm not limited to only what the tier list already tracks.

**Acceptance Criteria**

6.1 THE SYSTEM SHALL provide an interactive board editor where a user can place up to the current max board size of champions and assign items per unit.

6.2 WHILE a user edits the board, THE SYSTEM SHALL live-update the active trait counts and highlight traits that are one unit away from the next breakpoint.

6.3 THE SYSTEM SHALL let a user save a custom comp to their account and generate a shareable link that reconstructs the exact board when opened.

6.4 WHEN a saved custom comp's trait/unit signature matches a tracked meta comp, THE SYSTEM SHALL surface that comp's live stats for comparison.

6.5 THE SYSTEM SHALL let a user import any tracked meta comp into the builder as an editable starting point.

## Requirement 7 — Account Linking & Profiles

**User Story:** As a player, I want to link my Riot account securely, so that the app can personalize itself without me manually entering data.

**Acceptance Criteria**

7.1 THE SYSTEM SHALL authenticate account linking exclusively via Riot Sign-On (RSO) OAuth; THE SYSTEM SHALL NOT ask users to enter their Riot credentials directly.

7.2 WHEN a user completes RSO linking, THE SYSTEM SHALL store only their PUUID, region, and summoner/Riot ID display name — no password or unrelated PII.

7.3 THE SYSTEM SHALL let a user unlink their account at any time, which SHALL delete all personally identifying data and derived personal analytics within 30 days.

7.4 THE SYSTEM SHALL function in a fully useful, unauthenticated mode (tier list, comp explorer, augment intelligence, builder) without requiring account linking, on both web and the Overwolf app.

7.5 THE SYSTEM SHALL share the same RSO-linked identity between web and the Overwolf app when a user is signed into both, avoiding duplicate linking flows.

## Requirement 8 — Patch & Meta-Shift Tracking

**User Story:** As a player, I want to know what changed and how it affects the meta, so that I don't waste games playing a comp that just got nerfed.

**Acceptance Criteria**

8.1 WHEN Riot publishes new patch notes, THE SYSTEM SHALL ingest them and associate balance changes with the affected champions/traits/items/augments in its data model.

8.2 THE SYSTEM SHALL generate a plain-language "what this means for the meta" summary per patch, flagged for human editorial review before publishing.

8.3 WHEN a tracked comp's tier changes by more than one full tier between two consecutive computed rankings, THE SYSTEM SHALL flag it as a "meta shift" on the tier list view.

8.4 THE SYSTEM SHALL maintain a browsable patch history showing tier-list snapshots over time.

## Requirement 9 — Notifications & Alerts

**User Story:** As an engaged player, I want to be notified of changes I care about, so that I don't have to keep checking manually.

**Acceptance Criteria**

9.1 THE SYSTEM SHALL let a user subscribe to notifications for: new patch summaries, tier changes for comps they've bookmarked, and balance changes to champions they've bookmarked.

9.2 THE SYSTEM SHALL support web push and email as notification channels, configurable independently; THE SYSTEM SHALL support native OS notifications from the Overwolf app as an additional channel.

9.3 WHERE a user has not enabled any notification channel, THE SYSTEM SHALL NOT send notifications.

9.4 THE SYSTEM SHALL let a user unsubscribe from any notification category in one action, without requiring account deletion.

## Requirement 10 — Cross-Platform Consistency (Web + Desktop)

**User Story:** As a player, I want the web app and the desktop overlay to feel like the same product, so that switching between them doesn't cost me anything mentally.

**Acceptance Criteria**

10.1 THE SYSTEM SHALL provide a responsive web app usable on desktop and mobile browsers for all read-only features (tier list, comp explorer, augment intelligence, builder).

10.2 THE SYSTEM SHALL share design tokens and core TypeScript data types between the web app and the Overwolf app to prevent visual and data drift. Design tokens SHALL conform to `design-system.md`.

10.3 THE SYSTEM SHALL share the same backend API between web and the Overwolf app — the Overwolf app SHALL NOT maintain a separate data pipeline or duplicate business logic.

_(No native mobile app is in scope for this version — see the README for what to add back if that changes.)_

## Requirement 11 — Non-Functional Requirements

**Acceptance Criteria**

11.1 THE SYSTEM SHALL serve cached read endpoints (tier list, comp detail, augment list) with p95 latency under 300ms.

11.2 THE SYSTEM SHALL remain available and browsable in a degraded (last-cached-data) mode if the data ingestion pipeline or Riot API is down.

11.3 THE SYSTEM SHALL meet WCAG 2.1 AA contrast and keyboard-navigation standards on all web screens, and reasonable equivalent legibility/contrast standards on the Overwolf overlay given its constrained, semi-transparent context. Color tokens SHALL be verified against `design-system.md`'s contrast calculations before use.

11.4 THE SYSTEM SHALL respect the operating system's reduced-motion preference, disabling non-essential animation when set, on both web and the Overwolf app.

11.5 THE SYSTEM SHALL log and monitor Riot API error rates and rate-limit consumption, alerting engineers before hitting hard limits.

11.6 THE SYSTEM SHALL support English at launch with a localization architecture (externalized strings) that does not require re-engineering to add languages later.

11.7 THE SYSTEM SHALL keep the Overwolf app's idle CPU and memory footprint within Overwolf's documented performance guidelines, since it runs concurrently with the game.

## Requirement 12 — Compliance & Legal (General)

**Acceptance Criteria**

12.1 THE SYSTEM SHALL source all statistical data from the official Riot Games TFT API under a valid, approved developer application; THE SYSTEM SHALL NOT scrape or automate access to third-party community sites.

12.2 THE SYSTEM SHALL implement request queuing and backoff that keeps API usage within Riot's published rate limits for the app's assigned key tier at all times.

12.3 THE SYSTEM SHALL display Riot Games' required legal disclaimer ("TFT Codex isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games...") on every client, including the Overwolf app, and SHALL NOT use Riot's official logo.

12.4 THE SYSTEM SHALL provide a privacy policy covering what player data is collected, why, and how to request deletion, consistent with GDPR/CCPA data-subject rights.

## Requirement 13 — Overwolf & Riot Publishing Compliance

**User Story:** As the team building this, we want publishing on Overwolf to be a planned, compliant path rather than a surprise rejection at submission time.

**Acceptance Criteria**

13.1 THE SYSTEM'S development process SHALL include applying for Riot's third-party application approval through Riot's Developer Portal before the Overwolf app is submitted for Overwolf's own review — this SHALL be started as early as practical, in parallel with web development, given typical review lead times. The application materials SHALL explicitly describe the recommendation engine's board-state-reactive behavior (Requirement 3.7) and request written confirmation of its acceptability, rather than submitting a generic description and discovering the answer at rejection time.

13.2 THE SYSTEM'S Overwolf app idea SHALL be submitted for Overwolf whitelisting as a **Public** app (not Private), including a public-facing feature description, UI/UX plan, and monetization plan, before feature development on the Overwolf app begins — Overwolf does not approve private/faceless apps for API access.

13.3 THE SYSTEM SHALL, if monetized on Overwolf, use exclusively Overwolf's own advertising SDK and/or Overwolf Subscriptions — THE SYSTEM SHALL NOT integrate any third-party monetization (ads, payments) into the Overwolf-distributed build. This constraint does not apply to the separately-distributed web app (see Requirement 18 for web's own monetization plan).

13.4 THE SYSTEM SHALL build and design its own UI, branding, and feature set independently — SHALL NOT copy the functionality, UI/UX, or branding of existing Overwolf TFT apps (e.g., the official MetaTFT, TFTAcademy, or Mobalytics companion apps already on Overwolf).

13.5 THE SYSTEM SHALL package releases as a signed OPK conforming to Overwolf's manifest schema, and SHALL pass Overwolf DevRel QA review (including hotkey accessibility, multi-resolution testing, and second-screen support per Requirement 5.7) before each public release.

13.6 THE SYSTEM SHALL treat Requirement 3 (augment/Legend display restrictions, including the real-time-recommendation gating in 3.7) as a Riot approval blocker, not a nice-to-have — the Overwolf submission SHALL NOT proceed with any unresolved violation of 3.1, and SHALL NOT enable Tier-3 adaptive recommendations (3.7) without written Riot confirmation on file.

## Requirement 14 — Pre-Game Lobby Intel

**User Story:** As a player at the loading screen, I want a quick read on my lobby before the round starts, so I can gauge how contested my plan is without the app tracking anyone live.

**Acceptance Criteria**

14.1 WHEN a match's loading screen is detected, THE SYSTEM SHALL look up each visible lobby participant's recent ranked match history via the Riot API (public participant data, already visible via their Riot ID) and display: average placement (last N games), most-played comps/carries, and current rank tier.

14.2 THE SYSTEM SHALL compute this data once, before combat starts, and SHALL NOT continue polling or updating it based on in-match board state or actions — consistent with the "static data available prior to the game" carve-out in Riot's developer policy.

14.3 THE SYSTEM SHALL NOT display, infer, or track what an opponent is doing on their board during the live match at any point after the 14.1 lookup.

14.4 THE SYSTEM SHALL cache lobby intel locally so re-showing it (e.g., after toggling the overlay) doesn't re-query the API.

## Requirement 15 — Post-Game AI Coaching Narrative

**User Story:** As a player who just finished a match, I want a plain-language explanation of what actually went wrong or right, not just a curve chart, so I know what to change next game.

**Acceptance Criteria**

15.1 THE SYSTEM SHALL generate a short natural-language post-game summary (3-5 sentences) per match, built from the same underlying signals as Requirement 4.5 (leveling timing, econ deviation, augment-vs-recommendation delta, itemization completeness) rather than raw numbers alone.

15.2 THE SYSTEM SHALL cite the specific round/stage where the biggest deviation from the top-4 baseline occurred (e.g., "Your econ dropped to 4 gold at 3-2 chasing a 2-star upgrade that didn't hit — that's the turn your placement likely started slipping").

15.3 THE SYSTEM SHALL generate this narrative entirely post-game (after the match ends), keeping it unambiguously in the "post-game analysis" category Riot's developer policy explicitly encourages, never mid-game.

15.4 THE SYSTEM SHALL let users opt out of AI-generated narrative text in favor of the raw stat view (Requirement 4.3/4.4) for users who prefer numbers.

## Requirement 16 — Multi-Carry Itemization Optimizer

**User Story:** As a player mid-draft, I want to know the best way to split my item components across my whole board, not just the "ideal" build for one unit in isolation, so I don't waste components on a carry that won't get there.

**Acceptance Criteria**

16.1 THE SYSTEM SHALL accept a set of held item components/completed items and a set of board units (via the builder, Requirement 6, and/or the pre-game/post-game analysis flows) and return a suggested allocation across units, not just a per-unit ideal list.

16.2 THE SYSTEM SHALL explain trade-offs when components are contested between two units (e.g., "Guinsoo's is better on your Jinx than your Kai'Sa this game because Jinx has higher attack speed scaling at her current star level").

16.3 Consistent with Requirement 3.7, THE SYSTEM SHALL run this as a pre-game/builder/post-game tool first (Tier-1, definitely compliant); a live in-overlay version that reacts to the player's bench in real time SHALL be treated as Tier-3 and gated identically to Requirement 3.7.

## Requirement 17 — Leveling & Econ Breakpoint Reference

**User Story:** As a player deciding whether to level or roll, I want a quick reference for common breakpoints, so I can make the call myself instead of guessing.

**Acceptance Criteria**

17.1 THE SYSTEM SHALL provide a static reference (web and overlay) showing standard XP/gold breakpoints for reaching key levels (e.g., "50 gold + no losses reaches level 8 by 4-1") sourced from patch-level game constants, not from the player's live game state.

17.2 THE SYSTEM SHALL keep this reference static/lookup-only per the Tier-1/Tier-2 compliance boundary defined in Requirement 3.7 — it is a chart, not a live calculator wired to the player's current gold total.

## Requirement 18 — Web Monetization

**User Story:** As the team building this, we want the web app to be financially sustainable on its own, independent of whatever monetization the Overwolf build ends up using.

**Acceptance Criteria**

18.1 THE SYSTEM SHALL support a free tier of the web app funded by standard display advertising (e.g., a third-party ad network), consistent with Riot's general monetization policy requirement that any paid tier have a free option that may include advertising.

18.2 THE SYSTEM MAY offer an optional paid tier ("TFT Codex Plus" or similar) removing ads and unlocking features that are genuinely additive per Riot's monetization policy's "transformative" standard (new insight, not just less friction) — candidates include extended personal match history retention, CSV/JSON export for the Analyst persona, custom notification rules, and early access to new comp signatures before public tier assignment.

18.3 THE SYSTEM SHALL NOT gate any Requirement 1–3 core functionality (tier list, comp explorer, augment intelligence) behind payment — ads-supported free access to all core features stays intact, consistent with Requirement 7.4.

18.4 THE SYSTEM SHALL keep web display advertising and Overwolf monetization (Requirement 13.3) as two separate, non-overlapping revenue tracks with different SDKs and different rules — web ad placements SHALL NOT appear inside the Overwolf-distributed build.

## Requirement 19 — Creator/Streamer-Safe Overlay Mode

**User Story:** As a streamer or content creator (part of the Analyst persona), I want a clean overlay mode safe to show on stream, so I don't have to hide the app or leak account info on camera.

**Acceptance Criteria**

19.1 THE SYSTEM SHALL provide an overlay display mode that hides account-identifying elements (linked Riot ID, personal analytics) while keeping tier list/comp/augment reference panels visible.

19.2 THE SYSTEM SHALL provide a high-contrast, larger-scale overlay variant suitable for OBS/stream capture legibility, building on the second-screen-legible layout already required by Requirement 5.7.
