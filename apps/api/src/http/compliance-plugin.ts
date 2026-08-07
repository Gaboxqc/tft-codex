/**
 * The last line of defence for R3.1.
 *
 * design.md §7 step 4 calls for a response-schema allowlist on `/v1/augments/*`
 * that strips any field not in the compliant `Augment` type, "belt-and-braces
 * for if a future engineer adds a field to the wrong type by mistake". This is
 * that, generalised slightly: it scans outbound payloads on the compliance-
 * sensitive routes for forbidden stat fields.
 *
 * It is the *third* layer, not the only one:
 *   1. The types have no field to carry the numbers (packages/shared-types).
 *   2. The gateway's ClickHouse credentials cannot read them (infra/clickhouse).
 *   3. This — which should therefore never fire.
 *
 * Behaviour differs by environment on purpose. In development and test it
 * throws, loudly, so the bug is found by the engineer who wrote it. In
 * production it strips the field and logs an alert: shipping a stripped
 * response is strictly better for the user than a 500, and strictly better for
 * us than a policy breach.
 *
 * _Requirements: 3.1, 3.6, 13.6_
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { FORBIDDEN_STAT_FIELDS, findForbiddenStatFields } from '@tft-codex/shared-types';

/** Routes where augment-derived data could plausibly appear. */
const GUARDED_ROUTE_PREFIXES = ['/v1/augments', '/v1/recommendations'] as const;

export interface ComplianceGuardOptions {
  /** Throw instead of stripping. Defaults to true outside production. */
  strict: boolean;
  onViolation?: (detail: { url: string; paths: string[] }) => void;
}

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const FORBIDDEN = new Set(FORBIDDEN_STAT_FIELDS.map(normalizeKey));

/** Recursively removes forbidden keys, returning a cleaned copy. */
export function stripForbiddenStatFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripForbiddenStatFields(entry)) as unknown as T;
  }
  if (value === null || typeof value !== 'object') return value;

  const cleaned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN.has(normalizeKey(key))) continue;
    cleaned[key] = stripForbiddenStatFields(entry);
  }
  return cleaned as T;
}

export function isGuardedRoute(url: string): boolean {
  return GUARDED_ROUTE_PREFIXES.some((prefix) => url.startsWith(prefix));
}

export function registerComplianceGuard(
  app: FastifyInstance,
  options: ComplianceGuardOptions,
): void {
  app.addHook(
    'preSerialization',
    async (request: FastifyRequest, _reply: FastifyReply, payload: unknown) => {
      if (!isGuardedRoute(request.url)) return payload;

      const hits = findForbiddenStatFields(payload);
      if (hits.length === 0) return payload;

      const paths = hits.map((hit) => hit.path);
      options.onViolation?.({ url: request.url, paths });

      if (options.strict) {
        throw new Error(
          `R3.1 violation on ${request.url}: forbidden augment stat field(s) at ${paths.join(', ')}. ` +
            'Augment win rate and average placement must never leave the server. ' +
            'See requirements.md R3.1 and design.md §7.',
        );
      }

      request.log.error(
        { url: request.url, paths },
        'R3.1 violation stripped from response — investigate immediately',
      );
      return stripForbiddenStatFields(payload);
    },
  );
}
