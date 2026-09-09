import { CellsReadService } from '../../src/cells/cells.read.service';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createCell, createPerson } from '../setup/fixtures';

import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestPerson } from '../setup/fixtures';

/**
 * The drift guard for the Cell coverage denominator's leader (SKILL.md sections 12, 13 and
 * 20; decision 0187).
 *
 * **Two implementations of one rule, and this pins part of what keeps them equal.**
 * `CellsReadService.leaderOnDateWithin` answers "who led this Cell on this date" a row at a
 * time, and is the canonical statement of it. `scheduledMeetingsWithLeaderIn` restates the
 * same three ordering keys inside a `LATERAL`, because a set-returning query cannot call a
 * row-at-a-time method without one round trip per pair. Section 20 attributes each
 * scheduled meeting to "the leader who led the Cell on the scheduled date", so the two
 * disagreeing is not a tidiness problem: it is a meeting counted under the wrong leader, in
 * a figure that still sums correctly and looks right.
 *
 * **What it catches, measured by mutation rather than asserted:** the `started_at`
 * ordering **direction** and the closing date bound. Reversing either turns two of the four
 * cases below red.
 *
 * **What it does not catch, named because the source docblock rests on this file:** the
 * `ended_at DESC NULLS FIRST` tiebreak and the `id DESC` tiebreak — no case here builds two
 * leadership rows sharing a `started_at`, which is the section 5 correction pair those keys
 * exist for — the opening date bound's inclusive edge, the null-leader `LEFT JOIN` branch,
 * the multi-Cell case, and **the whole schedule half**. That last one is structural rather
 * than a missing case: this file asks the canonical method about whatever dates the query
 * hands it, so a schedule derivation returning the wrong dates is agreed with rather than
 * caught. Closing it needs a different oracle, not another fixture here.
 *
 * **It compares the two rather than asserting a number**, which is what makes it a guard
 * rather than a second copy of the expectation. A case asserting "the leader on the 20th is
 * Mark" would pass if both implementations drifted the same way; this one cannot, because
 * the oracle is the other implementation.
 *
 * *Written because a docblock claimed this file existed before it did — the justification
 * for restating the derivation was a guard nobody had written, which `architecture-guardian`
 * found by looking for the file.*
 *
 * The deciding date is the **handover day**, where the date comparison matches both the
 * outgoing and the incoming leadership row and the `started_at` direction alone decides.
 * Decision 0187 takes the outgoing leader, because that is the only answer that does not
 * depend on when the handover happened to be recorded.
 *
 * Fixture names are invented (`CLAUDE.md`, Secrets).
 */
