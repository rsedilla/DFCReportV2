import { Inject, Injectable, Optional } from '@nestjs/common';
import { type Transaction } from 'kysely';

import { AuditService } from '../audit/audit.service';
import { type Actor } from '../auth/authorization/authorization.service';
import {
  InvariantViolationError,
  NotFoundError,
  ValidationFailedError,
} from '../common/errors/api-error';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { sameId } from '../common/identifiers';
import { DATABASE, type Db } from '../database/database.module';
import { lockPersonsWithin } from '../database/person-lock';
import { HierarchyService } from '../hierarchy/hierarchy.service';
import { NetworksService } from '../networks/networks.service';

import {
  ARCHIVE_ACCOUNTS_PORT,
  ARCHIVE_CELLS_PORT,
  type ArchiveAccountsPort,
  type ArchiveCellsPort,
} from './person-archive.ports';
import { composeName } from './people.shared';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { Database } from '../database/schema';

/** One reason a merge cannot be made yet, as the merge screen says it (decision 0408). */
export interface MergeRefusal {
  code:
    | 'SAME_PERSON'
    | 'ALREADY_MERGED'
    | 'HAS_ABSORBED'
    | 'OWN_RECORD'
    | 'KEPT_ARCHIVED'
    | 'DUPLICATE_IS_ROOT'
    | 'DIFFERENT_NETWORKS'
    | 'LEADS_A_CELL'
    | 'PASTORS_PEOPLE';
  message: string;
}

type PersonRow = {
  id: string;
  member_id: string;
  title: string | null;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  birth_date: string | null;
  mobile_number: string | null;
  mobile_number_normalized: string | null;
  merged_into_id: string | null;
};

/**
 * Person Merge (SKILL.md section 3, decision 0408): the Admin joins a duplicate record into the
 * record kept.
 *
 * **Nothing is rewritten.** The duplicate's attendance, lessons and graduations stay on their
 * own rows; every figure resolves them to the kept person when it is computed (point 10). What
 * the merge writes is the duplicate's `merged_into_id` with when, by whom and why, the end of
 * the duplicate's open pastoral assignment and Cell membership (points 1 and 2), the details the
 * kept record lacks (point 3), and the duplicate's account disabled (section 3).
 *
 * The refusals are one function, asked by the preview the screen reads and again inside the
 * merge's own transaction after both records are locked, so the screen and the write cannot
 * answer differently. The cells and accounts ports are the archive's (section 2): both
 * directions are cycles.
 */
