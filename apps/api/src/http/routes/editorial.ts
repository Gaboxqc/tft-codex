/**
 * Editorial routes (tasks 6.1, 6.2, and the start of 2.11).
 *
 * `GET    /v1/editorial/patches/:id/balance-changes`  what is recorded now
 * `PUT    /v1/editorial/patches/:id/balance-changes`  the hand-written half
 * `GET    /v1/editorial/patches/:id/meta-summary`     draft vs published
 * `POST   /v1/editorial/patches/:id/meta-summary`     approve and publish
 * `DELETE /v1/editorial/patches/:id/meta-summary`     discard the draft
 *
 * Two things these routes exist to make possible:
 *
 * **The numbers Data Dragon cannot see.** Riot's static data carries no
 * ability values or trait breakpoints (see `balance-diff.ts`), so a real
 * balance patch is largely invisible to the ingestion job. The PUT here is
 * where a person types those in, and the job is written never to overwrite
 * them.
 *
 * **R8.2's approval step.** A drafted summary is not published copy. The only
 * route that writes the column the public API serves is the POST below, it
 * takes the approved text as its body so an editor can correct on the way
 * through, and it records who approved it.
 *
 * _Requirements: 8.1, 8.2_
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AppContext } from '../context.js';
import { makeRequireEditor } from '../require-editor.js';

/**
 * Editorial balance changes.
 *
 * `source` is not accepted from the client: everything written here is
 * editorial by definition, and letting a caller label a row `data-dragon`
 * would let it be silently overwritten by the next ingestion run.
 */
const EditorialChangesSchema = z.object({
  changes: z
    .array(
      z.object({
        entityType: z.enum(['champion', 'trait', 'item', 'augment']),
        entityId: z.string().min(1).max(120),
        summary: z.string().min(1).max(500),
      }),
    )
    .max(200),
});

const ApprovalSchema = z.object({
  summary: z.string().min(1).max(2000),
});

export async function registerEditorialRoutes(
  app: FastifyInstance,
  context: AppContext,
): Promise<void> {
  const requireEditor = makeRequireEditor(context);

  app.get<{ Params: { id: string } }>(
    '/v1/editorial/patches/:id/balance-changes',
    async (request, reply) => {
      if (!(await requireEditor(request, reply))) return reply;

      const patch = await context.patches.findById(request.params.id);
      if (!patch) return reply.status(404).send({ error: 'patch_not_found' });

      reply.header('cache-control', 'no-store');
      return {
        patch: patch.id,
        // Split so the screen can show which rows a re-run will replace and
        // which are the editor's own.
        editorial: patch.balanceChanges.filter((change) => change.source === 'editorial'),
        detected: patch.balanceChanges.filter((change) => change.source === 'data-dragon'),
      };
    },
  );

  /**
   * Replaces the editorial balance changes, leaving the detected ones alone.
   *
   * Wholesale within the editorial half, for the same reason the notification
   * preferences are: the screen sends the complete list it is showing, and a
   * partial upsert would leave a deleted row alive.
   */
  app.put<{ Params: { id: string } }>(
    '/v1/editorial/patches/:id/balance-changes',
    async (request, reply) => {
      if (!(await requireEditor(request, reply))) return reply;

      const parsed = EditorialChangesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid_request',
          detail: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
        });
      }

      const patch = await context.patches.findById(request.params.id);
      if (!patch) return reply.status(404).send({ error: 'patch_not_found' });

      const detected = patch.balanceChanges.filter((change) => change.source === 'data-dragon');
      const editorial = parsed.data.changes.map((change) => ({
        ...change,
        source: 'editorial' as const,
      }));

      // An editorial row wins over a detected one for the same entity: a
      // person's account of a change is the more informative of the two.
      const claimed = new Set(editorial.map((change) => `${change.entityType}:${change.entityId}`));
      const merged = [
        ...editorial,
        ...detected.filter((change) => !claimed.has(`${change.entityType}:${change.entityId}`)),
      ];

      await context.patches.saveBalanceChanges(
        patch.id,
        merged,
        (await context.patches.dataDragonVersion(patch.id)) ?? '',
      );

      reply.header('cache-control', 'no-store');
      return { patch: patch.id, editorial: editorial.length, detected: detected.length };
    },
  );

  // ── Meta summary review (R8.2) ───────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    '/v1/editorial/patches/:id/meta-summary',
    async (request, reply) => {
      if (!(await requireEditor(request, reply))) return reply;

      const review = await context.patches.metaSummaryReview(request.params.id);
      if (!review) return reply.status(404).send({ error: 'patch_not_found' });

      reply.header('cache-control', 'no-store');
      return {
        patch: request.params.id,
        ...review,
        // Spelled out rather than left to be inferred from two nullable
        // fields, so a review queue cannot mislabel a row.
        status: review.published ? 'published' : review.draft ? 'awaiting-review' : 'no-draft',
      };
    },
  );

  /**
   * Approves and publishes (R8.2).
   *
   * The approved text comes from the body rather than being copied from the
   * draft column, because correcting the draft is most of what reviewing one
   * consists of. Approving is therefore always an explicit statement of what
   * is being published, not a nod at whatever the model happened to write.
   */
  app.post<{ Params: { id: string } }>(
    '/v1/editorial/patches/:id/meta-summary',
    async (request, reply) => {
      if (!(await requireEditor(request, reply))) return reply;

      const parsed = ApprovalSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' });

      const patch = await context.patches.findById(request.params.id);
      if (!patch) return reply.status(404).send({ error: 'patch_not_found' });

      await context.patches.approveMetaSummaryAs(
        patch.id,
        parsed.data.summary,
        request.editorName!,
      );

      context.log(`meta summary for patch ${patch.id} approved by ${request.editorName!}`);

      reply.header('cache-control', 'no-store');
      return { patch: patch.id, published: true, approvedBy: request.editorName! };
    },
  );

  /** Discards a draft an editor does not want to publish or keep. */
  app.delete<{ Params: { id: string } }>(
    '/v1/editorial/patches/:id/meta-summary',
    async (request, reply) => {
      if (!(await requireEditor(request, reply))) return reply;

      const patch = await context.patches.findById(request.params.id);
      if (!patch) return reply.status(404).send({ error: 'patch_not_found' });

      await context.patches.discardMetaSummaryDraft(patch.id);

      reply.header('cache-control', 'no-store');
      return { patch: patch.id, discarded: true };
    },
  );
}
