import { sql, type RawBuilder } from 'kysely';

/**
 * Every Person merge, as two parallel lists: `absorbed[i]` was merged into `kept[i]`
 * (SKILL.md section 3, decision 0408). `people` owns the identity and hands it out
 * (`PeopleReadService.mergedPairsWithin`); a module counting people resolves its own rows with
 * it, so no module reads `persons` to count (section 2).
 *
 * One step is always enough: a merge never chains (migration 0033), so every absorbed record
 * names a record kept that was never merged away. **The pairs are ordered oldest absorbed
 * record first**, so a later index is the newer duplicate (decision 0408, point 15).
 */
export interface MergedPairs {
  absorbed: string[];
  kept: string[];
}

export const NO_MERGES: MergedPairs = { absorbed: [], kept: [] };

/**
 * A `merged(absorbed_id, kept_id)` common table expression over the pairs, for a statement's
 * `WITH` list. Merges are few, so they travel as two parameters rather than as a join.
 */
export function mergedCte(pairs: MergedPairs): RawBuilder<unknown> {
  return sql`merged AS (
    SELECT absorbed_id, kept_id
      FROM unnest(${pairs.absorbed}::uuid[], ${pairs.kept}::uuid[]) AS m (absorbed_id, kept_id)
  )`;
}

/** The record kept for an id, in memory: itself unless it was merged away. */
export function resolverOf(pairs: MergedPairs): (personId: string) => string {
  const kept = new Map<string, string>();
  pairs.absorbed.forEach((absorbed, index) => kept.set(absorbed.toLowerCase(), pairs.kept[index]));
  return (personId) => kept.get(personId.toLowerCase()) ?? personId;
}
