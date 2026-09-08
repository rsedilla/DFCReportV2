import { Test } from '@nestjs/testing';
import { sql } from 'kysely';

import { AppConfigModule } from '../../src/config/config.module';
import { DatabaseModule } from '../../src/database/database.module';
import { CellFiguresService } from '../../src/attendance/cell-figures.service';
import { DccFiguresService } from '../../src/attendance/dcc-figures.service';
import { HierarchyService } from '../../src/hierarchy/hierarchy.service';
import { NetworksService } from '../../src/networks/networks.service';
import { ReportingService } from '../../src/reporting/reporting.service';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createCell, createPerson } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestPerson } from '../setup/fixtures';

/**
 * Where a Cell figure's **responsible leader** is placed in a subtree (SKILL.md section 20,
 * decision 0221).
 *
 * **This file exists because the ruling shipped with nothing that could fail on it.** Section
 * 20 states a placement rule for the person key and for coverage and gave the middle key none;
 * decision 0221 settles it as the placement graph over the period. The reconciliation suite
 * cannot tell that answer from either rejected alternative — every assignment there is written
 * by `assignTo`, which defaults `started_at` to `EPOCH`, and none is ever closed, so the
 * placement graph, the tree at the period's end, and a per-meeting-date walk all return the
 * same set. `architecture-guardian` found that, and it is the Definition of Done's
 * "domain rules added or changed in `SKILL.md` have corresponding tests" with teeth.
 *
 * **The first two cases turn on the responsible leader's *own* placement moving**, which is the
 * direction the readings diverge in. *No claim is made here that it is the **only** such thing:
 * two attempts to state an exhaustive discriminator were refuted, and section 20 and decision
 * 0221 now record a direction rather than a closed list.* A Cell changing hands does not:
 * section 13 freezes the responsible leader per meeting and the figures query selects on that
 * frozen column, so a handover splits a month between two leaders under every reading. *An
 * earlier version of decision 0221 named the handover as its discriminator and offered the
 * split month as the chosen answer's cost. It is the cost of neither.*
 *
 * **The third case pins section 20's second residual**, which decision 0221 added as prose with
 * nothing able to fail on it; the fourth pins the class that residual does **not** cover, which
 * is an open Stop Condition rather than a settled rule. Each says so where it is written.
 *
 * *The third was verified by mutation too, though against a rival **claim** rather than a rival
 * implementation: adding `WHERE subtree.depth > 0` to `reportingSubtree`'s final select — which
 * is what "out of **every** leader's Cell figure" would mean if it were true — compiles and
 * reddens this case alone, on `toLito`, which is the assertion that carries the claim. Recorded
 * here rather than only in a commit message, because the next reader of this file reads the
 * file.*
 *
 * **The first two cases were mutation-verified against the actual rival implementations**, each
 * alone on a restored tree, each confirmed to compile first — *with the now-unused `start`/`end`
 * dropped from the destructuring, without which the substitution fails `TS6133` before any test
 * runs, so "confirmed to compile" holds only with that adjustment*:
 *
 * - `hierarchy.subtreeAsOf(trx, leader, end)` — the dated walk decision 0214 uses to
 *   *authorize* a report. Caught by the second case.
 * - `reportingSubtree(trx, leader, start, start)` — placement at the period's start, standing
 *   in for a per-meeting-date walk. Caught by the first case.
 *
 * **A third mutation was tried and is not caught, which is a fact about the mutation rather
 * than a gap here.** Collapsing the window to `reportingSubtree(trx, leader, end, end)` looks
 * like the dated walk and is not: section 20's departed-leader fallback reaches back *before*
 * the window, so that call still resolves a leader the dated walk would drop. It is recorded
 * because it is the shape of proxy that has expired on this project before — prefer the rival
 * implementation over something that resembles it.
 *
 * Fixture names are invented (`CLAUDE.md`, Secrets).
 */
