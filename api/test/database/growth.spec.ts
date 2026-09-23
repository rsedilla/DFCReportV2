import { sql, type Kysely } from 'kysely';

import { ALL_CAPABILITIES } from '../../src/auth/authorization/capabilities';
import { createTestDb, truncateAll } from '../setup/database';
import { createPerson, type TestPerson } from '../setup/fixtures';

import type { Database } from '../../src/database/schema';

/**
 * The three tables migration 0017 creates, exercised against the database.
 *
 * `suynl_lessons`, `training_graduations` and `conquest_confirmations` belong to
 * three modules and share one shape, because every row of each is the same kind
 * of thing: a statement a leader made about somebody, kept for ever, withdrawn
 * only by being superseded (SKILL.md sections 27 and 28, *Structure*).
 *
 * **Nothing reads or writes them yet.** There is no `suynl`, `training` or
 * `conquest` module, so what the database refuses on its own is the whole of the
 * enforcement that exists today -- and it stays the half that survives a
 * service-layer check somebody forgets to write, a `psql` session and a
 * `pg_restore`. Every case below therefore writes *through* the constraint rather
 * than reading the migration, which is the only way to tell a constraint that
 * exists from one that fires.
 *
 * The rules the three tables share are stated once and run three times. A rule
 * copied into three blocks is a rule that gets corrected in two of them, which is
 * a defect this repository has shipped more than once.
 *
 * **Fixture data is invented** (CLAUDE.md, Secrets). The given names come from
 * the example tree -- Raymond -> Manuel -> Mark -- and the surnames and dates are
 * made up.
 */

/**
 * One table, and the column the specification pairs with `person_id` in its
 * partial unique index: the lesson, the program, the goal.
 *
 * `values` holds two distinct values of that column, so a case can say "the same
 * one" and "a different one" without knowing which table it is running against.
 * `requires` names a column a table demands beyond the ones every statement
 * carries -- `conquest_confirmations.reached_on` is the only one, and it is the
 * subject of a case of its own further down.
 */
interface GrowthTable {
  table: 'suynl_lessons' | 'training_graduations' | 'conquest_confirmations';
  key: 'lesson' | 'program' | 'goal';
  values: readonly [string | number, string | number];
  /** The partial unique index, named so that a failure says which rule refused. */
  index: string;
  requires?: { column: string; value: string };
}

const GROWTH_TABLES: readonly GrowthTable[] = [
  {
    table: 'suynl_lessons',
    key: 'lesson',
    values: [3, 4],
    index: 'suynl_lessons_one_current_per_lesson',
  },
  {
    table: 'training_graduations',
    key: 'program',
    values: ['LIFE_CLASS', 'SOL_1'],
    index: 'training_graduations_one_current_per_program',
  },
  {
    table: 'conquest_confirmations',
    key: 'goal',
    values: ['WIN_3', 'OPEN_A_CELL'],
    index: 'conquest_confirmations_one_current_per_goal',
    requires: { column: 'reached_on', value: '2024-03-15' },
  },
];

/**
 * The three correction columns, set together or not at all (sections 27 and 28).
 *
 * They are carried as one object because that is what the CHECK is about: the
 * cases below set one of the three to null and expect a refusal, which is
 * unwriteable if the three are separate optional parameters that default.
 */
interface Correction {
  supersededAt: Date | null;
  correctedBy: string | null;
  reason: string | null;
}

/** A fixed instant. Nothing here spans a period, so no two clocks are mixed. */
const CORRECTED_AT = new Date('2026-03-01T10:00:00+08:00');

function aWholeCorrection(correctedBy: string): Correction {
  return {
    supersededAt: CORRECTED_AT,
    correctedBy,
    reason: 'Ticked against the wrong person.',
  };
}

