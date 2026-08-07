/**
 * @tft-codex/shared-types — the single source of truth for data shapes shared
 * by the API, the Next.js web app, and the Overwolf companion (R10.2, R10.3).
 *
 * Types are defined as Zod schemas with inferred TypeScript types so the same
 * definition serves compile-time checking, runtime request validation, and the
 * API gateway's response allowlist (design.md §5).
 */
export * from './compliance.js';
export * from './game.js';
export * from './augment.js';
export * from './comp.js';
export * from './patch.js';
export * from './player.js';
export * from './lobby.js';
export * from './recommendation.js';
