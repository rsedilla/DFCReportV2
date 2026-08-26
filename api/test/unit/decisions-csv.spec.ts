/**
 * The decisions file and the fingerprint (SKILL.md section 2, The decisions file
 * and The fingerprint).
 *
 * These are the two halves of the import that decide *which people exist*, and
 * both are pure over a string. They are tested here rather than only through the
 * commit because a commit exercises one path through them and section 2 states a
 * dozen rules — the tier asymmetry, the per-row fingerprint, the Member ID shape,
 * row order being part of the digest — each of which is invisible in a passing
 * end-to-end run.
 *
 * Pure functions, needing no database *server* — but the shared harness in
 * `test/setup/env.ts` throws without `DATABASE_URL` before any suite loads, so a
 * dummy value in `api/.env` is enough to run this file alone.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */

import {
  DECISION_FINDING_CODES,
  decisionsTemplate,
  readDecisionsCsv,
  type DecisionFinding,
  type DecisionFindingCode,
} from '../../src/admin/tree-import/decisions-csv';
import { fingerprintOf, validateTreeCsv } from '../../src/admin/tree-import/tree-csv';

import type { TreeRow } from '../../src/admin/tree-import/tree-csv';

const HEADER = 'row_id,first_name,last_name,birth_date,sex,civil_status,leader_row_id';
const ROOTS = [
  '1,Andres,Batungbakal,1968-04-12,MALE,MARRIED,',
  '2,Perlita,Batungbakal,1970-09-03,FEMALE,MARRIED,',
];

function treeFile(...rows: string[]): string {
  return [HEADER, ...ROOTS, ...rows].join('\n') + '\n';
}

function rowsOf(text: string): TreeRow[] {
  const report = validateTreeCsv(text, { skipDuplicates: true });
  expect(report.findings.filter((f) => f.severity === 'error')).toEqual([]);
  return report.rows;
}

const DECISIONS_HEADER = 'input_fingerprint,row_id,decision,member_id';

function codes(findings: readonly DecisionFinding[]): string[] {
  return findings.map((finding) => finding.code);
}

