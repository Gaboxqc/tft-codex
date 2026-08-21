-- Opt-in friends and the comparison leaderboard (task 6.8).
--
-- This is the only feature in TFT Codex that shows one player's data to
-- another, so the consent model is the design rather than a setting on it.
--
-- Three gates, each of which must pass independently:
--
--   1. You opted in to the feature at all (`friends_opt_in`).
--   2. They opted in too — you cannot even find someone who has not.
--   3. One of you sent a request and the other accepted it.
--
-- R4.6 says a player's data is never another player's to see. This does not
-- weaken that; it gives one narrow, explicit, revocable exception, and only
-- for aggregates. No match list, no per-game detail, and no augment breakdown
-- (which R4.7 gates for a player's *own* data, let alone a friend's).
--
-- _Requirements: 4.6, 4.7, 7.1, 7.3_

-- Off by default, deliberately. A player who never visits this page is not
-- discoverable, cannot be sent requests, and appears on nobody's leaderboard.
ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS friends_opt_in BOOLEAN NOT NULL DEFAULT FALSE;

-- Riot ID lookup is restricted to opted-in players. Otherwise the search
-- itself would answer "does this person use TFT Codex?" for any Riot ID
-- anyone cares to type, which is a disclosure in its own right.
CREATE INDEX IF NOT EXISTS player_profiles_friend_lookup_idx
    ON player_profiles (lower(riot_id))
    WHERE friends_opt_in AND deletion_requested_at IS NULL;

CREATE TABLE IF NOT EXISTS friendships (
    requester_puuid TEXT NOT NULL REFERENCES player_profiles (puuid) ON DELETE CASCADE,
    addressee_puuid TEXT NOT NULL REFERENCES player_profiles (puuid) ON DELETE CASCADE,
    -- 'pending' until the addressee accepts. There is no 'declined' state:
    -- a declined request is deleted outright, so it leaves no record of who
    -- turned down whom.
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at    TIMESTAMPTZ,
    PRIMARY KEY (requester_puuid, addressee_puuid),
    -- Guards a self-friendship, which would otherwise double-count someone on
    -- their own leaderboard.
    CHECK (requester_puuid <> addressee_puuid)
);

-- One relationship per pair, whichever direction the request went. Without
-- this, A→B pending and B→A accepted can coexist and the pair is
-- simultaneously friends and not.
CREATE UNIQUE INDEX IF NOT EXISTS friendships_unique_pair
    ON friendships (
        least(requester_puuid, addressee_puuid),
        greatest(requester_puuid, addressee_puuid)
    );

CREATE INDEX IF NOT EXISTS friendships_addressee_pending_idx
    ON friendships (addressee_puuid)
    WHERE status = 'pending';
