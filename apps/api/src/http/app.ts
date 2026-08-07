/**
 * Fastify application assembly.
 *
 * Kept separate from `server.ts` (which owns process concerns — listening,
 * signals, connection lifecycle) so integration tests can build an app against
 * fake repositories and drive it with `app.inject()`, without a socket or a
 * database in sight.
 */
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerComplianceGuard } from './compliance-plugin.js';
import type { AppContext } from './context.js';
import { registerCompRoutes } from './routes/comps.js';
import { registerMetaRoutes } from './routes/meta.js';

export interface BuildAppOptions {
  context: AppContext;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { context } = options;

  const app = Fastify({
    logger: options.logger ?? false,
    routerOptions: {
      // Riot match ids and comp slugs are case-sensitive; a case-insensitive
      // router would silently serve the wrong thing for a mistyped id.
      caseSensitive: true,
    },
  });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });

  // Registered before any route so no route can be added that bypasses it.
  registerComplianceGuard(app, {
    // Throw in dev/test so the engineer who introduced the leak finds it;
    // strip and alert in production, where a stripped response beats a 500 and
    // beats a policy breach (R3.1, R13.6).
    strict: !context.config.isProduction,
    onViolation: ({ url, paths }) => context.log(`R3.1 violation on ${url}`, paths),
  });

  app.get('/health', async () => ({ status: 'ok' }));

  await registerMetaRoutes(app, context);
  await registerCompRoutes(app, context);

  app.setNotFoundHandler(async (request, reply) =>
    reply.status(404).send({ error: 'not_found', detail: `No route for ${request.url}` }),
  );

  return app;
}
