/**
 * Editorial route tests (tasks 6.1, 6.2).
 *
 * _Requirements: 8.1, 8.2_
 */
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { buildTestContext } from '../test-context.js';

let app: FastifyInstance | undefined;

const TOKEN = 'editorial-token-long-enough-for-the-schema';

const headers = { authorization: `Bearer ${TOKEN}`, 'x-editor-name': 'Gabox' };

const start = async (options: Parameters<typeof buildTestContext>[0] = {}) => {
  const { context } = buildTestContext({
    config: { editorialToken: TOKEN },
    ...options,
  });
  app = await buildApp({ context });
  return { app, context };
};

afterEach(async () => {
  await app?.close();
  app = undefined;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (result: { json: () => unknown }): any => result.json();

describe('Editorial auth (_Requirements: 8.2_)', () => {
  it('503s when no editorial token is configured', async () => {
    // Closed by default. A guard that falls open when unconfigured looks like
    // a guard and is not one.
    const { app } = await start({ config: { editorialToken: null } });
    const result = await app.inject({
      url: '/v1/editorial/patches/17.9/meta-summary',
      headers,
    });

    expect(result.statusCode).toBe(503);
    expect(json(result).error).toBe('editorial_disabled');
  });

  it('401s without a token', async () => {
    const { app } = await start();
    const result = await app.inject({ url: '/v1/editorial/patches/17.9/meta-summary' });
    expect(result.statusCode).toBe(401);
  });

  it('401s on a wrong token', async () => {
    const { app } = await start();
    const result = await app.inject({
      url: '/v1/editorial/patches/17.9/meta-summary',
      headers: { authorization: 'Bearer not-the-token-but-the-same-length!!', ...{} },
    });
    expect(result.statusCode).toBe(401);
  });

  it('400s when the approval is not attributed to anyone', async () => {
    // R8.2 wants editorial approval; an approval nobody is accountable for is
    // a rubber stamp, so the name is required rather than optional.
    const { app } = await start();
    const result = await app.inject({
      url: '/v1/editorial/patches/17.9/meta-summary',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(result.statusCode).toBe(400);
    expect(json(result).error).toBe('editor_name_required');
  });

  it('does not leak whether a player session would work here', async () => {
    // A player token must not open an editorial route, and the failure must
    // not distinguish itself from any other bad credential.
    const { app } = await start();
    const result = await app.inject({
      url: '/v1/editorial/patches/17.9/meta-summary',
      headers: { authorization: 'Bearer some.player.jwt', 'x-editor-name': 'Gabox' },
    });

    expect(result.statusCode).toBe(401);
    expect(json(result)).toEqual({ error: 'unauthenticated' });
  });
});

describe('Balance changes (_Requirements: 8.1_)', () => {
  it('separates the detected rows from the hand-written ones', async () => {
    const { app } = await start({
      balanceChanges: [
        {
          entityType: 'champion',
          entityId: 'TFT17_Sett',
          summary: 'Sett shop cost increased from 4 to 5.',
          source: 'data-dragon',
        },
        {
          entityType: 'champion',
          entityId: 'TFT17_Zoe',
          summary: 'Spell damage 280/420/900 → 260/390/850.',
          source: 'editorial',
        },
      ],
    });

    const body = json(
      await app.inject({ url: '/v1/editorial/patches/17.9/balance-changes', headers }),
    );

    expect(body.detected).toHaveLength(1);
    expect(body.editorial).toHaveLength(1);
    expect(body.editorial[0].entityId).toBe('TFT17_Zoe');
  });

  it('keeps detected rows when the editorial half is replaced', async () => {
    const { app, context } = await start({
      balanceChanges: [
        {
          entityType: 'champion',
          entityId: 'TFT17_Sett',
          summary: 'Sett shop cost increased from 4 to 5.',
          source: 'data-dragon',
        },
      ],
    });

    const result = await app.inject({
      method: 'PUT',
      url: '/v1/editorial/patches/17.9/balance-changes',
      headers,
      payload: {
        changes: [
          {
            entityType: 'champion',
            entityId: 'TFT17_Zoe',
            summary: 'Spell damage 280/420/900 → 260/390/850.',
          },
        ],
      },
    });

    expect(result.statusCode).toBe(200);

    const written = (
      context.patches.saveBalanceChanges as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock.calls[0]![1] as { entityId: string; source: string }[];

    expect(written).toHaveLength(2);
    expect(written.find((change) => change.entityId === 'TFT17_Sett')?.source).toBe('data-dragon');
    expect(written.find((change) => change.entityId === 'TFT17_Zoe')?.source).toBe('editorial');
  });

  it('always labels a written row editorial, whatever the client claims', async () => {
    // Accepting `source` from the caller would let a row be labelled
    // data-dragon and then silently deleted by the next ingestion run.
    const { app, context } = await start();

    await app.inject({
      method: 'PUT',
      url: '/v1/editorial/patches/17.9/balance-changes',
      headers,
      payload: {
        changes: [
          {
            entityType: 'champion',
            entityId: 'TFT17_Zoe',
            summary: 'Hand written.',
            source: 'data-dragon',
          },
        ],
      },
    });

    const written = (
      context.patches.saveBalanceChanges as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock.calls[0]![1] as { source: string }[];

    expect(written[0]!.source).toBe('editorial');
  });

  it('lets an editorial row supersede a detected one for the same entity', async () => {
    const { app, context } = await start({
      balanceChanges: [
        {
          entityType: 'champion',
          entityId: 'TFT17_Zoe',
          summary: 'Zoe shop cost reduced from 5 to 4.',
          source: 'data-dragon',
        },
      ],
    });

    await app.inject({
      method: 'PUT',
      url: '/v1/editorial/patches/17.9/balance-changes',
      headers,
      payload: {
        changes: [
          { entityType: 'champion', entityId: 'TFT17_Zoe', summary: 'A fuller description.' },
        ],
      },
    });

    const written = (
      context.patches.saveBalanceChanges as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock.calls[0]![1] as { summary: string }[];

    expect(written).toHaveLength(1);
    expect(written[0]!.summary).toBe('A fuller description.');
  });

  it('404s an unknown patch', async () => {
    const { app } = await start();
    const result = await app.inject({ url: '/v1/editorial/patches/99.9/balance-changes', headers });
    expect(result.statusCode).toBe(404);
  });

  it('rejects a malformed payload', async () => {
    const { app } = await start();
    const result = await app.inject({
      method: 'PUT',
      url: '/v1/editorial/patches/17.9/balance-changes',
      headers,
      payload: { changes: [{ entityType: 'spaceship', entityId: 'x', summary: 'y' }] },
    });
    expect(result.statusCode).toBe(400);
  });
});

describe('Meta summary review (_Requirements: 8.2_)', () => {
  it('reports a pending draft as awaiting review', async () => {
    const { app } = await start({ metaSummaryDraft: 'Vanguard Zoe fell a tier.' });
    const body = json(
      await app.inject({ url: '/v1/editorial/patches/17.9/meta-summary', headers }),
    );

    expect(body.status).toBe('awaiting-review');
    expect(body.draft).toBe('Vanguard Zoe fell a tier.');
    expect(body.published).toBeNull();
  });

  it('reports no-draft distinctly from awaiting-review', async () => {
    const { app } = await start();
    expect(
      json(await app.inject({ url: '/v1/editorial/patches/17.9/meta-summary', headers })).status,
    ).toBe('no-draft');
  });

  it('publishes the approved text under the approver’s name', async () => {
    const { app, context } = await start({ metaSummaryDraft: 'A draft with a typo.' });

    const result = await app.inject({
      method: 'POST',
      url: '/v1/editorial/patches/17.9/meta-summary',
      headers,
      payload: { summary: 'A draft with the typo fixed.' },
    });

    expect(result.statusCode).toBe(200);
    expect(context.patches.approveMetaSummaryAs).toHaveBeenCalledWith(
      '17.9',
      'A draft with the typo fixed.',
      'Gabox',
    );
  });

  it('publishes what the editor sent, not what the model wrote', async () => {
    // Correcting the draft is most of what reviewing one consists of, so the
    // approved text is the body — never a copy of the draft column.
    const { app, context } = await start({ metaSummaryDraft: 'Model text.' });

    await app.inject({
      method: 'POST',
      url: '/v1/editorial/patches/17.9/meta-summary',
      headers,
      payload: { summary: 'Editor text.' },
    });

    const [, published] = (
      context.patches.approveMetaSummaryAs as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock.calls[0]!;

    expect(published).toBe('Editor text.');
  });

  it('discards a draft without publishing anything', async () => {
    const { app, context } = await start({ metaSummaryDraft: 'Not good enough.' });

    const result = await app.inject({
      method: 'DELETE',
      url: '/v1/editorial/patches/17.9/meta-summary',
      headers,
    });

    expect(result.statusCode).toBe(200);
    expect(context.patches.discardMetaSummaryDraft).toHaveBeenCalledWith('17.9');
    expect(context.patches.approveMetaSummaryAs).not.toHaveBeenCalled();
  });

  it('rejects an empty approval', async () => {
    const { app } = await start();
    const result = await app.inject({
      method: 'POST',
      url: '/v1/editorial/patches/17.9/meta-summary',
      headers,
      payload: { summary: '' },
    });
    expect(result.statusCode).toBe(400);
  });
});
