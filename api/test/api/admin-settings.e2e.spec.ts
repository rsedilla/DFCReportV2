import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import {
  assignTo,
  createAccount,
  createPerson,
  createTestApp,
  nameSeniorPastors,
} from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount } from '../setup/fixtures';

/**
 * The Admin's Settings tab (SKILL.md sections 7 and 19, decision 0425): one read and two
 * changes, every one under `settings.manage` at Whole Church, every change audited with
 * its previous and new values, and the encoding phase closed once and never reopened.
 */
describe('Admin settings (decision 0425)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;

  let admin: TestAccount;
  let seniorPastor: TestAccount;
  let leader: TestAccount;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    await assignTo(db, raymond.id, null);
    const manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    await assignTo(db, manuel.id, raymond.id);
    const adele = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });

    admin = await createAccount(app, db, { person: adele, roles: ['ADMIN'] });
    seniorPastor = await createAccount(app, db, {
      person: raymond,
      roles: ['SENIOR_PASTOR'],
      seniorPastorSlot: 1,
    });
    nameSeniorPastors(app, [raymond.id]);
    leader = await createAccount(app, db, { person: manuel, roles: ['LEADER'] });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  const read = (account: TestAccount) =>
    request(app.getHttpServer())
      .get('/api/v1/settings')
      .set('Authorization', `Bearer ${account.accessToken}`);

  const setMonths = (account: TestAccount, months: unknown, key: string = randomUUID()) =>
    request(app.getHttpServer())
      .patch('/api/v1/settings/cell-attention-months')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', key)
      .send({ months });

  const close = (account: TestAccount, key: string = randomUUID()) =>
    request(app.getHttpServer())
      .post('/api/v1/settings/initial-encoding/close')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', key)
      .send({});

  const verseOf = (account: TestAccount) =>
    request(app.getHttpServer())
      .get('/api/v1/settings/record-verse')
      .set('Authorization', `Bearer ${account.accessToken}`);

  const setVerse = (account: TestAccount, body: unknown, key: string = randomUUID()) =>
    request(app.getHttpServer())
      .put('/api/v1/settings/record-verse')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', key)
      .send(body as object);

  const VERSE = {
    text: 'Be shepherds of God’s flock that is under your care.',
    reference: '1 Peter 5:2 (NIV)',
  };

  const setting = async (key: 'cell_attention_months' | 'initial_encoding_open' | 'record_verse') =>
    (
      await db
        .selectFrom('settings')
        .select('value')
        .where('key', '=', key)
        .executeTakeFirstOrThrow()
    ).value;

  const changes = (targetId: string) =>
    db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', 'setting.changed')
      .where('target_id', '=', targetId)
      .execute();

  it('shows an administrator every setting and how far the DCC calendar reaches', async () => {
    await db.insertInto('dcc_events').values({ event_date: '2027-10-31' }).execute();
    await db.insertInto('dcc_events').values({ event_date: '2027-10-24' }).execute();

    const response = await read(admin).expect(200);

    expect(response.body).toEqual({
      cell_attention_months: 3,
      initial_encoding_open: true,
      dcc_calendar_start: null,
      dcc_calendar_through: '2027-10-31',
      record_verse: { text: null, reference: null },
    });
  });

  it('refuses a Senior Pastor and a Leader every route, and changes nothing', async () => {
    for (const account of [seniorPastor, leader]) {
      expect((await read(account).expect(403)).body.error.code).toBe('CAPABILITY_DENIED');
      expect((await setMonths(account, 5).expect(403)).body.error.code).toBe('CAPABILITY_DENIED');
      expect((await close(account).expect(403)).body.error.code).toBe('CAPABILITY_DENIED');
    }

    expect(await setting('cell_attention_months')).toBe(3);
    expect(await setting('initial_encoding_open')).toBe(true);
    expect(await changes('cell_attention_months')).toHaveLength(0);
    expect(await changes('initial_encoding_open')).toHaveLength(0);
  });

  it('refuses a settings.manage grant narrower than Whole Church', async () => {
    await db
      .insertInto('capability_grants')
      .values({
        account_id: leader.id,
        capability: 'settings.manage',
        scope_type: 'NETWORK',
        scope_network: 'MENS',
        read_only: false,
        reason: 'A Network-scoped grant of a Whole-Church-only capability.',
        granted_by: admin.id,
      })
      .execute();

    const response = await setMonths(leader, 5).expect(403);
    expect(['CAPABILITY_DENIED', 'SCOPE_DENIED']).toContain(response.body.error.code);
    expect(await setting('cell_attention_months')).toBe(3);
  });

  it('changes the attention threshold and audits the old and new value', async () => {
    const response = await setMonths(admin, 4).expect(200);

    expect(response.body.cell_attention_months).toBe(4);
    expect(await setting('cell_attention_months')).toBe(4);
    const [entry] = await changes('cell_attention_months');
    expect(entry.actor_id).toBe(admin.id);
    expect(entry.before).toEqual({ value: 3 });
    expect(entry.after).toEqual({ value: 4 });
  });

  it('records nothing when the threshold is set to the value it holds', async () => {
    await setMonths(admin, 3).expect(200);

    expect(await changes('cell_attention_months')).toHaveLength(0);
  });

  it('refuses a threshold outside two to six whole months, and changes nothing', async () => {
    for (const months of [1, 7, 2.5, '4', null]) {
      const response = await setMonths(admin, months).expect(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
    expect(await setting('cell_attention_months')).toBe(3);
  });

  it('closes initial encoding once, audited, and refuses a second close', async () => {
    const first = await close(admin).expect(200);
    expect(first.body.initial_encoding_open).toBe(false);
    expect(await setting('initial_encoding_open')).toBe(false);

    const second = await close(admin).expect(409);
    expect(second.body.error.code).toBe('INVARIANT_VIOLATION');

    const entries = await changes('initial_encoding_open');
    expect(entries).toHaveLength(1);
    expect(entries[0].before).toEqual({ value: true });
    expect(entries[0].after).toEqual({ value: false });
  });

  it('closes it once when two administrators close it together', async () => {
    const outcomes = await Promise.all([close(admin), close(admin)]);

    expect(outcomes.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await changes('initial_encoding_open')).toHaveLength(1);
  });

  it('replays a close retried under the same key rather than refusing it', async () => {
    const key = randomUUID();

    const first = await close(admin, key).expect(200);
    const retry = await close(admin, key).expect(200);

    expect(retry.body).toEqual(first.body);
    expect(await changes('initial_encoding_open')).toHaveLength(1);
  });

  describe('the verse on Record', () => {
    it('is read by every signed-in account, and by nobody without a token', async () => {
      await setVerse(admin, VERSE).expect(200);

      for (const account of [admin, seniorPastor, leader]) {
        expect((await verseOf(account).expect(200)).body).toEqual(VERSE);
      }
      await request(app.getHttpServer()).get('/api/v1/settings/record-verse').expect(401);
    });

    it('is changed by an administrator alone, and audited with the old and new verse', async () => {
      for (const account of [seniorPastor, leader]) {
        expect((await setVerse(account, VERSE).expect(403)).body.error.code).toBe(
          'CAPABILITY_DENIED',
        );
      }
      expect(await changes('record_verse')).toHaveLength(0);

      const response = await setVerse(admin, VERSE).expect(200);
      expect(response.body.record_verse).toEqual(VERSE);

      const [entry] = await changes('record_verse');
      expect(entry.actor_id).toBe(admin.id);
      expect(entry.before).toEqual({ value: { text: null, reference: null } });
      expect(entry.after).toEqual({ value: VERSE });
    });

    it('records nothing when set to the verse it holds, and clears with both null', async () => {
      await setVerse(admin, VERSE).expect(200);
      await setVerse(admin, VERSE).expect(200);
      expect(await changes('record_verse')).toHaveLength(1);

      await setVerse(admin, { text: null, reference: null }).expect(200);
      expect(await setting('record_verse')).toEqual({ text: null, reference: null });
      expect(await changes('record_verse')).toHaveLength(2);
    });

    it('refuses one without the other, a blank one, and a long one, naming the field', async () => {
      const cases: [unknown, string][] = [
        [{ text: VERSE.text, reference: null }, 'reference'],
        [{ text: null, reference: VERSE.reference }, 'text'],
        [{ text: '   ', reference: VERSE.reference }, 'text'],
        [{ text: VERSE.text, reference: 'x'.repeat(61) }, 'reference'],
        [{ text: 'x'.repeat(601), reference: VERSE.reference }, 'text'],
      ];
      for (const [body, field] of cases) {
        const response = await setVerse(admin, body).expect(422);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(JSON.stringify(response.body.error)).toContain(field);
      }
      expect(await setting('record_verse')).toEqual({ text: null, reference: null });
    });
  });
});
