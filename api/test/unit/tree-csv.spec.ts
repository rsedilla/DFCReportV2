/**
 * The leadership-tree CSV validator (SKILL.md section 2, How the tree import runs).
 *
 * **Every fixture here is invented.** CLAUDE.md: test fixtures use invented data,
 * never real member names, birthdays or mobile numbers, because a fixture is as
 * public as the rest of this repository and the church holds records for minors.
 *
 * These are pure functions over a string and need no database *server* — but the
 * shared harness in `test/setup/env.ts` throws without `DATABASE_URL` before any
 * suite loads, so a dummy value in `api/.env` is enough to run this file alone.
 */

import {
  FINDING_CODES,
  parseCsv,
  validateTreeCsv,
  type Finding,
  type FindingCode,
  type Severity,
} from '../../src/admin/tree-import/tree-csv';

const HEADER = 'row_id,first_name,last_name,birth_date,sex,civil_status,leader_row_id';

/** A minimal sound file: the two roots section 5 requires, one per Network. */
const ROOTS = [
  '1,Andres,Batungbakal,1968-04-12,MALE,MARRIED,',
  '2,Perlita,Batungbakal,1970-09-03,FEMALE,MARRIED,',
];

function file(...rows: string[]): string {
  return [HEADER, ...ROOTS, ...rows].join('\n') + '\n';
}

function codes(findings: Finding[], severity?: Severity): string[] {
  return findings
    .filter((f) => severity === undefined || f.severity === severity)
    .map((f) => f.code);
}

function errorsOf(csv: string): Finding[] {
  return validateTreeCsv(csv, { today: '2026-08-25' }).findings.filter(
    (f) => f.severity === 'error',
  );
}

