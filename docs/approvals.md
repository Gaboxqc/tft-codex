# Approval tracker — Riot & Overwolf

`tasks.md` 0.7 and 0.8 are not code tasks. They are real-world submissions with
multi-week review lead times, and **Phase 5 cannot start until both land**
(`tasks.md` 5.1 is an explicit blocking checkpoint). Everything in Phases 0–4
proceeds in parallel while these sit in someone's review queue.

Keep this file updated as statuses change — the Tier-3 answer in particular is
referenced by code (`RIOT_TIER3_RECOMMENDATIONS_CONFIRMED`) and by CI.

---

## 0.7 — Riot third-party application approval

| Field              | Value                                                                   |
| ------------------ | ----------------------------------------------------------------------- |
| Status             | ☐ Not yet submitted                                                     |
| Portal             | https://developer.riotgames.com/ (Third Party Application registration) |
| Submitted on       | —                                                                       |
| Reference / ticket | —                                                                       |
| Decision           | —                                                                       |
| Gates              | Production Riot API key; Overwolf publication (`13.1`); Phase 5         |

**What the submission must explicitly say** (`_Requirements: 13.1, 3.7_`):

The generic description is the trap here. `review-and-roadmap.md` §1 is the
reason this task exists in its current form — Riot's TFT developer policy lists
"apps that provide dynamic, real-time information" and "apps that dictate player
decisions" as **unapproved use cases**, separately from the augment-numbers rule
the spec already handles. The application must describe the actual behaviour and
ask for a direct answer, rather than discovering it at rejection time.

Include, verbatim in substance:

1. **The recommendation engine's two modes** (`design.md` §8). Describe Tier-2
   (ranking only the three augment options actually offered against a static,
   precomputed categorical tier list — a lookup over patch-level data, not a
   function of the player's board) and Tier-3 (reading live board/bench/gold to
   tailor rankings in real time). **Ask explicitly whether Tier-3 is
   acceptable for this app**, and request the answer in writing.
2. **The augment display restriction is already handled structurally**
   (`design.md` §7): win rate and average placement are computed but held in a
   ClickHouse table the API gateway's credentials cannot query, the public
   `Augment` type has no field to carry them, and a release-blocking CI suite
   asserts they never appear in a response body. Say so — it is the strongest
   thing in the application.
3. **Lobby intel is one-shot and pre-combat** (`R14`). Describe it as a single
   loading-screen lookup of public participant history that is never refreshed
   or extended once combat begins, and note that the service is architecturally
   isolated from the recommendation engine so it cannot drift into live
   opponent tracking. Distinguish it clearly from the "scouting" use case Riot
   lists as unapproved.
4. **Post-game coaching is post-game only** (`R15.3`) — the category Riot's
   policy explicitly encourages.
5. **The personal-augment-analytics question** (`R4.7`): ask whether a user's
   _own_ placement broken down by their own augment picks is in scope for the
   display restriction. Do not assume personal data is exempt. `tasks.md` 3.12
   is blocked on this answer.

### Answers received

| Question                                                | Answer    | Recorded |
| ------------------------------------------------------- | --------- | -------- |
| Tier-3 board-state-reactive recommendations acceptable? | ☐ Pending | —        |
| Personal augment-placement analytics in scope (R4.7)?   | ☐ Pending | —        |

> **Until the first row reads "yes, in writing":**
> `RIOT_TIER3_RECOMMENDATIONS_CONFIRMED` stays `false` in every environment, and
> the gateway downgrades any `tier3-adaptive` request to `tier2-lookup`. CI
> fails the build if the flag is set anywhere in the repo. Flipping it without
> the written answer on file is a compliance incident, not a config change.

---

## 0.8 — Overwolf app whitelisting (Public app)

| Field              | Value                                               |
| ------------------ | --------------------------------------------------- |
| Status             | ☐ Not yet submitted                                 |
| Portal             | https://console.overwolf.com/ (app idea submission) |
| Submitted on       | —                                                   |
| Reference / ticket | —                                                   |
| Decision           | —                                                   |
| Gates              | Overwolf API access; all of Phase 5                 |

Overwolf does not grant API access before whitelisting, and does not approve
private/faceless apps (`_Requirements: 13.2_`). The submission must be for a
**Public** app and include:

- **Public-facing feature description** — the in-game companion: closest-comp
  reference, offered-augment tier reference, pre-game lobby intel, static
  leveling/econ breakpoint chart, post-game coaching hand-off to web.
- **UI/UX plan** — see `design-system.md` §1–§5 (overlay panel model, glass
  panels, second-screen scaling, streamer-safe variant per `R19`).
- **Monetization plan** — required at submission time even if the answer is
  "ads disabled at launch". If monetized, it must be Overwolf Ads SDK and/or
  Overwolf Subscriptions **exclusively**; no third-party ad network or payment
  processor may appear in the Overwolf build (`R13.3`). Web's display ads
  (`R18`) are a separate track and must not leak into the Overwolf build
  (`R18.4`).

**Open decision to make before submitting:** Overwolf monetization on or off at
launch (see `docs/spec-index.md` § Open decisions). Either answer is acceptable
to Overwolf; it just has to be stated.

---

## Sequencing

```
0.7 Riot application ──┐
                       ├──> 5.1 blocking checkpoint ──> Phase 5 feature work
0.8 Overwolf idea   ───┘
```

Phase 5 ships in Tier-2 mode regardless of how the Tier-3 question is answered —
that is the point of building the mode split in `tasks.md` 2.13 up front. A "no"
on Tier-3 costs the product nothing that was already built; it just means the
flag never flips.