describe('the fingerprint (SKILL.md section 2)', () => {
  const rows = rowsOf(treeFile('9,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2'));

  it('is 64 lowercase hexadecimal characters', () => {
    expect(fingerprintOf(rows)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is unchanged by whitespace a spreadsheet adds and removes', () => {
    // Section 2's stated reason for digesting parsed rows rather than bytes:
    // re-saving a spreadsheet changes quoting and line endings without changing a
    // single fact, and a byte-level digest would refuse a file nobody touched.
    const respaced = rowsOf(
      [HEADER, ...ROOTS, '9, Marisol ,Ventura,1985-06-15,FEMALE,SINGLE,2 '].join('\r\n') + '\r\n',
    );

    expect(fingerprintOf(respaced)).toBe(fingerprintOf(rows));
  });

  it('changes when any field changes', () => {
    const altered = rowsOf(treeFile('9,Marisol,Ventura,1985-06-16,FEMALE,SINGLE,2'));
    expect(fingerprintOf(altered)).not.toBe(fingerprintOf(rows));
  });

  it('changes when the rows are re-sorted, which section 2 chooses deliberately', () => {
    // Every decision would still apply correctly, since decisions key on `row_id`
    // rather than on position. It is refused because the dry-run report the
    // adjudicator was reading names *line numbers*, and in a re-sorted file those
    // point at other people.
    const sorted = rowsOf(
      [HEADER, ROOTS[1], ROOTS[0], '9,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2'].join('\n') +
        '\n',
    );

    expect(fingerprintOf(sorted)).not.toBe(fingerprintOf(rows));
  });

  it('cannot be collided by moving a comma between fields', () => {
    // The reason section 2 specifies JSON encoding rather than a delimiter: a name
    // may contain any character (section 3), so there is no separator that cannot
    // occur inside a field. A digest that a comma in a surname can forge is worse
    // than none, because it is trusted.
    const a = rowsOf(treeFile('9,"Marisol,Ventura",Cruz,1985-06-15,FEMALE,SINGLE,2'));
    const b = rowsOf(treeFile('9,Marisol,"Ventura,Cruz",1985-06-15,FEMALE,SINGLE,2'));

    expect(fingerprintOf(a)).not.toBe(fingerprintOf(b));
  });
});

describe('the decisions file (SKILL.md section 2)', () => {
  const tree = treeFile(
    '9,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2',
    '10,Rogelio,Ventura,1979-11-02,MALE,MARRIED,1',
  );
  const rows = rowsOf(tree);
  const fingerprint = fingerprintOf(rows);
  const knownRowIds = new Set(rows.map((row) => row.rowId));

  function read(body: string[], tier1: string[] = []) {
    return readDecisionsCsv([DECISIONS_HEADER, ...body].join('\n') + '\n', {
      expectedFingerprint: fingerprint,
      knownRowIds,
      tier1RowIds: new Set(tier1),
    });
  }

  it('accepts a CREATE and a USE_EXISTING', () => {
    const report = read([`${fingerprint},9,CREATE,`, `${fingerprint},10,USE_EXISTING,M-000123`]);

    expect(report.findings).toEqual([]);
    expect(report.byRowId.get('9')).toMatchObject({ decision: 'CREATE', memberId: null });
    expect(report.byRowId.get('10')).toMatchObject({
      decision: 'USE_EXISTING',
      memberId: 'M-000123',
    });
  });

  it('refuses a row carrying a different fingerprint', () => {
    const report = read([`${'0'.repeat(64)},9,CREATE,`]);
    expect(codes(report.findings)).toEqual(['FINGERPRINT_MISMATCH']);
  });

  it('refuses where only some rows carry the fingerprint, which is two files spliced', () => {
    // The case a single header line could not catch, and section 2's stated reason
    // for repeating the digest on every row.
    const report = read([`${fingerprint},9,CREATE,`, `${'0'.repeat(64)},10,CREATE,`]);
    expect(codes(report.findings)).toEqual(['FINGERPRINT_MISMATCH']);
  });

  describe('the tier asymmetry, which is section 3 restated', () => {
    it('refuses a blank Tier 1 row, because silence is not acknowledgement', () => {
      const report = read([`${fingerprint},9,,`], ['9']);
      expect(codes(report.findings)).toEqual(['TIER1_UNACKNOWLEDGED']);
    });

    it('refuses a Tier 1 row absent from the file altogether', () => {
      // Section 2 creates a row absent from the decisions file, which is right for
      // Tier 2 and is exactly what section 3 forbids for Tier 1. The loop over the
      // file cannot see this one, so it is a separate pass.
      const report = read([`${fingerprint},10,CREATE,`], ['9']);
      expect(codes(report.findings)).toEqual(['TIER1_UNACKNOWLEDGED']);
      expect(report.findings[0].rowId).toBe('9');
    });

    it('raises one refusal for an unanswered Tier 1 row, not two', () => {
      // The blank-row branch and the absent-row pass both cover a blank Tier 1 row.
      // Two refusals naming one line is how an operator concludes there are twice
      // as many problems as there are.
      const report = read([`${fingerprint},9,,`], ['9']);
      expect(report.findings).toHaveLength(1);
    });

    it('accepts a blank Tier 2 row, which means create', () => {
      const report = read([`${fingerprint},9,,`]);
      expect(report.findings).toEqual([]);
      // Blank is not recorded as a decision — section 2 says an absent row is
      // created, and a blank row is the same statement.
      expect(report.byRowId.has('9')).toBe(false);
    });

    it('accepts an answered Tier 1 row', () => {
      const report = read([`${fingerprint},9,CREATE,`], ['9']);
      expect(report.findings).toEqual([]);
    });
  });

  it('refuses a row_id no row in the tree file carries', () => {
    const report = read([`${fingerprint},404,CREATE,`]);
    expect(codes(report.findings)).toEqual(['DECISIONS_ROW_ID_UNKNOWN']);
  });

  it('refuses two decisions for one row rather than choosing between them', () => {
    const report = read([`${fingerprint},9,CREATE,`, `${fingerprint},9,USE_EXISTING,M-000123`]);
    expect(codes(report.findings)).toEqual(['DECISIONS_ROW_ID_DUPLICATE']);
    // The first still stands, so the refusal is about the second.
    expect(report.byRowId.get('9')).toMatchObject({ decision: 'CREATE' });
  });

  describe('member_id', () => {
    it('is required by USE_EXISTING', () => {
      const report = read([`${fingerprint},9,USE_EXISTING,`]);
      expect(codes(report.findings)).toEqual(['MEMBER_ID_MISSING']);
    });

    it('must be M- and six digits, which is what survives retyping', () => {
      const report = read([`${fingerprint},9,USE_EXISTING,M-123`]);
      expect(codes(report.findings)).toEqual(['MEMBER_ID_SHAPE']);
    });

    it('refuses a UUID, which is the thing section 2 chose the Member ID over', () => {
      const report = read([`${fingerprint},9,USE_EXISTING,3f6b1c2e-0000-4000-8000-000000000000`]);
      expect(codes(report.findings)).toEqual(['MEMBER_ID_SHAPE']);
    });

    it('is refused alongside CREATE rather than ignored', () => {
      // The two readings of the row are "create a new Person" and "use that one",
      // and they are not the same decision. Ignoring the column picks one silently.
      const report = read([`${fingerprint},9,CREATE,M-000123`]);
      expect(codes(report.findings)).toEqual(['MEMBER_ID_UNEXPECTED']);
    });

    it('is refused alongside a blank decision for the same reason', () => {
      const report = read([`${fingerprint},9,,M-000123`]);
      expect(codes(report.findings)).toEqual(['MEMBER_ID_UNEXPECTED']);
    });
  });

  it('refuses a decision that is neither value', () => {
    const report = read([`${fingerprint},9,MERGE,`]);
    expect(codes(report.findings)).toEqual(['DECISION_INVALID']);
  });
});

describe('the decisions template', () => {
  it('carries only the rows that matched, each blank', () => {
    // Section 2: a row matching nobody has nothing to decide, and listing three
    // thousand of them to say so produces a file completed without being read.
    const text = decisionsTemplate('abc', [{ rowId: '9' }, { rowId: '12' }]);

    expect(text).toBe(
      ['input_fingerprint,row_id,decision,member_id', 'abc,9,,', 'abc,12,,'].join('\n') + '\n',
    );
  });

  it('round-trips through the reader it was written for', () => {
    const tree = treeFile('9,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2');
    const rows = rowsOf(tree);
    const fingerprint = fingerprintOf(rows);

    const report = readDecisionsCsv(decisionsTemplate(fingerprint, [{ rowId: '9' }]), {
      expectedFingerprint: fingerprint,
      knownRowIds: new Set(rows.map((row) => row.rowId)),
      tier1RowIds: new Set(),
    });

    expect(report.findings).toEqual([]);
  });

  it('is refused unedited where a row carries a Tier 1 candidate', () => {
    // The property that makes the template safe to hand over: it cannot be
    // returned untouched and treated as adjudication.
    const tree = treeFile('9,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2');
    const rows = rowsOf(tree);
    const fingerprint = fingerprintOf(rows);

    const report = readDecisionsCsv(decisionsTemplate(fingerprint, [{ rowId: '9' }]), {
      expectedFingerprint: fingerprint,
      knownRowIds: new Set(rows.map((row) => row.rowId)),
      tier1RowIds: new Set(['9']),
    });

    expect(codes(report.findings)).toEqual(['TIER1_UNACKNOWLEDGED']);
  });
});

describe('what a decisions finding carries', () => {
  /**
   * One fixture per code, walked from `DECISION_FINDING_CODES` rather than from
   * the fixtures, so a code added to the module without a fixture here fails this
   * suite.
   *
   * The promise being tested is the one `tree-csv.ts` makes and this module
   * inherits: **`detail` is the only field permitted to carry a name, a birthday
   * or a quoted value.** That is what lets an operator share a report from a
   * public repository's tooling about a file full of minors' records, and a
   * promise about *every* finding cannot be tested by a fixture that happens to
   * produce four of them.
   */
  const FINGERPRINT = 'a'.repeat(64);
  const KNOWN = new Set(['9']);

  function fixture(body: string): {
    text: string;
    tier1: Set<string>;
  } {
    return { text: body, tier1: new Set<string>() };
  }

  const FIXTURES: Record<DecisionFindingCode, { text: string; tier1: Set<string> }> = {
    DECISIONS_FILE_EMPTY: fixture(''),
    DECISIONS_HEADER_MISMATCH: fixture('a,b,c\nx,y,z\n'),
    DECISIONS_FIELD_COUNT: fixture(`${DECISIONS_HEADER}\n${FINGERPRINT},9,CREATE\n`),
    FINGERPRINT_MISMATCH: fixture(`${DECISIONS_HEADER}\n${'b'.repeat(64)},9,CREATE,\n`),
    DECISIONS_ROW_ID_MISSING: fixture(`${DECISIONS_HEADER}\n${FINGERPRINT},,CREATE,\n`),
    DECISIONS_ROW_ID_UNKNOWN: fixture(`${DECISIONS_HEADER}\n${FINGERPRINT},404,CREATE,\n`),
    DECISIONS_ROW_ID_DUPLICATE: fixture(
      `${DECISIONS_HEADER}\n${FINGERPRINT},9,CREATE,\n${FINGERPRINT},9,CREATE,\n`,
    ),
    TIER1_UNACKNOWLEDGED: {
      text: `${DECISIONS_HEADER}\n${FINGERPRINT},9,,\n`,
      tier1: new Set(['9']),
    },
    DECISION_INVALID: fixture(`${DECISIONS_HEADER}\n${FINGERPRINT},9,Marisol Ventura,\n`),
    MEMBER_ID_MISSING: fixture(`${DECISIONS_HEADER}\n${FINGERPRINT},9,USE_EXISTING,\n`),
    MEMBER_ID_SHAPE: fixture(`${DECISIONS_HEADER}\n${FINGERPRINT},9,USE_EXISTING,Marisol\n`),
    MEMBER_ID_UNEXPECTED: fixture(`${DECISIONS_HEADER}\n${FINGERPRINT},9,CREATE,Marisol\n`),
  };

  it.each(DECISION_FINDING_CODES)('%s has a fixture that triggers it', (code) => {
    const { text, tier1 } = FIXTURES[code];
    const report = readDecisionsCsv(text, {
      expectedFingerprint: FINGERPRINT,
      knownRowIds: KNOWN,
      tier1RowIds: tier1,
    });

    expect(codes(report.findings)).toContain(code);
  });

  it.each(DECISION_FINDING_CODES)('%s keeps personal data out of its message', (code) => {
    const { text, tier1 } = FIXTURES[code];
    const report = readDecisionsCsv(text, {
      expectedFingerprint: FINGERPRINT,
      knownRowIds: KNOWN,
      tier1RowIds: tier1,
    });

    for (const finding of report.findings.filter((f) => f.code === code)) {
      // The distinctive value every fixture carries where a name could leak.
      expect(finding.message).not.toContain('Marisol');
    }
  });
});