describe('the Cell coverage denominator resolves the same leader as leaderOnDateWithin', () => {
  let db: Kysely<Database>;
  let cells: CellsReadService;

  let outgoing: TestPerson;
  let incoming: TestPerson;

  /** June 2020 schedules Saturdays: the 6th, 13th, 20th and 27th. */
  const JUNE = '2020-06-01';
  const BEFORE = new Date('2020-05-01T00:00:00+08:00');

  beforeAll(() => {
    db = createTestDb();
    // One dependency, so the service is constructed rather than wired: this file measures
    // two SQL statements against each other and needs no application graph.
    cells = new CellsReadService(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAll(db);

    outgoing = await createPerson(db, { firstName: 'Mateo', lastName: 'Ferrer', network: 'MENS' });
    incoming = await createPerson(db, { firstName: 'Nilo', lastName: 'Garcia', network: 'MENS' });

    await assignTo(db, outgoing.id, null);
    await assignTo(db, incoming.id, outgoing.id);
  });

  const handOver = async (cellId: string, at: Date) => {
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('cell_leaderships')
        .set({ ended_at: at })
        .where('cell_id', '=', cellId)
        .where('ended_at', 'is', null)
        .execute();

      await trx
        .insertInto('cell_leaderships')
        .values({ cell_id: cellId, person_id: incoming.id, started_at: at })
        .execute();
    });
  };

  /**
   * Every scheduled pair the month derives, checked against the canonical answer for its
   * own date. Returns the pairs so a case can also assert it measured something.
   */
  const agreesThroughout = async (cellId: string) => {
    const pairs = await cells.scheduledMeetingsWithLeaderIn(db, JUNE);

    // The read is church-wide and each fixture builds one Cell, so this both narrows the
    // comparison honestly and catches a query that started returning other Cells' pairs.
    expect(pairs.every((pair) => pair.cellId === cellId)).toBe(true);

    for (const pair of pairs) {
      const canonical = await cells.leaderOnDateWithin(db, pair.cellId, pair.scheduledDate);

      expect({ date: pair.scheduledDate, leader: pair.leaderId }).toEqual({
        date: pair.scheduledDate,
        leader: canonical,
      });
    }

    return pairs;
  };

  it('agrees on every scheduled date of a Cell that never changed hands', async () => {
    const cell = (await createCell(db, { leader: outgoing, createdAt: BEFORE })).id;

    const pairs = await agreesThroughout(cell);

    // Four Saturdays. Asserted so that a query returning nothing cannot pass this file by
    // agreeing vacuously — which is the way a differential test most often stops testing.
    expect(pairs).toHaveLength(4);
    expect(pairs.every((pair) => pair.leaderId === outgoing.id)).toBe(true);
  });

  it('agrees on a handover that falls on a scheduled date', async () => {
    const cell = (await createCell(db, { leader: outgoing, createdAt: BEFORE })).id;

    // The 20th is itself a Saturday, so both leadership rows match the date comparison and
    // only the ordering decides. This is the case decision 0187 settles.
    await handOver(cell, new Date('2020-06-20T00:00:00+08:00'));

    const pairs = await agreesThroughout(cell);

    expect(pairs).toHaveLength(4);
    // Stated as well as compared: the guard above would pass if both implementations took
    // the incoming leader, and decision 0187 says which one is right.
    expect(pairs.map((pair) => pair.leaderId)).toEqual([
      outgoing.id,
      outgoing.id,
      outgoing.id,
      incoming.id,
    ]);
  });

  it('agrees on a handover that falls between two scheduled dates', async () => {
    const cell = (await createCell(db, { leader: outgoing, createdAt: BEFORE })).id;

    // A Monday: only one row matches each scheduled date, so the ordering decides nothing
    // and the two implementations must still agree for the ordinary reason.
    await handOver(cell, new Date('2020-06-15T00:00:00+08:00'));

    const pairs = await agreesThroughout(cell);

    expect(pairs).toHaveLength(4);
    expect(pairs.map((pair) => pair.leaderId)).toEqual([
      outgoing.id,
      outgoing.id,
      incoming.id,
      incoming.id,
    ]);
  });

  it('agrees across two handovers in one month', async () => {
    const cell = (await createCell(db, { leader: outgoing, createdAt: BEFORE })).id;

    await handOver(cell, new Date('2020-06-13T00:00:00+08:00'));
    // Back to the first leader, so one scheduled date has three leadership rows covering
    // it and the right answer is the *middle* one. That is what this case adds: the two
    // handover cases above each have a correct answer at one end of the candidate list,
    // so a query taking the first or the last row can be right for the wrong reason.
    //
    // *It said a latest-row query "would agree on a single handover and diverge here",
    // which is false: reversing the ordering to take the latest row already reddens the
    // handover-on-a-scheduled-date case above.*
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('cell_leaderships')
        .set({ ended_at: new Date('2020-06-27T00:00:00+08:00') })
        .where('cell_id', '=', cell)
        .where('ended_at', 'is', null)
        .execute();

      await trx
        .insertInto('cell_leaderships')
        .values({
          cell_id: cell,
          person_id: outgoing.id,
          started_at: new Date('2020-06-27T00:00:00+08:00'),
        })
        .execute();
    });

    const pairs = await agreesThroughout(cell);

    expect(pairs).toHaveLength(4);
    expect(pairs.map((pair) => pair.leaderId)).toEqual([
      outgoing.id,
      outgoing.id,
      incoming.id,
      incoming.id,
    ]);
  });
});
