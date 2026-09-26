import { randomUUID } from 'node:crypto';

import { sql, type Kysely } from 'kysely';

import { createTestDb, truncateAll } from '../setup/database';
import { createPerson } from '../setup/fixtures';

import type { Database } from '../../src/database/schema';

/**
 * `encounter_seasons`, exercised against the database with the application bypassed
 * (SKILL.md section 28, *Encounter seasons*; decision 0296; migration 0019).
 *
 * Section 28 makes the five-week rule "a constraint on `encounter_seasons` as well as a
 * refusal naming the field", and says two seasons may not hold the same weekend and nothing
 * deletes one. The Definition of Done asks that an invariant expressible as a constraint
 * exist as one, so every case below writes *through* the constraint rather than reading the
 * migration: that is the only way to tell a constraint that exists from one that fires.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */
describe('encounter_seasons (section 28, decision 0296)', () => {
  let db: Kysely<Database>;
  let accountId: string;

  beforeAll(() => {
    db = createTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);

    const adele = await createPerson(db, { firstName: 'Adele', network: 'WOMENS' });
    const email = `adele.${randomUUID().slice(0, 8)}@example.test`;
    const account = await db
      .insertInto('accounts')
      .values({
        person_id: adele.id,
        email,
        email_normalized: email,
        password_hash: 'argon2-placeholder-not-a-valid-hash',
        status: 'ACTIVE',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    accountId = account.id;
  });

  afterAll(async () => {
    await db.destroy();
  });

  const MENS = '2027-12-03';
  const WOMENS = '2027-12-10';

  const shift = (day: string, days: number): string => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };

  const insert = (
    values: Partial<{
      mens_lc_party_on: string;
      mens_encounter_on: string;
      womens_lc_party_on: string;
      womens_encounter_on: string;
      updated_by: string | null;
      updated_at: Date | null;
    }> = {},
  ) =>
    db
      .insertInto('encounter_seasons')
      .values({
        mens_encounter_on: MENS,
        womens_encounter_on: WOMENS,
        mens_lc_party_on: shift(values.mens_encounter_on ?? MENS, -35),
        womens_lc_party_on: shift(values.womens_encounter_on ?? WOMENS, -35),
        created_by: accountId,
        ...values,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

  const count = async () =>
    Number(
      (
        await db
          .selectFrom('encounter_seasons')
          .select((eb) => eb.fn.countAll().as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    );

  describe('each LC Party is at least five weeks before its own weekend', () => {
    it('admits a party exactly 35 days before, and one months before', async () => {
      await insert();
      await insert({
        mens_encounter_on: '2028-04-07',
        womens_encounter_on: '2028-04-14',
        mens_lc_party_on: '2027-06-01',
        womens_lc_party_on: '2027-01-01',
      });
      expect(await count()).toBe(2);
    });

    it.each([
      ['mens_lc_party_on', MENS, 'encounter_seasons_mens_party_five_weeks_before'],
      ['womens_lc_party_on', WOMENS, 'encounter_seasons_womens_party_five_weeks_before'],
    ] as const)('refuses %s 34 days before, by %s', async (field, weekend, constraint) => {
      await expect(insert({ [field]: shift(weekend, -34) })).rejects.toThrow(constraint);
      expect(await count()).toBe(0);
    });

    it.each([
      ['mens_lc_party_on', MENS, 'encounter_seasons_mens_party_five_weeks_before'],
      ['womens_lc_party_on', WOMENS, 'encounter_seasons_womens_party_five_weeks_before'],
    ] as const)(
      'refuses an UPDATE moving %s to 34 days before',
      async (field, weekend, constraint) => {
        const { id } = await insert();
        await expect(
          db
            .updateTable('encounter_seasons')
            .set({ [field]: shift(weekend, -34) })
            .where('id', '=', id)
            .execute(),
        ).rejects.toThrow(constraint);
      },
    );
  });

  describe('two seasons may not hold the same weekend', () => {
    it("refuses a second season on the same Men's weekend", async () => {
      await insert();
      await expect(
        insert({ mens_encounter_on: MENS, womens_encounter_on: '2027-12-17' }),
      ).rejects.toThrow('encounter_seasons_one_per_mens_weekend');
    });

    it("refuses a second season on the same Women's weekend", async () => {
      await insert();
      await expect(
        insert({ mens_encounter_on: '2027-11-26', womens_encounter_on: WOMENS }),
      ).rejects.toThrow('encounter_seasons_one_per_womens_weekend');
    });

    it('holds both as unique indexes on the one column each', async () => {
      const indexes = await sql<{ indexname: string; indexdef: string }>`
        SELECT indexname, indexdef FROM pg_indexes
         WHERE tablename = 'encounter_seasons'
           AND indexname IN (
             'encounter_seasons_one_per_mens_weekend',
             'encounter_seasons_one_per_womens_weekend'
           )
         ORDER BY indexname
      `.execute(db);

      expect(indexes.rows).toHaveLength(2);
      expect(indexes.rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX .* \(mens_encounter_on\)$/);
      expect(indexes.rows[1].indexdef).toMatch(/CREATE UNIQUE INDEX .* \(womens_encounter_on\)$/);
    });
  });

  describe('nothing deletes a season', () => {
    it('refuses a DELETE and leaves the row', async () => {
      const { id } = await insert();
      await expect(
        sql`DELETE FROM encounter_seasons WHERE id = ${id}::uuid`.execute(db),
      ).rejects.toThrow(/are never deleted/);
      expect(await count()).toBe(1);
    });
  });

  describe('an edit names who made it and when, together or not at all', () => {
    it('refuses updated_at without updated_by', async () => {
      await expect(insert({ updated_at: new Date() })).rejects.toThrow(
        'encounter_seasons_update_is_whole',
      );
    });

    it('refuses updated_by without updated_at', async () => {
      await expect(insert({ updated_by: accountId })).rejects.toThrow(
        'encounter_seasons_update_is_whole',
      );
    });
  });
});
