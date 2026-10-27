import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'kysely';

import { AuditService } from '../audit/audit.service';
import { AuthorizationService, type Actor } from '../auth/authorization/authorization.service';
import { Capability } from '../auth/authorization/capabilities';
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

import {
  ARCHIVE_ACCOUNTS_PORT,
  ARCHIVE_CELLS_PORT,
  type ArchiveAccountsPort,
  type ArchiveCellsPort,
} from './person-archive.ports';
import { composeName } from './people.shared';

import type { CurrentClaim } from '../common/idempotency/current-idempotency.decorator';
import type { ArchiveReason } from '../database/schema';

/** The reasons an archive may give now (SKILL.md section 3, decision 0397). */
export const ARCHIVE_REASONS = [
  'WORKING_AWAY',
  'STUDYING_AWAY',
  'MOVED_AWAY',
  'ATTENDS_ANOTHER_CHURCH',
  'PASSED_AWAY',
  'RECORD_CREATED_IN_ERROR',
  'OTHER',
] as const satisfies readonly ArchiveReason[];

export type GivenArchiveReason = (typeof ARCHIVE_REASONS)[number];

/** A Person's archived line, for their page (decision 0397, point 10), or null when current. */
export interface ArchivedLine {
  archived_at: string;
  reason: ArchiveReason | null;
  note: string | null;
}

/**
 * Archiving and restoring a Person (SKILL.md sections 3 and 6, decision 0397), and the two
 * reads that go with them: the Admin's *Archived* list and a person page's archived line.
 *
 * **One transaction does the whole archive**, because section 3 asks that nothing about the
 * Person be left half-changed: the lifecycle rows, the pastoral edge `hierarchy` owns, the
 * Cell membership `cells` owns and the account `auth` owns are each written by their owning
 * module, the last two through ports because both directions are cycles (section 2).
 *
 * The order is the reassignment's — lock, then decide, then write, then record the
 * completion last (section 24, CLAUDE.md *Write endpoints*).
 */
