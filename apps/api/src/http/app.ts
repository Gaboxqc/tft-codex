/**
 * Fastify application assembly.
 *
 * Kept separate from `server.ts` (which owns process concerns — listening,
 * signals, connection lifecycle) so integration tests can build an app against
 * fake repositories and drive it with `app.inject()`, without a socket or a
 * database in sight.
 */
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerComplianceGuard } from './compliance-plugin.js';
import type { AppContext } from './context.js';
import { registerAugmentRoutes } from './routes/augments.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerBuilderRoutes } from './routes/builder.js';
import { registerCompRoutes } from './routes/comps.js';
import { registerDeliveryRoutes } from './routes/delivery.js';
import { registerEditorialRoutes } from './routes/editorial.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerPatchRoutes } from './routes/patches.js';
import { registerPlayerRoutes } from './routes/players.js';
import { registerRecommendationRoutes } from './routes/recommendations.js';
import { registerReferenceRoutes } from './routes/reference.js';

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
    // Credentials must be allowed for the session cookie to survive the
    // cross-origin hop from the web app to the API in development, where they
    // sit on different ports.
    origin: context.config.isProduction ? context.config.webBaseUrl : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });

  await app.register(cookie);

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
  await registerAugmentRoutes(app, context);
  await registerRecommendationRoutes(app, context);
  await registerReferenceRoutes(app, context);
  await registerAuthRoutes(app, context);
  await registerPlayerRoutes(app, context);
  await registerEditorialRoutes(app, context);
  await registerDeliveryRoutes(app, context);
  await registerBuilderRoutes(app, context);
  await registerPatchRoutes(app, context);

  app.setNotFoundHandler(async (request, reply) =>
    reply.status(404).send({ error: 'not_found', detail: `No route for ${request.url}` }),
  );

  return app;
}