describe('parseCsv', () => {
  it('strips a UTF-8 BOM, which is what Excel writes and what breaks the header', () => {
    const records = parseCsv('﻿row_id,first_name\n1,Andres\n');
    expect(records[0].fields[0]).toBe('row_id');
  });

  it('reads a quoted field containing a comma without shifting the columns', () => {
    const records = parseCsv('a,"Santos, Jr",c\n');
    expect(records[0].fields).toEqual(['a', 'Santos, Jr', 'c']);
  });

  it('reads a doubled quote as one quote', () => {
    expect(parseCsv('"say ""hi""",b\n')[0].fields).toEqual(['say "hi"', 'b']);
  });

  it('counts a newline inside a quoted field, so later line numbers stay true', () => {
    // The reason line numbers are counted during the parse rather than by
    // splitting on newlines first: one pasted multi-line cell would otherwise
    // put every later finding on the wrong row of the operator's spreadsheet.
    const records = parseCsv('a,b\n"two\nlines",d\ne,f\n');
    expect(records.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  it('ignores CRLF and a trailing blank line rather than reading them as a row', () => {
    const records = parseCsv('a,b\r\nc,d\r\n\r\n');
    expect(records).toHaveLength(2);
  });

  it('keeps a row whose fields are all empty but which has commas', () => {
    // Distinct from a blank line: this is a real row with missing values, and
    // reporting it is the point.
    expect(parseCsv('a,b\n,\n')).toHaveLength(2);
  });
});

describe('the file itself', () => {
  it('accepts a sound file', () => {
    const result = validateTreeCsv(file('3,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2'), {
      today: '2026-08-25',
    });
    expect(codes(result.findings, 'error')).toEqual([]);
    expect(result.summary.rowCount).toBe(3);
    expect(result.summary.maxDepth).toBe(2);
  });

  it('refuses a wrong header and stops, rather than misreading every column', () => {
    const result = validateTreeCsv('id,first,last\n1,Andres,Batungbakal\n');
    expect(codes(result.findings)).toEqual(['HEADER_MISMATCH']);
  });

  it('reports a row with the wrong number of columns and keeps going', () => {
    const result = validateTreeCsv(file('3,Marisol,Ventura,1985-06-15,FEMALE,SINGLE'));
    expect(codes(result.findings, 'error')).toContain('FIELD_COUNT');
  });

  it('warns on surrounding whitespace without failing the row', () => {
    const result = validateTreeCsv(file('3, Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2'), {
      today: '2026-08-25',
    });
    expect(codes(result.findings, 'error')).toEqual([]);
    expect(codes(result.findings, 'warning')).toContain('FIELD_WHITESPACE');
  });
});

describe('row_id and leader_row_id', () => {
  it('refuses a duplicate row_id and names the line that claimed it first', () => {
    const found = errorsOf(
      file(
        '3,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2',
        '3,Elena,Rivas,1988-02-02,FEMALE,SINGLE,2',
      ),
    );
    const duplicate = found.find((f) => f.code === 'ROW_ID_DUPLICATE');
    expect(duplicate?.line).toBe(5);
    expect(duplicate?.relatedLine).toBe(4);
  });

  it('refuses a leader_row_id that resolves to nothing', () => {
    const found = errorsOf(file('3,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,99'));
    expect(found.map((f) => f.code)).toContain('LEADER_UNRESOLVED');
  });

  it('refuses a row that names itself, which section 5 calls a one-node cycle', () => {
    const found = errorsOf(file('3,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,3'));
    expect(found.map((f) => f.code)).toContain('LEADER_SELF');
  });
});

describe('fields', () => {
  it('reports a missing birthday as a warning, and still accepts the file', () => {
    // Section 2 required one until its premise — a central record holding them —
    // was found not to exist for this church. Section 3 governs, and permits
    // absence. **Refusing the file would be the surest way to have the field
    // filled with something**, and a fabricated birthday matches another at
    // Tier 1, where creation is blocked. So the file passes and the gap is said.
    const result = validateTreeCsv(file('3,Marisol,Ventura,,FEMALE,SINGLE,2'), {
      today: '2026-08-25',
    });

    expect(codes(result.findings, 'error')).toEqual([]);

    const missing = result.findings.find((f) => f.code === 'BIRTH_DATE_MISSING');
    expect(missing?.severity).toBe('warning');
    expect(missing?.message).toMatch(/never fill one in/);
  });

  it('accepts a whole file carrying no birthdays at all', () => {
    // The case the spine import actually is: thirty senior leaders whose
    // birthdays nobody holds centrally. A rule that passes one blank row and
    // refuses thirty would be no use to it.
    const noBirthdays = [
      HEADER,
      '1,Andres,Batungbakal,,MALE,MARRIED,',
      '2,Perlita,Batungbakal,,FEMALE,MARRIED,',
      '3,Bayani,Ilagan,,MALE,MARRIED,1',
      '4,Marisol,Ventura,,FEMALE,SINGLE,2',
    ].join('\n');

    const result = validateTreeCsv(`${noBirthdays}\n`, { today: '2026-08-25' });

    expect(codes(result.findings, 'error')).toEqual([]);
    expect(result.summary.rowCount).toBe(4);
  });

  it.each([
    ['15/06/1985', /indistinguishable/],
    ['1985/06/15', /not hyphenated/],
    ['1985-6-15', /zero-padded/],
    ['15-Jun-1985', /month name/],
    ['19850615', /no separators/],
    ['31213', /serial number/],
  ])('names what a %s date most likely is', (value, expected) => {
    const found = errorsOf(file(`3,Marisol,Ventura,${value},FEMALE,SINGLE,2`));
    const bad = found.find((f) => f.code === 'BIRTH_DATE_FORMAT');
    expect(bad?.message).toMatch(expected);
  });

  it('refuses a well-shaped date that is not a real day', () => {
    expect(
      errorsOf(file('3,Marisol,Ventura,1985-02-30,FEMALE,SINGLE,2')).map((f) => f.code),
    ).toContain('BIRTH_DATE_INVALID');
  });

  it('refuses a birthday in the future', () => {
    expect(
      errorsOf(file('3,Marisol,Ventura,2027-01-01,FEMALE,SINGLE,2')).map((f) => f.code),
    ).toContain('BIRTH_DATE_FUTURE');
  });

  it('refuses a lowercase enum and says the values are case-sensitive', () => {
    const found = errorsOf(file('3,Marisol,Ventura,1985-06-15,female,SINGLE,2'));
    expect(found.find((f) => f.code === 'SEX_INVALID')?.message).toMatch(/case-sensitive/);
  });

  it('calls M ambiguous rather than guessing between MALE and MARRIED', () => {
    const found = errorsOf(file('3,Marisol,Ventura,1985-06-15,M,SINGLE,2'));
    expect(found.find((f) => f.code === 'SEX_INVALID')?.message).toMatch(/ambiguous/);
  });

  it('treats a civil status outside the closed list as a specification question', () => {
    // Section 3's list is closed. Mapping DIVORCED onto SINGLE is a decision
    // about what the record means, and the validator must not make it look like
    // a formatting problem the operator can fix in the sheet.
    const found = errorsOf(file('3,Marisol,Ventura,1985-06-15,FEMALE,DIVORCED,2'));
    const bad = found.find((f) => f.code === 'CIVIL_STATUS_UNSUPPORTED');
    expect(bad?.message).toMatch(/closed in section 3/);
  });
});

describe('the graph', () => {
  it('refuses a file with one root', () => {
    const result = validateTreeCsv(
      [HEADER, ROOTS[0], '3,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,1'].join('\n'),
      { today: '2026-08-25' },
    );
    expect(codes(result.findings, 'error')).toContain('ROOT_COUNT');
  });

  it('refuses two roots of the same sex, which leaves a Network rootless', () => {
    const result = validateTreeCsv(
      [HEADER, ROOTS[0], '2,Bayani,Ilagan,1970-09-03,MALE,MARRIED,'].join('\n'),
      { today: '2026-08-25' },
    );
    expect(codes(result.findings, 'error')).toContain('ROOT_NETWORK');
  });

  it('refuses a cross-Network edge and names both lines', () => {
    const found = errorsOf(file('3,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,1'));
    const edge = found.find((f) => f.code === 'EDGE_CROSS_NETWORK');
    expect(edge?.line).toBe(4);
    expect(edge?.relatedLine).toBe(2);
  });

  it('does not report a cross-Network edge for a row whose sex is already invalid', () => {
    // One cause, one finding. A row with sex `female` cannot also be told its
    // edge crosses a Network, because its Network is not yet decidable.
    const found = errorsOf(file('3,Marisol,Ventura,1985-06-15,female,SINGLE,2'));
    expect(found.map((f) => f.code)).not.toContain('EDGE_CROSS_NETWORK');
  });

  it('reports a cycle as the loop itself, in order', () => {
    const found = errorsOf(
      file(
        '3,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,5',
        '4,Elena,Rivas,1986-07-16,FEMALE,SINGLE,3',
        '5,Corazon,Malabo,1987-08-17,FEMALE,SINGLE,4',
      ),
    );
    const cycle = found.find((f) => f.code === 'CYCLE');
    expect(cycle).toBeDefined();
    expect(cycle?.message).toMatch(/3 rows form a cycle/);
    // The loop is printed as lines in walking order, which is what makes it fixable.
    expect(cycle?.message).toMatch(/\d+ -> \d+ -> \d+ -> \d+/);
  });

  it('reports one finding per cycle, not one per row that walks into it', () => {
    const found = errorsOf(
      file(
        '3,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,4',
        '4,Elena,Rivas,1986-07-16,FEMALE,SINGLE,3',
        '5,Corazon,Malabo,1987-08-17,FEMALE,SINGLE,3',
        '6,Divina,Ocampo,1988-09-18,FEMALE,SINGLE,5',
      ),
    );
    expect(found.filter((f) => f.code === 'CYCLE')).toHaveLength(1);
  });

  it('leaves depth undefined while a cycle stands rather than reporting a number', () => {
    const result = validateTreeCsv(
      file(
        '3,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,4',
        '4,Elena,Rivas,1986-07-16,FEMALE,SINGLE,3',
      ),
      { today: '2026-08-25' },
    );
    expect(result.summary.maxDepth).toBeNull();
  });

  it('walks a deep chain without exhausting the stack', () => {
    // The tree is arbitrary-depth by rule (Principle 11), and depth is exactly
    // what a recursive walk spends stack on. Both the cycle check and the depth
    // calculation are iterative for this reason.
    const deep = Array.from({ length: 20_000 }, (_, i) => {
      const id = i + 3;
      return `${id},Ana${id},Cruz,1990-01-22,FEMALE,SINGLE,${id === 3 ? 2 : id - 1}`;
    });
    const result = validateTreeCsv(file(...deep), { today: '2026-08-25', skipDuplicates: true });
    expect(codes(result.findings, 'error')).toEqual([]);
    expect(result.summary.maxDepth).toBe(20_001);
  });
});

describe('duplicates, which are warnings and never refusals', () => {
  it('surfaces a Tier 1 pair within the file and names both lines', () => {
    const result = validateTreeCsv(
      file(
        '3,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2',
        '4,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2',
      ),
      { today: '2026-08-25' },
    );
    // Section 3: the system never blocks creation. This is work waiting at
    // adjudication, not a defect in the file.
    expect(codes(result.findings, 'error')).toEqual([]);
    const tier1 = result.findings.find((f) => f.code === 'DUPLICATE_TIER1');
    expect(tier1?.line).toBe(5);
    expect(tier1?.relatedLine).toBe(4);
    expect(result.summary.tier1Pairs).toBe(1);
  });

  it('flags two rows sharing a name as ambiguous for a leader reference', () => {
    // Section 3 refuses a name as a leader reference because a congregation
    // certainly holds two people who share one. Where the source named leaders
    // by name, this is the set where the conversion could have picked wrongly.
    const result = validateTreeCsv(
      file(
        '3,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2',
        '4,Marisol,Ventura,1991-11-02,FEMALE,SINGLE,2',
      ),
      { today: '2026-08-25' },
    );
    const ambiguous = result.findings.find((f) => f.code === 'AMBIGUOUS_AS_LEADER');
    expect(ambiguous?.message).toMatch(/lines 4, 5/);
  });

  it('skips the pass when asked', () => {
    const result = validateTreeCsv(
      file(
        '3,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2',
        '4,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2',
      ),
      { today: '2026-08-25', skipDuplicates: true },
    );
    expect(codes(result.findings, 'warning')).not.toContain('DUPLICATE_TIER1');
  });
});

describe('what a finding carries', () => {
  /**
   * One fixture per code, each written to trigger exactly that code, and each
   * carrying the same distinctive personal values so one pattern can search
   * every message. `FINDING_CODES` is walked rather than the fixtures, so a code
   * added to the module without a fixture here fails this suite.
   *
   * The first version of this test used a single fixture and asserted over
   * whatever it happened to produce, which was four codes of twenty-six. It
   * passed against a deliberate mutation that interpolated a birthday into a
   * message — the defect it exists to catch — because that message's code was
   * not among the four.
   */
  const FIXTURES: Record<FindingCode, string> = {
    FILE_EMPTY: '',
    HEADER_MISMATCH: 'id,first,last\n9,Marisol,Ventura\n',
    NO_ROWS: `${HEADER}\n`,
    FIELD_COUNT: file('9,Marisol,Ventura,1985-06-15,FEMALE,SINGLE'),
    FIELD_WHITESPACE: file('9, Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2'),
    ROW_ID_MISSING: file(',Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2'),
    ROW_ID_WHITESPACE: file('"9 a",Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2'),
    ROW_ID_DUPLICATE: file(
      '9,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2',
      '9,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2',
    ),
    NAME_MISSING: file('9,,Ventura,1985-06-15,FEMALE,SINGLE,2'),
    NAME_SUSPECT: file('9,Marisol2,Ventura,1985-06-15,FEMALE,SINGLE,2'),
    BIRTH_DATE_MISSING: file('9,Marisol,Ventura,,FEMALE,SINGLE,2'),
    BIRTH_DATE_FORMAT: file('9,Marisol,Ventura,15/06/1985,FEMALE,SINGLE,2'),
    BIRTH_DATE_INVALID: file('9,Marisol,Ventura,1985-02-30,FEMALE,SINGLE,2'),
    BIRTH_DATE_FUTURE: file('9,Marisol,Ventura,2027-06-15,FEMALE,SINGLE,2'),
    BIRTH_DATE_IMPLAUSIBLE: file('9,Marisol,Ventura,1885-06-15,FEMALE,SINGLE,2'),
    SEX_INVALID: file('9,Marisol,Ventura,1985-06-15,female,SINGLE,2'),
    CIVIL_STATUS_INVALID: file('9,Marisol,Ventura,1985-06-15,FEMALE,Single,2'),
    CIVIL_STATUS_UNSUPPORTED: file('9,Marisol,Ventura,1985-06-15,FEMALE,DIVORCED,2'),
    LEADER_SELF: file('9,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,9'),
    LEADER_UNRESOLVED: file('9,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,404'),
    ROOT_COUNT: `${HEADER}\n${ROOTS[0]}\n9,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,1\n`,
    ROOT_NETWORK: `${HEADER}\n${ROOTS[0]}\n9,Marisol,Ventura,1985-06-15,MALE,SINGLE,\n`,
    EDGE_CROSS_NETWORK: file('9,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,1'),
    CYCLE: file(
      '9,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,10',
      '10,Elena,Rivas,1986-07-16,FEMALE,SINGLE,9',
    ),
    DUPLICATE_TIER1: file(
      '9,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2',
      '10,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2',
    ),
    AMBIGUOUS_AS_LEADER: file(
      '9,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2',
      '10,Marisol,Ventura,1991-11-02,FEMALE,SINGLE,2',
    ),
  };

  /** Every invented value the fixtures above put into a file. */
  const PERSONAL =
    /Marisol|Ventura|Elena|Rivas|Andres|Perlita|Batungbakal|1985-06-15|1985-02-30|1986-07-16|1991-11-02|1885-06-15|2027-06-15|15\/06\/1985/;

  it.each(FINDING_CODES)('%s has a fixture that produces it', (code) => {
    const findings = validateTreeCsv(FIXTURES[code], { today: '2026-08-25' }).findings;
    expect(findings.map((f) => f.code)).toContain(code);
  });

  it.each(FINDING_CODES)('%s keeps personal data out of its message', (code) => {
    // `detail` is the one field permitted to carry it, which is what lets the
    // CLI redact a report without losing its structure. A message naming a
    // person could not be shared, and a report nobody can share is one an
    // operator cannot get help with.
    const findings = validateTreeCsv(FIXTURES[code], { today: '2026-08-25' }).findings;
    for (const finding of findings.filter((f) => f.code === code)) {
      expect(finding.message).not.toMatch(PERSONAL);
    }
  });

  it('puts nothing in `detail` that a redacted report would need to stay actionable', () => {
    // A finding must be locatable without its detail: line, code and message
    // carry the whole of what to do about it.
    const result = validateTreeCsv(FIXTURES.CYCLE, { today: '2026-08-25' });
    const cycle = result.findings.find((f) => f.code === 'CYCLE');
    expect(cycle?.message).toMatch(/Lines \d+ -> \d+ -> \d+/);
  });
});
