import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { DATABASE, type Db } from '../database/database.module';

import { CellsReadService } from './cells.read.service';

import type { Database } from '../database/schema';
import type { ArchiveCellsPort, LedCell } from '../people/person-archive.ports';
import type { Transaction } from 'kysely';

/**
 * `cells`' half of archiving a Person (SKILL.md sections 3 and 10, decision 0397), behind
 * `people`'s `ARCHIVE_CELLS_PORT`.
 *
 * Archiving somebody who leads a Cell is refused, naming each Cell and how many members it
 * has, so the archiver knows what has to be handed over or closed first. Archiving anybody
 * else ends their Cell membership, keeping the row, and is audited exactly as removing a
 * member is (`cell_membership.ended`), so a Cell's history reads the same whichever way
 * somebody left it.
 */
@Injectable()
export class PersonArchiveCellsAdapter implements ArchiveCellsPort {
  constructor(
    @Inject(DATABASE) private readonly db: Db,
    private readonly cells: CellsReadService,
    private readonly audit: AuditService,
  ) {}

  async ledCellsWithin(executor: Transaction<Database>, personId: string): Promise<LedCell[]> {
    const led = await this.cells.openLeadershipsOf(executor, personId);
    const headings = await this.cells.cellHeadingsWithin(
      executor,
      led.map((cell) => cell.id),
    );

    return led.map((cell) => ({ ...cell, members: headings.get(cell.id)?.memberCount ?? 0 }));
  }

  async endMembershipWithin(
    executor: Transaction<Database>,
    personId: string,
    at: Date,
    actorAccountId: string,
  ): Promise<{ cellUuid: string; cellId: string } | null> {
    const ended = await executor
      .updateTable('cell_memberships')
      .set({ ended_at: at })
      .where('person_id', '=', personId)
      .where('ended_at', 'is', null)
      .returning('cell_id')
      .executeTakeFirst();

    if (ended === undefined) {
      return null;
    }

    const cell = await executor
      .selectFrom('cells')
      .select('cell_id')
      .where('id', '=', ended.cell_id)
      .executeTakeFirstOrThrow();

    await this.audit.writeWithin(executor, {
      actorId: actorAccountId,
      action: 'cell_membership.ended',
      targetType: 'person',
      targetId: personId,
      before: { cell_uuid: ended.cell_id, cell_id: cell.cell_id },
      after: { ended_at: at.toISOString() },
    });

    return { cellUuid: ended.cell_id, cellId: cell.cell_id };
  }

  async latestCellsOf(
    personIds: readonly string[],
  ): Promise<
    Map<
      string,
      { id: string; cell_id: string; category: string | null; day_of_week: number | null }
    >
  > {
    const latest = await this.cells.latestMembershipCellsOf(this.db, personIds);
    const headings = await this.cells.cellHeadingsWithin(this.db, [
      ...new Set([...latest.values()].map((cell) => cell.id)),
    ]);

    return new Map(
      [...latest].map(([personId, cell]) => [
        personId,
        {
          id: cell.id,
          cell_id: cell.cellId,
          category: headings.get(cell.id)?.category ?? null,
          day_of_week: headings.get(cell.id)?.dayOfWeek ?? null,
        },
      ]),
    );
  }
}
