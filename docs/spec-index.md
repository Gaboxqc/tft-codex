# TFT Codex — Spec-Driven Development Package

Five linked documents, in the order they're meant to be read and used:

1. **`requirements.md`** — what the product must do, in EARS format (`WHEN/IF/THE SYSTEM SHALL`), organized as 19 numbered requirement areas with testable acceptance criteria. Start here, and edit this first if you want to change scope — everything else traces back to it.
2. **`design.md`** — how it's built: architecture diagrams, the meta-computation pipeline, data models, API surface, the Overwolf app architecture, the recommendation-engine compliance tiering, and a testing strategy. Every section is tagged back to the requirement IDs it satisfies.
3. **`design-system.md`** — how it looks: color tokens (cyan-primary, dark-first, contrast-verified), typography, spacing, and component patterns shared between web and the Overwolf overlay via `packages/ui`. `design.md` is architecture-only by design; this is where the actual UI system lives.
4. **`tasks.md`** — a phased, ordered checklist of implementation tasks, each small enough to build and test on its own and tagged with the requirements it fulfills.
5. **`review-and-roadmap.md`** — a review pass over the first four documents: one compliance gap the original spec missed (see below), a competitive comparison against MetaTFT/Mobalytics/Blitz.gg, and the rationale behind the new requirements/tasks that got folded into the documents above. Read this if you want the _why_ behind the v3 changes rather than just the _what_.

## v3 scope (current)

Same product shape as v2 — **web + a desktop companion published on Overwolf, no mobile app** — with two corrections layered in after a compliance review, plus six new requirements aimed at making this the strongest TFT companion in the market rather than a parity play.

- **Overwolf, not a standalone overlay.** The desktop app is built on Overwolf Electron (`ow-electron`) and reads live game state through Overwolf's Game Events Provider — Overwolf already has purpose-built TFT support (augment picks, bench items, round/stage state), so there's no reason to reimplement a local-API poller ourselves. See `design.md` §6.
- **Augment/Legend display restriction.** Riot's TFT developer policy bars third-party apps from showing Augment win rates, Augment average placements, or Legend win rates — on any platform, not just Overwolf. `requirements.md` R3.1–3.6 and `design.md` §7 build this in structurally (the data model has no field to leak, the API has an allowlist as a second layer, and there's a CI test that fails the build if it ever shows up).
- **New in v3 — real-time recommendation restriction.** Riot's policy separately restricts recommendations that adapt in real time to a player's board state and give direct prescriptions ("go here now"), and it explicitly excludes opponent/lobby scouting as an unapproved use case. This is a _different_ rule from the augment-numbers one above, and the original v2 spec didn't account for it — it directly touches the flagship "suggest comps from my board/augments" feature. `requirements.md` R3.7 and `design.md` §8 now split the recommendation engine into a Tier-2 (static lookup, ships by default) and Tier-3 (adaptive, gated behind explicit written Riot confirmation obtained during the R13.1 approval process) mode, enforced server-side so no client build can ship Tier-3 ahead of approval. **If you only take one thing from `review-and-roadmap.md` before building Phase 5, make it this — it's the difference between a real compliance risk and a defensible one.**
- **New in v3 — six added requirements (R14–R19):** pre-game lobby intel (the compliant version of "scouting" — a one-shot, pre-combat opponent-history lookup, not live tracking), a post-game AI coaching narrative (the biggest real differentiation opportunity versus every competitor reviewed), a multi-carry itemization optimizer, a static leveling/econ breakpoint reference, a web monetization plan (v2 only specified monetization for the Overwolf build — web had none), and a streamer/creator-safe overlay mode. See `review-and-roadmap.md` §3 for the full rationale and competitive comparison behind each.

## How to use this with an AI coding agent

Work through `tasks.md` top to bottom, one unchecked task (or a small cluster within the same numbered section) at a time:

> "Implement task 1.5 from tasks.md — check requirements.md R1.3 and design.md §3 for context first."

Check the box, commit, move to the next task. This keeps context small per turn and keeps every change traceable to a requirement instead of vibes. For UI tasks, also check `design-system.md` for the relevant tokens/component pattern before building from scratch.

**Start tasks 0.7 and 0.8 immediately**, even before writing any product code — they're approval applications (Riot's third-party program, Overwolf's app whitelisting) with real-world review lead times, and Phase 5 can't start without both. Task 0.7 now also carries the Tier-3 recommendation-timing question (see v3 scope above) — get that answered early too, since it determines whether Phase 5's adaptive engine is buildable at all. Everything else in Phases 0–4 can proceed in parallel while those sit in someone's review queue.

## If you want to change scope

- **Web-only, no desktop app?** Drop Requirement 5 (Overwolf companion) and Requirement 13 (Overwolf/Riot publishing compliance) from `requirements.md`, then delete Phase 5 from `tasks.md` and tasks 0.7/0.8. Everything else stands on its own — the API and data pipeline don't know or care whether Overwolf exists. Requirement 3.7's Tier-2/Tier-3 split still applies to the web recommendation engine on its own, since the real-time-recommendation policy isn't Overwolf-specific.
- **Add mobile back later?** `packages/shared-types` and the API were designed so a React Native app could reuse both without touching the backend — the original mobile requirement (old R10.2/10.3) and Phase 7 tasks from the v1 draft are easy to reintroduce as an appendix if you want them; just don't renumber existing requirements to make room.
- **Different data source?** The only requirement that hard-codes Riot's API as the source is R12.1. If that changes, `design.md` §3's pipeline and §13's stack table are the sections to revise — the rest of the spec (tier logic, comp explorer, builder) doesn't care where the stats come from. Note this would still leave the Overwolf augment-display restriction in place — that one comes from Riot's game policy, not from how you source data.
- **Add a requirement?** Append it to `requirements.md` with the next number, then add matching tasks to the relevant phase in `tasks.md` with a `_Requirements: N.N_` tag. Don't renumber existing requirements — task references would go stale. (This is exactly how R14–R19 were added in v3.)

## Open decisions worth revisiting before Phase 0

- ClickHouse vs. Timescale for the OLAP store (`design.md` §13) — pick based on your team's existing ops comfort, not a hard technical requirement either way.
- Whether the comp-signature registry (`design.md` §3) is maintained by you manually each patch or eventually automated — it's manual in this design on purpose, to keep tier assignment honest and auditable while stats stay fully computed.
- Riot API key tier — a development key is enough to build and test Phases 0–4; a production key application (which takes real review time on Riot's side, same as the third-party approval in 0.7) should be underway well before Phase 5 or any public launch.
- Overwolf monetization: on or off at launch. Either is fine for the whitelisting submission (0.8), but if "on," it has to be Overwolf's own ads/subscriptions exclusively — no third-party ad network or payment processor is permitted inside the Overwolf build (`requirements.md` R13.3). Web's monetization (R18) is a separate decision and isn't constrained by this.
- Whether Legends are active in whatever Set is live when you build Phase 2/5 — if so, R3.6 means the same compliance machinery (categorical tier only, no numbers) applies to them from day one, not as a retrofit.
- **New in v3:** whether to pursue Tier-3 adaptive recommendations at all, or ship Tier-2 permanently as the product's stance — this is worth a real product decision once Riot's answer comes back, not just a default to flip on the moment it's technically allowed. Tier-2 alone, done well (fast, accurate augment-offered lookups + a strong post-game coaching narrative per R15), may be a more defensible long-term position than chasing Tier-3 parity with competitors operating in a grayer area.
