-- Phase 2: public augment records.
--
-- This table holds the *result* of tiering — a letter and a pick rate — never
-- the inputs. Win rates and average placements live only in ClickHouse's
-- `augment_internal_stats`, behind credentials the API gateway does not have
-- (requirements.md R3.1, design.md §7).
--
-- Adding a column here that stores or derives a win rate or an average
-- placement is a Riot approval blocker, not a schema preference. The CI
-- compliance suite will catch it reaching a response; this comment is here so
-- it gets caught earlier, at review.

CREATE TABLE IF NOT EXISTS augments (
    id            TEXT NOT NULL,
    patch         TEXT NOT NULL REFERENCES patches (id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    -- R3.6: Legends reuse this table rather than getting a parallel one, so
    -- the same compliance machinery applies the moment a Set reintroduces
    -- them — no code change needed to "re-enable" compliance.
    kind          TEXT NOT NULL DEFAULT 'augment' CHECK (kind IN ('augment', 'legend')),

    -- Categorical only (R3.2). The composite score behind it is discarded.
    tier          TEXT NOT NULL DEFAULT 'C' CHECK (tier IN ('S', 'A', 'B', 'C')),
    -- Pick frequency. Explicitly permitted by R3.3 — Riot's restriction names
    -- win rate and average placement, not pick rate.
    play_rate     NUMERIC(6, 5) NOT NULL DEFAULT 0 CHECK (play_rate BETWEEN 0 AND 1),
    -- Sample too thin to tier confidently. Unlike a comp, the augment still
    -- gets a letter — a player has to choose something this round — but the UI
    -- can hedge how it presents it.
    provisional   BOOLEAN NOT NULL DEFAULT TRUE,

    rounds_offered       INTEGER[] NOT NULL DEFAULT '{}',
    description          TEXT NOT NULL DEFAULT '',
    -- Static metadata used to describe *fit*, never outcome.
    category             TEXT CHECK (category IN ('combat', 'econ', 'item', 'trait', 'utility')),
    related_traits       TEXT[] NOT NULL DEFAULT '{}',
    related_carries      TEXT[] NOT NULL DEFAULT '{}',
    requires_traits      TEXT[] NOT NULL DEFAULT '{}',
    -- Editorially curated fit, not a win-rate ranking (R2.4).
    curated_for_comp_ids TEXT[] NOT NULL DEFAULT '{}',
    qualitative_notes    TEXT NOT NULL DEFAULT '',

    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, patch)
);

CREATE INDEX IF NOT EXISTS augments_patch_kind_idx ON augments (patch, kind);
CREATE INDEX IF NOT EXISTS augments_curated_idx ON augments USING GIN (curated_for_comp_ids);

-- Static XP/gold breakpoints (R17.1).
--
-- Sourced from patch-level game constants, NOT from any player's live state.
-- R17.2 makes this a chart, not a calculator: there is deliberately no column
-- here for a player's current gold, and no route that accepts one.
CREATE TABLE IF NOT EXISTS level_breakpoints (
    patch          TEXT    NOT NULL REFERENCES patches (id) ON DELETE CASCADE,
    level          INTEGER NOT NULL CHECK (level BETWEEN 2 AND 11),
    xp_to_reach    INTEGER NOT NULL,
    gold_to_buy_xp INTEGER NOT NULL,
    note           TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (patch, level)
);

CREATE TABLE IF NOT EXISTS econ_constants (
    patch                TEXT NOT NULL PRIMARY KEY REFERENCES patches (id) ON DELETE CASCADE,
    interest_thresholds  INTEGER[] NOT NULL DEFAULT '{10,20,30,40,50}'
);
