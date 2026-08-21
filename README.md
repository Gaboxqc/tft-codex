# TFT Codex

A data-backed Teamfight Tactics meta engine: a live-computed tier list, comp
explorer, augment reference, personal analytics, and an in-game companion
published on Overwolf.

The differentiator is that nothing here is hand-curated. Tiers come from a
**documented, versioned composite score** computed from real ranked match data
pulled via the official Riot TFT API — and the formula is published rather than
hidden.

> TFT Codex isn't endorsed by Riot Games and doesn't reflect the views or
> opinions of Riot Games or anyone officially involved in producing or managing
> Riot Games properties.

---

## Where the specs live

This repo is spec-driven. The five documents in [`docs/`](docs/) are the source
of truth and should be read in this order:

| Document                                                   | What it is                                                                                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/requirements.md`](docs/requirements.md)             | What the product must do — 19 requirement areas in EARS format with testable acceptance criteria. Edit this first if scope changes. |
| [`docs/design.md`](docs/design.md)                         | How it's built — architecture, data pipeline, data models, API surface, Overwolf app design, compliance tiering.                    |
| [`docs/design-system.md`](docs/design-system.md)           | How it looks — contrast-verified color tokens, type scale, component patterns shared by web and overlay.                            |
| [`docs/tasks.md`](docs/tasks.md)                           | Ordered implementation checklist, each task tagged with the requirements it fulfills.                                               |
| [`docs/review-and-roadmap.md`](docs/review-and-roadmap.md) | The review pass that produced v3 — the compliance gap found, competitive analysis, and rationale for R14–R19.                       |
| [`docs/spec-index.md`](docs/spec-index.md)                 | Original spec-package index: v3 scope, how to change scope, open decisions.                                                         |
| [`docs/approvals.md`](docs/approvals.md)                   | Live status of the Riot and Overwolf approval submissions that gate Phase 5.                                                        |

Every commit should trace to a task in `docs/tasks.md`, and every task traces to
a requirement ID.

## Two compliance rules that shape the architecture

These are Riot approval blockers (`R13.6`), not preferences, and both are
enforced structurally rather than by convention. Read these before touching the
augment or recommendation code.

**1. Augment win rates and average placements can never be displayed** (`R3.1`).
They are computed — they usefully _order_ recommendations — but they never leave
the server. Three independent layers:

- The public `Augment` type has **no field** to carry them
  ([`packages/shared-types/src/augment.ts`](packages/shared-types/src/augment.ts)).
- The API gateway connects to ClickHouse as a user with **no grant** on the
  internal-stats table ([`infra/clickhouse/init/01-gateway-user.sql`](infra/clickhouse/init/01-gateway-user.sql)).
- A **release-blocking CI job** scans response bodies for the forbidden field
  names ([`packages/shared-types/src/compliance.ts`](packages/shared-types/src/compliance.ts)).

**2. Real-time, board-reactive prescriptions are gated** (`R3.7`). This is a
_separate_ rule from the one above. The recommendation engine has two modes:
Tier-2 (a lookup against static, patch-level data, filtered to the options
actually offered — ships by default) and Tier-3 (adaptive, reads live board
state). Tier-3 requires **written confirmation from Riot** on file. The gateway
silently downgrades any Tier-3 request unless `RIOT_TIER3_RECOMMENDATIONS_CONFIRMED`
is set, so no client build can enable it on its own. Status:
[`docs/approvals.md`](docs/approvals.md).

## Getting started

Requires **Node 22+** and **Docker** (for Postgres/Redis/ClickHouse).

```bash
git clone https://github.com/Gaboxqc/tft-codex.git
cd tft-codex
npm install
cp .env.example .env
```

Then fill in `RIOT_API_KEY` in `.env` with a key from
[developer.riotgames.com](https://developer.riotgames.com/) (a development key
is enough for Phases 0–4; it expires every 24 hours).

Start the local datastores:

```bash
docker compose up -d
```

Run everything in dev mode:

```bash
npm run dev
```

### Common commands

| Command             | What it does                                |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | All apps in watch mode via Turborepo        |
| `npm run build`     | Build every workspace                       |
| `npm run typecheck` | TypeScript strict check across the monorepo |
| `npm run lint`      | ESLint across the monorepo                  |
| `npm run test`      | Full test suite                             |
| `npm run format`    | Prettier write                              |

### Scheduled jobs

Run from the API workspace (`--workspace @tft-codex/api`):

| Job                   | What it does                                                                      |
| --------------------- | --------------------------------------------------------------------------------- |
| `npm run crawl`       | Pulls matches from Riot into the ingestion queue                                  |
| `npm run aggregate`   | Aggregates, scores and publishes the tier list                                    |
| `npm run patch-notes` | Diffs Data Dragon into balance changes, then drafts the meta summary for review   |
| `npm run notify`      | Drains the notification outbox through whichever delivery channels are configured |

`patch-notes` accepts `-- --patch 17.9 --from 16.15.1 --to 16.16.1` to pin a
backfill; by default it diffs the two newest Data Dragon versions into the
current patch. Neither it nor `notify` publishes anything a human has not
approved — a drafted meta summary stays in `meta_impact_draft` until it is
approved through the editorial route.

## Repo layout

```
apps/
  web/            Next.js web app — tier list, comp explorer, builder, analytics
  api/            Fastify API gateway + services + ingestion workers
  overwolf/       Overwolf Electron (ow-electron) in-game companion — Phase 5
packages/
  shared-types/   Zod schemas + inferred types shared by every client (R10.2)
  ui/             Design tokens and components shared by web and overlay (R10.2)
  riot-client/    Rate-limited Riot API client (R12.2)
infra/
  clickhouse/     OLAP init scripts, incl. the gateway grant boundary (R3.1)
docs/             The specs above
```

Web and the Overwolf app share the same backend API and the same types — the
overlay maintains no separate data pipeline and duplicates no business logic
(`R10.3`).

## Contributing

Work one unchecked task from [`docs/tasks.md`](docs/tasks.md) at a time. Branch
naming: `phase-N/task-N.N-short-slug`. Every PR runs lint, typecheck, tests, and
the two compliance gates above — all four are required to merge.
