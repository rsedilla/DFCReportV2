import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { manilaDayOf } from '../../src/common/time/manila';
import { databaseNow } from '../../src/common/time/submission-window';
import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  closeCellDirectly,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * The read-only Conquest tab at the API (SKILL.md section 27; decisions 0278, 0279 and
 * 0283 to 0286).
 *
 * Fixture names are invented (CLAUDE.md, Secrets). The tree is the example one:
 *
 *   Raymond (Men's root) -> Manuel -> { Mark, Nathan }
 *   Grace (Women's root) -> Hannah
 *   Adele: an administrator outside the pastoral tree
 *
 * Each case then gives Mark (or Nathan) the history it is about: disciples arriving and
 * leaving on stated days, SUYNL lessons filed on stated days, Cells opened and closed.
 *
 * **History is staged by writing the tables directly**, as `suynl.e2e.spec.ts` and
 * `reports-by-leader.e2e.spec.ts` do. The goals are derived from dated rows, and no route
 * can write a row dated in March 2025; the one exception is Open a cell, which is also
 * driven through the real `NEW_CELL` and `HANDOVER` approvals, since those are what
 * section 27 names.
 *
 * Every staged instant is 10:00 in Manila on a day of March 2025, so a `reached_on` can
 * be asserted as a literal day. One case crosses the Manila/UTC date line on purpose.
 */
describe('Conquest (section 27)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let nathan: TestPerson;
  let grace: TestPerson;
  let hannah: TestPerson;

  let admin: TestAccount;
  let manuelAccount: TestAccount;
  let markAccount: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    await assignTo(db, raymond.id, null);
    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    await assignTo(db, manuel.id, raymond.id);
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    await assignTo(db, mark.id, manuel.id);
    nathan = await createPerson(db, { firstName: 'Nathan', network: 'MENS' });
    await assignTo(db, nathan.id, manuel.id);

    grace = await createPerson(db, { firstName: 'Grace', network: 'WOMENS' });
    await assignTo(db, grace.id, null);
    hannah = await createPerson(db, { firstName: 'Hannah', network: 'WOMENS' });
    await assignTo(db, hannah.id, grace.id);

    const adele = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adele, roles: ['ADMIN'] });

    await createAccount(app, db, {
      person: raymond,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 1,
    });
    nameSeniorPastors(app, [raymond.id]);

    manuelAccount = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
    markAccount = await createAccount(app, db, { person: mark, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const pad = (value: number) => String(value).padStart(2, '0');

  /** 10:00 in Manila on a day of March 2025. */
  const onDay = (day: number) => new Date(`2025-03-${pad(day)}T10:00:00+08:00`);
  /** The Manila day `onDay(day)` falls on. */
  const dayOf = (day: number) => `2025-03-${pad(day)}`;

  const get = (account: TestAccount, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/conquest/${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  interface GoalState {
    reached_on: string | null;
    now?: number;
  }
  interface Row {
    person_id: string;
    member_id: string;
    full_name: string;
    goals: {
      win_3: GoalState;
      open_a_cell: GoalState;
      completion_of_12: GoalState;
      raise_12_leaders: GoalState;
    };
  }

  /** Every page of the list, following `next_cursor`. */
  const allPages = async (account: TestAccount, query = ''): Promise<Row[]> => {
    const rows: Row[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const response = await get(account, `people?limit=200&${query}${suffix}`);
      expect(response.status).toBe(200);
      rows.push(...response.body.data);
      cursor = response.body.next_cursor;
      pages += 1;
      expect(pages).toBeLessThan(50);
    } while (cursor !== null);

    return rows;
  };

  /** One person's four goals, as a reader who oversees them sees them. */
  const goalsOf = async (personId: string, account: TestAccount = manuelAccount) => {
    const row = (await allPages(account)).find((entry) => entry.person_id === personId);
    expect(row).toBeDefined();
    return row!.goals;
  };

  const idsOf = (rows: Row[]) => new Set(rows.map((row) => row.person_id));

  let serial = 0;

  /** A new Men's Person, not yet anybody's disciple. */
  const person = (label = 'Disciple') => {
    serial += 1;
    return createPerson(db, { firstName: `${label}${pad(serial)}`, network: 'MENS' });
  };

  /** A new Person, the disciple of `leader` from `at`. */
  const discipleOf = async (leader: TestPerson, at: Date, label?: string) => {
    const disciple = await person(label);
    await assignTo(db, disciple.id, leader.id, at);
    return disciple;
  };

  /** `count` new disciples of `leader`, the i-th (from 1) arriving on day `firstDay + i - 1`. */
  const disciplesOf = async (leader: TestPerson, count: number, firstDay = 1) => {
    const made: TestPerson[] = [];
    for (let index = 0; index < count; index += 1) {
      made.push(await discipleOf(leader, onDay(firstDay + index)));
    }
    return made;
  };

  /**
   * Moves a person under another leader at `at`: closes the open row and opens the next,
   * both ends from one value (fixtures.ts, *Never take the two ends ... from different
   * clocks*).
   */
  const move = async (personId: string, leaderId: string, at: Date) => {
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('pastoral_assignments')
        .set({ ended_at: at })
        .where('person_id', '=', personId)
        .where('ended_at', 'is', null)
        .execute();
      await trx
        .insertInto('pastoral_assignments')
        .values({ person_id: personId, leader_id: leaderId, started_at: at })
        .execute();
    });
  };

  /** Lessons 1, 2, 3, ... for a person, each filed on the day given, as current rows. */
  const fileLessons = async (personId: string, days: number[]) => {
    let lesson = 0;
    for (const day of days) {
      lesson += 1;
      await db
        .insertInto('suynl_lessons')
        .values({
          person_id: personId,
          lesson,
          confirmed_by: mark.id,
          recorded_by: admin.id,
          confirmed_at: onDay(day),
        })
        .execute();
    }
  };

  /** A further lesson with the given number, filed on the day given. */
  const fileLesson = async (personId: string, lesson: number, day: number) => {
    await db
      .insertInto('suynl_lessons')
      .values({
        person_id: personId,
        lesson,
        confirmed_by: mark.id,
        recorded_by: admin.id,
        confirmed_at: onDay(day),
      })
      .execute();
  };

  /** Withdraws a current lesson, as a correction does (section 28): superseded, never deleted. */
  const withdrawLesson = async (personId: string, lesson: number) => {
    const updated = await db
      .updateTable('suynl_lessons')
      .set({
        superseded_at: new Date(),
        corrected_by: admin.id,
        correction_reason: 'Filed against the wrong person.',
      })
      .where('person_id', '=', personId)
      .where('lesson', '=', lesson)
      .where('superseded_at', 'is', null)
      .executeTakeFirst();
    expect(Number(updated.numUpdatedRows)).toBe(1);
  };

  // ---------------------------------------------------------------------------
  // 1. Authorization
  // ---------------------------------------------------------------------------

  describe('authorization', () => {
    it('refuses an unauthenticated request on both routes', async () => {
      for (const path of ['counts', 'people']) {
        const response = await request(app.getHttpServer()).get(`/api/v1/conquest/${path}`);
        expect(response.status).toBe(401);
      }
    });

    it('refuses an account that holds no conquest.view_subtree', async () => {
      const outsider = await createAccount(app, db, { person: nathan, roles: [] });

      for (const path of ['counts', 'people']) {
        const response = await get(outsider, path);
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('CAPABILITY_DENIED');
      }
    });

    it('refuses an account holding the SUYNL and Training view grants but not Conquest’s', async () => {
      // Section 28: each module carries its own three, and a grant of one reaches nothing
      // in another.
      const reader = await createAccount(app, db, { person: nathan, roles: [] });
      for (const capability of ['suynl.view_subtree', 'training.view_subtree'] as const) {
        await db
          .insertInto('capability_grants')
          .values({
            account_id: reader.id,
            capability,
            scope_type: 'OWN_SUBTREE',
            read_only: true,
            reason: 'Invented for this case (CLAUDE.md, Secrets).',
            granted_by: admin.id,
          })
          .execute();
      }

      expect(
        (
          await request(app.getHttpServer())
            .get('/api/v1/suynl/counts')
            .set('Authorization', `Bearer ${reader.accessToken}`)
        ).status,
      ).toBe(200);

      for (const path of ['counts', 'people']) {
        const response = await get(reader, path);
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('CAPABILITY_DENIED');
      }
    });

    it('neither lists nor counts a person outside the grant', async () => {
      // Nathan (Mark's sibling) and Hannah (the other Network) each opened a Cell.
      await createCell(db, { leader: nathan, createdAt: onDay(3) });
      await createCell(db, { leader: hannah, createdAt: onDay(4) });

      // Mark's subtree is Mark alone.
      const byMark = await get(markAccount, 'counts');
      expect(byMark.status).toBe(200);
      expect(byMark.body).toEqual({
        people: 1,
        win_3: 0,
        open_a_cell: 0,
        completion_of_12: 0,
        raise_12_leaders: 0,
      });
      expect(idsOf(await allPages(markAccount))).toEqual(new Set([mark.id]));
      expect(await allPages(markAccount, 'goal=OPEN_A_CELL')).toEqual([]);

      // Manuel oversees Nathan and not Hannah.
      expect((await get(manuelAccount, 'counts')).body.open_a_cell).toBe(1);
      const manuelsOpeners = await allPages(manuelAccount, 'goal=OPEN_A_CELL');
      expect(idsOf(manuelsOpeners)).toEqual(new Set([nathan.id]));
      expect(idsOf(await allPages(manuelAccount))).not.toContain(hannah.id);

      // A Whole Church reader sees both.
      expect((await get(admin, 'counts')).body.open_a_cell).toBe(2);
      expect(idsOf(await allPages(admin, 'goal=OPEN_A_CELL'))).toEqual(
        new Set([nathan.id, hannah.id]),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Completion of 12
  // ---------------------------------------------------------------------------

  describe('Completion of 12', () => {
    it('is dated the day the twelfth edge started, read in Manila', async () => {
      await disciplesOf(mark, 11);
      // 01:00 on 1 April in Manila is still 31 March in UTC.
      await discipleOf(mark, new Date('2025-04-01T01:00:00+08:00'));

      const goals = await goalsOf(mark.id);
      expect(goals.completion_of_12).toEqual({ reached_on: '2025-04-01', now: 12 });
    });

    it('is not reached at eleven, and says how far it is', async () => {
      await disciplesOf(mark, 11);

      const goals = await goalsOf(mark.id);
      expect(goals.completion_of_12).toEqual({ reached_on: null, now: 11 });
    });

    it('does not count a disciple moved away before the twelfth arrived', async () => {
      const [first] = await disciplesOf(mark, 11);
      await move(first.id, nathan.id, onDay(12));
      await discipleOf(mark, onDay(13));

      // Eleven at every instant: the first left on the 12th, the twelfth came on the 13th.
      expect((await goalsOf(mark.id)).completion_of_12).toEqual({ reached_on: null, now: 11 });

      await discipleOf(mark, onDay(14));
      expect((await goalsOf(mark.id)).completion_of_12).toEqual({
        reached_on: dayOf(14),
        now: 12,
      });
    });

    it('does not count a disciple who leaves at the instant the twelfth arrives', async () => {
      // Half-open periods (section 5): an edge ending at t is not in force at t, so the
      // two never overlap and there are eleven at every instant.
      const [first] = await disciplesOf(mark, 11);
      await move(first.id, nathan.id, onDay(12));
      await discipleOf(mark, onDay(12));

      expect((await goalsOf(mark.id)).completion_of_12).toEqual({ reached_on: null, now: 11 });
    });

    it('stays reached after a disciple leaves, with today’s count beside it', async () => {
      const disciples = await disciplesOf(mark, 12);
      await move(disciples[2].id, nathan.id, onDay(20));

      expect((await goalsOf(mark.id)).completion_of_12).toEqual({ reached_on: dayOf(12), now: 11 });
    });

    it('counts a disciple who left and came back once', async () => {
      await disciplesOf(mark, 10);
      const returning = await discipleOf(mark, onDay(1));
      await move(returning.id, nathan.id, onDay(5));
      await move(returning.id, mark.id, onDay(8));

      expect((await goalsOf(mark.id)).completion_of_12).toEqual({ reached_on: null, now: 11 });
    });

    it('counts a disciple holding two overlapping edges once', async () => {
      // A closed row [1st, 20th) and an open row from the 5th, both under Mark. Nothing
      // writes this today — historical overlap is an open Stop Condition in CLAUDE.md —
      // but the schema admits it, and it is the only state in which counting per edge
      // rather than per disciple gives a different answer (twelve on the 10th).
      await disciplesOf(mark, 10);
      const doubled = await person();
      const earlier = await assignTo(db, doubled.id, mark.id, onDay(1));
      await db
        .updateTable('pastoral_assignments')
        .set({ ended_at: onDay(20) })
        .where('id', '=', earlier)
        .execute();
      await assignTo(db, doubled.id, mark.id, onDay(5));

      expect((await goalsOf(mark.id)).completion_of_12).toEqual({ reached_on: null, now: 11 });
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Win 3
  // ---------------------------------------------------------------------------

  describe('Win 3', () => {
    it('is dated when the third disciple qualifies, by their third lesson', async () => {
      // Each qualifies at the later of their edge's start and their third lesson.
      const first = await discipleOf(mark, onDay(1));
      await fileLessons(first.id, [2, 3, 4]); // qualifies on the 4th
      const second = await discipleOf(mark, onDay(10));
      await fileLessons(second.id, [1, 2, 3]); // filed before the edge: qualifies on the 10th
      const third = await discipleOf(mark, onDay(2));
      await fileLessons(third.id, [5, 6, 12]); // qualifies on the 12th

      expect((await goalsOf(mark.id)).win_3).toEqual({ reached_on: dayOf(12), now: 3 });
    });

    it('is dated when the third disciple qualifies, by their edge', async () => {
      const first = await discipleOf(mark, onDay(1));
      await fileLessons(first.id, [2, 3, 4]);
      const second = await discipleOf(mark, onDay(10));
      await fileLessons(second.id, [1, 2, 3]);
      const third = await discipleOf(mark, onDay(2));
      await fileLessons(third.id, [5, 6, 7]);

      expect((await goalsOf(mark.id)).win_3).toEqual({ reached_on: dayOf(10), now: 3 });
    });

    it('does not count a disciple with fewer than three lessons', async () => {
      for (const days of [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8],
      ]) {
        const disciple = await discipleOf(mark, onDay(1));
        await fileLessons(disciple.id, days);
      }

      expect((await goalsOf(mark.id)).win_3).toEqual({ reached_on: null, now: 2 });
    });

    it('a withdrawn lesson never counted: it removes the date, and a later lesson moves it', async () => {
      const first = await discipleOf(mark, onDay(1));
      await fileLessons(first.id, [2, 3, 4]);
      const second = await discipleOf(mark, onDay(10));
      await fileLessons(second.id, [1, 2, 3]);
      const third = await discipleOf(mark, onDay(2));
      await fileLessons(third.id, [5, 6, 7]);
      expect((await goalsOf(mark.id)).win_3).toEqual({ reached_on: dayOf(10), now: 3 });

      // Section 28: only current rows ever count, at every instant. With lesson 2 withdrawn
      // the first disciple has never held three.
      await withdrawLesson(first.id, 2);
      expect((await goalsOf(mark.id)).win_3).toEqual({ reached_on: null, now: 2 });

      // A fourth lesson on the 15th is their third current one, and the date moves there.
      await fileLesson(first.id, 4, 15);
      expect((await goalsOf(mark.id)).win_3).toEqual({ reached_on: dayOf(15), now: 3 });
    });

    it('does not count a disciple who left before the third qualified', async () => {
      const departed = await discipleOf(mark, onDay(1));
      await fileLessons(departed.id, [2, 3, 4]); // qualified on the 4th...
      await move(departed.id, nathan.id, onDay(6)); // ...and left on the 6th
      const second = await discipleOf(mark, onDay(1));
      await fileLessons(second.id, [7, 8, 9]);
      const third = await discipleOf(mark, onDay(1));
      await fileLessons(third.id, [10, 11, 12]);

      expect((await goalsOf(mark.id)).win_3).toEqual({ reached_on: null, now: 2 });

      const fourth = await discipleOf(mark, onDay(1));
      await fileLessons(fourth.id, [13, 14, 15]);
      expect((await goalsOf(mark.id)).win_3).toEqual({ reached_on: dayOf(15), now: 3 });
    });

    it('stays reached after a counted disciple leaves', async () => {
      const disciples = [];
      for (const days of [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ]) {
        const disciple = await discipleOf(mark, onDay(1));
        await fileLessons(disciple.id, days);
        disciples.push(disciple);
      }
      await move(disciples[0].id, nathan.id, onDay(20));

      expect((await goalsOf(mark.id)).win_3).toEqual({ reached_on: dayOf(9), now: 2 });
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Open a cell
  // ---------------------------------------------------------------------------

  describe('Open a cell', () => {
    const requestLeadership = (account: TestAccount, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/api/v1/cells/leadership-requests')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send(body);

    const approve = (requestId: string) =>
      request(app.getHttpServer())
        .post(`/api/v1/cells/leadership-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .set('Idempotency-Key', randomUUID())
        .send({});

    it('goes to the first leader of a Cell recorded at setup, dated that leadership', async () => {
      await createCell(db, { leader: mark, createdAt: onDay(5) });

      const goals = await goalsOf(mark.id);
      // Open a cell carries no count (section 27), so no `now`.
      expect(goals.open_a_cell).toEqual({ reached_on: dayOf(5) });
      expect(goals.win_3.reached_on).toBeNull();
    });

    it('goes to the leader an approved NEW_CELL names, and not to a handover’s successor', async () => {
      const opener = await discipleOf(mark, onDay(1), 'Opener');
      const successor = await discipleOf(mark, onDay(1), 'Successor');

      const asked = await requestLeadership(markAccount, {
        kind: 'NEW_CELL',
        prospective_leader_id: opener.id,
        category: 'YOUTH',
        day_of_week: 6,
        time_of_day: '18:00',
      });
      expect(asked.status).toBe(201);
      const approved = await approve(asked.body.id);
      expect(approved.status).toBe(200);
      const today = manilaDayOf(await databaseNow(db));

      expect((await goalsOf(opener.id)).open_a_cell).toEqual({ reached_on: today });

      const handover = await requestLeadership(markAccount, {
        kind: 'HANDOVER',
        prospective_leader_id: successor.id,
        cell_id: approved.body.cell_uuid,
      });
      expect(handover.status).toBe(201);
      expect((await approve(handover.body.id)).status).toBe(200);

      // A handover is not an opening, and the opener keeps what they reached.
      expect((await goalsOf(successor.id)).open_a_cell).toEqual({ reached_on: null });
      expect((await goalsOf(opener.id)).open_a_cell).toEqual({ reached_on: today });
      expect(idsOf(await allPages(manuelAccount, 'goal=OPEN_A_CELL'))).toEqual(
        new Set([opener.id]),
      );
    });

    it('does not go to a successor who took over a Cell recorded at setup', async () => {
      const cell = await createCell(db, { leader: nathan, createdAt: onDay(2) });
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('cell_leaderships')
          .set({ ended_at: onDay(9) })
          .where('cell_id', '=', cell.id)
          .where('ended_at', 'is', null)
          .execute();
        await trx
          .insertInto('cell_leaderships')
          .values({ person_id: mark.id, cell_id: cell.id, started_at: onDay(9) })
          .execute();
      });

      expect((await goalsOf(mark.id)).open_a_cell).toEqual({ reached_on: null });
      expect((await goalsOf(nathan.id)).open_a_cell).toEqual({ reached_on: dayOf(2) });
    });

    it('is unmade by closing the Cell CREATED_IN_ERROR (decision 0283)', async () => {
      const cell = await createCell(db, { leader: mark, createdAt: onDay(5) });
      expect((await goalsOf(mark.id)).open_a_cell).toEqual({ reached_on: dayOf(5) });

      await closeCellDirectly(db, cell.id, { reason: 'CREATED_IN_ERROR', at: onDay(6) });

      expect((await goalsOf(mark.id)).open_a_cell).toEqual({ reached_on: null });
      expect((await get(manuelAccount, 'counts')).body.open_a_cell).toBe(0);
    });

    it('stays reached when the Cell closes for any other reason', async () => {
      for (const reason of [
        'LEADER_STEPPED_DOWN',
        'MERGED_INTO_ANOTHER_CELL',
        'MEMBERS_DISPERSED',
        'OTHER',
      ] as const) {
        const opener = await discipleOf(mark, onDay(1));
        const cell = await createCell(db, { leader: opener, createdAt: onDay(5) });
        await closeCellDirectly(db, cell.id, {
          reason,
          at: onDay(8),
          note: reason === 'OTHER' ? 'Invented for this case.' : undefined,
        });

        expect((await goalsOf(opener.id)).open_a_cell).toEqual({ reached_on: dayOf(5) });
      }
    });

    it('is dated by the earliest Cell that still counts', async () => {
      const mistaken = await createCell(db, { leader: mark, createdAt: onDay(3) });
      await closeCellDirectly(db, mistaken.id, { reason: 'CREATED_IN_ERROR', at: onDay(4) });
      await createCell(db, { leader: mark, createdAt: onDay(9) });

      expect((await goalsOf(mark.id)).open_a_cell).toEqual({ reached_on: dayOf(9) });
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Raise 12 leaders
  // ---------------------------------------------------------------------------

  describe('Raise 12 leaders', () => {
    /**
     * Twelve disciples of Mark from the 1st, the i-th opening a Cell on day i + 1 — except
     * the twelfth, who opened theirs on the 5th while Nathan's disciple and came to Mark on
     * the 14th. So twelve leaders are Mark's disciples at once from the 14th, and not on
     * the 13th, when the twelfth led a Cell but was somebody else's.
     */
    const twelveLeaders = async () => {
      const disciples = await disciplesOf(mark, 11, 1).then(async (first) => {
        const late = await discipleOf(nathan, onDay(1));
        await move(late.id, mark.id, onDay(14));
        return [...first, late];
      });
      const cells = [];
      for (let index = 0; index < 11; index += 1) {
        cells.push(await createCell(db, { leader: disciples[index], createdAt: onDay(index + 2) }));
      }
      cells.push(await createCell(db, { leader: disciples[11], createdAt: onDay(5) }));
      return { disciples, cells };
    };

    it('is dated the first instant twelve disciples each lead a Cell', async () => {
      await twelveLeaders();

      const goals = await goalsOf(mark.id);
      expect(goals.raise_12_leaders).toEqual({ reached_on: dayOf(14), now: 12 });
      expect(goals.completion_of_12).toEqual({ reached_on: dayOf(14), now: 12 });
    });

    it('does not count a disciple who leads nothing', async () => {
      const disciples = await disciplesOf(mark, 12);
      for (let index = 0; index < 11; index += 1) {
        await createCell(db, { leader: disciples[index], createdAt: onDay(15) });
      }

      const goals = await goalsOf(mark.id);
      expect(goals.completion_of_12).toEqual({ reached_on: dayOf(12), now: 12 });
      expect(goals.raise_12_leaders).toEqual({ reached_on: null, now: 11 });
    });

    it('does not count a disciple whose Cell was closed CREATED_IN_ERROR (decision 0286)', async () => {
      const { cells } = await twelveLeaders();
      expect((await goalsOf(mark.id)).raise_12_leaders.reached_on).toBe(dayOf(14));

      // The Cell never existed, so its leadership never did either, and the date goes.
      await closeCellDirectly(db, cells[11].id, { reason: 'CREATED_IN_ERROR', at: onDay(20) });

      expect((await goalsOf(mark.id)).raise_12_leaders).toEqual({ reached_on: null, now: 11 });
    });

    it('stays reached when a Cell closes for another reason, the count falling', async () => {
      const { cells } = await twelveLeaders();

      await closeCellDirectly(db, cells[11].id, { reason: 'LEADER_STEPPED_DOWN', at: onDay(20) });

      expect((await goalsOf(mark.id)).raise_12_leaders).toEqual({ reached_on: dayOf(14), now: 11 });
    });

    it('does not reach twelve on a leadership that ended before the twelfth began', async () => {
      const { cells } = await twelveLeaders();
      // The first Cell closes on the 10th, before the twelfth leader arrives on the 14th.
      await closeCellDirectly(db, cells[0].id, { reason: 'MEMBERS_DISPERSED', at: onDay(10) });

      expect((await goalsOf(mark.id)).raise_12_leaders).toEqual({ reached_on: null, now: 11 });
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Counts and the list
  // ---------------------------------------------------------------------------

  describe('counts and the list', () => {
    let silas: TestPerson;

    beforeEach(async () => {
      // Mark: twelve disciples and a Cell. Nathan: a Cell, and three disciples with three
      // lessons each. Silas, archived and under Nathan, opened a Cell too.
      await disciplesOf(mark, 12);
      await createCell(db, { leader: mark, createdAt: onDay(2) });
      await createCell(db, { leader: nathan, createdAt: onDay(3) });
      for (const days of [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ]) {
        const disciple = await discipleOf(nathan, onDay(1));
        await fileLessons(disciple.id, days);
      }

      silas = await createPerson(db, { firstName: 'Silas', network: 'MENS', archived: true });
      await assignTo(db, silas.id, nathan.id, onDay(1));
      await createCell(db, { leader: silas, createdAt: onDay(4) });

      // Outside Manuel's grant, inside a Whole Church one.
      await createCell(db, { leader: hannah, createdAt: onDay(6) });
    });

    const cards = [
      ['win_3', 'WIN_3'],
      ['open_a_cell', 'OPEN_A_CELL'],
      ['completion_of_12', 'COMPLETION_OF_12'],
      ['raise_12_leaders', 'RAISE_12_LEADERS'],
    ] as const;

    it('counts what the tab lists, for a leader', async () => {
      const response = await get(manuelAccount, 'counts');

      expect(response.status).toBe(200);
      // Manuel, Mark, Nathan, Mark's twelve and Nathan's three. Silas is archived.
      expect(response.body).toEqual({
        people: 18,
        win_3: 1,
        open_a_cell: 2,
        completion_of_12: 1,
        raise_12_leaders: 0,
      });
    });

    for (const account of ['leader', 'whole church'] as const) {
      it(`each card equals the listed people who reached it, and narrows to them (${account})`, async () => {
        const reader = account === 'leader' ? manuelAccount : admin;
        const counts = (await get(reader, 'counts')).body;
        const listed = await allPages(reader);

        expect(listed).toHaveLength(counts.people);
        expect(idsOf(listed)).not.toContain(silas.id);

        for (const [key, goal] of cards) {
          const reached = listed.filter((row) => row.goals[key].reached_on !== null);
          expect(reached).toHaveLength(counts[key]);

          const narrowed = await allPages(reader, `goal=${goal}`);
          expect(idsOf(narrowed)).toEqual(idsOf(reached));
        }
      });
    }

    it('neither lists nor counts an archived person who reached a goal (decision 0279)', async () => {
      for (const reader of [manuelAccount, admin]) {
        expect(idsOf(await allPages(reader, 'goal=OPEN_A_CELL'))).not.toContain(silas.id);
      }
      expect(idsOf(await allPages(manuelAccount, 'goal=OPEN_A_CELL'))).toEqual(
        new Set([mark.id, nathan.id]),
      );
      expect((await get(admin, 'counts')).body.open_a_cell).toBe(3);
    });

    it('lists only direct disciples with mine=true', async () => {
      expect(idsOf(await allPages(manuelAccount, 'mine=true'))).toEqual(
        new Set([mark.id, nathan.id]),
      );
      expect(idsOf(await allPages(manuelAccount, 'mine=true&goal=WIN_3'))).toEqual(
        new Set([nathan.id]),
      );
    });

    it('shapes each row with its four goals, Open a cell carrying no count', async () => {
      const [row] = (await get(manuelAccount, 'people?goal=COMPLETION_OF_12')).body.data as Row[];

      expect(row.person_id).toBe(mark.id);
      expect(row.member_id).toMatch(/^M-\d+$/);
      expect(row.full_name).toContain('Mark');
      expect(row.goals).toEqual({
        win_3: { reached_on: null, now: 0 },
        open_a_cell: { reached_on: dayOf(2) },
        completion_of_12: { reached_on: dayOf(12), now: 12 },
        raise_12_leaders: { reached_on: null, now: 0 },
      });
    });

    it('refuses a goal it does not know', async () => {
      for (const goal of ['win_3', 'WIN_12', '']) {
        const response = await get(manuelAccount, `people?goal=${goal}`);
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });
});