describe('the Growth tables (SKILL.md sections 27 and 28)', () => {
  let db: Kysely<Database>;
  let mark: TestPerson;
  let raymond: TestPerson;
  let account: string;
  let otherAccount: string;

  beforeAll(() => {
    db = createTestDb();
  });

  beforeEach(async () => {
    // `truncateAll` does not name these three tables and does not need to: each
    // holds a foreign key into `persons`, which it does name, and `TRUNCATE ...
    // CASCADE` reaches every table referencing one it lists. Each case also
    // creates its own Persons, so a row that somehow outlived the truncation
    // belongs to somebody else and cannot collide with anything asserted here.
    await truncateAll(db);

    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    account = await accountFor(db, 'Manuel');
    otherAccount = await accountFor(db, 'Rowena');
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe.each(GROWTH_TABLES)('$table', (spec) => {
    // -----------------------------------------------------------------------
    // The partial unique index (sections 27 and 28: one current row per person
    // and lesson, program or goal -- partial over live rows, as section 5 uses
    // for an active pastoral assignment)
    // -----------------------------------------------------------------------

    it(`refuses two current rows for one person and the same ${spec.key}`, async () => {
      await insertStatement(db, spec, { person: mark, confirmedBy: raymond, account });

      await expect(
        insertStatement(db, spec, { person: mark, confirmedBy: raymond, account }),
      ).rejects.toThrow(new RegExp(spec.index));
    });

    it(`permits one current row per ${spec.key}, which is what a ladder is`, async () => {
      await insertStatement(db, spec, {
        person: mark,
        confirmedBy: raymond,
        account,
        key: spec.values[0],
      });

      await expect(
        insertStatement(db, spec, {
          person: mark,
          confirmedBy: raymond,
          account,
          key: spec.values[1],
        }),
      ).resolves.toBeDefined();
    });

    it('permits a superseded row beside a current one, which is what a correction leaves', async () => {
      // The correction shape itself: a tick withdrawn, then filed again. The
      // index is partial over `superseded_at IS NULL` precisely so the withdrawn
      // row stays -- sections 27 and 28 both refuse a delete as the alternative,
      // and a retraction leaves no replacement row to carry the history instead.
      await insertStatement(db, spec, {
        person: mark,
        confirmedBy: raymond,
        account,
        correction: aWholeCorrection(otherAccount),
      });

      await expect(
        insertStatement(db, spec, { person: mark, confirmedBy: raymond, account }),
      ).resolves.toBeDefined();
    });

    it('permits two superseded rows, because every correction is kept', async () => {
      // Corrected twice. A unique index over the whole table, or one treating the
      // superseded rows as interchangeable, would lose the first withdrawal and
      // with it the record of who withdrew what and why (section 21).
      for (let i = 0; i < 2; i += 1) {
        await expect(
          insertStatement(db, spec, {
            person: mark,
            confirmedBy: raymond,
            account,
            correction: aWholeCorrection(otherAccount),
          }),
        ).resolves.toBeDefined();
      }
    });

    it(`scopes the index to one person, so two people may each hold the same ${spec.key}`, async () => {
      await insertStatement(db, spec, { person: mark, confirmedBy: raymond, account });

      await expect(
        insertStatement(db, spec, { person: raymond, confirmedBy: mark, account }),
      ).resolves.toBeDefined();
    });

    // -----------------------------------------------------------------------
    // The correction CHECK (sections 27 and 28: `superseded_at`, `corrected_by`
    // and `correction_reason` are set together or not at all, "as a CHECK
    // constraint rather than as a convention")
    // -----------------------------------------------------------------------

    describe('the correction columns', () => {
      const constraint = new RegExp(`${spec.table}_correction_is_whole`);

      it('refuses a supersession with no correcting account', async () => {
        await expect(
          insertStatement(db, spec, {
            person: mark,
            confirmedBy: raymond,
            account,
            correction: { supersededAt: CORRECTED_AT, correctedBy: null, reason: 'Wrong person.' },
          }),
        ).rejects.toThrow(constraint);
      });

      it('refuses a supersession with no reason', async () => {
        // Section 28: "Unticking requires a reason". A row withdrawn without one
        // is a withdrawal nobody has to explain, and the audit entry section 21
        // requires would have nothing to carry.
        await expect(
          insertStatement(db, spec, {
            person: mark,
            confirmedBy: raymond,
            account,
            correction: { supersededAt: CORRECTED_AT, correctedBy: otherAccount, reason: null },
          }),
        ).rejects.toThrow(constraint);
      });

      it.each([
        ['empty', ''],
        ['a single space', ' '],
        ['several spaces', '     '],
        ['a single tab', '\t'],
        ['a single newline', '\n'],
        ['a carriage return', '\r'],
        ['spaces, tabs and newlines together', ' \t \n \r '],
      ])('refuses a reason that is %s', async (_label, reason) => {
        // A reason present but blank satisfies "not null" and says nothing, which
        // is the refusal section 28 means rather than the one NOT NULL gives.
        //
        // **The whitespace cases beyond the spaces are why the constraint is
        // `correction_reason ~ '\S'` rather than the schema's usual
        // `btrim(x) <> ''`.** One-argument `btrim` strips spaces and nothing
        // else, so the older idiom stores a reason of one tab or one newline --
        // the hole `cell-meeting-submit.dto.ts` names at the edge, where
        // `@MinLength(1)` was replaced by `@Matches(/\S/)` for the same reason.
        // These cases are what would go red if this constraint were ever written
        // back into the older shape, which is the shape every neighbouring table
        // still uses.
        //
        // **This is a floor and not the whole rule.** Section 13 puts the
        // equivalent rule for `cell_attendance`'s own `correction_reason` "at the
        // route's door rather than at either write", normalising a blank note to
        // absent before it reaches a column. The write endpoints sections 27 and
        // 28 owe still owe their own normalisation: the database refuses a reason
        // made *of* whitespace, and it neither trims a reason with whitespace
        // around it nor decides what a route does with one.
        await expect(
          insertStatement(db, spec, {
            person: mark,
            confirmedBy: raymond,
            account,
            correction: { supersededAt: CORRECTED_AT, correctedBy: otherAccount, reason },
          }),
        ).rejects.toThrow(constraint);
      });

      it('refuses a reason on a row nothing superseded', async () => {
        // The other half of "together or not at all". Without it a current row
        // could carry a withdrawal's paperwork while still counting, and a reader
        // deciding whether a tick stands would have two columns disagreeing.
        await expect(
          insertStatement(db, spec, {
            person: mark,
            confirmedBy: raymond,
            account,
            correction: {
              supersededAt: null,
              correctedBy: otherAccount,
              reason: 'Withdrawn on a row that is still current.',
            },
          }),
        ).rejects.toThrow(constraint);
      });

      it('accepts the three together', async () => {
        await expect(
          insertStatement(db, spec, {
            person: mark,
            confirmedBy: raymond,
            account,
            correction: aWholeCorrection(otherAccount),
          }),
        ).resolves.toBeDefined();
      });

      it('accepts a current row carrying none of the three', async () => {
        await expect(
          insertStatement(db, spec, { person: mark, confirmedBy: raymond, account }),
        ).resolves.toBeDefined();
      });
    });

    // -----------------------------------------------------------------------
    // The no-delete trigger (section 28: "A row of either table is never
    // deleted, and the migration that creates them owes the trigger that refuses
    // it", a sentence that section names as covering section 27's table too)
    // -----------------------------------------------------------------------

    it('refuses a DELETE, while the row is current and once it is superseded', async () => {
      // Both states, because the rule is about the row rather than about its
      // standing: a superseded row is the one somebody tidying up would reach
      // for, and it is the one carrying the history of the withdrawal.
      await insertStatement(db, spec, {
        person: mark,
        confirmedBy: raymond,
        account,
        key: spec.values[0],
      });
      await insertStatement(db, spec, {
        person: mark,
        confirmedBy: raymond,
        account,
        key: spec.values[1],
        correction: aWholeCorrection(otherAccount),
      });

      await expect(
        sql`DELETE FROM ${sql.table(spec.table)} WHERE person_id = ${mark.id}::uuid`.execute(db),
      ).rejects.toThrow(/are never deleted/);

      await expect(
        sql`
          DELETE FROM ${sql.table(spec.table)}
           WHERE person_id = ${mark.id}::uuid AND superseded_at IS NOT NULL
        `.execute(db),
      ).rejects.toThrow(/are never deleted/);

      // The refusal has to leave the rows behind. A trigger that raised after the
      // row had gone, or one firing per statement on a table it had already
      // emptied, would satisfy both assertions above and destroy the history.
      expect(await rowCount(db, spec.table, mark.id)).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // What each table says on its own
  // -------------------------------------------------------------------------

  describe('suynl_lessons.lesson (SKILL.md section 28: ten lessons, numbered 1 to 10)', () => {
    it.each([0, 11, -1, 99])('refuses lesson %i', async (lesson) => {
      await expect(
        db
          .insertInto('suynl_lessons')
          .values({ person_id: mark.id, lesson, confirmed_by: raymond.id, recorded_by: account })
          .execute(),
      ).rejects.toThrow(/suynl_lessons_lesson_in_range/);
    });

    it('accepts the two ends of the range, 1 and 10', async () => {
      // The ends rather than a value in the middle: an off-by-one in the CHECK is
      // invisible to anything that only tries lesson 5, and ten current rows are
      // what section 28 makes a graduation, so lesson 10 above all has to be
      // writeable.
      await expect(
        db
          .insertInto('suynl_lessons')
          .values([
            { person_id: mark.id, lesson: 1, confirmed_by: raymond.id, recorded_by: account },
            { person_id: mark.id, lesson: 10, confirmed_by: raymond.id, recorded_by: account },
          ])
          .execute(),
      ).resolves.toBeDefined();
    });
  });

  describe('the dates the two dated tables carry', () => {
    it('lets a graduation have no date, for a leader who does not know it', async () => {
      // Section 28: "A graduation carries a date where the leader knows it and
      // none where they do not", on section 3's own reason for an optional
      // birthday -- a mandatory field somebody cannot fill gets filled with a
      // fiction, and leaders are recording graduations from years back.
      await expect(
        db
          .insertInto('training_graduations')
          .values({
            person_id: mark.id,
            program: 'ENCOUNTER',
            graduated_on: null,
            confirmed_by: raymond.id,
            recorded_by: account,
          })
          .execute(),
      ).resolves.toBeDefined();
    });

    it('accepts a graduation date a leader does know', async () => {
      await expect(
        db
          .insertInto('training_graduations')
          .values({
            person_id: mark.id,
            program: 'SOL_2',
            graduated_on: '2022-11-05',
            confirmed_by: raymond.id,
            recorded_by: account,
          })
          .execute(),
      ).resolves.toBeDefined();
    });

    it('refuses a Conquest confirmation with no date', async () => {
      // Section 27: `reached_on` is required, "unlike a graduation date: a
      // confirmation whose whole purpose is history nobody else holds would say
      // nothing without one". The asymmetry between the two tables is the rule,
      // so both halves are pinned or neither is.
      //
      // Written in raw SQL because the typed column refuses the null before any
      // statement reaches the database, and a rule the database does not hold is
      // the thing this file exists to detect.
      await expect(
        sql`
          INSERT INTO conquest_confirmations (person_id, goal, reached_on, confirmed_by, recorded_by)
          VALUES (${mark.id}::uuid, 'WIN_3', NULL, ${raymond.id}::uuid, ${account}::uuid)
        `.execute(db),
      ).rejects.toThrow(/reached_on/);
    });

    it('gives suynl_lessons no stated date at all', async () => {
      // Section 28: "A lesson tick carries the day it was filed, and no date is
      // stated", because section 27's Win 3 date has to derive from one clock
      // rather than two that can disagree. A stated day would be a `date` column,
      // and there is none -- the day is the Asia/Manila date of `confirmed_at`.
      //
      // Asserted as the absence of a `date` column rather than as an exact column
      // list, so that an additive migration adding something unrelated does not
      // put a passing case under pressure to be weakened.
      const dated = await sql<{ column_name: string }>`
        SELECT column_name
          FROM information_schema.columns
         WHERE table_name = 'suynl_lessons' AND data_type = 'date'
      `.execute(db);

      expect(dated.rows).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // The capability enum (SKILL.md sections 27 and 28)
  // -------------------------------------------------------------------------

  describe('the nine capabilities sections 27 and 28 add', () => {
    // Written out from the two sections rather than derived from the application,
    // because SKILL.md is the source of truth and a test reading its expectation
    // out of the code it is checking agrees with that code however wrong both are.
    const NINE = [
      'conquest.view_subtree',
      'conquest.confirm',
      'conquest.confirm_on_behalf',
      'suynl.view_subtree',
      'suynl.confirm',
      'suynl.confirm_on_behalf',
      'training.view_subtree',
      'training.confirm',
      'training.confirm_on_behalf',
    ];

    it('carries all nine in the database enum', async () => {
      // The guard resolves a grant against a `capability` column, so a value the
      // application declares and the type does not is a capability nothing can be
      // granted, and one the database holds and the closed list does not is a
      // grant nothing can check. `schema.spec.ts` asserts the whole enum equals
      // the declared list; this names the nine, so a failure here says which rule
      // went missing rather than only that two lists differ.
      const labels = await enumLabels(db, 'capability');

      for (const capability of NINE) {
        expect(labels).toContain(capability);
      }
    });

    it('declares all nine in the guard closed list', () => {
      for (const capability of NINE) {
        expect(ALL_CAPABILITIES).toContain(capability);
      }
    });

    it('stores exactly the five Training programs and the four Conquest goals', async () => {
      // In the order the sections state them: section 28 lists the schools in
      // pathway order, and section 27 the goals in ladder order, which is the
      // order its screen displays them in.
      expect(await enumLabels(db, 'training_program')).toEqual([
        'ENCOUNTER',
        'LIFE_CLASS',
        'SOL_1',
        'SOL_2',
        'SOL_3',
      ]);

      expect(await enumLabels(db, 'conquest_goal')).toEqual([
        'WIN_3',
        'OPEN_A_CELL',
        'COMPLETION_OF_12',
        'RAISE_12_LEADERS',
      ]);
    });
  });
});

/**
 * One row of whichever table `spec` names, written in raw SQL.
 *
 * Raw rather than through Kysely's typed builder because the three tables differ
 * in exactly the column the shared cases must not know about, and a case that has
 * to name its table cannot be run once against all three -- which is what stops
 * the three copies of one rule drifting apart.
 */
function insertStatement(
  db: Kysely<Database>,
  spec: GrowthTable,
  row: {
    person: TestPerson;
    /**
     * The Person whose statement this is. Null is reserved for a Network root,
     * who has no pastoral leader to confirm for them (sections 5, 9 and 27), and
     * no case here is about a root.
     */
    confirmedBy: TestPerson;
    account: string;
    key?: string | number;
    correction?: Correction;
  },
): Promise<unknown> {
  const columns = ['person_id', spec.key, 'confirmed_by', 'recorded_by'];
  const values: (string | number | Date | null)[] = [
    row.person.id,
    row.key ?? spec.values[0],
    row.confirmedBy.id,
    row.account,
  ];

  if (spec.requires) {
    columns.push(spec.requires.column);
    values.push(spec.requires.value);
  }

  if (row.correction) {
    columns.push('superseded_at', 'corrected_by', 'correction_reason');
    values.push(row.correction.supersededAt, row.correction.correctedBy, row.correction.reason);
  }

  return sql`
    INSERT INTO ${sql.table(spec.table)} (${sql.join(columns.map((column) => sql.id(column)))})
    VALUES (${sql.join(values.map((value) => sql.val(value)))})
  `.execute(db);
}

async function rowCount(db: Kysely<Database>, table: string, personId: string): Promise<number> {
  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count FROM ${sql.table(table)} WHERE person_id = ${personId}::uuid
  `.execute(db);

  return Number(result.rows[0].count);
}

async function enumLabels(db: Kysely<Database>, typeName: string): Promise<string[]> {
  const result = await sql<{ enumlabel: string }>`
    SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = ${typeName}
     ORDER BY e.enumsortorder
  `.execute(db);

  if (result.rows.length === 0) {
    throw new Error(`type ${typeName} does not exist`);
  }

  return result.rows.map((row) => row.enumlabel);
}

/**
 * An account with no role and no capability, which is all these cases need:
 * `recorded_by` and `corrected_by` are foreign keys, and what an actor may file
 * is decided in a guard and a domain layer, neither of which exists yet.
 */
async function accountFor(db: Kysely<Database>, firstName: string): Promise<string> {
  const person = await createPerson(db, { firstName, network: 'MENS' });
  const email = `${firstName.toLowerCase()}.${person.id.slice(0, 8)}@example.test`;

  const row = await db
    .insertInto('accounts')
    .values({
      person_id: person.id,
      email,
      email_normalized: email,
      password_hash: 'argon2-placeholder-not-a-valid-hash',
      status: 'ACTIVE',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return row.id;
}
