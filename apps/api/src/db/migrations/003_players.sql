-- Phase 3: linked player profiles and personal analytics.
--
-- R7.2 restricts what may be stored to PUUID, region and display Riot ID.
-- That is the entire identity surface of this table, and it is deliberately
-- narrow: there is no email column, no password column, and no place to put
-- one. Riot Sign-On handles authentication; we never see a credential.
--
-- R7.3 requires unlink to delete the profile and every derived analytic within
-- 30 days. Every table below cascades from `player_profiles`, so deleting one
-- row removes everything derived from it — the retention guarantee is a
-- foreign key, not a cleanup script someone has to remember to run.

CREATE TABLE IF NOT EXISTS player_profiles (
    puuid          TEXT PRIMARY KEY,
    region         TEXT NOT NULL,
    -- "Name#TAG". Display only.
    riot_id        TEXT NOT NULL,
    linked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_synced_at TIMESTAMPTZ,
    -- R15.4 — users who prefer numbers can turn off AI narrative text.
    coaching_narrative_opt_out BOOLEAN NOT NULL DEFAULT FALSE,
    -- Set when the user unlinks. The row survives briefly so an accidental
    -- unlink can be reversed and so the deletion is auditable (R12.4), then
    -- the hard-delete job removes it. Nothing is served for a row with this set.
    deletion_requested_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS player_profiles_pending_deletion_idx
    ON player_profiles (deletion_requested_at)
    WHERE deletion_requested_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_prefs (
    puuid    TEXT NOT NULL REFERENCES player_profiles (puuid) ON DELETE CASCADE,
    channel  TEXT NOT NULL CHECK (channel IN ('email', 'webpush', 'overwolf-native')),
    category TEXT NOT NULL CHECK (category IN ('patch', 'bookmarkedComp', 'bookmarkedChampion')),
    enabled  BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (puuid, channel, category)
);

-- A linked user's own matches.
--
-- R4.6: other participants in these matches are used only in memory for comp
-- detection and baseline comparison. Nothing about them is persisted against
-- their identity — there is no row here keyed by anyone but the linked user.
CREATE TABLE IF NOT EXISTS player_matches (
    match_id          TEXT NOT NULL,
    puuid             TEXT NOT NULL REFERENCES player_profiles (puuid) ON DELETE CASCADE,
    patch             TEXT NOT NULL,
    placement         SMALLINT NOT NULL CHECK (placement BETWEEN 1 AND 8),
    detected_comp_id  TEXT,
    -- Augment ids only.
    --
    -- R4.7: no placement or outcome may be joined to this in any exposed view,
    -- even for the user's own data, until Riot's approval process confirms
    -- personal augment-placement analytics are in scope (task 3.12). The
    -- placement column above lives in the same row, so the restriction is on
    -- the QUERY, not the storage — do not add a view or endpoint that groups
    -- placement by an element of this array without that written answer.
    augments_picked   TEXT[] NOT NULL DEFAULT '{}',
    level_curve       JSONB  NOT NULL DEFAULT '[]',
    gold_curve        JSONB  NOT NULL DEFAULT '[]',
    played_at         TIMESTAMPTZ NOT NULL,
    synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (match_id, puuid)
);

CREATE INDEX IF NOT EXISTS player_matches_recent_idx ON player_matches (puuid, played_at DESC);
CREATE INDEX IF NOT EXISTS player_matches_comp_idx ON player_matches (puuid, detected_comp_id);

-- Generated post-game (R15.3) and cached so re-opening a review does not
-- regenerate it. Cascades with the profile.
CREATE TABLE IF NOT EXISTS match_coaching (
    match_id            TEXT NOT NULL,
    puuid               TEXT NOT NULL REFERENCES player_profiles (puuid) ON DELETE CASCADE,
    narrative           TEXT NOT NULL,
    key_deviation_round TEXT,
    suggestions         JSONB NOT NULL DEFAULT '[]',
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (match_id, puuid),
    FOREIGN KEY (match_id, puuid) REFERENCES player_matches (match_id, puuid) ON DELETE CASCADE
);

-- RSO OAuth flow state.
--
-- Short-lived rows holding the PKCE verifier and CSRF state between the
-- redirect out and the callback back. Kept server-side rather than in a cookie
-- so the verifier never touches the browser (design.md §10).
CREATE TABLE IF NOT EXISTS auth_flows (
    state         TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    redirect_to   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_flows_expiry_idx ON auth_flows (expires_at);

-- Refresh tokens live server-side, never in client localStorage or the
-- Overwolf app's storage (design.md §10, R7.5). The session id is what the
-- client holds, in an httpOnly cookie.
CREATE TABLE IF NOT EXISTS auth_sessions (
    id              TEXT PRIMARY KEY,
    puuid           TEXT NOT NULL REFERENCES player_profiles (puuid) ON DELETE CASCADE,
    refresh_token   TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    last_used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS auth_sessions_puuid_idx ON auth_sessions (puuid);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions (expires_at);