describe("where a Cell figure's responsible leader is placed (decision 0221)", () => {
  let db: Kysely<Database>;
  let app: INestApplication;
  let reporting: ReportingService;

  let recorder: string;

  /** The two candidate parents. `alma` holds the leader early in the month, `bien` later. */
  let root: TestPerson;
  let alma: TestPerson;
  let bien: TestPerson;
  /** The Cell's leader, and the person whose placement the ruling decides. */
  let lito: TestPerson;
  let member: TestPerson;

  let cell: string;

  const MONTH = '2020-10-01';
  /** Before and after the reassignment, so a per-meeting-date walk would split them. */
  const OCT_3 = '2020-10-03';
  const OCT_24 = '2020-10-24';

  const BEFORE = new Date('2020-09-01T00:00:00+08:00');
  /** Mid-month, so the period's two ends find different parents for the leader. */
  const REASSIGNED = new Date('2020-10-15T00:00:00+08:00');

  beforeAll(async () => {
    db = createTestDb();

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule],
      providers: [
        CellFiguresService,
        DccFiguresService,
        HierarchyService,
        NetworksService,
        ReportingService,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    reporting = app.get(ReportingService);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const accountFor = async (personId: string) => {
    const row = await db
      .insertInto('accounts')
      .values({
        person_id: personId,
        email: 'recorder@example.invalid',
        email_normalized: 'recorder@example.invalid',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return row.id;
  };

  /** One recorded meeting, with the derived columns computed by the database. */
  const meeting = async (scheduledDate: string, leaderId: string) => {
    const rows = await sql<{ id: string }>`
      INSERT INTO cell_meetings (
        cell_id, scheduled_date, scheduled_time, week_starting, reporting_month,
        status, responsible_leader_id
      )
      VALUES (
        ${cell}::uuid, ${scheduledDate}::date, '19:00'::time,
        ${scheduledDate}::date - ((EXTRACT(ISODOW FROM ${scheduledDate}::date)::integer) - 1),
        date_trunc('month', ${scheduledDate}::date)::date,
        'HELD'::cell_meeting_status, ${leaderId}::uuid
      )
      RETURNING id
    `.execute(db);

    return rows.rows[0].id;
  };

  const attend = async (meetingId: string, personId: string) => {
    await db
      .insertInto('cell_attendance')
      .values({
        cell_meeting_id: meetingId,
        person_id: personId,
        present: true,
        recorded_by: recorder,
      })
      .execute();
  };

  const leaderScoped = (personId: string) =>
    reporting.cellMonthly({ kind: 'LEADER', person_id: personId }, MONTH);

  beforeEach(async () => {
    await truncateAll(db);

    alma = await createPerson(db, { firstName: 'Alma', lastName: 'Ferrer', network: 'WOMENS' });
    bien = await createPerson(db, {
      firstName: 'Bienvenida',
      lastName: 'Gamboa',
      network: 'WOMENS',
    });
    lito = await createPerson(db, { firstName: 'Lourdes', lastName: 'Hidalgo', network: 'WOMENS' });
    member = await createPerson(db, {
      firstName: 'Imelda',
      lastName: 'Jacinto',
      network: 'WOMENS',
    });

    // **Siblings under one root, not two roots.** Section 5 gives each Network exactly one
    // root (`pastoral_assignments_one_root_per_network`), and the two candidate parents have
    // to be in disjoint subtrees for "Alma's figure is empty" to mean anything.
    root = await createPerson(db, {
      firstName: 'Geraldine',
      lastName: 'Katigbak',
      network: 'WOMENS',
    });
    await assignTo(db, root.id, null);
    await assignTo(db, alma.id, root.id);
    await assignTo(db, bien.id, root.id);
    await assignTo(db, member.id, lito.id);

    recorder = await accountFor(alma.id);

    cell = (await createCell(db, { leader: lito, createdAt: BEFORE })).id;
    await db
      .insertInto('cell_memberships')
      .values({ cell_id: cell, person_id: member.id, started_at: BEFORE })
      .execute();
  });

  /**
   * **The discriminator against resolving at each meeting's date**, which is the alternative
   * with the strongest symmetry — coverage resolves that way and section 13 freezes the
   * responsible leader that way.
   *
   * Lourdes runs both meetings and is reassigned from Alma to Bienvenida between them. Under
   * the ruling she is placed once for the period, by the open assignment she holds at its end,
   * so **both** meetings' attendees land under Bienvenida and Alma's figure is empty. Under a
   * per-meeting-date walk the 3 October meeting would land under Alma.
   */
  it('places the leader once for the period, not once per meeting', async () => {
    await assignTo(db, lito.id, alma.id, BEFORE);
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: REASSIGNED })
      .where('person_id', '=', lito.id)
      .where('ended_at', 'is', null)
      .execute();
    await assignTo(db, lito.id, bien.id, REASSIGNED);

    await attend(await meeting(OCT_3, lito.id), member.id);
    await attend(await meeting(OCT_24, lito.id), member.id);

    const toBien = await leaderScoped(bien.id);
    const toAlma = await leaderScoped(alma.id);

    expect(toBien.unique_people).toBe(1);
    expect(toAlma.unique_people).toBe(0);
  });

  /**
   * **The discriminator against the tree in force at the period's end**, which decision 0214
   * uses to *authorize* a report and which 0221 refuses for computing one.
   *
   * Lourdes's assignment under Alma is closed mid-month and none replaces it, which section 5
   * permits. At the period's end she is under nobody, so the dated walk would drop her — and
   * with her the attendees of every meeting she ran, out of Alma's figure while the Whole
   * Church total kept them, which is the additivity failure decision 0206 exists to prevent.
   * The placement graph falls back to the last assignment she held *within* the period.
   */
  it('falls back to the assignment held within the period when none is open at its end', async () => {
    await assignTo(db, lito.id, alma.id, BEFORE);
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: REASSIGNED })
      .where('person_id', '=', lito.id)
      .where('ended_at', 'is', null)
      .execute();

    await attend(await meeting(OCT_3, lito.id), member.id);
    await attend(await meeting(OCT_24, lito.id), member.id);

    const toAlma = await leaderScoped(alma.id);
    const church = await reporting.cellMonthly({ kind: 'WHOLE_CHURCH' }, MONTH);

    expect(toAlma.unique_people).toBe(1);
    // The identity the fallback exists for: what a leader's figure holds is not lost from the
    // church's, and here it is not lost from the leader's either.
    expect(church.unique_people).toBe(1);
  });

  /**
   * **Section 20's second residual, both halves** (decision 0221). The ruling shipped it as
   * prose with nothing able to fail on it, on the branch whose own subject is a rule that
   * shipped that way; `architecture-guardian` found that and this is the answer.
   *
   * Lourdes holds no assignment at any instant of the period **and none before it**, which is
   * the state the residual names. She is therefore placed in no subtree above her, and the
   * attendees of her meetings leave every such figure while the Whole Church total keeps them.
   *
   * The second half is the correction this branch had to make twice: her **own** `LEADER`
   * figure still holds them, because the walk seeds at the leader named and she is in her own
   * subtree at depth zero. Section 20 and decision 0221 both said "every leader's Cell figure",
   * which is false of exactly one leader — her.
   */
  it('places an always-unassigned responsible leader in no subtree above, but keeps her own', async () => {
    await attend(await meeting(OCT_3, lito.id), member.id);

    const toLito = await leaderScoped(lito.id);
    const toRoot = await leaderScoped(root.id);
    const church = await reporting.cellMonthly({ kind: 'WHOLE_CHURCH' }, MONTH);

    // Out of every subtree above her — the root's included, and the root is above everyone.
    expect(toRoot.unique_people).toBe(0);
    // And kept by her own, which is the half "every leader's Cell figure" got wrong.
    expect(toLito.unique_people).toBe(1);
    expect(church.unique_people).toBe(1);
  });

  /**
   * **The class the second residual does *not* cover, pinned as the behaviour the code has
   * today rather than as behaviour anybody has ruled on.** Recorded as an open Stop Condition
   * in `CLAUDE.md`: a responsible leader who held an assignment **before** the period, none
   * **within** it, and who **leads nobody**. `reportingSubtree`'s `departed` tier seeds only
   * from people who lead somebody, so she is dropped exactly as the always-unassigned leader
   * is — while section 20's residual sentence describes only the latter.
   *
   * **Imelda is deliberately moved under the root here**, so the attendee is perfectly
   * placeable and sits inside the root's own subtree. The root's Cell figure is still 0. That
   * is what makes this different in consequence from the person-key version of the same class,
   * which `CLAUDE.md` closes with "the behaviour is already right": what goes missing is not
   * an unplaceable person from a figure counting them, but *other people's* attendance from a
   * leader who does disciple them.
   *
   * This case goes red when that Stop Condition is settled in the other direction, which is
   * the point of pinning it — it follows `reporting-subtree.spec.ts`, which pins its own two
   * miss cases so that settling them cannot forget them.
   */
  it('drops a responsible leader who left before the period and leads nobody (open, not endorsed)', async () => {
    const ENDED_BEFORE = new Date('2020-09-20T00:00:00+08:00');

    // Lourdes led somebody until before the period; move Imelda to the root so she leads
    // nobody, which is what keeps her out of the `departed` tier.
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: ENDED_BEFORE })
      .where('person_id', '=', member.id)
      .where('ended_at', 'is', null)
      .execute();
    await assignTo(db, member.id, root.id, ENDED_BEFORE);

    await assignTo(db, lito.id, alma.id, BEFORE);
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: ENDED_BEFORE })
      .where('person_id', '=', lito.id)
      .where('ended_at', 'is', null)
      .execute();

    await attend(await meeting(OCT_3, lito.id), member.id);

    const toAlma = await leaderScoped(alma.id);
    const toRoot = await leaderScoped(root.id);
    const church = await reporting.cellMonthly({ kind: 'WHOLE_CHURCH' }, MONTH);

    expect(toAlma.unique_people).toBe(0);
    // The attendee is inside the root's subtree and the root's Cell figure is still empty.
    expect(toRoot.unique_people).toBe(0);
    expect(church.unique_people).toBe(1);
  });
});
