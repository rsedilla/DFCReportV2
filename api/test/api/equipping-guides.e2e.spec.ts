import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';

import { lifeClassGuidesFor } from '../../src/equipping/equipping.service';
import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createCell,
  createPerson,
  createTestApp,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * A class's Guides at the API (SKILL.md section 29, decision 0501, points 4 and 8).
 *
 * What is pinned, each from the ruling rather than from the service:
 *
 *   - a Life Class Guide has passed SOL 1 (a pass before the school counts) and is in the tree,
 *     and anybody else is refused (owner, 2026-11-20);
 *   - DREAMS shares the students out by sex, the Guide with the fewest first, so 5 men under two
 *     Guides are 3 and 2, and a student with no Guide of their sex reads none;
 *   - a student enrolled later joins the same-sex Guide with the fewest (owner, 2026-11-20);
 *   - *Swap Guide* stays within the student's sex; removing a Guide shares their students out;
 *   - only the Coordinator and the Admin do any of it; nothing is deleted.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('Guides (section 29, decision 0501)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let registrar: TestAccount;
  let coordinator: TestAccount;
  let plainLeader: TestAccount;
  let ramon: TestPerson;
  let rosa: TestPerson;
  let mario: TestPerson;
  let pedro: TestPerson;
  let mila: TestPerson;
  let nico: TestPerson;
  let seasonId: string;
  let classId: string;

  const TERM = { level: 'LIFE_CLASS', term_year: 2027, term_number: 1 };

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const post = (account: TestAccount, path: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/v1/${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);

  const get = (account: TestAccount, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/${path}`)
      .set('Authorization', `Bearer ${account.accessToken}`);

  /** A SOL graduation, as a leader files it today (section 28). */
  const passed = async (person: TestPerson, program: 'SOL_1' | 'LIFE_CLASS') =>
    db
      .insertInto('training_graduations')
      .values({
        person_id: person.id,
        program,
        graduated_on: '2025-06-01',
        confirmed_by: person === mila ? rosa.id : ramon.id,
        recorded_by: admin.id,
      })
      .execute();

  /** Registered and enrolled into the class, each a Person under Ramon with a birthday. */
  const enrol = async (people: { name: string; network: 'MENS' | 'WOMENS' }[]) => {
    const ids: string[] = [];
    for (const each of people) {
      const person = await createPerson(db, {
        firstName: each.name,
        network: each.network,
        birthDate: '1999-02-01',
      });
      await assignTo(db, person.id, each.network === 'MENS' ? ramon.id : rosa.id);
      const reg = await post(registrar, 'equipping/registrations', {
        ...TERM,
        person_id: person.id,
        bible_confirmed: true,
        manual_confirmed: true,
        exception_reason: 'Their leader confirms they attend.',
      }).expect(201);
      ids.push((reg.body as { id: string }).id);
    }
    await post(admin, `equipping/classes/${classId}/enrollments`, { registration_ids: ids }).expect(
      201,
    );
  };

  const students = async () =>
    (await get(coordinator, `equipping/coordinate/classes/${classId}/students`).expect(200))
      .body as {
      guides: { id: string; person: { id: string } }[];
      data: {
        enrollment_id: string;
        person: { full_name: string };
        sex: string;
        guide: { id: string; full_name: string } | null;
        cell_leader: { full_name: string } | null;
      }[];
    };

  const guideIdOf = async (person: TestPerson) =>
    (await students()).guides.find((g) => g.person.id === person.id)!.id;

  beforeEach(async () => {
    await truncateAll(db);

    ramon = await createPerson(db, { firstName: 'Ramon', network: 'MENS' });
    await assignTo(db, ramon.id, null);
    rosa = await createPerson(db, { firstName: 'Rosa', network: 'WOMENS' });
    await assignTo(db, rosa.id, null);
    mario = await createPerson(db, { firstName: 'Mario', network: 'MENS' });
    await assignTo(db, mario.id, ramon.id);
    await createCell(db, { leader: mario });
    pedro = await createPerson(db, { firstName: 'Pedro', network: 'MENS' });
    await assignTo(db, pedro.id, ramon.id);
    mila = await createPerson(db, { firstName: 'Mila', network: 'WOMENS' });
    await assignTo(db, mila.id, rosa.id);
    nico = await createPerson(db, { firstName: 'Nico', network: 'MENS' });
    await assignTo(db, nico.id, ramon.id);
    const lito = await createPerson(db, { firstName: 'Lito', network: 'MENS' });
    await assignTo(db, lito.id, ramon.id);

    const ada = await createPerson(db, { firstName: 'Ada', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: ada, roles: ['ADMIN'] });
    const eva = await createPerson(db, { firstName: 'Eva', network: 'WOMENS' });
    registrar = await createAccount(app, db, { person: eva, roles: ['REGISTRAR'] });
    coordinator = await createAccount(app, db, { person: lito, roles: ['LEADER'] });
    plainLeader = await createAccount(app, db, { person: nico, roles: ['LEADER'] });
    await post(admin, `accounts/${coordinator.id}/coordinates-life-class`, {
      coordinates_life_class: true,
    }).expect(200);

    await passed(mario, 'SOL_1');
    await passed(pedro, 'SOL_1');
    await passed(mila, 'SOL_1');
    await passed(nico, 'LIFE_CLASS');

    seasonId = (
      await db
        .insertInto('encounter_seasons')
        .values({
          mens_lc_party_on: '2027-01-30',
          mens_encounter_on: '2027-03-06',
          womens_lc_party_on: '2027-02-06',
          womens_encounter_on: '2027-03-13',
          created_by: admin.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    classId = (
      (
        await post(coordinator, 'equipping/classes', {
          ...TERM,
          name: 'Life Class A',
          day_of_week: 2,
          time_of_day: '19:00',
          first_lesson_on: '2027-01-12',
          encounter_season_id: seasonId,
        }).expect(201)
      ).body as { id: string }
    ).id;
  });

  it('counts the Guides a sex needs as the owner gave them', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 11, 24].map(lifeClassGuidesFor)).toEqual([
      0, 1, 1, 1, 1, 2, 2, 2, 3, 8,
    ]);
  });

  it('names only somebody one level ahead and in the tree', async () => {
    const refused = await post(coordinator, `equipping/classes/${classId}/guides`, {
      person_id: nico.id,
    }).expect(409);
    expect((refused.body as { error: { code: string } }).error.code).toBe('INVARIANT_VIOLATION');
    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: mario.id }).expect(
      201,
    );
    // The Guide search offers only who may guide.
    const found = (await get(coordinator, 'equipping/guides?q=Nic').expect(200)).body as {
      data: unknown[];
    };
    expect(found.data).toEqual([]);
    // Each says why they may guide (decision 0501, point 4).
    const mar = (await get(coordinator, 'equipping/guides?q=Mar').expect(200)).body as {
      data: { full_name: string; qualifies: string | null }[];
    };
    expect(mar.data.map((each) => [each.full_name, each.qualifies])).toEqual([
      [expect.stringContaining('Mario'), 'Passed SOL 1'],
    ]);
  });

  it('shares the students out by sex, the fewest first, and a late one joins the fewest', async () => {
    await enrol([
      { name: 'Ben', network: 'MENS' },
      { name: 'Carlo', network: 'MENS' },
      { name: 'Dino', network: 'MENS' },
      { name: 'Eli', network: 'MENS' },
      { name: 'Fred', network: 'MENS' },
      { name: 'Ana', network: 'WOMENS' },
    ]);
    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: mario.id }).expect(
      201,
    );
    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: pedro.id }).expect(
      201,
    );

    let read = await students();
    const counts = (rows: typeof read.data) =>
      rows.reduce<Record<string, number>>((m, row) => {
        const key = row.guide?.full_name ?? 'none';
        m[key] = (m[key] ?? 0) + 1;
        return m;
      }, {});
    // Mario took all five men when he was the only Guide; Pedro takes the next arrivals only.
    expect(read.data.find((row) => row.person.full_name.startsWith('Ana'))?.guide).toBeNull();

    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: mila.id }).expect(
      201,
    );
    read = await students();
    expect(
      read.data.find((row) => row.person.full_name.startsWith('Ana'))?.guide?.full_name,
    ).toMatch(/^Mila/);

    // Removing Mario shares his men out to Pedro, the only man left.
    const marioGuide = await guideIdOf(mario);
    await post(coordinator, `equipping/classes/${classId}/guides/${marioGuide}/remove`, {}).expect(
      200,
    );
    read = await students();
    const men = read.data.filter((row) => row.sex === 'MALE');
    expect(men.every((row) => row.guide?.full_name.startsWith('Pedro'))).toBe(true);

    // Mario named again, then a sixth man enrolled late joins the Guide with the fewest: Mario.
    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: mario.id }).expect(
      201,
    );
    await enrol([{ name: 'Gil', network: 'MENS' }]);
    read = await students();
    expect(
      read.data.find((row) => row.person.full_name.startsWith('Gil'))?.guide?.full_name,
    ).toMatch(/^Mario/);
    expect(counts(read.data)[men[0].guide!.full_name]).toBe(5);
  });

  it('splits five men 3 and 2 when both Guides are named before anyone is shared out', async () => {
    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: mario.id }).expect(
      201,
    );
    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: pedro.id }).expect(
      201,
    );
    await enrol([
      { name: 'Ben', network: 'MENS' },
      { name: 'Carlo', network: 'MENS' },
      { name: 'Dino', network: 'MENS' },
      { name: 'Eli', network: 'MENS' },
      { name: 'Fred', network: 'MENS' },
    ]);
    const read = await students();
    const sizes = Object.values(
      read.data.reduce<Record<string, number>>((m, row) => {
        m[row.guide!.id] = (m[row.guide!.id] ?? 0) + 1;
        return m;
      }, {}),
    ).sort();
    expect(sizes).toEqual([2, 3]);
    const listed = (
      await get(
        coordinator,
        'equipping/coordinate/classes?level=LIFE_CLASS&term_year=2027&term_number=1',
      ).expect(200)
    ).body as { data: { guides: { named: number; short_men: number; short_women: number } }[] };
    expect(listed.data[0].guides).toEqual({ named: 2, short_men: 0, short_women: 0 });
  });

  it('swaps within the student’s sex only, and audits it', async () => {
    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: mario.id }).expect(
      201,
    );
    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: pedro.id }).expect(
      201,
    );
    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: mila.id }).expect(
      201,
    );
    await enrol([{ name: 'Ben', network: 'MENS' }]);
    const ben = (await students()).data[0];
    const refused = await post(coordinator, `equipping/enrollments/${ben.enrollment_id}/guide`, {
      guide_id: await guideIdOf(mila),
    }).expect(409);
    expect((refused.body as { error: { code: string } }).error.code).toBe('INVARIANT_VIOLATION');
    const other = ben.guide!.full_name.startsWith('Mario') ? pedro : mario;
    await post(coordinator, `equipping/enrollments/${ben.enrollment_id}/guide`, {
      guide_id: await guideIdOf(other),
    }).expect(200);
    const audit = await db
      .selectFrom('audit_log')
      .select('action')
      .where('action', '=', 'equipping_enrollment.guide_changed')
      .execute();
    expect(audit).toHaveLength(1);
  });

  it('is the Coordinator’s and the Admin’s alone', async () => {
    for (const as of [plainLeader, registrar]) {
      await post(as, `equipping/classes/${classId}/guides`, { person_id: mario.id }).expect(403);
      await get(as, 'equipping/guides?q=Mar').expect(403);
    }
    await post(admin, `equipping/classes/${classId}/guides`, { person_id: mario.id }).expect(201);
    const guideId = await guideIdOf(mario);
    for (const as of [plainLeader, registrar]) {
      await post(as, `equipping/classes/${classId}/guides/${guideId}/remove`, {}).expect(403);
      await post(as, `equipping/enrollments/${randomUUID()}/guide`, { guide_id: guideId }).expect(
        403,
      );
    }
  });

  it('keeps every row: a delete is refused, and a pairing names a Guide of its own class', async () => {
    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: mario.id }).expect(
      201,
    );
    await expect(sql`DELETE FROM equipping_class_guides`.execute(db)).rejects.toThrow(
      /never deleted/,
    );
    const other = (
      await post(coordinator, 'equipping/classes', {
        ...TERM,
        name: 'Life Class B',
        day_of_week: 4,
        time_of_day: '19:00',
        first_lesson_on: '2027-01-14',
        encounter_season_id: seasonId,
      }).expect(201)
    ).body as { id: string };
    await enrol([{ name: 'Ben', network: 'MENS' }]);
    const ben = (await students()).data[0];
    const foreign = await db
      .insertInto('equipping_class_guides')
      .values({ class_id: other.id, person_id: pedro.id, named_by: admin.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    // A pairing cannot be repointed at all (decision 0502), and a new one to another class's
    // Guide is refused by the same-class trigger.
    await expect(
      sql`UPDATE equipping_guide_students SET guide_id = ${foreign.id} WHERE enrollment_id = ${ben.enrollment_id}`.execute(
        db,
      ),
    ).rejects.toThrow(/keeps its student and Guide/);
    await sql`UPDATE equipping_guide_students SET ended_at = now(), ended_by = ${admin.id}, end_reason = 'SWAPPED' WHERE enrollment_id = ${ben.enrollment_id}`.execute(
      db,
    );
    await expect(
      db
        .insertInto('equipping_guide_students')
        .values({ enrollment_id: ben.enrollment_id, guide_id: foreign.id, started_by: admin.id })
        .execute(),
    ).rejects.toThrow(/equipping_guide_students_same_class|Guide of the class/);
  });

  /** The pairing rows of one enrollment, oldest first. */
  const pairingsOf = (enrollmentId: string) =>
    db
      .selectFrom('equipping_guide_students')
      .select(['guide_id', 'ended_at', 'end_reason'])
      .where('enrollment_id', '=', enrollmentId)
      .orderBy('started_at')
      .execute();

  it('ends a pairing when its student moves or withdraws, and a later removal leaves it so', async () => {
    await enrol([
      { name: 'Ben', network: 'MENS' },
      { name: 'Carlo', network: 'MENS' },
    ]);
    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: mario.id }).expect(
      201,
    );
    const [ben, carlo] = (await students()).data;
    const otherClass = (
      (
        await post(coordinator, 'equipping/classes', {
          ...TERM,
          name: 'Life Class B',
          day_of_week: 4,
          time_of_day: '19:00',
          first_lesson_on: '2027-01-14',
          encounter_season_id: seasonId,
        }).expect(201)
      ).body as { id: string }
    ).id;
    await post(registrar, `equipping/enrollments/${ben.enrollment_id}/move`, {
      class_id: otherClass,
    }).expect(200);
    await post(registrar, `equipping/enrollments/${carlo.enrollment_id}/withdraw`, {
      reason: 'Working nights this term.',
    }).expect(200);

    // Decision 0502, point 1: the pairing ends with the enrollment, and says why.
    for (const each of [ben, carlo]) {
      const rows = await pairingsOf(each.enrollment_id);
      expect(rows).toHaveLength(1);
      expect(rows[0].end_reason).toBe('ENROLLMENT_ENDED');
      expect(rows[0].ended_at).not.toBeNull();
    }
    // Removing the Guide afterwards rewrites neither.
    await post(
      coordinator,
      `equipping/classes/${classId}/guides/${await guideIdOf(mario)}/remove`,
      {},
    ).expect(200);
    for (const each of [ben, carlo]) {
      expect((await pairingsOf(each.enrollment_id))[0].end_reason).toBe('ENROLLMENT_ENDED');
    }
  });

  it('gives an archived Guide no new students, keeps the ones they have, and refuses a swap to them', async () => {
    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: mario.id }).expect(
      201,
    );
    await enrol([
      { name: 'Ben', network: 'MENS' },
      { name: 'Carlo', network: 'MENS' },
    ]);
    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: pedro.id }).expect(
      201,
    );
    // Pedro takes nobody when named (decision 0501); the Coordinator swaps Carlo to him.
    const carlo = (await students()).data.find((each) =>
      each.person.full_name.startsWith('Carlo'),
    )!;
    const pedroGuide = await guideIdOf(pedro);
    await post(coordinator, `equipping/enrollments/${carlo.enrollment_id}/guide`, {
      guide_id: pedroGuide,
    }).expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/people/${pedro.id}/archive`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'MOVED_AWAY' })
      .expect(200);

    // Dino would join Pedro, who has fewer; Pedro is archived, so Dino joins Mario.
    await enrol([{ name: 'Dino', network: 'MENS' }]);
    const after = await students();
    const guideOf = (name: string) =>
      after.data.find((each) => each.person.full_name.startsWith(name))!.guide?.id;
    expect(guideOf('Dino')).toBe(await guideIdOf(mario));
    expect(guideOf('Carlo')).toBe(pedroGuide);
    expect(after.guides.find((g) => g.id === pedroGuide)).toMatchObject({ archived: true });

    const ben = after.data.find((each) => each.person.full_name.startsWith('Ben'))!;
    const refused = await post(coordinator, `equipping/enrollments/${ben.enrollment_id}/guide`, {
      guide_id: pedroGuide,
    }).expect(409);
    expect((refused.body as { error: { code: string } }).error.code).toBe('INVARIANT_VIOLATION');
  });

  it("enters a swap with both Guides' Persons, and says each sex's shortfall apart", async () => {
    await enrol([
      { name: 'Ben', network: 'MENS' },
      { name: 'Ana', network: 'WOMENS' },
    ]);
    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: mario.id }).expect(
      201,
    );
    const listed = (
      await get(
        coordinator,
        'equipping/coordinate/classes?level=LIFE_CLASS&term_year=2027&term_number=1',
      ).expect(200)
    ).body as {
      data: { id: string; guides: { named: number; short_men: number; short_women: number } }[];
    };
    expect(listed.data.find((each) => each.id === classId)!.guides).toEqual({
      named: 1,
      short_men: 0,
      short_women: 1,
    });

    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: pedro.id }).expect(
      201,
    );
    const ben = (await students()).data.find((each) => each.person.full_name.startsWith('Ben'))!;
    await post(coordinator, `equipping/enrollments/${ben.enrollment_id}/guide`, {
      guide_id: await guideIdOf(pedro),
    }).expect(200);
    const entry = await db
      .selectFrom('audit_log')
      .select(['before', 'after'])
      .where('action', '=', 'equipping_enrollment.guide_changed')
      .executeTakeFirstOrThrow();
    expect(entry.before).toEqual({ guide_person_id: mario.id });
    expect(entry.after).toEqual({ guide_person_id: pedro.id });
  });

  it('holds its invariants as database constraints, not only in the service', async () => {
    await enrol([{ name: 'Ben', network: 'MENS' }]);
    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: mario.id }).expect(
      201,
    );
    const guideId = await guideIdOf(mario);
    const [ben] = (await students()).data;

    // One open naming of a person per class.
    await expect(
      db
        .insertInto('equipping_class_guides')
        .values({ class_id: classId, person_id: mario.id, named_by: admin.id })
        .execute(),
    ).rejects.toThrow(/equipping_class_guides_one_open/);
    // One open pairing per enrollment.
    await expect(
      db
        .insertInto('equipping_guide_students')
        .values({ enrollment_id: ben.enrollment_id, guide_id: guideId, started_by: admin.id })
        .execute(),
    ).rejects.toThrow(/equipping_guide_students_one_open/);
    // A Guide with an open pairing cannot be removed, and a naming keeps its class.
    await expect(
      db
        .updateTable('equipping_class_guides')
        .set({ removed_at: sql<Date>`now()`, removed_by: admin.id })
        .where('id', '=', guideId)
        .execute(),
    ).rejects.toThrow(/removed only once their students/);
    await expect(
      db
        .updateTable('equipping_class_guides')
        .set({ person_id: pedro.id })
        .where('id', '=', guideId)
        .execute(),
    ).rejects.toThrow(/keeps its class and person/);

    await post(coordinator, `equipping/classes/${classId}/guides/${guideId}/remove`, {}).expect(
      200,
    );
    // A removed Guide stays removed, an ended pairing stays ended, and nobody is paired with a
    // Guide who has left.
    await expect(
      db
        .updateTable('equipping_class_guides')
        .set({ removed_at: null, removed_by: null })
        .where('id', '=', guideId)
        .execute(),
    ).rejects.toThrow(/stays removed/);
    await expect(
      db
        .updateTable('equipping_guide_students')
        .set({ ended_at: null, ended_by: null, end_reason: null })
        .where('enrollment_id', '=', ben.enrollment_id)
        .execute(),
    ).rejects.toThrow(/stays ended/);
    await expect(
      db
        .insertInto('equipping_guide_students')
        .values({ enrollment_id: ben.enrollment_id, guide_id: guideId, started_by: admin.id })
        .execute(),
    ).rejects.toThrow(/has left the class/);
  });

  it('enrols four people into one class at the same moment, each answered, none refused as busy', async () => {
    await post(coordinator, `equipping/classes/${classId}/guides`, { person_id: mario.id }).expect(
      201,
    );
    const register = async (name: string) => {
      const person = await createPerson(db, {
        firstName: name,
        network: 'MENS',
        birthDate: '1999-02-01',
      });
      await assignTo(db, person.id, ramon.id);
      const reg = await post(registrar, 'equipping/registrations', {
        ...TERM,
        person_id: person.id,
        bible_confirmed: true,
        manual_confirmed: true,
        exception_reason: 'Their leader confirms they attend.',
      }).expect(201);
      return (reg.body as { id: string }).id;
    };
    const regs = await Promise.all(['Ben', 'Carlo', 'Dino', 'Eli'].map(register));
    // Before the class lock was FOR NO KEY UPDATE, each enrollment's foreign-key check held
    // KEY SHARE on the class while waiting for the other's class lock: a deadlock every time.
    const answers = await Promise.all(
      regs.map((id) =>
        post(registrar, `equipping/classes/${classId}/enrollments`, { registration_ids: [id] }),
      ),
    );
    expect(answers.map((each) => each.status)).toEqual([201, 201, 201, 201]);
    const read = await students();
    expect(read.data).toHaveLength(4);
    expect(read.data.every((each) => each.guide !== null)).toBe(true);
  });
});