@Injectable()
export class PeopleLifecycleService {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly authorization: AuthorizationService,
    private readonly hierarchy: HierarchyService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    @Optional() @Inject(ARCHIVE_CELLS_PORT) private readonly cells?: ArchiveCellsPort,
    @Optional() @Inject(ARCHIVE_ACCOUNTS_PORT) private readonly accounts?: ArchiveAccountsPort,
  ) {}

  async archive(
    personId: string,
    input: { reason: GivenArchiveReason; note?: string; accountAccess?: 'DISABLE' | 'KEEP' },
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    const { cells, accounts } = this.ports();
    const note = input.note?.trim() === '' ? undefined : input.note?.trim();

    if (input.reason === 'OTHER' && note === undefined) {
      throw new ValidationFailedError('Other needs a comment saying why.', { field: 'note' });
    }

    // Section 6: keeping or disabling an account is an account decision, so whoever makes it
    // must hold `accounts.manage` over this same Person. Asked before the transaction, as
    // the reassignment asks its second capability, because nothing in it changes the answer.
    if (input.accountAccess !== undefined) {
      await this.authorization.authorize(actor, Capability.AccountsManage, {
        kind: 'person',
        personId,
      });
    }

    return this.db.transaction().execute(async (trx) => {
      await lockPersonsWithin(trx, [personId]);

      const person = await trx
        .selectFrom('persons')
        .select([
          'id',
          'member_id',
          'title',
          'first_name',
          'middle_name',
          'last_name',
          'merged_into_id',
        ])
        .where('id', '=', personId)
        .executeTakeFirst();

      if (person === undefined) {
        throw new NotFoundError('No such person.');
      }

      if (person.merged_into_id !== null) {
        throw new InvariantViolationError(
          'That person was absorbed by a merge. Archive the surviving record instead.',
          { person_id: personId, merged_into_id: person.merged_into_id },
        );
      }

      if (actor.personId !== null && sameId(actor.personId, personId)) {
        throw new InvariantViolationError('You can’t archive yourself.', { person_id: personId });
      }

      const lifecycle = await trx
        .selectFrom('person_lifecycle')
        .select(['id', 'state'])
        .where('person_id', '=', personId)
        .where('ended_at', 'is', null)
        .executeTakeFirst();

      if (lifecycle?.state === 'ARCHIVED') {
        throw new InvariantViolationError('That person is already archived.', {
          person_id: personId,
        });
      }

      const assignment = await this.hierarchy.openAssignmentOf(trx, personId);

      if (assignment !== null && assignment.leaderId === null) {
        // Section 5 gives a root's seat no succession, so archiving its holder would leave a
        // Network with no root and nothing that could seat another.
        throw new InvariantViolationError(
          'That person is a Network root. A root is not archived (SKILL.md section 5).',
          { person_id: personId },
        );
      }

      const led = await cells.ledCellsWithin(trx, personId);

      if (led.length > 0) {
        // Section 3 names what must be resolved first rather than closing the Cells.
        const named = led
          .map(
            (cell) =>
              `${cell.cellId} (${cell.members} ${cell.members === 1 ? 'member' : 'members'})`,
          )
          .join(', ');
        throw new InvariantViolationError(
          `${composeName(person)} leads ${named}. Hand ${led.length === 1 ? 'it' : 'them'} over ` +
            'or close ' +
            (led.length === 1 ? 'it' : 'them') +
            ' first (SKILL.md section 3).',
          {
            person_id: personId,
            cells: led.map((cell) => ({
              id: cell.id,
              cell_id: cell.cellId,
              members: cell.members,
            })),
          },
        );
      }

      const account = await accounts.accountOfWithin(trx, personId);
      const asksAboutAccess = account !== null && account.status !== 'DISABLED';

      if (asksAboutAccess && input.accountAccess === undefined) {
        throw new ValidationFailedError(
          'This person has an account. Choose whether to disable it or keep it (SKILL.md section 6).',
          { field: 'account_access' },
        );
      }

      // Read after the lock, as the reassignment does, so a request that waited is stamped
      // after the one it waited for.
      const at = new Date();

      if (lifecycle !== undefined) {
        await trx
          .updateTable('person_lifecycle')
          .set({ ended_at: at })
          .where('id', '=', lifecycle.id)
          .execute();
      }

      await trx
        .insertInto('person_lifecycle')
        .values({
          person_id: personId,
          state: 'ARCHIVED',
          reason: input.reason,
          note: note ?? null,
          actor_id: actor.accountId,
          started_at: at,
        })
        .execute();

      const ended = await this.hierarchy.endAssignmentWithin(trx, personId, at);
      const membership = await cells.endMembershipWithin(trx, personId, at, actor.accountId);
      const accountAccess = asksAboutAccess ? (input.accountAccess ?? null) : null;

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'person.archived',
        targetType: 'person',
        targetId: personId,
        before: {
          state: 'CURRENT',
          pastoral_leader_id: ended?.leaderId ?? null,
          cell_id: membership?.cellId ?? null,
        },
        after: {
          state: 'ARCHIVED',
          reason: input.reason,
          note: note ?? null,
          // The decision itself is the auditable fact (section 6), so it is written
          // whichever was chosen, and null where there was no account to decide about.
          account_access: accountAccess,
        },
      });

      if (account !== null && accountAccess === 'DISABLE') {
        await accounts.disableWithin(trx, account.id, actor.accountId);
      }

      const body = {
        id: personId,
        state: 'ARCHIVED',
        archived_at: at.toISOString(),
        reason: input.reason,
        note: note ?? null,
        account_access: accountAccess,
      };

      // Last statement (CLAUDE.md, Write endpoints).
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body });

      return body;
    });
  }

  /**
   * Back to `CURRENT`, and nothing else (sections 3, 5, 6 and 10): no account, Cell or
   * pastoral leader comes back, each being its own act.
   */
  async restore(
    personId: string,
    actor: Actor,
    claim: CurrentClaim,
  ): Promise<Record<string, unknown>> {
    return this.db.transaction().execute(async (trx) => {
      await lockPersonsWithin(trx, [personId]);

      const person = await trx
        .selectFrom('persons')
        .select(['id', 'merged_into_id'])
        .where('id', '=', personId)
        .executeTakeFirst();

      if (person === undefined) {
        throw new NotFoundError('No such person.');
      }

      if (person.merged_into_id !== null) {
        throw new InvariantViolationError('That person was absorbed by a merge.', {
          person_id: personId,
          merged_into_id: person.merged_into_id,
        });
      }

      const lifecycle = await trx
        .selectFrom('person_lifecycle')
        .select(['id', 'state', 'reason'])
        .where('person_id', '=', personId)
        .where('ended_at', 'is', null)
        .executeTakeFirst();

      if (lifecycle?.state !== 'ARCHIVED') {
        throw new InvariantViolationError('That person is not archived.', {
          person_id: personId,
        });
      }

      const at = new Date();

      await trx
        .updateTable('person_lifecycle')
        .set({ ended_at: at })
        .where('id', '=', lifecycle.id)
        .execute();

      await trx
        .insertInto('person_lifecycle')
        .values({
          person_id: personId,
          state: 'CURRENT',
          actor_id: actor.accountId,
          started_at: at,
        })
        .execute();

      await this.audit.writeWithin(trx, {
        actorId: actor.accountId,
        action: 'person.restored',
        targetType: 'person',
        targetId: personId,
        before: { state: 'ARCHIVED', reason: lifecycle.reason },
        after: { state: 'CURRENT' },
      });

      const body = { id: personId, state: 'CURRENT', restored_at: at.toISOString() };

      // Last statement (CLAUDE.md, Write endpoints).
      await this.idempotency.completeWithin(trx, { ...claim, status: 200, body });

      return body;
    });
  }

  /** The archived line for a person's page, or null when they are current. */
  async archivedLineOf(personId: string): Promise<ArchivedLine | null> {
    const row = await this.db
      .selectFrom('person_lifecycle')
      .select(['state', 'reason', 'note', 'started_at'])
      .where('person_id', '=', personId)
      .where('ended_at', 'is', null)
      .executeTakeFirst();

    return row?.state === 'ARCHIVED'
      ? { archived_at: row.started_at.toISOString(), reason: row.reason, note: row.note }
      : null;
  }

  /**
   * Everyone archived, newest first (decision 0397, point 9), for the Admin's *Archived*
   * view, with the pastoral leader and Cell they had when they were archived. A cursor of
   * the archive instant and the Person's identifier.
   */
  async archivedPage(
    limit: number,
    cursor: { archivedAt: string; id: string } | null,
  ): Promise<{
    rows: Record<string, unknown>[];
    nextCursor: { archivedAt: string; id: string } | null;
  }> {
    const result = await sql<{
      id: string;
      member_id: string;
      title: string | null;
      first_name: string;
      middle_name: string | null;
      last_name: string;
      archived_at: Date;
      reason: ArchiveReason | null;
      note: string | null;
    }>`
      SELECT p.id, p.member_id, p.title, p.first_name, p.middle_name, p.last_name,
             life.started_at AS archived_at, life.reason, life.note
      FROM person_lifecycle life
      JOIN persons p ON p.id = life.person_id
      WHERE life.ended_at IS NULL
        AND life.state = 'ARCHIVED'
        AND p.merged_into_id IS NULL
        ${
          cursor === null
            ? sql``
            : sql`AND (life.started_at, p.id) < (${cursor.archivedAt}::timestamptz, ${cursor.id}::uuid)`
        }
      ORDER BY life.started_at DESC, p.id DESC
      LIMIT ${limit + 1}
    `.execute(this.db);

    const page = result.rows.slice(0, limit);
    const last = page[page.length - 1];
    const ids = page.map((row) => row.id);
    // An archive ends both rows and a restore reopens neither, so each person's latest is
    // the one they had when they were last archived.
    const [leaders, lastCells] = await Promise.all([
      this.hierarchy.latestLeadersOf(this.db, ids),
      this.ports().cells.latestCellsOf(ids),
    ]);
    const leaderNames = await this.namesOf([...new Set(leaders.values())]);

    return {
      rows: page.map((row) => {
        const leaderId = leaders.get(row.id) ?? null;
        return {
          id: row.id,
          member_id: row.member_id,
          full_name: composeName(row),
          archived_at: row.archived_at.toISOString(),
          reason: row.reason,
          note: row.note,
          leader:
            leaderId === null
              ? null
              : { person_id: leaderId, full_name: leaderNames.get(leaderId) ?? '' },
          cell: lastCells.get(row.id) ?? null,
        };
      }),
      nextCursor:
        result.rows.length > limit && last !== undefined
          ? { archivedAt: last.archived_at.toISOString(), id: last.id }
          : null,
    };
  }

  private async namesOf(personIds: readonly string[]): Promise<Map<string, string>> {
    if (personIds.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .selectFrom('persons')
      .select(['id', 'title', 'first_name', 'middle_name', 'last_name'])
      .where('id', 'in', [...personIds])
      .execute();

    return new Map(rows.map((row) => [row.id, composeName(row)]));
  }

  /** Refuses rather than half-archiving when a port is not bound. */
  private ports(): { cells: ArchiveCellsPort; accounts: ArchiveAccountsPort } {
    if (this.cells === undefined || this.accounts === undefined) {
      throw new InvariantViolationError(
        'This deployment cannot archive a person: a port it needs is not bound.',
        {},
      );
    }

    return { cells: this.cells, accounts: this.accounts };
  }
}
