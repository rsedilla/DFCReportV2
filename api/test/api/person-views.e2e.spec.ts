import { sql, type Kysely } from 'kysely';
import request from 'supertest';

import { EMAIL_PORT } from '../../src/email/email.port';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Database } from '../../src/database/schema';
import type { CapturingEmailAdapter } from '../setup/capturing-email.adapter';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * Who opened a person's page (SKILL.md sections 8 and 21, decision 0414): kept for a year,
 * shown to the Admin, and the Admin told when one person opens more than a hundred pages in
 * an hour. Invented names.
 */
describe('who opened this record (decision 0414)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let email: CapturingEmailAdapter;
  let leader: TestAccount;
  let leaderPerson: TestPerson;
  let disciple: TestPerson;
  let admin: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
    email = app.get<CapturingEmailAdapter>(EMAIL_PORT);
  });

  beforeEach(async () => {
    await truncateAll(db);
    email.reset();

    const root = await createPerson(db, { firstName: 'Rodrigo', network: 'MENS' });
    await assignTo(db, root.id, null);
    leaderPerson = await createPerson(db, { firstName: 'Teofilo', network: 'MENS' });
    await assignTo(db, leaderPerson.id, root.id);
    disciple = await createPerson(db, { firstName: 'Marcelo', network: 'MENS' });
    await assignTo(db, disciple.id, leaderPerson.id);

    leader = await createAccount(app, db, { person: leaderPerson, roles: ['LEADER'] });
    const adminPerson = await createPerson(db, { firstName: 'Alma', network: 'WOMENS' });
    admin = await createAccount(app, db, { person: adminPerson, roles: ['ADMIN'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const open = (who: TestAccount, personId: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/people/${personId}`)
      .set('Authorization', `Bearer ${who.accessToken}`);

  const views = (who: TestAccount, personId: string, query = '') =>
    request(app.getHttpServer())
      .get(`/api/v1/people/${personId}/views${query}`)
      .set('Authorization', `Bearer ${who.accessToken}`);

  it('records an opening of the page, and shows it to the Admin, naming the pastoral leader', async () => {
    await open(leader, disciple.id).expect(200);

    const answer = await views(admin, disciple.id).expect(200);

    expect(answer.body.data).toHaveLength(1);
    expect(answer.body.data[0]).toMatchObject({
      viewer: { person_id: leaderPerson.id, full_name: expect.stringContaining('Teofilo') },
      relation: 'PASTORAL_LEADER',
    });
    expect(answer.body.next_cursor).toBeNull();
  });

  it('counts a reload within ten minutes as the same opening', async () => {
    await open(leader, disciple.id).expect(200);
    await open(leader, disciple.id).expect(200);

    expect((await views(admin, disciple.id).expect(200)).body.data).toHaveLength(1);

    await db
      .updateTable('person_views')
      .set({ viewed_at: sql`viewed_at - interval '11 minutes'` } as never)
      .execute();
    await open(leader, disciple.id).expect(200);

    expect((await views(admin, disciple.id).expect(200)).body.data).toHaveLength(2);
  });

  it('records nothing for a list or a search', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/people?q=Marcelo')
      .set('Authorization', `Bearer ${leader.accessToken}`)
      .expect(200);

    expect(await db.selectFrom('person_views').selectAll().execute()).toHaveLength(0);
  });

  it("keeps nothing for a read of one's own record, nor for a record that does not exist", async () => {
    await open(leader, leaderPerson.id).expect(200);
    await open(admin, '7d1c2b3a-0000-4000-8000-00000000abcd').expect(404);

    expect(await db.selectFrom('person_views').selectAll().execute()).toHaveLength(0);
  });

  it('pages without losing two openings inside one millisecond', async () => {
    const [first, second] = [
      await createPerson(db, { firstName: 'Dina', network: 'MENS' }),
      await createPerson(db, { firstName: 'Ester', network: 'MENS' }),
    ];
    // Two instants 0.4 ms apart: the same millisecond, different microseconds.
    await db
      .insertInto('person_views')
      .values([
        {
          person_id: disciple.id,
          viewer_person_id: first.id,
          viewed_at: sql`'2026-10-30 10:00:00.123900+00'`,
        },
        {
          person_id: disciple.id,
          viewer_person_id: second.id,
          viewed_at: sql`'2026-10-30 10:00:00.123500+00'`,
        },
      ] as never)
      .execute();

    const page1 = await views(admin, disciple.id, '?limit=1').expect(200);
    const page2 = await views(
      admin,
      disciple.id,
      `?limit=1&cursor=${page1.body.next_cursor}`,
    ).expect(200);

    expect([page1.body.data[0].viewer.person_id, page2.body.data[0]?.viewer.person_id]).toEqual([
      first.id,
      second.id,
    ]);
  });

  it('sends no birthday, civil status or mobile number in a list or search row', async () => {
    await db
      .updateTable('persons')
      .set({ birth_date: '1990-04-02', mobile_number: '+639171234567' } as never)
      .where('id', '=', disciple.id)
      .execute();

    for (const query of ['', '?q=Marcelo']) {
      const answer = await request(app.getHttpServer())
        .get(`/api/v1/people${query}`)
        .set('Authorization', `Bearer ${leader.accessToken}`)
        .expect(200);
      const row = answer.body.data.find((entry: { id: string }) => entry.id === disciple.id);

      expect(row).toMatchObject({ scope: 'FULL', member_id: expect.any(String) });
      expect(row).not.toHaveProperty('birth_date');
      expect(row).not.toHaveProperty('civil_status');
      expect(row).not.toHaveProperty('mobile_number');
    }

    // The one record still carries them, and reading it is kept.
    const record = await open(leader, disciple.id).expect(200);
    expect(record.body).toMatchObject({ birth_date: '1990-04-02', mobile_number: '+639171234567' });
  });

  it('is shown to the Admin alone', async () => {
    const refused = await views(leader, disciple.id);

    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('CAPABILITY_DENIED');
  });

  it('shows nothing older than a year, and removes it', async () => {
    await db
      .insertInto('person_views')
      .values({
        person_id: disciple.id,
        viewer_person_id: leaderPerson.id,
        viewed_at: sql`now() - interval '13 months'`,
      } as never)
      .execute();

    expect((await views(admin, disciple.id).expect(200)).body.data).toHaveLength(0);

    await open(leader, disciple.id).expect(200);
    expect(await db.selectFrom('person_views').selectAll().execute()).toHaveLength(1);
  });

  it('pages newest first, and refuses a cursor it cannot read', async () => {
    const others = [];
    for (const name of ['Ana', 'Bea', 'Cora']) {
      const person = await createPerson(db, { firstName: name, network: 'MENS' });
      others.push(person);
    }
    for (const [index, person] of others.entries()) {
      await db
        .insertInto('person_views')
        .values({
          person_id: disciple.id,
          viewer_person_id: person.id,
          viewed_at: sql`now() - ${`${index} minutes`}::interval`,
        } as never)
        .execute();
    }

    const first = await views(admin, disciple.id, '?limit=2').expect(200);
    expect(
      first.body.data.map((row: { viewer: { person_id: string } }) => row.viewer.person_id),
    ).toEqual([others[0].id, others[1].id]);
    const second = await views(
      admin,
      disciple.id,
      `?limit=2&cursor=${first.body.next_cursor}`,
    ).expect(200);
    expect(
      second.body.data.map((row: { viewer: { person_id: string } }) => row.viewer.person_id),
    ).toEqual([others[2].id]);

    const bad = await views(admin, disciple.id, '?cursor=not-a-cursor');
    expect(bad.status).toBe(422);
  });

  it('tells the Admin once a day when one person opens more than a hundred pages in an hour', async () => {
    // A hundred openings already this hour, of a hundred different people.
    const many = [];
    for (let i = 0; i < 100; i += 1) {
      many.push(await createPerson(db, { firstName: `Invented${i}`, network: 'MENS' }));
    }
    await db
      .insertInto('person_views')
      .values(many.map((person) => ({ person_id: person.id, viewer_person_id: leaderPerson.id })))
      .execute();

    await open(leader, disciple.id).expect(200);

    const alerts = email.sent.filter((message) => message.kind === 'MANY_PAGES_OPENED');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      to: { email: admin.email },
      viewer: expect.stringContaining('Teofilo'),
      pages: 101,
    });

    // Another new page the same day sends nothing more.
    await open(leader, leaderPerson.id).expect(200);
    expect(email.sent.filter((message) => message.kind === 'MANY_PAGES_OPENED')).toHaveLength(1);
  });

  it('does not tell the Admin at a hundred', async () => {
    const many = [];
    for (let i = 0; i < 99; i += 1) {
      many.push(await createPerson(db, { firstName: `Invented${i}`, network: 'MENS' }));
    }
    await db
      .insertInto('person_views')
      .values(many.map((person) => ({ person_id: person.id, viewer_person_id: leaderPerson.id })))
      .execute();

    await open(leader, disciple.id).expect(200);

    expect(email.sent.filter((message) => message.kind === 'MANY_PAGES_OPENED')).toHaveLength(0);
  });
});
