# TFT Codex — Review & Roadmap Addendum

Companion to `requirements.md`, `design.md`, and `tasks.md`. This document does not replace them — it flags one blocking issue found during review, then proposes prioritized, high-value additions to make TFT Codex the strongest TFT companion on the market. New requirement IDs continue the existing numbering (R14+) so they can be appended to `requirements.md` without renumbering anything.

---

## 0. Bottom line

The existing spec is unusually solid — the augment win-rate compliance design (§7, R3) is genuinely well-built, the architecture is sound, and the phasing is sane. But research for this review turned up a **second, broader Riot policy that the spec doesn't address**, and it directly affects the flagship feature you want (live comp suggestions that react to the augments you're holding). Read §1 before building Phase 5. Everything after that is feature and design upside.

---

## 1. Critical finding: Riot's "real-time dynamic recommendation" policy (read before Phase 5)

`requirements.md` R3 and `design.md` §7 correctly handle Riot's ban on displaying **augment/Legend win rates and placements**. That's necessary but it's not the only restriction. Riot's official TFT Developer Policy (support-developer.riotgames.com, TFT article, last updated March 2025) contains a second, broader rule the current spec never mentions:

> "Apps that provide dynamic, real-time information" and "Apps that dictate player decisions" are listed as **Unapproved Use Cases**, full stop.
>
> "Having a static recommendation for a player pre-game is acceptable, even if that same recommendation is available to you the entire game. **Issues arise when the recommendations adjust in real time based on the player's actions in game and give direct prescriptions of what to do.**"
>
> "An app cannot make suggestions based on the player's current game state as that information is dynamic and not readily available prior to the game start."
>
> "Apps and overlays during the game may not include any real-time data that would improve a player's performance immediately by altering player behavior, such as 'go here now' — versus altering it upon reflection, learning and coaching the player game over game."
>
> "Apps and overlays during gameplay (including the loading screen) may not track your opponent's champions/plays or predict their next plays. This includes aggregate stats for both individual players and the lobby." Scouting opponents' boards is explicitly listed as an **Unapproved Use Case**.

**Why this matters for this spec specifically:** R3.4, R5.4, R5.5, and design.md §8's recommendation engine all describe a system that reads your live board/bench/gold, matches it against the closest comp, and pushes a ranked, prescriptive suggestion within a 2-second SLA whenever your state changes. That is close to a textbook example of what the policy calls out — reactive, board-state-driven, prescriptive, real-time. As written, this is the highest compliance-risk part of the whole product, more so than the augment-numbers issue the spec already solved.

**Why MetaTFT/Blitz/Mobalytics seem to do this anyway:** they do ship live overlays, but not identically. Mobalytics' own reviewers describe its in-game guidance as "closer to a reference card... less focused on what you specifically should do with the board and gold you have right now" — that phrasing looks like a deliberate design choice to stay on the compliant side of this exact rule. Blitz and MetaTFT surface an **augment tier list filtered to the 3 options you were offered** (informational lookup against precomputed, patch-level data) rather than a board-reactive prescription engine. Established partners may also have more enforcement latitude than a brand-new submission would get. Don't assume feature parity with them is automatically safe for a first-time applicant.

**Recommended fix — ship in compliance tiers, not one monolithic engine:**

| Tier                                               | Feature shape                                                                                                                                                                                                                                                                    | Risk                                                      | Status                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Definitely compliant                           | Pre-game tier lists, comp guides, static augment-tier reference panel pinned in the overlay (doesn't react to your board), pre-game lobby intel (see R14 below), post-game coaching (Riot's policy explicitly _encourages_ this: "post-game analysis are great spaces for this") | None                                                      | Build first, ship as launch value                                                                                                                                                                                                                                                                                                         |
| 2 — Industry-standard, moderate risk               | Filtering the static augment tier list down to the 3 options actually offered this round (a lookup, not a board-reactive judgment); a static leveling/econ breakpoint reference chart                                                                                            | Low, matches observed competitor practice                 | Build in Phase 2, keep the "reason" purely a lookup against precomputed data, never a function of your board                                                                                                                                                                                                                              |
| 3 — Your flagship ask, highest value, highest risk | Comp suggestions and augment advice that read your live board/bench/gold and adapt in real time (current R3.4, R5.4, R5.5)                                                                                                                                                       | Real — this is the exact language Riot's policy calls out | **Gate behind explicit written confirmation from Riot during the R13.1 approval application, the same way R4.7 already gates personal augment-placement analytics. Don't build Phase 5's adaptive engine until that answer comes back.** Build a Tier-2 fallback (static reference overlay) so Phase 5 isn't blocked if the answer is no. |

