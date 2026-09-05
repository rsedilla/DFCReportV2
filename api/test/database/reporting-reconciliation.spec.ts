import { randomUUID } from 'node:crypto';

import { Test } from '@nestjs/testing';

import { AppConfigModule } from '../../src/config/config.module';
import { DatabaseModule } from '../../src/database/database.module';
import { DccFiguresService } from '../../src/attendance/dcc-figures.service';
import { ReportingService } from '../../src/reporting/reporting.service';
import { ValidationFailedError } from '../../src/common/errors/api-error';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createPerson } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';

/**
 * SKILL.md section 20's reconciliation, which is Stage 5's whole exit criterion.
 *
 * Both views of a domain cover the same population and both must sum to it:
 *
 * ```text
 * VIP + 2nd + 3rd + 4th + Regular         = Total Unique People
 * Once + Twice + ... + Completed          = Total Unique People
 * ```
 *
 * **Written before the queries it checks** -- they land in one commit, so nothing in
 * history can show that, but it is why the fixture is shaped the way it is rather than
 * shaped around what the queries turned out to do. It is the only oracle for a bucket
 * that does not sum. A reconciliation failure is a data-integrity defect rather than a
 * rounding issue, and section 20 says so in terms.
 *
 * **Whole Church scope only, deliberately.** Decision 0206 places a person with no open
 * assignment at the period's end under the last leader they held within it, and that
 * fallback is required before any *leader*-scoped figure is right. Whole Church needs
 * neither the tree walk nor the fallback -- everyone is in the church total -- so it
 * reaches both identities without resting on something unbuilt. Leader scope arrives with
 * the fallback, and this file grows a case for it then.
 *
 * **The fixture is built to make a wrong query fail rather than to be tidy.** It carries a
 * person who attended in a prior month as well (so lifetime and monthly diverge, which is
 * what classification being evaluated as of the end of the month means), a person marked
 * absent, a superseded record, and a removed Sunday. Each is a way a query can quietly
 * over-count, and a fixture without them reconciles against itself.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('section 20 reconciliation, DCC monthly (Stage 5 Done-when)', () => {
  let db: Kysely<Database>;
  let app: INestApplication;
  let reporting: ReportingService;

  /**
   * The account every fixture record is attributed to. `recorded_by` and `removed_by`
   * are both account references, and who recorded a figure changes none of it -- section
   * 9 says coverage "measures whether the record exists, never who entered it".
   */
  let recorder: string;

  /**
   * **Fixed and in the past, which is not the usual rule here.** Test dates in this
   * repository run forward so they do not drift across a month boundary as the suite ages.
   * These are fixed, so they cannot drift — and they must be past, because section 9 says
   * an event whose Manila day has not begun takes no attendance record. A future fixture
   * would be a state the service can never produce, and it would also make every month in
   * the file open, so the closed-month assertion below could not exist.
   */
  const MONTH = '2020-10-01';
  const OCT_4 = '2020-10-04';
  const OCT_11 = '2020-10-11';
  const OCT_18 = '2020-10-18';
  const OCT_25 = '2020-10-25';
  const SEP_27 = '2020-09-27';

  /**
   * The two instants a corrected record spans, both fixed and both written explicitly.
   * `dcc_attendance_period_ordered` requires a row to be superseded no earlier than it was
   * recorded, and letting `recorded_at` default to now would put the predecessor's start
   * years after the 2020 supersession these fixtures date to.
   */
  const FIRST_RECORDED_AT = new Date('2020-10-11T09:00:00+08:00');
  const CORRECTED_AT = new Date('2020-10-12T09:00:00+08:00');

  beforeAll(async () => {
    db = createTestDb();

    // **The two providers rather than `ReportingModule`.** Importing the module pulls
    // `AttendanceModule` and, behind it, most of the application graph -- which this file
    // has no use for and which makes an unrelated wiring change fail it. That the real
    // module resolves is asserted where it belongs, in `module-graph.spec.ts`, which
    // compiles the whole of `AppModule`.
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule],
      providers: [DccFiguresService, ReportingService],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    reporting = app.get(ReportingService);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /**
   * An account, because `dcc_events.removed_by` references one and
   * `dcc_events_removal_is_whole` requires an actor and a reason together -- a removal
   * nobody can read back is what that constraint exists to refuse. Inserted directly
   * rather than through `createAccount`, which needs the auth graph this file does not
   * build.
   */
  const accountFor = async (personId: string) => {
    const row = await db
      .insertInto('accounts')
      .values({
        person_id: personId,
        email: 'admina@example.invalid',
        email_normalized: 'admina@example.invalid',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return row.id;
  };

  const event = async (day: string, removedBy?: string) => {
    const row = await db
      .insertInto('dcc_events')
      .values({ event_date: day })
      .returning('id')
      .executeTakeFirstOrThrow();

    if (removedBy !== undefined) {
      await db
        .updateTable('dcc_events')
        .set({
          removed_at: new Date(),
          removed_by: removedBy,
          removal_reason: 'Invented for this case (CLAUDE.md, Secrets).',
        })
        .where('id', '=', row.id)
        .execute();
    }

    return row.id;
  };

  const attend = async (
    eventId: string,
    personId: string,
    leaderId: string,
    options: { present?: boolean } = {},
  ) => {
    const row = await db
      .insertInto('dcc_attendance')
      .values({
        dcc_event_id: eventId,
        person_id: personId,
        present: options.present ?? true,
        responsible_leader_id: leaderId,
        recorded_by: recorder,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return row.id;
  };

  /**
   * A record that was corrected: a superseded row and the live one that replaced it.
   *
   * **Written in the order the service writes it**, which is the only order the schema
   * permits. `dcc_attendance_one_live` refuses a second live row for one person at one
   * event, so the predecessor must be closed before the successor exists -- and closing
   * it requires naming a successor, because section 9 has no operation that closes a DCC
   * record with nothing replacing it and migration 0013 refuses a row naming itself. The
   * successor's identifier is therefore generated first and the foreign key is deferred.
   *
   * It is here because a corrected record is exactly how a query that forgets
   * `superseded_at IS NULL` over-counts -- and it over-counts in *both* views at once, so
   * the reconciliation identity still holds and cannot catch it.
   */
  const attendCorrected = async (eventId: string, personId: string, leaderId: string) => {
    await db.transaction().execute(async (trx) => {
      const successorId = randomUUID();

      const first = await trx
        .insertInto('dcc_attendance')
        .values({
          dcc_event_id: eventId,
          person_id: personId,
          present: true,
          responsible_leader_id: leaderId,
          recorded_by: recorder,
          recorded_at: FIRST_RECORDED_AT,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      // **One instant written to both ends, rather than a clock read twice.** Migration
      // 0013 requires a successor to begin exactly where its predecessor ended, and
      // `test/setup/fixtures.ts` states the rule this is the other half of: never take the
      // two ends of a period from different clocks. Reading `clock_timestamp()` for the
      // close and letting the successor default gives two instants microseconds apart,
      // which the trigger correctly refuses.
      await trx
        .updateTable('dcc_attendance')
        .set({ superseded_at: CORRECTED_AT, superseded_by: successorId })
        .where('id', '=', first.id)
        .execute();

      await trx
        .insertInto('dcc_attendance')
        .values({
          id: successorId,
          dcc_event_id: eventId,
          person_id: personId,
          present: true,
          responsible_leader_id: leaderId,
          recorded_by: recorder,
          recorded_at: CORRECTED_AT,
        })
        .execute();
    });
  };

  it('both views sum to the same unique-people total', async () => {
    const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, root.id, null);

    const people = [];
    for (const name of ['Ana', 'Ben', 'Cely', 'Dino', 'Elmo']) {
      const p = await createPerson(db, { firstName: name, network: 'MENS' });
      await assignTo(db, p.id, root.id);
      people.push(p);
    }
    const [ana, ben, cely, dino, elmo] = people;

    recorder = await accountFor(root.id);

    const sep = await event(SEP_27);
    const e1 = await event(OCT_4);
    const e2 = await event(OCT_11);
    const e3 = await event(OCT_18);
    const removed = await event(OCT_25, recorder);

    // Ana: every October event, and September too. Lifetime 4 -> 4th Timer, monthly 3 of 3.
    // *Counted rather than assumed: the first version of this comment said five and
    // Regular, and the expectation below was written from the comment.*
    await attend(sep, ana.id, root.id);
    await attend(e1, ana.id, root.id);
    await attend(e2, ana.id, root.id);
    await attend(e3, ana.id, root.id);

    // Ben: two in October, one in September. Lifetime 3 -> 3rd Timer, monthly 2.
    await attend(sep, ben.id, root.id);
    await attend(e1, ben.id, root.id);
    await attend(e2, ben.id, root.id);

    // Cely: one, her first ever. Lifetime 1 -> VIP, monthly 1.
    await attend(e1, cely.id, root.id);

    // Dino: marked absent, and present on the removed Sunday. He attended nothing
    // applicable, so he is not in the population at all.
    await attend(e1, dino.id, root.id, { present: false });
    await attend(removed, dino.id, root.id);

    // Elmo: a corrected record -- one superseded row and the live one that replaced it.
    // Counting both would put him in the `Twice` bucket and make his lifetime 2, so this
    // one case is load-bearing in both views at once. Lifetime 1 -> VIP, monthly 1.
    await attendCorrected(e2, elmo.id, root.id);

    const report = await reporting.dccMonthly({ kind: 'WHOLE_CHURCH' }, MONTH);

    // N counts calendar rows the month holds, and the removed Sunday is not one.
    expect(report.n).toBe(3);

    // Section 9 requires the removal to be visible, so that a month showing three where
    // the calendar shows four is explained rather than merely odd.
    expect(report.removedEvents).toEqual([OCT_25]);

    // Section 17: a report says whether its period is still open. October 2020 is not.
    expect(report.open).toBe(false);

    // Ana, Ben, Cely, Elmo. Dino is absent from the population, not a zero in it.
    expect(report.uniquePeople).toBe(4);

    const classificationTotal = Object.values(report.classification).reduce((a, b) => a + b, 0);
    const bucketTotal = report.buckets.reduce((sum, bucket) => sum + bucket.people, 0);

    // Section 20's two identities. Asserted against the same number rather than against
    // each other, so that both being wrong the same way still fails.
    expect(classificationTotal).toBe(report.uniquePeople);
    expect(bucketTotal).toBe(report.uniquePeople);

    // And the distribution itself, so a query that reconciles by putting everybody in one
    // bucket does not pass.
    // Cely and Elmo first-timers, Ben third, Ana fourth. Nobody is Regular, which is
    // deliberate -- a fixture where everybody lands in the same bucket checks less.
    expect(report.classification).toEqual({
      vip: 2,
      secondTimer: 0,
      thirdTimer: 1,
      fourthTimer: 1,
      regular: 0,
    });
    expect(report.buckets).toEqual([
      { times: 1, people: 2, completed: false },
      { times: 2, people: 1, completed: false },
      { times: 3, people: 1, completed: true },
    ]);
  });

  it('classification is evaluated as of the end of the month, not as of now', async () => {
    // Section 9: "A person who was a VIP in October and attended again in November is a
    // VIP on October's report forever." Without this a closed month's figures move every
    // time somebody attends again, which section 20 forbids and section 3 makes a
    // reproducibility guarantee.
    const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, root.id, null);
    const cely = await createPerson(db, { firstName: 'Cely', network: 'MENS' });
    await assignTo(db, cely.id, root.id);
    recorder = await accountFor(root.id);

    const october = await event(OCT_4);
    await attend(october, cely.id, root.id);

    const before = await reporting.dccMonthly({ kind: 'WHOLE_CHURCH' }, MONTH);
    expect(before.classification.vip).toBe(1);

    // She attends twice more in November.
    const nov7 = await event('2020-11-01');
    const nov14 = await event('2020-11-08');
    await attend(nov7, cely.id, root.id);
    await attend(nov14, cely.id, root.id);

    const after = await reporting.dccMonthly({ kind: 'WHOLE_CHURCH' }, MONTH);
    expect(after.classification.vip).toBe(1);
    expect(after.classification.thirdTimer).toBe(0);
    expect(after).toEqual(before);
  });

  it('refuses a month that is not the first of one, rather than under-reporting it', async () => {
    // The calendar is matched on a `YYYY-MM` prefix, which sorts chronologically only for a
    // well-formed month. A malformed one would match nothing and return a plausible empty
    // report -- worse than a refusal, because nobody can see it is wrong. Decision 0185
    // settles the same shape for a date-only field.
    //
    // **Asserted on the error class rather than its message, and a mutation is why.** With
    // the guard removed this case still passed: `windowClosesAt` throws its own "not the
    // first of a month" and the regex matched it. But that is a plain `Error`, which the
    // exception filter renders as `INTERNAL_ERROR` -- a 500 on a client's bad month, which
    // is the exact failure `reportingMonthOf` records having shipped once. Passing for that
    // reason is the test pinning nothing.
    await expect(reporting.dccMonthly({ kind: 'WHOLE_CHURCH' }, '2020-10')).rejects.toThrow(
      ValidationFailedError,
    );
    await expect(reporting.dccMonthly({ kind: 'WHOLE_CHURCH' }, '2020-10-15')).rejects.toThrow(
      ValidationFailedError,
    );
    await expect(reporting.dccMonthly({ kind: 'WHOLE_CHURCH' }, '2020-13-01')).rejects.toThrow(
      ValidationFailedError,
    );
  });

  it('a month with no applicable events has an empty population and no buckets', async () => {
    // Section 12 refuses a `Completed (0/0)` bucket on the ground that a bucket every
    // person satisfies is not a bucket. The DCC case is the same shape: no events means
    // nobody attended, and both identities hold over zero.
    const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, root.id, null);
    recorder = await accountFor(root.id);

    const report = await reporting.dccMonthly({ kind: 'WHOLE_CHURCH' }, MONTH);

    expect(report.n).toBe(0);
    expect(report.uniquePeople).toBe(0);
    expect(report.buckets).toEqual([]);
    expect(report.removedEvents).toEqual([]);
    expect(Object.values(report.classification).reduce((a, b) => a + b, 0)).toBe(0);
  });
});
