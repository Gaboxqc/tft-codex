/**
 * Environment configuration, validated once at boot.
 *
 * Validating up front means a missing Riot key or a malformed database URL
 * fails the process immediately rather than at 3am inside a crawler worker.
 *
 * The compliance flags at the bottom are the important part — see the comment
 * on `tier3RecommendationsConfirmed`.
 */
import { z } from 'zod';
import { PLATFORM_ROUTES, REGIONAL_ROUTES } from '@tft-codex/riot-client';

const booleanish = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default('0.0.0.0'),

  RIOT_API_KEY: z.string().min(1, 'RIOT_API_KEY is required — see .env.example'),
  RIOT_PLATFORM_ROUTE: z.enum(PLATFORM_ROUTES).default('euw1'),
  RIOT_REGIONAL_ROUTE: z.enum(REGIONAL_ROUTES).optional(),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  CLICKHOUSE_URL: z.string().min(1),
  CLICKHOUSE_DATABASE: z.string().default('tftcodex'),
  CLICKHOUSE_USER: z.string().default('tftcodex'),
  CLICKHOUSE_PASSWORD: z.string().default(''),
  CLICKHOUSE_GATEWAY_USER: z.string().default('tftcodex_gateway'),
  CLICKHOUSE_GATEWAY_PASSWORD: z.string().default(''),

  /** Signs session JWTs. Must differ per environment (design.md §10). */
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  /** Where to send the browser after an RSO round trip. */
  WEB_BASE_URL: z.string().default('http://localhost:3000'),
  /**
   * This API's own publicly reachable base URL.
   *
   * Needed because some links we generate are clicked from outside the browser
   * session entirely — the email verification link lands on an API route, not
   * a web page, so it cannot be built from WEB_BASE_URL.
   */
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),

  // RSO credentials, issued once Riot approves the third-party application
  // (docs/approvals.md). Optional so the rest of the API boots without them —
  // account linking returns 503 until they exist, rather than blocking Phases
  // 1 and 2 from running at all.
  RSO_CLIENT_ID: z.string().optional(),
  RSO_CLIENT_SECRET: z.string().optional(),
  RSO_REDIRECT_URI: z.string().optional(),

  /** How often the meta pipeline is expected to publish, in minutes (R1.2). */
  META_REFRESH_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),
  /** R7.3 — hard-delete window after an unlink. */
  PROFILE_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  /** Below this many games on the current patch, a comp is provisional (R1.4). */
  COMP_MIN_SAMPLE_SIZE: z.coerce.number().int().positive().default(200),

  /**
   * R3.7 — the Tier-3 kill switch.
   *
   * Tier-3 is the adaptive, board-state-reactive recommendation mode. Riot's
   * developer policy separately restricts recommendations that "adjust in real
   * time based on the player's actions in game", and this app has no written
   * confirmation that its Tier-3 behaviour is acceptable. Until that answer is
   * on file (docs/approvals.md), the gateway downgrades every Tier-3 request
   * to Tier-2.
   *
   * This lives server-side on purpose. No client build can turn it on, and CI
   * fails if it is set to true anywhere in the repo. Flipping it without the
   * written answer is a compliance incident, not a config change.
   */
  RIOT_TIER3_RECOMMENDATIONS_CONFIRMED: booleanish,
  /** Reference to the written confirmation, for the audit trail. */
  RIOT_TIER3_CONFIRMATION_REF: z.string().optional(),

  /**
   * Shared secret for the editorial routes (tasks 6.1, 6.2, 2.11).
   *
   * Deliberately not RSO: an editor is a member of staff, not a linked Riot
   * account, and coupling internal write access to a player session would mean
   * every approval path ran through the same token a game client holds.
   *
   * A shared token is a stopgap and is treated as one — optional, so the API
   * boots without it, and every editorial route 503s while it is unset rather
   * than falling open. Proper per-user roles are the eventual answer; this is
   * enough for a pre-launch team of one.
   */
  EDITORIAL_API_TOKEN: z
    .string()
    .min(24, 'EDITORIAL_API_TOKEN must be at least 24 characters')
    .optional(),

  /**
   * Drafts the per-patch meta summary (task 6.2). Optional — without it the
   * drafting step no-ops and the summary simply stays unwritten, which the
   * patch page already renders as "still being reviewed".
   */
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),

  // ── Notification delivery (task 6.6) ──────────────────────────────────────
  //
  // Each channel is independently optional. A channel with no credentials has
  // no adapter, and the worker leaves its messages pending rather than failing
  // them — the message is fine, the deployment just cannot deliver it yet.

  /** Self-generated, free: `npx web-push generate-vapid-keys`. */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  /** `mailto:` or https, per the VAPID spec — push services require a contact. */
  VAPID_SUBJECT: z.string().default('mailto:notifications@tftcodex.local'),

  RESEND_API_KEY: z.string().optional(),
  /** Verified sending identity, e.g. `TFT Codex <notifications@example.com>`. */
  EMAIL_FROM: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export interface AppConfig {
  env: Env['NODE_ENV'];
  isProduction: boolean;
  server: { port: number; host: string };
  riot: {
    apiKey: string;
    platform: Env['RIOT_PLATFORM_ROUTE'];
    regional: Env['RIOT_REGIONAL_ROUTE'];
  };
  postgres: { connectionString: string };
  redis: { url: string };
  clickhouse: {
    url: string;
    database: string;
    /** Full access. Aggregation jobs only — can read augment_internal_stats. */
    admin: { username: string; password: string };
    /**
     * Restricted. What the API gateway connects as; has no grant on
     * augment_internal_stats, which is the credential layer of R3.1
     * (design.md §7 step 1). Never swap this for `admin`.
     */
    gateway: { username: string; password: string };
  };
  meta: { refreshIntervalMinutes: number; compMinSampleSize: number };
  /** Signs session JWTs. */
  jwtSecret: string;
  webBaseUrl: string;
  /** This API's own public base URL, for links clicked outside the browser. */
  apiPublicUrl: string;
  /** null until Riot issues RSO credentials — linking 503s in the meantime. */
  rso: { clientId: string; clientSecret: string; redirectUri: string } | null;
  privacy: { profileRetentionDays: number };
  compliance: {
    tier3RecommendationsConfirmed: boolean;
    tier3ConfirmationRef: string | null;
  };
  /** null until an editorial token is configured — the routes 503 until then. */
  editorialToken: string | null;
  /** null when no model credentials exist — summary drafting then no-ops. */
  drafter: { apiKey: string; model: string } | null;
  delivery: {
    /** null without VAPID keys. Generating them is free and local. */
    webPush: { publicKey: string; privateKey: string; subject: string } | null;
    /** null without a provider key and a verified sending identity. */
    email: { apiKey: string; from: string } | null;
  };
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}\n\nSee .env.example.`);
  }

  const env = parsed.data;

  const config: AppConfig = {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    server: { port: env.API_PORT, host: env.API_HOST },
    riot: {
      apiKey: env.RIOT_API_KEY,
      platform: env.RIOT_PLATFORM_ROUTE,
      regional: env.RIOT_REGIONAL_ROUTE,
    },
    postgres: { connectionString: env.DATABASE_URL },
    redis: { url: env.REDIS_URL },
    clickhouse: {
      url: env.CLICKHOUSE_URL,
      database: env.CLICKHOUSE_DATABASE,
      admin: { username: env.CLICKHOUSE_USER, password: env.CLICKHOUSE_PASSWORD },
      gateway: {
        username: env.CLICKHOUSE_GATEWAY_USER,
        password: env.CLICKHOUSE_GATEWAY_PASSWORD,
      },
    },
    meta: {
      refreshIntervalMinutes: env.META_REFRESH_INTERVAL_MINUTES,
      compMinSampleSize: env.COMP_MIN_SAMPLE_SIZE,
    },
    jwtSecret: env.JWT_SECRET,
    webBaseUrl: env.WEB_BASE_URL.replace(/\/+$/, ''),
    apiPublicUrl: env.API_PUBLIC_URL.replace(/\/+$/, ''),
    // All three or none. A half-configured OAuth client fails at the redirect
    // with an opaque Riot error; failing here says which piece is missing.
    rso:
      env.RSO_CLIENT_ID && env.RSO_CLIENT_SECRET && env.RSO_REDIRECT_URI
        ? {
            clientId: env.RSO_CLIENT_ID,
            clientSecret: env.RSO_CLIENT_SECRET,
            redirectUri: env.RSO_REDIRECT_URI,
          }
        : null,
    privacy: { profileRetentionDays: env.PROFILE_RETENTION_DAYS },
    compliance: {
      tier3RecommendationsConfirmed: env.RIOT_TIER3_RECOMMENDATIONS_CONFIRMED,
      tier3ConfirmationRef: env.RIOT_TIER3_CONFIRMATION_REF ?? null,
    },
    editorialToken: env.EDITORIAL_API_TOKEN ?? null,
    drafter: env.ANTHROPIC_API_KEY
      ? { apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL }
      : null,
    delivery: {
      // Both keys or neither: half a VAPID pair fails at send time with an
      // opaque crypto error, which is a bad way to learn about a typo.
      webPush:
        env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
          ? {
              publicKey: env.VAPID_PUBLIC_KEY,
              privateKey: env.VAPID_PRIVATE_KEY,
              subject: env.VAPID_SUBJECT,
            }
          : null,
      // Likewise: a key without a verified From is rejected by the provider on
      // every send rather than at boot.
      email:
        env.RESEND_API_KEY && env.EMAIL_FROM
          ? { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }
          : null,
    },
  };

  assertTier3GateIsDefensible(config);
  return config;
}

/**
 * Refuses to boot with Tier-3 enabled but no confirmation reference recorded.
 *
 * A boolean alone is too easy to flip during a debugging session and forget.
 * Requiring a pointer to the written Riot answer means enabling Tier-3 is a
 * deliberate act with an audit trail attached (R3.7, R13.6).
 */
function assertTier3GateIsDefensible(config: AppConfig): void {
  const { tier3RecommendationsConfirmed, tier3ConfirmationRef } = config.compliance;
  if (tier3RecommendationsConfirmed && !tier3ConfirmationRef) {
    throw new Error(
      'RIOT_TIER3_RECOMMENDATIONS_CONFIRMED is true but RIOT_TIER3_CONFIRMATION_REF is empty.\n' +
        "Tier-3 adaptive recommendations may only be enabled with Riot's written confirmation " +
        'on file (requirements.md R3.7). Record the reference to that confirmation, or set the ' +
        'flag back to false. See docs/approvals.md.',
    );
  }
}