**Action items to fold into the existing docs:**

- Extend task **0.7** (Riot third-party approval submission) to explicitly describe the board-reactive recommendation engine in the application materials and request written confirmation, not a generic submission. This is cheap — it's the same submission, just with the real question asked up front instead of discovered at rejection time.
- Add a new acceptance criterion to R3 (or a new R3.7): _"IF Riot's approval process does not explicitly confirm board-state-reactive recommendations are acceptable, THEN the recommendation engine SHALL operate in Tier-2 lookup mode (static data filtered by offered options only) rather than Tier-3 adaptive mode."_
- Update design.md §8 to describe both modes and a feature flag between them, so the engineering work for Tier 2 isn't wasted if Tier 3 is approved later — it becomes the fallback path, not throwaway code.
- This is exactly the kind of thing worth a two-line email to Riot's Developer Relations Discord/portal before Phase 5 starts — it already sits on your critical path per the README, so the timing works out.

---

## 2. Competitive snapshot

| Feature area                                                                  | MetaTFT                | Mobalytics                   | Blitz.gg                  | TFT Codex (current spec)                                                             | Gap/opportunity                                               |
| ----------------------------------------------------------------------------- | ---------------------- | ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Computed tier list                                                            | Yes                    | Yes                          | Yes                       | Yes — and yours is the only one with a _published, versioned scoring formula_ (R1.3) | Lean into "show your work" as a trust differentiator          |
| In-overlay augment tier reference                                             | Yes                    | Partial                      | Yes                       | Planned (R3.2/3.3)                                                                   | Table stakes — must ship                                      |
| Board-reactive comp suggestions                                               | Yes (claimed)          | Deliberately softened        | Partial                   | Planned, but see §1                                                                  | Ship Tier 1/2 first; Tier 3 pending Riot confirmation         |
| Live leveling/econ breakpoint helper                                          | Partial                | No                           | Yes                       | Not in current spec                                                                  | Add — see R17                                                 |
| Pre-game lobby intel (opponent history)                                       | Yes ("lobby scouting") | No                           | Yes ("opponent tracking") | Not in current spec                                                                  | Add — see R14, and it's the _compliant_ version of "scouting" |
| Post-game coaching narrative                                                  | Basic                  | Basic                        | Basic                     | R4.5 has one suggestion per match; competitors don't go much further here            | **Real differentiation opportunity** — see R15                |
| Multi-unit itemization optimizer (bench-aware, not just per-unit ideal items) | No                     | No                           | No                        | Not in current spec                                                                  | **Real differentiation opportunity** — see R16                |
| Documented, versioned tier formula                                            | No                     | No                           | No                        | Yes (R1.3)                                                                           | Already a differentiator — market it                          |
| Comp builder/sandbox                                                          | Basic                  | Yes (Team Builder)           | Basic                     | Yes (R6), plus tankiness/damage estimate (4.6) which none of them have               | Keep and market the damage estimate                           |
| Web monetization plan                                                         | N/A (desktop-first)    | Freemium ("Mobalytics Plus") | Ad-supported              | **Not addressed anywhere in the current spec**                                       | Add — see §4                                                  |
| Design system / cyan-first modern UI                                          | Generic                | Generic                      | Generic                   | Not yet specified                                                                    | Real, easy differentiation — see `design-system.md`           |

Net read: the tier list, augment reference, and basic comp suggestions are table stakes — every competitor has them, so parity there is necessary but won't win anyone over. The two areas where you can genuinely out-value the market are **post-game coaching depth** and **item optimization across the whole bench**, neither of which any competitor does well today. Pre-game lobby intel is a "must match" feature that's also fully compliant. Design quality is a cheap, real differentiator because every competitor's UI is dated and cluttered.

---

## 3. New high-value features (proposed R14–R19)

### R14 — Pre-Game Lobby Intel (compliant "scouting")

**User Story:** As a player at the loading screen, I want a quick read on my lobby before the round starts, so I can gauge how contested my plan is without the app tracking anyone live.

- 14.1 WHEN a match's loading screen is detected, THE SYSTEM SHALL look up each visible lobby participant's recent ranked match history via the Riot API (public participant data, already visible via their Riot ID) and display: average placement (last N games), most-played comps/carries, and current rank tier.
- 14.2 THE SYSTEM SHALL compute this data once, before combat starts, and SHALL NOT continue polling or updating it based on in-match board state or actions — consistent with the "static data available prior to the game" carve-out in Riot's policy.
- 14.3 THE SYSTEM SHALL NOT display, infer, or track what an opponent is doing on their board during the live match at any point after 14.1's initial lookup.
- 14.4 THE SYSTEM SHALL cache lobby intel locally so re-showing it (e.g., after toggling the overlay) doesn't re-query the API.

