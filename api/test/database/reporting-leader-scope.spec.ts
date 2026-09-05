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
    // **Archived, and that is load-bearing rather than colour.** Without `archived` the
    // fixture leaves `person_lifecycle` at `CURRENT`, and the section 3 claim below —
    // that a period-based report is not filtered by current lifecycle state — has nothing
    // that can fail: `architecture-guardian` added exactly that filter to the population
    // query and the whole suite stayed green.
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS', archived: true });
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

  /**
   * Mark twice; Tessa, Manuel, Nena and the root once each. Ben attends nothing.
   *
   * **The root attends deliberately.** With the root attending nothing the identity reduces
   * to `level = sum(children)`, and the general form section 20 actually claims —
   * `level = own + sum(children)` — goes untested in the file whose whole subject is
   * additivity.
   */
  const october = async () => {
    const first = await event(OCT_4);
    const second = await event(OCT_11);

    await attend(first, mark.id, manuel.id);
    await attend(second, mark.id, manuel.id);
    await attend(first, tessa.id, ben.id);
    await attend(first, manuel.id, root.id);
    await attend(first, root.id, root.id);
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

    // The general form: the level above is its own people plus its children's. The root
    // attended once himself, so a query that only ever summed children would read 3 here.
    expect(atRoot.uniquePeople).toBe(1 + atManuel.uniquePeople + atBen.uniquePeople);
    expect(atRoot.uniquePeople).toBe(4);

    // **And the church is larger than the root by exactly the residual** -- Nena, who held
    // no open assignment at any instant of the period and is therefore in no leader's
    // subtree. Section 20 puts her in the Whole Church total alone, so this is the one
    // place the drill-down deliberately does not sum.
    expect(wholeChurch.uniquePeople).toBe(5);
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

    // Nena leads nobody and is in no leader's subtree, but a walk always returns its own
    // seed -- which is what makes the drill-down sum, since a leader's own attendance has to
    // land somewhere. So her report is her own attendance: one person, not the church's five.
    const atNena = await leader(nena.id);
    expect(atNena.uniquePeople).toBe(1);

    const gale = await createPerson(db, { firstName: 'Gale', network: 'WOMENS' });
    const atGale = await leader(gale.id);
    expect(atGale.uniquePeople).toBe(0);
    expect(atGale.buckets.every((b) => b.people === 0)).toBe(true);
  });

  it('treats an empty population as nobody, never as everybody', async () => {
    await october();

    // **Unreachable through `dccMonthly`, so exercised directly.** `reportingSubtree` seeds
    // itself with the leader, so it never returns an empty array and no leader-scoped report
    // can produce this call. The branch is real all the same -- an empty list and "no
    // restriction" are different questions -- and replacing the ternary with one that treats
    // `[]` as unrestricted left the entire suite green when `architecture-guardian` tried it.
    // A childless scope answered with the church's own figures is the largest wrong answer
    // this query can give, and it is the one nothing was checking.
    const figures = app.get(DccFiguresService);

    const unrestricted = await figures.monthFigures(PERIOD);
    const nobody = await figures.monthFigures(PERIOD, { personIds: [] });

    expect(unrestricted.people).toHaveLength(5);
    expect(nobody.people).toHaveLength(0);

    // The month's own figures are properties of the calendar and survive the narrowing.
    expect(nobody.n).toBe(unrestricted.n);
    expect(nobody.open).toBe(unrestricted.open);
    expect(nobody.removed).toEqual(unrestricted.removed);
  });

  it('holds one population across a write committed between its two reads', async () => {
    await october();

    // **The third assertion decision 0210 asks of this slice, and the only one that survives
    // a change of mechanism.** Reading the isolation level back catches the level being
    // dropped; it does not catch a later refactor hoisting one of the two reads out of the
    // transaction. This does: the tree walk and the figures must describe one population, and
    // at `READ COMMITTED` a write landing between them would be visible to the second.
    //
    // The write is committed on a **separate connection** while the report is mid-flight,
    // from inside the seam between the two reads.
    const figures = app.get(DccFiguresService);
    const original = figures.monthFigures.bind(figures);
    const other = createTestDb();

    figures.monthFigures = async (month, options = {}) => {
      // Between the walk and the count: a second Sunday for Mark, who is already in the
      // population. Under a shared snapshot his bucket stays at 2.
      const extra = await other
        .insertInto('dcc_events')
        .values({ event_date: '2020-10-18' })
        .returning('id')
        .executeTakeFirstOrThrow();

      await other
        .insertInto('dcc_attendance')
        .values({
          dcc_event_id: extra.id,
          person_id: mark.id,
          present: true,
          responsible_leader_id: manuel.id,
          recorded_by: recorder,
        })
        .execute();

      return original(month, options);
    };

    try {
      const during = await leader(manuel.id);

      // N was read inside the snapshot and cannot see the third Sunday; neither can Mark's
      // count. Both identities still hold over the population the walk chose.
      expect(during.n).toBe(2);
      expect(during.buckets.find((b) => b.times === 2)?.people).toBe(1);
      expect(during.buckets.reduce((sum, b) => sum + b.people, 0)).toBe(during.uniquePeople);
    } finally {
      figures.monthFigures = original;
      await other.destroy();
    }

    // And the next report, outside that snapshot, sees the write.
    const after = await leader(manuel.id);
    expect(after.n).toBe(3);
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
