/**
 * Static game entities — champions, traits, items.
 * Mirrors design.md §4. _Requirements: 1.1, 2.1_
 */
import { z } from 'zod';

export const ChampionCostSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type ChampionCost = z.infer<typeof ChampionCostSchema>;

export const ChampionSchema = z.object({
  /** Riot's data-dragon id, e.g. "TFT17_Zoe". */
  id: z.string().min(1),
  name: z.string().min(1),
  cost: ChampionCostSchema,
  /** Trait ids this champion belongs to. */
  traits: z.array(z.string().min(1)),
  patch: z.string().min(1),
});
export type Champion = z.infer<typeof ChampionSchema>;

export const TraitSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['origin', 'class']),
  /** Ascending unit counts that unlock each tier of the bonus, e.g. [2,4,6,8]. */
  breakpoints: z.array(z.number().int().positive()).min(1),
});
export type Trait = z.infer<typeof TraitSchema>;

export const ItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** null for basic components; a pair of component ids for completed items. */
  components: z.tuple([z.string(), z.string()]).nullable(),
  /** Free-form classifiers, e.g. ["AD", "tank", "aura"]. */
  tags: z.array(z.string()),
});
export type Item = z.infer<typeof ItemSchema>;

export const PLAYSTYLES = ['Reroll', 'Fast 8', 'Fast 9', 'Slow Roll', 'Standard'] as const;
export const PlaystyleSchema = z.enum(PLAYSTYLES);
export type Playstyle = z.infer<typeof PlaystyleSchema>;

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;
export const DifficultySchema = z.enum(DIFFICULTIES);
export type Difficulty = z.infer<typeof DifficultySchema>;

/** Confident tiers only. `provisional` is modelled separately — see comp.ts. */
export const TIERS = ['S', 'A', 'B', 'C'] as const;
export const TierSchema = z.enum(TIERS);
export type Tier = z.infer<typeof TierSchema>;
