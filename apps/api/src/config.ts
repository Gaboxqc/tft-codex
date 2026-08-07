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
  /** null until Riot issues RSO credentials — linking 503s in the meantime. */
  rso: { clientId: string; clientSecret: string; redirectUri: string } | null;
  privacy: { profileRetentionDays: number };
  compliance: {
    tier3RecommendationsConfirmed: boolean;
    tier3ConfirmationRef: string | null;
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
