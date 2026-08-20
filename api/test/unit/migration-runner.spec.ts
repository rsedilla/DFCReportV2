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

  it('checksums the whole file, comments included', () => {
    const withComment = parse('0001_x.sql', `-- why this exists\n${up}-- migrate:down\n`);
    const without = parse('0001_x.sql', `${up}-- migrate:down\n`);

    expect(withComment.checksum).not.toBe(without.checksum);
  });
});
