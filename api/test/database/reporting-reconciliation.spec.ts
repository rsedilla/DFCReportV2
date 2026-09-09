import { randomUUID } from 'node:crypto';

import { Test } from '@nestjs/testing';

import { AppConfigModule } from '../../src/config/config.module';
import { DatabaseModule } from '../../src/database/database.module';
import { CellFiguresService } from '../../src/attendance/cell-figures.service';
import { DccCoverageService } from '../../src/attendance/dcc-coverage.service';
import { CellsReadService } from '../../src/cells/cells.read.service';
import { DccFiguresService } from '../../src/attendance/dcc-figures.service';
import { AuthorizationService } from '../../src/auth/authorization/authorization.service';
import { PeopleReadService } from '../../src/people/people.read.service';
import { HierarchyService } from '../../src/hierarchy/hierarchy.service';
import { NetworksService } from '../../src/networks/networks.service';
import { ReportingService } from '../../src/reporting/reporting.service';
import { ValidationFailedError } from '../../src/common/errors/api-error';
import { currentReportingMonth } from '../../src/common/time/submission-window';
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

    // **The providers rather than `ReportingModule`.** Importing the module pulls
    // `AttendanceModule` and, behind it, most of the application graph -- which this file
    // has no use for and which makes an unrelated wiring change fail it. That the real
    // module resolves is asserted where it belongs, in `module-graph.spec.ts`, which
    // compiles the whole of `AppModule`.
    //
    // `HierarchyService` joined the list when leader scope arrived and `NetworksService`
    // when Network scope did: `ReportingService` composes the placement graph and the
    // Network's membership (decisions 0206 and 0219), and every scope goes through the
    // same constructor — so a provider is needed here even by a case that never asks for
    // that scope.
    //
    // **`CellFiguresService` joined with the Cell monthly report, and is the sharpest
    // instance of that clause**: this file computes no Cell figure anywhere, and without
    // the provider every case in it fails to construct. It was missed by the commit that
    // added the dependency and found by the full suite rather than by this file's own run
    // — which is why the cost of hand-building the module is written down beside the
    // reason for doing it.
    //
    // **It has now happened three times**, the third being the coverage line (decisions
    // 0224 and 0225), which brought `DccCoverageService` and, behind it,
    // `AuthorizationService` and `PeopleReadService`, plus `CellsReadService` for the Cell
    // denominator. This file measures no coverage and authorizes nobody, and needs all
    // four to construct. *This comment said "the second time" and was made stale by the
    // commit that read it, which is the failure it is about.* The count is not incremented
    // from here: it is what `git log -S DccCoverageService` and its two predecessors show.
    //
    // *The numerator deliberately does **not** appear here. It was first written on
    // `CellMeetingsService`, which needs audit, idempotency, authorization and meeting
    // scope in order to exist, and this module had to pull that whole chain in to count
    // rows. It lives on `CellFiguresService` instead, which is a figure service taking a
    // database and nothing else — and which was already in this list.*
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule],
      providers: [
        CellFiguresService,
        DccFiguresService,
        DccCoverageService,
        CellsReadService,
        AuthorizationService,
        PeopleReadService,
        HierarchyService,
        NetworksService,
        ReportingService,
      ],
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
    expect(report.removed_events).toEqual([OCT_25]);

    // Section 17: a report says whether its period is still open. October 2020 is not.
    expect(report.open).toBe(false);

    // Ana, Ben, Cely, Elmo. Dino is absent from the population, not a zero in it.
    expect(report.unique_people).toBe(4);

    const classificationTotal = Object.values(report.classification).reduce((a, b) => a + b, 0);
    const bucketTotal = report.buckets.reduce((sum, bucket) => sum + bucket.people, 0);

    // Section 20's two identities. Asserted against the same number rather than against
    // each other, so that both being wrong the same way still fails.
    expect(classificationTotal).toBe(report.unique_people);
    expect(bucketTotal).toBe(report.unique_people);

    // And the distribution itself, so a query that reconciles by putting everybody in one
    // bucket does not pass.
    // Cely and Elmo first-timers, Ben third, Ana fourth. Nobody is Regular, which is
    // deliberate -- a fixture where everybody lands in the same bucket checks less.
    expect(report.classification).toEqual({
      vip: 2,
      second_timer: 0,
      third_timer: 1,
      fourth_timer: 1,
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
    expect(after.classification.third_timer).toBe(0);
    expect(after).toEqual(before);
  });

  it('says an open month is open, which is the other half of section 17', async () => {
    // **The half that had nothing able to fail.** Every other case here uses October 2020,
    // so `open` was only ever asserted as `false` -- replace the whole comparison with
    // `false AS open` and the suite stayed green. This needs no events and no attendance to
    // pin the other branch, only a month whose window has not shut.
    //
    // Section 17 requires the marker because an open month's figures are still changing,
    // and it is load-bearing beside an N that counts calendar rows whether or not their day
    // has passed (section 9).
    //
    // **The current month, not a future one.** This read `2099-01-01` until decision 0216,
    // which refuses a period that has not begun -- so the case that pinned `open` was
    // itself asking about a period no report may name. The current month is the right
    // fixture and always was: its window closes on the 8th of the month after, so it is
    // open at every instant within it, and unlike 2099 it is a month somebody could
    // actually ask for.
    // The database's clock, for the reason `reporting-dcc-monthly.e2e.spec.ts` gives at the
    // same call: the rule under test is decided on it (decision 0160).
    const thisMonth = await currentReportingMonth(db);
    const open = await reporting.dccMonthly({ kind: 'WHOLE_CHURCH' }, thisMonth);
    expect(open.open).toBe(true);
    expect(open.n).toBe(0);

    const closed = await reporting.dccMonthly({ kind: 'WHOLE_CHURCH' }, MONTH);
    expect(closed.open).toBe(false);
  });

  it('takes every figure in one statement, which is what makes the identity hold', async () => {
    // **The commit's headline fix had nothing that could fail.** `n` and the population were
    // read with `Promise.all` on a pooled connection: two connections, two snapshots, and a
    // Sunday removed between them yields a person whose count exceeds N and who falls
    // outside every bucket. Restoring that shape breaks no assertion in this file, because
    // the identity still holds sequentially on a quiescent database -- which is exactly why
    // the defect shipped in the first place.
    //
    // CLAIMED.md's standard is that a conformance claim with nothing that can fail is a
    // wish, so the shape is pinned rather than the outcome: one statement is one snapshot at
    // any isolation level, and two statements are not.
    // **Counted on the executor, not on the connection.** A `sql` template resolves its
    // executor through `db.getExecutor()` and calls `executeQuery` there, so a counter on
    // the Kysely instance never fires. And every member is bound to its target: Kysely reads
    // private fields off `this`, which a proxy does not declare, so an unbound method throws
    // on the first internal call rather than counting.
    let queries = 0;

    const count = <T extends object>(target: T, method: string): T =>
      new Proxy(target, {
        get(inner, property) {
          const value = Reflect.get(inner, property, inner) as unknown;

          if (property === method && typeof value === 'function') {
            return (...args: unknown[]) => {
              queries += 1;
              return (value as (...a: unknown[]) => unknown).apply(inner, args);
            };
          }

          return typeof value === 'function' ? value.bind(inner) : value;
        },
      });

    const counting = new Proxy(db, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;

        if (property === 'getExecutor' && typeof value === 'function') {
          return (...args: unknown[]) =>
            count((value as (...a: unknown[]) => object).apply(target, args), 'executeQuery');
        }

        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    await new DccFiguresService(counting).monthFigures(MONTH);

    expect(queries).toBe(1);
  });

  it('refuses a month that is not the first of one, rather than under-reporting it', async () => {
    // The calendar is matched on a `YYYY-MM` prefix, which sorts chronologically only for a
    // well-formed month. A malformed one would match nothing and return a plausible empty
    // report -- worse than a refusal, because nobody can see it is wrong. Decision 0185
    // settles the same shape for a date-only field.
    //
    // **Asserted on the error class and its details rather than on its message, and a mutation is why.** With
    // the guard removed this case still passed: `windowClosesAt` throws its own "not the
    // first of a month" and the regex matched it. But that is a plain `Error`, which the
    // exception filter renders as `INTERNAL_ERROR` -- a 500 on a client's bad month, which
    // is the exact failure `reportingMonthOf` records having shipped once. Passing for that
    // reason is the test pinning nothing.
    // **The field and the value are asserted, not merely the class.** Section 22 requires a
    // refusal to name the field a client needs in order to fix it, and asserting only
    // `ValidationFailedError` cannot see that it named the wrong one. It could not: when
    // leader scope derived a period's bounds *before* validating the month, three of these
    // four answered `field: "date"`, and two quoted a month the caller never sent --
    // `2020-13-01` refused as `"2020-14-01"`, which is decision 0185's shape reached one
    // call earlier. This file stayed green throughout, because the class was all it read.
    const refusalFor = async (period: string) => {
      try {
        await reporting.dccMonthly({ kind: 'WHOLE_CHURCH' }, period);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationFailedError);
        return (error as ValidationFailedError).details;
      }

      throw new Error(`expected ${period} to be refused`);
    };

    // `0026-01-01` is **the case that makes composing `isCalendarDate` mean something.** A
    // hand-written `\d{4}-(0[1-9]|1[0-2])-01` accepts it and `isCalendarDate` refuses it,
    // because `Date.UTC(26, ...)` applies the legacy two-digit-year mapping and the month's
    // window would be computed from 1926. Without it the two predicates are
    // indistinguishable here, and section 22's one-predicate rule has nothing that can fail.
    // `9999-12-01` is a real month and a valid date, and is the **only** month whose
    // successor is not writable as `YYYY-MM-DD` -- which is how a period's end is derived.
    // Unbounded it reached that derivation and answered `{field: "date", value:
    // "10000-01-01"}`, the same signature as `2020-13-01` one call further along, in the
    // batch whose stated purpose was closing that class.
    for (const period of ['2020-10', '2020-10-15', '2020-13-01', '0026-01-01', '9999-12-01']) {
      expect(await refusalFor(period)).toMatchObject({ field: 'period', value: period });
    }
  });

  it('a month with no applicable events has an empty population and no buckets', async () => {
    // Section 12 refuses a `Completed (0/0)` bucket on the ground that a bucket every
    // person satisfies is not a bucket. The DCC case is the same shape: no events means
    // nobody attended, and both identities hold over zero.
    const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, root.id, null);

    const report = await reporting.dccMonthly({ kind: 'WHOLE_CHURCH' }, MONTH);

    expect(report.n).toBe(0);
    expect(report.unique_people).toBe(0);
    expect(report.buckets).toEqual([]);
    expect(report.removed_events).toEqual([]);
    expect(Object.values(report.classification).reduce((a, b) => a + b, 0)).toBe(0);
  });

  /**
   * A Network's population is its **membership**, not its root's subtree (decision 0219).
   *
   * **This is the case the API-level cases cannot make.** There, every fixture total is
   * zero, so admitting a Network request shows it was scoped and not what it was scoped
   * *to*. Here the attendance is real, and the two readings give different numbers.
   *
   * **The person who separates them is discipled by somebody outside the tree, and that
   * matters because section 20's residual cannot be one.** Section 9: "A Person with no open
   * assignment row cannot have DCC attendance recorded" — so a DCC attendee always held an
   * assignment inside the period, and §20's residual, who held none at any instant, is never
   * in a DCC population. A first version of this case built one anyway, by direct insert,
   * and was green under both readings once restricted to states the application can write.
   *
   * What is reachable is a chain that terminates somewhere other than a Network root.
   * `assertLeaderIsAssignable` checks that a leader is unmerged, unarchived and in the same
   * Network, and does **not** require them to hold an assignment of their own — and
   * `createSystemAdministratorWithin` creates exactly such a Person, in a Network and
   * outside the pastoral tree (section 5 permits it). Somebody they disciple has an
   * assignment, so they may attend; a walk from the Network root never reaches them.
   *
   * *Found by `architecture-guardian`, which reproduced the §9 objection and then named this
   * case.*
   */
  it("counts a Network's members, including one the root's subtree cannot reach", async () => {
    const root = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, root.id, null);
    const discipled = await createPerson(db, { firstName: 'Cely', network: 'MENS' });
    await assignTo(db, discipled.id, root.id);

    // In the Men's Network and outside the pastoral tree, as an administrator is.
    const administrator = await createPerson(db, { firstName: 'Editha', network: 'MENS' });

    // Discipled by them, so they hold an assignment and may attend — and their chain
    // terminates at somebody who is not the Men's root.
    const strayed = await createPerson(db, { firstName: 'Bayani', network: 'MENS' });
    await assignTo(db, strayed.id, administrator.id);

    // The other Network, with a root of its own, because section 5 refuses a cross-Network
    // edge.
    const womensRoot = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
    await assignTo(db, womensRoot.id, null);
    const womensMember = await createPerson(db, { firstName: 'Luzviminda', network: 'WOMENS' });
    await assignTo(db, womensMember.id, womensRoot.id);

    recorder = await accountFor(root.id);

    const october = await event(OCT_4);
    await attend(october, discipled.id, root.id);
    await attend(october, strayed.id, administrator.id);
    await attend(october, womensMember.id, womensRoot.id);

    const mens = await reporting.dccMonthly({ kind: 'NETWORK', network: 'MENS' }, MONTH);
    const womens = await reporting.dccMonthly({ kind: 'NETWORK', network: 'WOMENS' }, MONTH);
    const wholeChurch = await reporting.dccMonthly({ kind: 'WHOLE_CHURCH' }, MONTH);

    // **Two, not one.** A walk from the Men's root reaches `discipled` and never `strayed`,
    // so the subtree reading answers 1 here and the identity below fails.
    expect(mens.unique_people).toBe(2);
    expect(womens.unique_people).toBe(1);

    // Section 17's drill-down: Whole Church → Network → Leader. This is the level at which
    // the subtree reading would stop adding up.
    expect(wholeChurch.unique_people).toBe(3);
    expect(mens.unique_people + womens.unique_people).toBe(wholeChurch.unique_people);

    // Section 20's reconciliation still holds inside the Network scope.
    const classified = Object.values(mens.classification).reduce((a, b) => a + b, 0);
    const bucketed = mens.buckets.reduce((total, bucket) => total + bucket.people, 0);
    expect(classified).toBe(mens.unique_people);
    expect(bucketed).toBe(mens.unique_people);
  });

  /**
   * The population is read at **one instant — the period's final millisecond** — and from
   * `network_assignments` alone (decisions 0218 and 0219).
   *
   * **Three people who move at three different times, because one mover pins only one
   * wrong answer.** A first version had a single person who moved *after* the month, which
   * fails an implementation reading "now" and passes three others. `architecture-guardian`
   * ran them: reading the period's **start**, dropping the `ended_at` half of the predicate,
   * and deriving the Network from `persons.sex` all stayed green — and that third is the
   * derivation section 4 forbids in the one sentence decision 0219 cites as its whole
   * ground. Each person below exists to redden one of them.
   *
   * | moves | in force at period end | what it catches |
   * | --- | --- | --- |
   * | after the month | Men's | reading `now`, and deriving from `sex` |
   * | inside the month | Women's | reading the period's `start` |
   * | before the month | Women's | dropping the `ended_at` predicate |
   *
   * **`persons.sex` is updated with the Network, as `correctSex` writes it.** The fixture
   * left it alone before, which is not the state the application produces — and that gap is
   * exactly what let a `sex`-derived population pass.
   *
   * Written straight to the tables because section 4 reaches this state only through
   * `people.correct_sex`, which is not what is under test — but as section 4's **atomic
   * pair**: the Network change and the pastoral reassignment share one instant and one
   * transaction. The database refuses the Network half alone, which this fixture met on its
   * first run.
   */
  it("reads the population at the period's end, from rows in force then", async () => {
    const mensRoot = await createPerson(db, { firstName: 'Oriel', network: 'MENS' });
    await assignTo(db, mensRoot.id, null);
    const womensRoot = await createPerson(db, { firstName: 'Geraldine', network: 'WOMENS' });
    await assignTo(db, womensRoot.id, null);

    /** Section 4's atomic pair, plus the `sex` the correction would have written. */
    const moveToWomens = async (personId: string, at: Date): Promise<void> => {
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('network_assignments')
          .set({ ended_at: at })
          .where('person_id', '=', personId)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('network_assignments')
          .values({
            person_id: personId,
            network: 'WOMENS',
            reason: 'A fixture standing in for a section 4 correction.',
            actor_id: null,
            started_at: at,
          })
          .execute();
        await trx
          .updateTable('pastoral_assignments')
          .set({ ended_at: at })
          .where('person_id', '=', personId)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('pastoral_assignments')
          .values({ person_id: personId, leader_id: womensRoot.id, started_at: at })
          .execute();
        await trx
          .updateTable('persons')
          .set({ sex: 'FEMALE' })
          .where('id', '=', personId)
          .execute();
      });
    };

    const movedAfter = await createPerson(db, { firstName: 'Rosa', network: 'MENS' });
    const movedDuring = await createPerson(db, { firstName: 'Imelda', network: 'MENS' });
    const movedBefore = await createPerson(db, { firstName: 'Corazon', network: 'MENS' });
    await assignTo(db, movedAfter.id, mensRoot.id);
    await assignTo(db, movedDuring.id, mensRoot.id);
    await assignTo(db, movedBefore.id, mensRoot.id);

    // Before the month, so their Men's row is closed *and started* before the period —
    // the only person here whose closed row an `ended_at`-blind query would still match.
    await moveToWomens(movedBefore.id, new Date('2020-09-15T10:00:00+08:00'));

    recorder = await accountFor(mensRoot.id);
    const october = await event(OCT_4);
    await attend(october, movedAfter.id, mensRoot.id);
    await attend(october, movedBefore.id, womensRoot.id);

    // Mid-month, after the attendance above and before the period ends.
    await moveToWomens(movedDuring.id, new Date('2020-10-15T10:00:00+08:00'));
    await attend(october, movedDuring.id, womensRoot.id);

    await moveToWomens(movedAfter.id, new Date('2020-11-05T10:00:00+08:00'));

    const mens = await reporting.dccMonthly({ kind: 'NETWORK', network: 'MENS' }, MONTH);
    const womens = await reporting.dccMonthly({ kind: 'NETWORK', network: 'WOMENS' }, MONTH);
    const wholeChurch = await reporting.dccMonthly({ kind: 'WHOLE_CHURCH' }, MONTH);

    // Only `movedAfter` is still in the Men's Network at the last millisecond of October.
    expect(mens.unique_people).toBe(1);
    expect(womens.unique_people).toBe(2);
    expect(mens.unique_people + womens.unique_people).toBe(wholeChurch.unique_people);
  });
});