@Injectable()
export class PeopleMergeService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly hierarchy: HierarchyService,
    private readonly networks: NetworksService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    @Optional() @Inject(ARCHIVE_CELLS_PORT) private readonly cells?: ArchiveCellsPort,
    @Optional() @Inject(ARCHIVE_ACCOUNTS_PORT) private readonly accounts?: ArchiveAccountsPort,
  ) {}

  /** What a merge of `duplicateId` into `keptId` would be refused for, now. Writes nothing. */
  async preview(
    keptId: string,
    duplicateId: string,
    actor: Actor,
  ): Promise<{ refusals: MergeRefusal[] }> {
    return this.db.transaction().execute(async (trx) => {
      const { kept, duplicate } = await this.pair(trx, keptId, duplicateId);
      return { refusals: await this.refusals(trx, kept, duplicate, actor) };
    });
  }

  /**
   * A merged record's read-only line (decision 0408, points 14 and 18): the record kept, when and
   * by whom, and not the reason, which stays in the audit log. Null for a record that was never
   * merged away, or that does not exist.
   */
  async mergedLineOf(personId: string): Promise<Record<string, unknown> | null> {
    const row = await this.db
      .selectFrom('persons as absorbed')
      .innerJoin('persons as kept', 'kept.id', 'absorbed.merged_into_id')
      .select([
        'absorbed.id as id',
        'absorbed.member_id as member_id',
        'absorbed.title as title',
        'absorbed.first_name as first_name',
        'absorbed.middle_name as middle_name',
        'absorbed.last_name as last_name',
        'absorbed.merged_at as merged_at',
        'absorbed.merged_by as merged_by',
        'kept.id as kept_id',
        'kept.member_id as kept_member_id',
        'kept.title as kept_title',
        'kept.first_name as kept_first_name',
        'kept.middle_name as kept_middle_name',
        'kept.last_name as kept_last_name',
      ])
      .where('absorbed.id', '=', personId)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    // Who merged it, by name where their account names a Person (section 6 allows an
    // administrator outside the tree, who still has one).
    let mergedBy: string | null = null;
    if (row.merged_by !== null && this.accounts) {
      const byPersonId = await this.accounts.personOfAccountWithin(this.db, row.merged_by);
      if (byPersonId !== null) {
        const by = await this.db
          .selectFrom('persons')
          .select(['title', 'first_name', 'middle_name', 'last_name'])
          .where('id', '=', byPersonId)
          .executeTakeFirst();
        mergedBy = by ? composeName(by) : null;
      }
    }

    return {
      id: row.id,
      member_id: row.member_id,
      full_name: composeName(row),
      merged: {
        into: {
          id: row.kept_id,
          member_id: row.kept_member_id,
          full_name: composeName({
            title: row.kept_title,
            first_name: row.kept_first_name,
            middle_name: row.kept_middle_name,
            last_name: row.kept_last_name,
          }),
        },
        merged_at: row.merged_at?.toISOString() ?? null,
        merged_by: mergedBy,
      },
    };
  }

  async merge(
    keptId: string,
    input: { duplicateId: string; reason: string },
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    const reason = input.reason.trim();
    if (reason === '') {
      throw new ValidationFailedError('Say why these are the same person.', { field: 'reason' });
    }
    const { cells, accounts } = this.ports();

    return this.db.transaction().execute(async (trx) => {
      // Both records, in one order, so two merges sharing a record wait for each other and
      // the second decides on what the first wrote (section 24).
      await lockPersonsWithin(trx, [keptId, input.duplicateId]);
      const { kept, duplicate } = await this.pair(trx, keptId, input.duplicateId);

      const refusals = await this.refusals(trx, kept, duplicate, actor);
      if (refusals.length > 0) {
        throw new InvariantViolationError(refusals[0].message, {
          refusals: refusals.map((refusal) => ({ code: refusal.code, message: refusal.message })),
        });
      }

      const at = new Date();

      // Point 3: a detail the kept record lacks is copied; where both have one, the kept stands.
      const copied: Record<string, string> = {};
      if (kept.birth_date === null && duplicate.birth_date !== null) {
        copied.birth_date = duplicate.birth_date;
      }
      if (kept.mobile_number === null && duplicate.mobile_number !== null) {
        copied.mobile_number = duplicate.mobile_number;
      }
      if (Object.keys(copied).length > 0) {
        await trx
          .updateTable('persons')
          .set({
            ...(copied.birth_date ? { birth_date: copied.birth_date } : {}),
            ...(copied.mobile_number
              ? {
                  mobile_number: duplicate.mobile_number,
                  mobile_number_normalized: duplicate.mobile_number_normalized,
                }
              : {}),
          })
          .where('id', '=', kept.id)
          .execute();
      }

      // Points 1 and 2: the duplicate's open edge and open membership end now.
      const ended = await this.hierarchy.endAssignmentWithin(trx, duplicate.id, at);
      const membership = await cells.endMembershipWithin(trx, duplicate.id, at, actor.accountId);

      await trx
        .updateTable('persons')
        .set({
          merged_into_id: kept.id,
          merged_at: at,
          merged_by: actor.accountId,
          merge_reason: reason,
        })
        .where('id', '=', duplicate.id)
        .execute();

      const account = await accounts.accountOfWithin(trx, duplicate.id);
      const disabled = account !== null && account.status !== 'DISABLED';

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'person.merged',
        targetType: 'person',
        targetId: duplicate.id,
        before: {
          pastoral_leader_id: ended?.leaderId ?? null,
          cell_id: membership?.cellId ?? null,
        },
        after: {
          merged_into_id: kept.id,
          merged_into_member_id: kept.member_id,
          reason,
          // The values written onto the record kept, which had none (point 3, section 21).
          copied_to_kept: copied,
          account_disabled: disabled,
        },
      });

      if (account !== null && disabled) {
        await accounts.disableWithin(trx, account.id, actor.accountId);
      }

      const body = {
        id: duplicate.id,
        member_id: duplicate.member_id,
        merged_into: { id: kept.id, member_id: kept.member_id, full_name: composeName(kept) },
        merged_at: at.toISOString(),
        copied: Object.keys(copied),
        account_disabled: disabled,
      };

      // Last statement (CLAUDE.md, Write endpoints).
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body });

      return body;
    });
  }

  private async pair(
    executor: Transaction<Database>,
    keptId: string,
    duplicateId: string,
  ): Promise<{ kept: PersonRow; duplicate: PersonRow }> {
    const rows = await executor
      .selectFrom('persons')
      .select([
        'id',
        'member_id',
        'title',
        'first_name',
        'middle_name',
        'last_name',
        'birth_date',
        'mobile_number',
        'mobile_number_normalized',
        'merged_into_id',
      ])
      .where('id', 'in', [keptId, duplicateId])
      .execute();
    const kept = rows.find((row) => sameId(row.id, keptId));
    const duplicate = rows.find((row) => sameId(row.id, duplicateId));
    if (kept === undefined || duplicate === undefined) {
      throw new NotFoundError('No such person.');
    }
    return { kept, duplicate };
  }

  /** Every reason the merge is refused now, in the order the screen states them. */
  private async refusals(
    executor: Transaction<Database>,
    kept: PersonRow,
    duplicate: PersonRow,
    actor: Actor,
  ): Promise<MergeRefusal[]> {
    const refusals: MergeRefusal[] = [];
    const duplicateName = `${composeName(duplicate)} (${duplicate.member_id})`;
    const keptName = `${composeName(kept)} (${kept.member_id})`;

    if (sameId(kept.id, duplicate.id)) {
      return [{ code: 'SAME_PERSON', message: 'Choose two different records.' }];
    }

    // Section 3: a Person is merged once, into a record never merged away.
    for (const record of [kept, duplicate]) {
      if (record.merged_into_id !== null) {
        refusals.push({
          code: 'ALREADY_MERGED',
          message: `${composeName(record)} (${record.member_id}) was already merged into another record.`,
        });
      }
    }
    if (refusals.length > 0) {
      return refusals;
    }

    // Point 9: a record that has absorbed another is not merged away, so no merge chains.
    const absorbed = await executor
      .selectFrom('persons')
      .select('id')
      .where('merged_into_id', '=', duplicate.id)
      .executeTakeFirst();
    if (absorbed !== undefined) {
      refusals.push({
        code: 'HAS_ABSORBED',
        message: `${duplicateName} has another record merged into it. Keep it, and swap which one is kept.`,
      });
    }

    // Disabling the Admin's own account mid-request would end their own session.
    if (actor.personId !== null && sameId(actor.personId, duplicate.id)) {
      refusals.push({
        code: 'OWN_RECORD',
        message: 'You can’t merge your own record away. Keep it instead.',
      });
    }

    // Point 8: the duplicate may be archived; the record kept must be current.
    const keptLifecycle = await executor
      .selectFrom('person_lifecycle')
      .select('state')
      .where('person_id', '=', kept.id)
      .where('ended_at', 'is', null)
      .executeTakeFirst();
    if (keptLifecycle?.state === 'ARCHIVED') {
      refusals.push({
        code: 'KEPT_ARCHIVED',
        message: `${keptName} is archived. Restore it first, or swap which one is kept.`,
      });
    }

    // Point 7: a root may be kept and is never absorbed.
    const assignment = await this.hierarchy.openAssignmentOf(executor, duplicate.id);
    if (assignment !== null && assignment.leaderId === null) {
      refusals.push({
        code: 'DUPLICATE_IS_ROOT',
        message: `${duplicateName} is a Network root. Keep it, and swap which one is kept.`,
      });
    }

    // Point 6: one Network, or the sex is corrected first.
    const now = new Date();
    const [keptNetwork, duplicateNetwork] = await Promise.all([
      this.networks.networkAsOf(executor, kept.id, now),
      this.networks.networkAsOf(executor, duplicate.id, now),
    ]);
    if (keptNetwork !== null && duplicateNetwork !== null && keptNetwork !== duplicateNetwork) {
      refusals.push({
        code: 'DIFFERENT_NETWORKS',
        message:
          'These two are in different Networks. Correct the sex on the record that is wrong first, then merge.',
      });
    }

    // Section 3: a duplicate who leads a Cell is not absorbed.
    const { cells } = this.ports();
    const led = await cells.ledCellsWithin(executor, duplicate.id);
    if (led.length > 0) {
      refusals.push({
        code: 'LEADS_A_CELL',
        message: `${duplicateName} leads ${led.map((cell) => cell.cellId).join(', ')}. Hand it over or close it first.`,
      });
    }

    // Point 5: nor while they pastor anyone; where each goes is a pastoral decision.
    const disciples = await this.hierarchy.openDisciplesOf(executor, duplicate.id);
    if (disciples.length > 0) {
      refusals.push({
        code: 'PASTORS_PEOPLE',
        message: `${duplicateName} pastors ${disciples.length} ${
          disciples.length === 1 ? 'person' : 'people'
        }. Move ${disciples.length === 1 ? 'them' : 'each of them'} to another leader first, then merge.`,
      });
    }

    return refusals;
  }

  private ports(): { cells: ArchiveCellsPort; accounts: ArchiveAccountsPort } {
    if (this.cells === undefined || this.accounts === undefined) {
      throw new InvariantViolationError(
        'This deployment cannot merge people: a port it needs is not bound.',
        {},
      );
    }
    return { cells: this.cells, accounts: this.accounts };
  }
}
