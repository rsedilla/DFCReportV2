import { Test } from '@nestjs/testing';
import { sql } from 'kysely';

import { AppConfigModule } from '../../src/config/config.module';
import { DatabaseModule } from '../../src/database/database.module';
import { DccFiguresService } from '../../src/attendance/dcc-figures.service';
import { HierarchyService } from '../../src/hierarchy/hierarchy.service';
import { ReportingService } from '../../src/reporting/reporting.service';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createPerson } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';

/**
 * A leader-scoped DCC monthly report (SKILL.md section 20; decisions 0206, 0208, 0210).
 *
 * **Additivity is what this file exists for, and nothing tested it.** Section 20 claims that
 * every level of a drill-down adds up to the level above, except for a named residual. That
 * is the whole reason decisions 0206 and 0209 exist -- a person with no open assignment at
 * the period's end is placed by the last one they held within it, resolved up the chain --
 * and `reporting-subtree.spec.ts` checks only *which people* a walk returns. Whether the
 * *figures* sum is a different claim, and this is the first thing that can fail on it.
 *
 * **The fixture is built so a wrong query fails rather than so it is tidy.** Mark is archived
 * mid-October, so a report resolving the tree with `subtreeAsOf` at the period's end loses him
 * and Manuel's total silently drops by one. Nena holds no assignment at any instant, so she is
 * section 20's residual and belongs to the Whole Church total alone -- which makes the root's
 * total deliberately *smaller* than the church's, and a report that quietly equated them
 * would pass a weaker fixture.
 *
 * Dates are fixed and in the past; names are invented (CLAUDE.md, Secrets).
 */
