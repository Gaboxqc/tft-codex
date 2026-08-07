import { describe, expect, it } from 'vitest';

import augmentFixture from './__fixtures__/augment.json' with { type: 'json' };
import championFixture from './__fixtures__/champion.json' with { type: 'json' };
import compFixture from './__fixtures__/comp.json' with { type: 'json' };
import {
  AugmentSchema,
  ChampionSchema,
  CompSchema,
  ItemSchema,
  LobbyIntelSchema,
  PatchVersionSchema,
  PlayerProfileSchema,
  RecommendationRequestSchema,
  RecommendationResponseSchema,
  TraitSchema,
} from './index.js';

describe('fixture parsing (_Requirements: 0.5_)', () => {
  it('parses a champion fixture', () => {
    const champion = ChampionSchema.parse(championFixture);
    expect(champion.cost).toBe(4);
    expect(champion.traits).toContain('TFT17_Sorcerer');
  });

  it('parses a comp fixture with computed stats', () => {
    const comp = CompSchema.parse(compFixture);
    expect(comp.tier).toBe('S');
    expect(comp.computedStats.sampleSize).toBeGreaterThan(0);
    expect(comp.units.filter((unit) => unit.role === 'carry')).toHaveLength(1);
  });

  it('parses an augment fixture', () => {
    const augment = AugmentSchema.parse(augmentFixture);
    expect(augment.tier).toBe('A');
    expect(augment.playRate).toBeCloseTo(0.094);
  });

  it('parses a trait fixture', () => {
    const trait = TraitSchema.parse({
      id: 'TFT17_Vanguard',
      name: 'Vanguard',
      type: 'class',
      breakpoints: [2, 4, 6],
    });
    expect(trait.breakpoints).toEqual([2, 4, 6]);
  });

  it('parses both a component and a completed item', () => {
    expect(
      ItemSchema.parse({
        id: 'TFT_Item_BFSword',
        name: 'B.F. Sword',
        components: null,
        tags: ['AD'],
      }).components,
    ).toBeNull();
    expect(
      ItemSchema.parse({
        id: 'TFT_Item_InfinityEdge',
        name: 'Infinity Edge',
        components: ['TFT_Item_BFSword', 'TFT_Item_SparringGloves'],
        tags: ['AD', 'crit'],
      }).components,
    ).toHaveLength(2);
  });

  it('parses a patch version with an unapproved meta summary', () => {
    const patch = PatchVersionSchema.parse({
      id: '17.9',
      setNumber: 17,
      setName: 'Into the Arcane',
      releaseDate: '2026-07-30',
      isCurrentPatch: true,
      balanceChanges: [
        {
          entityType: 'champion',
          entityId: 'TFT17_Zoe',
          summary: 'Spell damage 280/420/900 → 260/390/850',
        },
      ],
      metaImpactSummary: null,
    });
    // R8.2 — null until a human approves it.
    expect(patch.metaImpactSummary).toBeNull();
    expect(patch.archived).toBe(false);
  });

  it('parses a player profile storing only PUUID, region and Riot ID (R7.2)', () => {
    const profile = PlayerProfileSchema.parse({
      puuid: 'abc-123',
      region: 'euw1',
      riotId: 'Codex#EUW',
      linkedAt: '2026-08-01T00:00:00.000Z',
      lastSyncedAt: null,
    });
    expect(Object.keys(profile).sort()).toEqual(
      [
        'coachingNarrativeOptOut',
        'linkedAt',
        'lastSyncedAt',
        'notificationPrefs',
        'puuid',
        'region',
        'riotId',
      ].sort(),
    );
  });
});

describe('schema defaults encode compliance behaviour', () => {
  it('defaults a recommendation request to Tier-2 lookup mode (R3.7)', () => {
    const request = RecommendationRequestSchema.parse({ source: 'overwolf-overlay' });
    expect(request.mode).toBe('tier2-lookup');
  });

  it('requires the server to echo which mode it actually served (R3.7)', () => {
    const response = RecommendationResponseSchema.parse({
      suggestedComps: [],
      contextAware: false,
      modeServed: 'tier2-lookup',
    });
    expect(response.modeServed).toBe('tier2-lookup');

    expect(() =>
      RecommendationResponseSchema.parse({ suggestedComps: [], contextAware: false }),
    ).toThrow();
  });

  it('stamps every lobby intel entry from a single one-shot lookup (R14.2)', () => {
    const computedAt = '2026-08-07T09:31:00.000Z';
    const intel = LobbyIntelSchema.parse({
      matchId: 'EUW1_1234',
      computedAt,
      entries: [
        {
          puuid: 'p1',
          riotId: 'Rival#EUW',
          recentAvgPlacement: 3.9,
          mostPlayedComps: ['vanguard-zoe'],
          rankTier: 'DIAMOND II',
          computedAt,
        },
      ],
    });
    for (const entry of intel.entries) {
      expect(entry.computedAt).toBe(intel.computedAt);
    }
  });
});