_Ties to design.md §6 overlay window model; ties to R12.2 rate limiting — this adds up to 7 extra lookups per match, size the crawler/API budget accordingly._

### R15 — Post-Game AI Coaching Narrative

**User Story:** As a player who just finished a match, I want a plain-language explanation of what actually went wrong or right, not just a curve chart, so I know what to change next game.

- 15.1 THE SYSTEM SHALL generate a short natural-language post-game summary (3-5 sentences) per match, built from the same underlying signals as R4.5 (leveling timing, econ deviation, augment-vs-recommendation delta, itemization completeness) rather than raw numbers alone.
- 15.2 THE SYSTEM SHALL cite the specific round/stage where the biggest deviation from the top-4 baseline occurred (e.g., "Your econ dropped to 4 gold at 3-2 chasing a 2-star upgrade that didn't hit — that's the turn your placement likely started slipping").
- 15.3 THE SYSTEM SHALL generate this narrative entirely post-game (after the match ends), keeping it unambiguously in the "post-game analysis" category the policy explicitly encourages, never mid-game.
- 15.4 THE SYSTEM SHALL let users opt out of AI-generated narrative text in favor of the raw stat view (R4.3/4.4) for users who prefer numbers.

_This is your strongest differentiation opportunity — no competitor does narrative post-game coaching well. It's also the safest place to spend "real-time intelligence" ambition, since it's explicitly outside the risky policy zone._

### R16 — Multi-Carry Itemization Optimizer

**User Story:** As a player mid-draft, I want to know the best way to split my item components across my whole board, not just the "ideal" build for one unit in isolation, so I don't waste components on a carry that won't get there.

- 16.1 THE SYSTEM SHALL accept a set of held item components/completed items and a set of board units (via the builder, R6, and/or the pre-game/post-game analysis flows) and return a suggested allocation across units, not just a per-unit ideal list.
- 16.2 THE SYSTEM SHALL explain trade-offs when components are contested between two units (e.g., "Guinsoo's is better on your Jinx than your Kai'Sa this game because Jinx has higher attack speed scaling at her current star level").
- 16.3 Consistent with §1, THE SYSTEM SHALL run this as a pre-game/builder/post-game tool first (definitely compliant); a live in-overlay version that reacts to your bench in real time is Tier 3 and gated the same way as R3's engine.

### R17 — Leveling & Econ Breakpoint Reference

**User Story:** As a player deciding whether to level or roll, I want a quick reference for common breakpoints, so I can make the call myself instead of guessing.

- 17.1 THE SYSTEM SHALL provide a static reference (web and overlay) showing standard XP/gold breakpoints for reaching key levels (e.g., "50 gold + no losses reaches level 8 by 4-1") sourced from patch-level game constants, not from the player's live game state.
- 17.2 THE SYSTEM SHALL keep this reference static/lookup-only per the same compliance boundary as R17 and Tier 1/2 in §1 — it is a chart, not a live calculator wired to the player's current gold total.

_Blitz has this; you don't yet. Cheap to build, low risk if kept as a static reference rather than a live gold-reactive calculator._

### R18 — Web Monetization (currently unaddressed)

The spec has a full monetization plan for the Overwolf build (R13.3: Overwolf Ads/Subscriptions only) but **says nothing about how the web app makes money**, even though web is the primary, always-available surface (R7.4 requires it to be fully useful logged out). Given the goal is a sustainable product, this needs its own requirement:

