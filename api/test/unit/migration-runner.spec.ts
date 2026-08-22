import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from '../../scripts/migrate';

/**
 * The migration parser decides whether a guard against dropping
 * `pastoral_assignments` is honoured, and it has been wrong twice: once by
 * matching the guard only as part of the down marker, so a plain marker above it
 * silently disabled it, and once by "fixing" that with a placement check which
 * could never fire, because the marker regex subsumed the guard regex.
 *
 * Both defects were in string handling and needed no database to find. These
 * cases exist so the next one is caught by a test rather than by a review pass.
 */
describe('the migration parser (CLAUDE.md, migration policy)', () => {
  const up = '-- migrate:up\nCREATE TABLE persons (id uuid);\n';

  describe('the down section', () => {
    it('reads a plain marker', () => {
      const migration = parse('0001_x.sql', `${up}-- migrate:down\nDROP TABLE persons;\n`);

      expect(migration.down).toContain('DROP TABLE persons;');
      expect(migration.up).toContain('CREATE TABLE persons');
      expect(migration.up).not.toContain('DROP TABLE');
      expect(migration.refuseIfPopulated).toEqual([]);
    });

    it('reads the guard when the guard is the marker', () => {
      const migration = parse(
        '0001_x.sql',
        `${up}-- migrate:down:refuse-if-populated persons accounts\nDROP TABLE persons;\n`,
      );

      expect(migration.refuseIfPopulated).toEqual(['persons', 'accounts']);
      expect(migration.up).not.toContain('DROP TABLE');
    });

    it('reads the guard when it sits directly below a plain marker', () => {
      // The layout the runner's own documentation invites, and the one that used
      // to turn the guard off without a word.
      const migration = parse(
        '0001_x.sql',
        `${up}-- migrate:down\n-- migrate:down:refuse-if-populated persons accounts\nDROP TABLE persons;\n`,
      );

      expect(migration.refuseIfPopulated).toEqual(['persons', 'accounts']);
    });

    it('refuses a guard stranded in the up section', () => {
      // Taking the first marker would end the up section at the guard and parse
      // the real DDL as the down section, which is the same silent misparse in a
      // different costume.
      expect(() =>
        parse(
          '0001_x.sql',
          '-- migrate:up\n-- migrate:down:refuse-if-populated persons\nCREATE TABLE persons (id uuid);\n-- migrate:down\nDROP TABLE persons;\n',
        ),
      ).toThrow(/must be the down marker itself, or the line directly below it/);
    });

    it('refuses a guard stranded in the up section even with no plain marker', () => {
      // The placement check cannot fire here: with no plain marker to compare
      // against, the guard simply becomes the down marker, the up section
      // truncates to a comment, and the real DDL is parsed as the down section
      // with the guard pointing at tables that were never created.
      expect(() =>
        parse(
          '0001_x.sql',
          '-- migrate:up\n-- migrate:down:refuse-if-populated persons\nCREATE TABLE persons (id uuid);\n',
        ),
      ).toThrow(/up section holds no statements/);
    });

    it('refuses an up section holding only comments', () => {
      // It would run an empty statement, record the version as applied against a
      // schema it never created, and then freeze the file with its own checksum.
      expect(() =>
        parse('0001_x.sql', '-- migrate:up\n-- nothing here yet\n-- migrate:down\nDROP TABLE x;\n'),
      ).toThrow(/up section holds no statements/);
    });

    it('refuses more than one guard, so there is one list to read', () => {
      expect(() =>
        parse(
          '0001_x.sql',
          `${up}-- migrate:down:refuse-if-populated persons\n-- migrate:down:refuse-if-populated accounts\nDROP TABLE persons;\n`,
        ),
      ).toThrow(/more than one/);
    });

    it('refuses a migration with no down section and no irreversible marker', () => {
      expect(() => parse('0001_x.sql', up)).toThrow(/reversible/);
    });

    it('refuses a down marker above the up marker', () => {
      expect(() =>
        parse('0001_x.sql', '-- migrate:down\nDROP TABLE persons;\n-- migrate:up\n'),
      ).toThrow(/appears before/);
    });
  });

  describe('the irreversible marker', () => {
    it('stands in place of a down section, and carries its reason', () => {
      const migration = parse(
        '0002_x.sql',
        `${up}-- migrate:irreversible the source rows cannot be reconstructed\n`,
      );

      expect(migration.down).toBeNull();
      expect(migration.irreversibleBecause).toBe('the source rows cannot be reconstructed');
    });

    it('refuses a marker with no reason, since the reason is what gets escalated', () => {
      expect(() => parse('0002_x.sql', `${up}-- migrate:irreversible\n`)).toThrow(/must say why/);
    });

    it('refuses a marker above the up marker', () => {
      // It would leave the up section empty, run nothing, and record the version
      // as applied against a schema that was never created.
      expect(() =>
        parse('0002_x.sql', '-- migrate:irreversible because\n-- migrate:up\nCREATE TABLE x ();\n'),
      ).toThrow(/would leave the up section empty/);
    });

    it('refuses an up section holding only comments', () => {
      // Worse here than on the down path: an irreversible migration recorded as
      // applied against a schema it never created cannot be reverted, because
      // `down` refuses it by design. The only way back is a restore.
      expect(() =>
        parse(
          '0002_x.sql',
          '-- migrate:up\n-- nothing here yet\n-- migrate:irreversible because\n',
        ),
      ).toThrow(/holds no statements/);
    });

    it('refuses a file carrying both a down section and an irreversible marker', () => {
      expect(() =>
        parse(
          '0002_x.sql',
          `${up}-- migrate:down\nDROP TABLE persons;\n-- migrate:irreversible why\n`,
        ),
      ).toThrow(/Choose one/);
    });
  });

  describe('the version', () => {
    it('comes from the filename', () => {
      expect(parse('0007_x.sql', `${up}-- migrate:down\n`).version).toBe('0007');
    });

    it('must be numeric', () => {
      expect(() => parse('seven_x.sql', `${up}-- migrate:down\n`)).toThrow(/numeric version/);
    });
  });

  /**
   * Tables a down section may drop without guarding, each with the reason it is
   * not history. Everything else a migration drops must be named in its
   * `refuse-if-populated` directive.
   *
   * This list is the deliberate edit. Adding a table here is how an author says
   * "this one holds no history", in a file a reviewer reads, rather than by
   * quietly omitting it from a directive where the omission looks like a typo.
   * The original form of the check required every dropped table to be guarded,
   * which was true of 0001 because every table in it held history.
   */
  const UNGUARDED = new Map([
    [
      'idempotency_keys',
      // Section 22 keeps a key for 24 hours and permits dropping it after, so it
      // holds neither history nor a decision. Refusing a down over a row that
      // expires by itself tomorrow would make the guard mean less everywhere.
      'operational state with its own expiry (SKILL.md section 22)',
    ],
    [
      'settings',
      // The guard counts rows and 0002 seeds two, so naming it would refuse every
      // down from the moment the up finished -- a guard that always fires teaches
      // an operator to reach for --force. A real decision is covered by
      // `audit_log` being guarded: section 7 requires every settings change to be
      // audit logged, so a changed setting implies an audit entry.
      'seeded by its own migration; a change to it is covered by audit_log',
    ],
  ]);

  describe.each([['0001_foundations.sql'], ['0002_audit_idempotency_settings.sql']])(
    'the migration this repository actually ships: %s',
    (fileName) => {
      // Everything above runs on string fixtures. CI cannot catch a regression
      // here either: it reverts against empty tables, where the guard is a no-op
      // by construction. So the real files are parsed, and what they yield is
      // asserted.
      const sql = readFileSync(join(__dirname, '..', '..', 'migrations', fileName), 'utf8');
      const migration = parse(fileName, sql);

      it('guards every table its down section drops, or exempts it deliberately', () => {
        // Matched over the down section alone, and without requiring IF EXISTS: a
        // bare `DROP TABLE cell_memberships;` would otherwise match nothing, leave
        // both sides equal, and pass while dropping an unguarded history table.
        const dropped = [
          ...(migration.down ?? '').matchAll(/DROP TABLE\s+(?:IF EXISTS\s+)?([a-z_]+)/g),
        ].map((match) => match[1]);

        expect(dropped.length).toBeGreaterThan(0);

        const expected = dropped.filter((table) => !UNGUARDED.has(table)).sort();
        expect([...migration.refuseIfPopulated].sort()).toEqual(expected);
      });

      it('guards nothing its down section does not drop', () => {
        // A guard naming a table this migration never drops reads as protection
        // and is none, and it would refuse the down for a table whose data the
        // down would have left alone.
        const dropped = new Set(
          [...(migration.down ?? '').matchAll(/DROP TABLE\s+(?:IF EXISTS\s+)?([a-z_]+)/g)].map(
            (match) => match[1],
          ),
        );

        for (const guarded of migration.refuseIfPopulated) {
          expect([...dropped]).toContain(guarded);
        }
      });
    },
  );

  describe('the migration this repository actually ships', () => {
    const sql = readFileSync(
      join(__dirname, '..', '..', 'migrations', '0001_foundations.sql'),
      'utf8',
    );
    const migration = parse('0001_foundations.sql', sql);

    it('names the tables SKILL.md guarantees history for', () => {
      expect(migration.refuseIfPopulated).toEqual(
        expect.arrayContaining([
          'persons',
          'person_lifecycle',
          'network_assignments',
          'pastoral_assignments',
          'accounts',
          'account_roles',
          'capability_grants',
        ]),
      );
    });

    it('splits the sections where they belong', () => {
      expect(migration.up).toContain('CREATE TABLE persons');
      expect(migration.up).not.toContain('DROP TABLE');
      expect(migration.down).toContain('DROP TABLE IF EXISTS persons');
    });
  });

  it('checksums the whole file, comments included', () => {
    const withComment = parse('0001_x.sql', `-- why this exists\n${up}-- migrate:down\n`);
    const without = parse('0001_x.sql', `${up}-- migrate:down\n`);

    expect(withComment.checksum).not.toBe(without.checksum);
  });
});