describe('a leader-scoped DCC monthly report (decisions 0206, 0210)', () => {
  let db: Kysely<Database>;
  let app: INestApplication;
  let reporting: ReportingService;

  const PERIOD = '2020-10-01';
  const OCT_4 = '2020-10-04';
  const OCT_11 = '2020-10-11';
  const SEPTEMBER = new Date('2020-09-01T00:00:00+08:00');
  const OCT_20 = new Date('2020-10-20T00:00:00+08:00');

  let root: { id: string };
  let manuel: { id: string };
  let ben: { id: string };
  let mark: { id: string };
  let tessa: { id: string };
  let nena: { id: string };
  let recorder: string;

  beforeAll(async () => {
    db = createTestDb();

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule],
      providers: [ReportingService, DccFiguresService, HierarchyService],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    reporting = app.get(ReportingService);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  beforeEach(async () => {
    await truncateAll(db);

    //        root
    //        /  \
    //   manuel   ben
    //      |      |
    //    mark   tessa          nena: no assignment, ever
    root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    ben = await createPerson(db, { firstName: 'Ben', network: 'MENS' });
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    tessa = await createPerson(db, { firstName: 'Tessa', network: 'MENS' });
    nena = await createPerson(db, { firstName: 'Nena', network: 'MENS' });
    // `dcc_attendance.recorded_by` references an **account**, not a Person. Inserted
    // directly rather than through `createAccount`, which needs the auth graph this file
    // does not build.
    const account = await db
      .insertInto('accounts')
      .values({
        person_id: root.id,
        email: 'oriel@example.invalid',
        email_normalized: 'oriel@example.invalid',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    recorder = account.id;

    await assignTo(db, root.id, null, SEPTEMBER);
    await assignTo(db, manuel.id, root.id, SEPTEMBER);
    await assignTo(db, ben.id, root.id, SEPTEMBER);
    await assignTo(db, tessa.id, ben.id, SEPTEMBER);

    // Mark is archived on the 20th: no open assignment at the period's end, so decision
    // 0206's fallback places him under Manuel, whom he was under within the month.
    const marksRow = await assignTo(db, mark.id, manuel.id, SEPTEMBER);
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: OCT_20 })
      .where('id', '=', marksRow)
      .execute();
  });

  const event = async (day: string) => {
    const row = await db
      .insertInto('dcc_events')
      .values({ event_date: day })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  };

  const attend = async (eventId: string, personId: string, leaderId: string) => {
    await db
      .insertInto('dcc_attendance')
      .values({
        dcc_event_id: eventId,
        person_id: personId,
        present: true,
        responsible_leader_id: leaderId,
        recorded_by: recorder,
      })
      .execute();
  };

  /** Mark twice, Tessa once, Manuel once, Nena once. Ben and the root attend nothing. */
  const october = async () => {
    const first = await event(OCT_4);
    const second = await event(OCT_11);

    await attend(first, mark.id, manuel.id);
    await attend(second, mark.id, manuel.id);
    await attend(first, tessa.id, ben.id);
    await attend(first, manuel.id, root.id);
    await attend(first, nena.id, root.id);
  };

  const leader = (personId: string) => reporting.dccMonthly({ kind: 'LEADER', personId }, PERIOD);
  const church = () => reporting.dccMonthly({ kind: 'WHOLE_CHURCH' }, PERIOD);

  it('adds up: each leader plus their siblings equals the level above', async () => {
    await october();

    const [wholeChurch, atRoot, atManuel, atBen] = await Promise.all([
      church(),
      leader(root.id),
      leader(manuel.id),
      leader(ben.id),
    ]);

    // Manuel's subtree is Manuel and Mark, both of whom attended. Ben's is Ben and Tessa,
    // and only Tessa attended.
    expect(atManuel.uniquePeople).toBe(2);
    expect(atBen.uniquePeople).toBe(1);

    // The level above is exactly their sum, because the root attended nothing himself.
    expect(atRoot.uniquePeople).toBe(atManuel.uniquePeople + atBen.uniquePeople);
    expect(atRoot.uniquePeople).toBe(3);

    // **And the church is larger than the root by exactly the residual** -- Nena, who held
    // no open assignment at any instant of the period and is therefore in no leader's
    // subtree. Section 20 puts her in the Whole Church total alone, so this is the one
    // place the drill-down deliberately does not sum.
    expect(wholeChurch.uniquePeople).toBe(4);
    expect(wholeChurch.uniquePeople - atRoot.uniquePeople).toBe(1);
  });

  it('keeps a person archived mid-period in their leader figures', async () => {
    await october();

    // **The case that separates the placement graph from the tree.** Mark holds no
    // assignment at the period's end, so a report resolving `subtreeAsOf` at that instant
    // would drop him -- and Manuel's total would read 1 rather than 2, while the church's
    // stayed 4 and nothing failed. Section 3 forbids filtering a period-based report by
    // current lifecycle state, which is what that would amount to.
    const atManuel = await leader(manuel.id);

    expect(atManuel.uniquePeople).toBe(2);
    expect(atManuel.buckets.find((b) => b.times === 2)?.people).toBe(1);
  });

  it('reconciles at leader scope, both identities', async () => {
    await october();

    const report = await leader(manuel.id);
    const { classification: c } = report;

    expect(c.vip + c.secondTimer + c.thirdTimer + c.fourthTimer + c.regular).toBe(
      report.uniquePeople,
    );
    expect(report.buckets.reduce((sum, b) => sum + b.people, 0)).toBe(report.uniquePeople);
  });

  it('measures a leader against the month N, not against their own people', async () => {
    await october();

    const [atManuel, wholeChurch] = await Promise.all([leader(manuel.id), church()]);

    // N is a property of the calendar, so it is the same at every scope -- which is what
    // makes `Completed` mean the same thing for a leader as for the church, and what lets
    // the buckets be compared between levels at all.
    expect(atManuel.n).toBe(2);
    expect(atManuel.n).toBe(wholeChurch.n);
    expect(atManuel.buckets.find((b) => b.completed)?.times).toBe(2);
  });

  it('reports zero for a leader with nobody beneath them, rather than the whole church', async () => {
    await october();

    // **The empty-population case, and it is a real trap.** An empty list and "no
    // restriction" are different questions, and a query treating `[]` as "unrestricted"
    // would answer a childless leader with the church's own figures -- the largest possible
    // wrong answer, and one that looks plausible on every screen.
    const atTessa = await leader(tessa.id);

    expect(atTessa.uniquePeople).toBe(1);
    expect(atTessa.classification.vip).toBe(1);

    // Nena leads nobody and is in no leader's subtree, but a scope always includes the
    // person it names -- `OWN_SUBTREE` "includes the actor" (`scopes.ts`). So her own report
    // is her own attendance: one person, and emphatically not the church's four.
    const atNena = await leader(nena.id);
    expect(atNena.uniquePeople).toBe(1);

    // And somebody who leads nobody and attended nothing is genuinely empty -- the case
    // that would read as the whole church if an empty population were taken for no
    // restriction at all.
    const gale = await createPerson(db, { firstName: 'Gale', network: 'WOMENS' });
    const atGale = await leader(gale.id);
    expect(atGale.uniquePeople).toBe(0);
    expect(atGale.buckets.every((b) => b.people === 0)).toBe(true);
  });

  it('computes the whole report inside one read-only repeatable-read transaction', async () => {
    await october();

    // **Decision 0210, asserted by reading the level back from the database** rather than
    // from the code that set it. A leader-scoped report is two statements by construction --
    // section 2 puts the tree walk in `hierarchy` and the figures in `attendance` -- and at
    // `READ COMMITTED` each takes its own snapshot even inside a transaction, so the
    // population and the figures could describe two trees.
    //
    // Observed on the executor the composing service actually hands down, which is the only
    // thing that can fail if a later change reads on the pool instead.
    const figures = app.get(DccFiguresService);
    const original = figures.monthFigures.bind(figures);
    let observed: { isolation: string; readOnly: string } | undefined;

    figures.monthFigures = async (month, options = {}) => {
      const seen = await sql<{ isolation: string; read_only: string }>`
        SELECT current_setting('transaction_isolation') AS isolation,
               current_setting('transaction_read_only') AS read_only
      `.execute(options.executor ?? db);

      observed = {
        isolation: seen.rows[0].isolation,
        readOnly: seen.rows[0].read_only,
      };

      return original(month, options);
    };

    try {
      await leader(manuel.id);
    } finally {
      figures.monthFigures = original;
    }

    expect(observed).toEqual({ isolation: 'repeatable read', readOnly: 'on' });
  });
});