- 18.1 THE SYSTEM SHALL support a free tier of the web app funded by standard display advertising (e.g., Google Ad Manager/AdSense), consistent with the general Riot monetization policy's requirement that any paid tier have a free option that may include ads.
- 18.2 THE SYSTEM MAY offer an optional paid tier ("TFT Codex Plus" or similar) removing ads and unlocking depth features that are genuinely "transformative" per Riot's monetization policy (new insight, not just less friction) — good candidates: extended personal match history retention, CSV/JSON export for the Analyst persona, custom notification rules, early access to new comp signatures before public tier assignment.
- 18.3 THE SYSTEM SHALL NOT gate any core Requirement 1-3 functionality (tier list, comp explorer, augment intelligence) behind payment — ads-supported free access to all core features stays intact, consistent with R7.4 and Riot's "free tier" monetization requirement.
- 18.4 Ad placement on web SHALL avoid the overlay/Overwolf build entirely (R13.3 already restricts that surface to Overwolf's own SDK) — web ads and Overwolf ads are two separate, non-overlapping revenue tracks with different SDKs and different rules.

### R19 — Creator/Streamer-Safe Overlay Mode

**User Story:** As a streamer or content creator (part of the Analyst persona), I want a clean overlay mode safe to show on stream, so I don't have to hide the app or leak account info on camera.

- 19.1 THE SYSTEM SHALL provide an overlay display mode that hides account-identifying elements (linked Riot ID, personal analytics) while keeping tier list/comp/augment reference panels visible.
- 19.2 THE SYSTEM SHALL provide a high-contrast, larger-scale overlay variant suitable for OBS/stream capture legibility, building on the second-screen-legible layout already required by R5.7.

---

## 4. Prioritization (value vs. effort vs. risk)

| Feature                                               | Value                    | Effort                   | Compliance risk                         | Suggested phase                                |
| ----------------------------------------------------- | ------------------------ | ------------------------ | --------------------------------------- | ---------------------------------------------- |
| R14 Pre-game lobby intel                              | High                     | Medium                   | None                                    | Phase 3 (rides on existing match-history sync) |
| R15 Post-game AI coaching                             | High                     | Medium                   | None                                    | Phase 3, alongside 3.7's suggestion generator  |
| R17 Breakpoint reference                              | Medium                   | Low                      | None if static                          | Phase 2 or 4                                   |
| R18 Web monetization                                  | High (business-critical) | Low-Medium               | None (general policy already allows it) | Phase 1, before public launch                  |
| R19 Streamer-safe overlay                             | Medium                   | Low                      | None                                    | Phase 5, alongside 5.11/5.12                   |
| Tier-2 augment lookup (offered-only filtering)        | High                     | Low (reuses R3 pipeline) | Low                                     | Phase 2                                        |
| R16 Itemization optimizer (builder/post-game)         | High                     | Medium-High              | None in Tier-1 form                     | Phase 4                                        |
| Tier-3 board-reactive engine (current R3.4/R5.4/R5.5) | Highest (if approved)    | High                     | **Real — gate on Riot confirmation**    | Phase 5, contingent                            |

---

## 5. Task list deltas (for `tasks.md`)

Additions, not replacements — insert near the referenced phase:

- **0.7 (amend):** add "include the board-reactive recommendation engine design explicitly in the Riot approval submission and request written confirmation before Phase 5 begins building Tier-3 mode."
- **New 2.13:** Build Tier-2 "offered augments only" lookup mode as the default recommendation behavior; feature-flag Tier-3 board-reactive mode off until 0.7's confirmation lands. _Requirements: 3.4, 3.7 (new)_
- **New 3.14:** Build pre-game lobby intel: loading-screen participant lookup, cached, one-shot per match. _Requirements: 14.1-14.4_
- **New 3.15:** Build the post-game AI coaching narrative generator, with a raw-stats opt-out toggle. _Requirements: 15.1-15.4_
- **New 4.8:** Build the multi-carry itemization optimizer in the builder. _Requirements: 16.1, 16.2_
- **New 1.15:** Stand up web ad slots (non-core-content placements only) and the free/paid tier gate before public launch. _Requirements: 18.1-18.4_
- **New 5.21:** Build the streamer-safe overlay display mode. _Requirements: 19.1, 19.2_
- **New X.7:** Whenever the recommendation engine or overlay changes, re-verify against the Tier 1/2/3 compliance boundary in §1 of this document — treat it as a standing review gate alongside the existing augment-compliance test suite (2.6/X.6).

---

## 6. Design

A full visual design system (cyan-primary, dark-first, modern) is in `design-system.md` — color tokens (contrast-verified against WCAG AA), typography, component patterns for tier badges/comp cards/overlay variants, and motion/accessibility guidelines that plug into `design.md` §13's Next.js + shared `packages/ui` stack.

---

Sources consulted for this review: [Riot TFT Developer Policy](https://support-developer.riotgames.com/hc/en-us/articles/22698732381587-Teamfight-Tactics), [Mortdog on the augment-stats policy](https://dotesports.com/tft/news/mortdog-admits-tfts-ban-on-augment-stats-sites-was-naive-as-riot-changes-course), [Overwolf Ads Monetization Basics](https://overwolf.github.io/start/monetize-with-ads/ads-monetization-basics), [Overwolf Advertising guidelines](https://dev.overwolf.com/ow-electron/monetization/advertising/standard-ads/working-with-ads/), MetaTFT/Mobalytics/Blitz.gg public feature pages and third-party comparisons (see chat response for full list).
