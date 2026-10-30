import type { Db } from '../../database/database.module';

/**
 * Which record a Person merged away was joined into (SKILL.md sections 3 and 7, decision 0408,
 * point 17). A record merged away resolves its scope through the record kept: the merge ended its
 * own pastoral position, so without this no leader's scope reaches the old page a saved link names.
 *
 * **Declared here and implemented in `people`, because the direction is a cycle**: `people`
 * imports this module, so it cannot be imported back (section 2 reserves a port for that case).
 * Optional, like the others: absent, a merged-away record resolves as itself and is refused to
 * every reader but a Whole Church or Network one, which is the narrower answer.
 */
export const MERGED_PERSONS_PORT = Symbol('MERGED_PERSONS_PORT');

export interface MergedPersonsPort {
  /** The record a Person was merged into, or null for one never merged away or unknown. */
  keptRecordOfWithin(executor: Db, personId: string): Promise<string | null>;
}
