-- Notification delivery: web push subscriptions and opt-in email (task 6.6).
--
-- _Requirements: 9.1, 9.2, 7.3, 12.4_

-- ── Web push ────────────────────────────────────────────────────────────────
--
-- A browser push subscription is per-device, so one player can hold several.
-- Keyed by endpoint because that is what the push service itself uses as the
-- identity of a subscription, and what it returns in a 404/410 when the
-- subscription has expired.
CREATE TABLE IF NOT EXISTS push_subscriptions (
    puuid       TEXT NOT NULL REFERENCES player_profiles (puuid) ON DELETE CASCADE,
    endpoint    TEXT NOT NULL,
    -- The browser's public key and auth secret. Required to encrypt a payload
    -- the push service itself cannot read.
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (puuid, endpoint)
);

-- ── Opt-in notification email ───────────────────────────────────────────────
--
-- 003_players.sql says of this table: "there is no email column, no password
-- column, and no place to put one". That was accurate and is deliberately
-- being changed here, narrowly.
--
-- The distinction that keeps the original promise intact: this address does not
-- come from Riot and is not part of linking an account. It exists only when a
-- player types one in specifically to receive notifications, it is used for
-- nothing else, and clearing it is one request. Sign-in still goes through RSO
-- and still involves no password. /privacy is updated in the same commit —
-- a privacy page that lags the schema is worse than either alone.
--
-- Nothing is ever sent to an unverified address. Someone can type a stranger's
-- address into a form; sending to it before the owner confirms would make this
-- product the mechanism of that abuse.
ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS notification_email TEXT;
ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS notification_email_verified_at TIMESTAMPTZ;
ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS notification_email_token TEXT;
ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS notification_email_token_expires_at TIMESTAMPTZ;

-- Verification tokens are looked up by token alone, on a route that has no
-- session — the link is clicked from an inbox.
CREATE INDEX IF NOT EXISTS player_profiles_email_token_idx
    ON player_profiles (notification_email_token)
    WHERE notification_email_token IS NOT NULL;

-- ── Outbox delivery bookkeeping ─────────────────────────────────────────────
--
-- `attempts` lets the worker distinguish "not tried yet" from "tried and the
-- push service was down". markFailed stays terminal for permanent failures;
-- this is for the retryable ones.
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
