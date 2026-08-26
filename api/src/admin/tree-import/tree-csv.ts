/**
 * Validation of the leadership-tree CSV the initial import consumes
 * (SKILL.md section 2, Initial data load and How the tree import runs).
 *
 * **This is the structural half of the dry run, and nothing else.** Section 2
 * puts the validation burden on the dry run — "cycles, the root count, every
 * `leader_row_id` resolving, sex present and mapping to a Network, and every
 * edge same-Network" — so that a commit fails for a structural reason only where
 * something changed underneath it. All of that is decidable from the file alone,
 * which is why it lives here rather than inside the import: an operator fixing a
 * spreadsheet should not need a database, an Admin account, or an open
 * initial-encoding phase to find out that row 412 points at row 87 which points
 * back at row 412.
 *
 * What it deliberately does **not** do, because section 2 gives those to the
 * import: it writes nothing, it reads no existing Person, and it decides no
 * duplicate. The duplicate pass below compares rows of the file against each
 * other only — it is a warning that adjudication is coming, never a verdict and
 * never a refusal. Section 3's two bounds hold here as everywhere: the system
 * never merges automatically and never blocks creation.
 *
 * Pure functions over a string. No database, no environment, no filesystem — the
 * CLI in `scripts/validate-tree-csv.ts` does the reading and the printing.
 */

import { createHash } from 'node:crypto';

import { type Candidate, findCandidates, normalizeName } from '../../people/duplicate-matching';

/**
 * The columns, in order. Section 2's ruling fixes `row_id` and `leader_row_id`;
 * the rest are section 3's required personal information, plus the birthday, which
 * section 3 makes optional and which nothing now requires — including this import,
 * whose earlier requirement rested on a central record that does not exist.
 *
 * `middle_name` and `mobile_number` are section 3 fields and are deliberately
 * **not** columns. Section 2 names what the import loads — "names, sex, and each
 * person's direct leader" and a birthday — and a column nobody can fill from the
 * central record is a column that gets filled with something.
 */
export const COLUMNS = [
  'row_id',
  'first_name',
  'last_name',
  'birth_date',
  'sex',
  'civil_status',
  'leader_row_id',
] as const;

export const SEXES = ['MALE', 'FEMALE'] as const;
export const CIVIL_STATUSES = ['SINGLE', 'MARRIED', 'WIDOWED'] as const;

/**
 * An error is something the import will refuse. A warning is something a person
 * should look at, and several of them are the whole point of running this: a
 * Tier 1 duplicate is not a defect in the file, it is work waiting at
 * adjudication (section 3).
 */
export type Severity = 'error' | 'warning';

/**
 * Every finding this module can emit. Closed, and exported, for one reason:
 * `detail` is the only field permitted to carry a name, a birthday or a quoted
 * value, and that promise is what lets an operator share a report from a public
 * repository's tooling about a file full of minors' records. A promise about
 * *every* finding cannot be tested by a fixture that happens to produce four of
 * them — so the test walks this list and fails if a code has no fixture, which
 * makes adding a code without checking its message a red build rather than a
 * quiet hole.
 */
export const FINDING_CODES = [
  'FILE_EMPTY',
  'HEADER_MISMATCH',
  'NO_ROWS',
  'FIELD_COUNT',
  'FIELD_WHITESPACE',
  'ROW_ID_MISSING',
  'ROW_ID_WHITESPACE',
  'ROW_ID_DUPLICATE',
  'NAME_MISSING',
  'NAME_SUSPECT',
  'BIRTH_DATE_MISSING',
  'BIRTH_DATE_FORMAT',
  'BIRTH_DATE_INVALID',
  'BIRTH_DATE_FUTURE',
  'BIRTH_DATE_IMPLAUSIBLE',
  'SEX_INVALID',
  'CIVIL_STATUS_INVALID',
  'CIVIL_STATUS_UNSUPPORTED',
  'LEADER_SELF',
  'LEADER_UNRESOLVED',
  'ROOT_COUNT',
  'ROOT_NETWORK',
  'EDGE_CROSS_NETWORK',
  'CYCLE',
  'DUPLICATE_TIER1',
  'AMBIGUOUS_AS_LEADER',
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];

/**
 * Generic over its code so the decisions file can carry the same shape without
 * borrowing this file's enumeration.
 *
 * The two files refuse different things and their codes have nothing to say about
 * each other, but the *redaction promise* below is one promise and must not be
 * made twice — `detail` is the only field permitted to carry personal data, and
 * the CLI redacts a report by dropping that field whatever produced it. A second
 * shape would be a second place for that rule to be got wrong.
 *
 * The default keeps every existing `Finding` and `Finding[]` in this module
 * meaning exactly what it did.
 */
export interface Finding<Code extends string = FindingCode> {
  severity: Severity;
  /** Stable, greppable, and what the report groups by. */
  code: Code;
  /** 1-based line in the file, header included, so it matches an editor. */
  line: number;
  /** The row's own `row_id`, where one was readable. */
  rowId?: string;
  /** What is wrong, in one sentence. */
  message: string;
  /**
   * Where a second row is implicated — the other end of an edge, the other half
   * of a duplicate pair, the earlier row that already claimed this `row_id`.
   */
  relatedLine?: number;
  /**
   * A value quoted back, or a name. **Personal data appears here and nowhere
   * else**, which is what lets the CLI redact a report without losing its
   * structure: this repository is public and the church holds records for
   * minors, so an operator must be able to share what the validator said.
   */
  detail?: string;
}

/** A row as read, before any rule is applied to it. */
export interface TreeRow {
  line: number;
  rowId: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  sex: string;
  civilStatus: string;
  leaderRowId: string;
}

export interface TreeSummary {
  rowCount: number;
  rootLines: number[];
  mens: number;
  womens: number;
  /** Null where cycles or unresolved leaders make depth undefined. */
  maxDepth: number | null;
  /** Leaders with the most direct disciples, strongest first, at most five. */
  widest: { line: number; rowId: string; directs: number }[];
  tier1Pairs: number;
  tier2Pairs: number;
}

export interface TreeReport {
  rows: TreeRow[];
  findings: Finding[];
  summary: TreeSummary;
}

export interface ValidateOptions {
  /**
   * Skip the duplicate pass. It compares every row against every earlier row and
   * the matcher normalizes both ends of every comparison, so the cost grows with
   * the square of the row count and is much the largest part of a run. No figure
   * is quoted for it: what it costs depends on how many rows share a surname, and
   * a number measured on one file would be a property of that file presented as a
   * property of this code. An operator iterating on a date format should not pay
   * it at all, which is what this option is for.
   */
  skipDuplicates?: boolean;
  /**
   * Today, as `YYYY-MM-DD`. Injected so the future-birthday rule is testable —
   * a test asserting against the real clock either fabricates a date far enough
   * ahead to be meaningless or starts failing on a particular morning.
   */
  today?: string;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

interface CsvRecord {
  fields: string[];
  line: number;
}

/**
 * RFC 4180, which is what every spreadsheet writes.
 *
 * Hand-rolled rather than taken as a dependency: this runs against a file that
 * may never enter the repository, on an operator's machine, and the whole value
 * of it is that `npm run validate:tree` and nothing else is required. Quoted
 * fields may contain commas, doubled quotes and newlines — the last of which is
 * why line numbers are counted here rather than by splitting on `\n` first. A
 * name with a comma in it is rare and a multi-line cell rarer, but both are what
 * a spreadsheet produces when somebody pastes into it, and misreading either
 * shifts every column on that row.
 */
export function parseCsv(text: string): CsvRecord[] {
  // A UTF-8 BOM is what Excel writes when it saves "CSV UTF-8", and left in place
  // it becomes part of the first header name — so the header comparison fails on
  // a file that is otherwise perfect, naming a column that looks identical.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let line = 1;
  let recordLine = 1;
  let quoted = false;
  let started = false;

  const endRecord = () => {
    fields.push(field);
    field = '';
    // A record of one empty field is a blank line, which every editor leaves at
    // the end of a file. It is not a row with six missing columns.
    if (!(fields.length === 1 && fields[0] === '')) {
      records.push({ fields, line: recordLine });
    }
    fields = [];
    started = false;
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (!started) {
      recordLine = line;
      started = true;
    }

    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else if (ch === '\r') {
      // Swallowed where a '\n' follows, which ends the record on the next pass.
      // A lone '\r' is a classic-Mac line ending and ends it here.
      if (source[i + 1] !== '\n') {
        endRecord();
        line += 1;
      }
    } else if (ch === '\n') {
      endRecord();
      line += 1;
    } else {
      field += ch;
    }
  }

  if (started) endRecord();

  return records;
}

// ---------------------------------------------------------------------------
// Field rules
// ---------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A real calendar date, not merely a well-shaped one. `2000-02-30` matches the
 * shape and is not a day; PostgreSQL refuses it, and the operator would otherwise
 * learn that at the commit rather than here.
 */
function isCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() + 1 === Number(m) &&
    date.getUTCDate() === Number(d)
  );
}

/**
 * What a wrong date most likely is, so the operator fixes the export rather than
 * the cell. Naming the shape is the difference between "row 412 is invalid" and
 * "the sheet is writing US order, re-export as ISO" — and with several hundred
 * rows wrong the second is the only one anybody can act on.
 */
function dateShapeHint(value: string): string {
  if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(value)) {
    return (
      'this is day/month/year or month/day/year, and the two are indistinguishable ' +
      'wherever the day is 12 or less — re-export as ISO rather than guessing the order'
    );
  }
  if (/^\d{4}[/.]\d{1,2}[/.]\d{1,2}$/.test(value)) {
    return 'year first, but not hyphenated — the format is exactly YYYY-MM-DD';
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(value)) {
    return 'month and day must be zero-padded to two digits';
  }
  if (/[A-Za-z]/.test(value)) {
    return 'this carries a month name — export the underlying date rather than a display format';
  }
  if (/^\d{8}$/.test(value)) {
    return 'eight digits and no separators — the format is exactly YYYY-MM-DD';
  }
  if (/^\d{1,6}$/.test(value)) {
    return (
      'this is a spreadsheet date serial number, which means the column exported as a ' +
      'number — format it as a date, or as text already in ISO, and export again'
    );
  }
  return 'the format is exactly YYYY-MM-DD';
}

/**
 * Values a Philippine church record commonly holds for civil status and SKILL.md
 * section 3 does not. Named individually because the operator's instinct is to
 * map one onto the nearest permitted value, and which value that should be is a
 * decision the specification has to make rather than a conversion.
 */
const OUT_OF_ENUM_STATUSES = new Set([
  'DIVORCED',
  'SEPARATED',
  'ANNULLED',
  'LIVE-IN',
  'LIVE IN',
  'COHABITING',
  'SINGLE PARENT',
  'SOLO PARENT',
  'ENGAGED',
]);

const ENUM_HINTS: Record<string, string> = {
  M: 'a single letter is ambiguous here — M could be MALE or MARRIED',
  F: 'did you mean FEMALE?',
  S: 'did you mean SINGLE?',
  W: 'did you mean WIDOWED?',
  WIDOW: 'did you mean WIDOWED?',
  WIDOWER: 'did you mean WIDOWED?',
  MARRIED_: 'did you mean MARRIED?',
};

function enumHint(value: string, allowed: readonly string[]): string | null {
  const upper = value.toUpperCase().trim();
  if (allowed.includes(upper)) return `the values are case-sensitive, so write ${upper}`;
  return ENUM_HINTS[upper] ?? null;
}

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

const EMPTY_SUMMARY: TreeSummary = {
  rowCount: 0,
  rootLines: [],
  mens: 0,
  womens: 0,
  maxDepth: null,
  widest: [],
  tier1Pairs: 0,
  tier2Pairs: 0,
};

export function validateTreeCsv(text: string, options: ValidateOptions = {}): TreeReport {
  const findings: Finding[] = [];
  const add = (finding: Finding) => findings.push(finding);
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  const records = parseCsv(text);
  if (records.length === 0) {
    add({ severity: 'error', code: 'FILE_EMPTY', line: 1, message: 'The file has no content.' });
    return { rows: [], findings, summary: EMPTY_SUMMARY };
  }

  const header = records[0].fields.map((field) => field.trim());
  if (header.length !== COLUMNS.length || COLUMNS.some((name, i) => header[i] !== name)) {
    add({
      severity: 'error',
      code: 'HEADER_MISMATCH',
      line: records[0].line,
      message: `The header must be exactly: ${COLUMNS.join(',')}`,
      detail: `found: ${header.join(',')}`,
    });
    // Every rule below reads its column by position, so a wrong header makes
    // every later finding a guess. Stop rather than emit a thousand of them.
    return { rows: [], findings, summary: EMPTY_SUMMARY };
  }

  const { rows, byRowId } = readRows(records.slice(1), add, today);
  if (rows.length === 0) {
    add({
      severity: 'error',
      code: 'NO_ROWS',
      line: 1,
      message: 'The file has a header and no rows.',
    });
    return { rows, findings, summary: EMPTY_SUMMARY };
  }

  const graph = checkGraph(rows, byRowId, add);
  const duplicates = options.skipDuplicates ? { tier1: 0, tier2: 0 } : checkDuplicates(rows, add);

  return {
    rows,
    findings,
    summary: {
      rowCount: rows.length,
      rootLines: graph.rootLines,
      mens: rows.filter((row) => row.sex === 'MALE').length,
      womens: rows.filter((row) => row.sex === 'FEMALE').length,
      maxDepth: graph.maxDepth,
      widest: graph.widest,
      tier1Pairs: duplicates.tier1,
      tier2Pairs: duplicates.tier2,
    },
  };
}

function readRows(
  records: CsvRecord[],
  add: (finding: Finding) => void,
  today: string,
): { rows: TreeRow[]; byRowId: Map<string, TreeRow> } {
  const rows: TreeRow[] = [];
  const byRowId = new Map<string, TreeRow>();

  for (const { fields, line } of records) {
    if (fields.length !== COLUMNS.length) {
      add({
        severity: 'error',
        code: 'FIELD_COUNT',
        line,
        message: `Expected ${COLUMNS.length} columns and found ${fields.length}. An unquoted comma inside a name does this.`,
      });
      continue;
    }

    const trimmed = fields.map((field) => field.trim());
    if (trimmed.some((value, i) => value !== fields[i])) {
      add({
        severity: 'warning',
        code: 'FIELD_WHITESPACE',
        line,
        rowId: trimmed[0],
        message:
          'A field carries leading or trailing whitespace. It is ignored here, but the import stores names as given — section 3 normalizes for comparison only.',
      });
    }

    const [rowId, firstName, lastName, birthDate, sex, civilStatus, leaderRowId] = trimmed;
    const row: TreeRow = {
      line,
      rowId,
      firstName,
      lastName,
      birthDate,
      sex,
      civilStatus,
      leaderRowId,
    };

    checkRowId(row, byRowId, add);
    checkNames(row, add);
    checkBirthDate(row, add, today);
    checkSex(row, add);
    checkCivilStatus(row, add);

    rows.push(row);
  }

  return { rows, byRowId };
}

function checkRowId(
  row: TreeRow,
  byRowId: Map<string, TreeRow>,
  add: (finding: Finding) => void,
): void {
  if (row.rowId === '') {
    add({
      severity: 'error',
      code: 'ROW_ID_MISSING',
      line: row.line,
      message: 'row_id is required — it is how every other row names this person.',
    });
    return;
  }
  if (/\s/.test(row.rowId)) {
    add({
      severity: 'error',
      code: 'ROW_ID_WHITESPACE',
      line: row.line,
      rowId: row.rowId,
      message: 'row_id must contain no whitespace.',
    });
    return;
  }
  const existing = byRowId.get(row.rowId);
  if (existing) {
    add({
      severity: 'error',
      code: 'ROW_ID_DUPLICATE',
      line: row.line,
      rowId: row.rowId,
      relatedLine: existing.line,
      message: `row_id ${row.rowId} is already used, so every leader_row_id naming it is ambiguous.`,
    });
    return;
  }
  byRowId.set(row.rowId, row);
}

function checkNames(row: TreeRow, add: (finding: Finding) => void): void {
  for (const [label, value] of [
    ['first_name', row.firstName],
    ['last_name', row.lastName],
  ] as const) {
    if (value === '') {
      add({
        severity: 'error',
        code: 'NAME_MISSING',
        line: row.line,
        rowId: row.rowId,
        message: `${label} is required (section 3).`,
      });
    } else if (/\d/.test(value)) {
      // Not an error. Section 3 forbids "letters only" validation, and a name
      // may legitimately hold anything; a digit is merely the commonest sign
      // that the columns are shifted on this row.
      add({
        severity: 'warning',
        code: 'NAME_SUSPECT',
        line: row.line,
        rowId: row.rowId,
        message: `${label} contains a digit, which usually means this row's columns are shifted.`,
        detail: value,
      });
    }
  }
}

function checkBirthDate(row: TreeRow, add: (finding: Finding) => void, today: string): void {
  const { birthDate, line, rowId } = row;
  if (birthDate === '') {
    // **A warning, not an error, and the distinction is the whole rule.** Section 2
    // required a birthday of the import until it was found to rest on a central
    // record that does not exist for this church; section 3 governs instead, and
    // section 3 permits absence. What it forbids is invention — so this reports the
    // gap, and refusing the file would be the surest way to have it filled with
    // something. A fabricated birthday matches another fabricated one at Tier 1,
    // and Tier 1 blocks creation, so the fiction refuses to record a real person.
    add({
      severity: 'warning',
      code: 'BIRTH_DATE_MISSING',
      line,
      rowId,
      message:
        'birth_date is absent. That is permitted (section 3) and the import will accept it — but never fill one in to silence this. A fabricated birthday produces false Tier 1 matches, and Tier 1 blocks creation, so it refuses to record real people. Add it later by an ordinary edit.',
    });
    return;
  }
  if (!ISO_DATE.test(birthDate)) {
    add({
      severity: 'error',
      code: 'BIRTH_DATE_FORMAT',
      line,
      rowId,
      message: `birth_date is not YYYY-MM-DD: ${dateShapeHint(birthDate)}.`,
      detail: birthDate,
    });
    return;
  }
  if (!isCalendarDate(birthDate)) {
    add({
      severity: 'error',
      code: 'BIRTH_DATE_INVALID',
      line,
      rowId,
      message: 'birth_date is well-shaped but is not a real day.',
      detail: birthDate,
    });
    return;
  }
  if (birthDate > today) {
    add({
      severity: 'error',
      code: 'BIRTH_DATE_FUTURE',
      line,
      rowId,
      message: 'birth_date is in the future.',
      detail: birthDate,
    });
    return;
  }
  if (birthDate < '1900-01-01') {
    add({
      severity: 'warning',
      code: 'BIRTH_DATE_IMPLAUSIBLE',
      line,
      rowId,
      message: 'birth_date is before 1900, which is usually a two-digit year expanded wrongly.',
      detail: birthDate,
    });
  }
}

function checkSex(row: TreeRow, add: (finding: Finding) => void): void {
  if ((SEXES as readonly string[]).includes(row.sex)) return;
  const hint = enumHint(row.sex, SEXES);
  add({
    severity: 'error',
    code: 'SEX_INVALID',
    line: row.line,
    rowId: row.rowId,
    message: `sex must be exactly MALE or FEMALE${hint ? ` — ${hint}` : ''}. Network follows from it (section 4), so nothing downstream can proceed without it.`,
    detail: row.sex,
  });
}

function checkCivilStatus(row: TreeRow, add: (finding: Finding) => void): void {
  if ((CIVIL_STATUSES as readonly string[]).includes(row.civilStatus)) return;
  const upper = row.civilStatus.toUpperCase();
  if (OUT_OF_ENUM_STATUSES.has(upper)) {
    add({
      severity: 'error',
      code: 'CIVIL_STATUS_UNSUPPORTED',
      line: row.line,
      rowId: row.rowId,
      message:
        `civil_status ${upper} is not one of SINGLE, MARRIED, WIDOWED. That list is closed in section 3, so ` +
        'which permitted value this becomes is a specification question rather than a mapping to choose here.',
      detail: row.civilStatus,
    });
    return;
  }
  const hint = enumHint(row.civilStatus, CIVIL_STATUSES);
  add({
    severity: 'error',
    code: 'CIVIL_STATUS_INVALID',
    line: row.line,
    rowId: row.rowId,
    message: `civil_status must be exactly SINGLE, MARRIED or WIDOWED${hint ? ` — ${hint}` : ''}.`,
    detail: row.civilStatus,
  });
}

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

interface GraphResult {
  rootLines: number[];
  maxDepth: number | null;
  widest: { line: number; rowId: string; directs: number }[];
}

/**
 * The four graph rules section 2 puts on the dry run: every `leader_row_id`
 * resolves, exactly two roots and one per Network, every edge same-Network, and
 * no cycles.
 */
function checkGraph(
  rows: TreeRow[],
  byRowId: Map<string, TreeRow>,
  add: (finding: Finding) => void,
): GraphResult {
  const roots: TreeRow[] = [];
  const leaderOf = new Map<number, TreeRow>();
  const directs = new Map<number, number>();

  for (const row of rows) {
    if (row.leaderRowId === '') {
      roots.push(row);
      continue;
    }
    if (row.leaderRowId === row.rowId) {
      add({
        severity: 'error',
        code: 'LEADER_SELF',
        line: row.line,
        rowId: row.rowId,
        message:
          'leader_row_id names this row itself. Section 5 rejects a self-assignment and calls it a one-node cycle; a root is an empty leader_row_id, never a self-reference.',
      });
      continue;
    }
    const leader = byRowId.get(row.leaderRowId);
    if (!leader) {
      add({
        severity: 'error',
        code: 'LEADER_UNRESOLVED',
        line: row.line,
        rowId: row.rowId,
        message: `leader_row_id ${row.leaderRowId} matches no row_id in this file.`,
        detail: row.leaderRowId,
      });
      continue;
    }
    leaderOf.set(row.line, leader);
    directs.set(leader.line, (directs.get(leader.line) ?? 0) + 1);

    // Section 4 and section 5: Network follows from sex, and a pastoral edge
    // never crosses one. A row whose sex is invalid is already reported; saying
    // its edge is cross-Network as well would be a second finding for one cause.
    const bothValid =
      (SEXES as readonly string[]).includes(row.sex) &&
      (SEXES as readonly string[]).includes(leader.sex);
    if (bothValid && row.sex !== leader.sex) {
      add({
        severity: 'error',
        code: 'EDGE_CROSS_NETWORK',
        line: row.line,
        rowId: row.rowId,
        relatedLine: leader.line,
        message: `This row is ${row.sex} and its leader on line ${leader.line} is ${leader.sex}. A pastoral edge never crosses Networks (section 5), and Network follows from sex (section 4).`,
      });
    }
  }

  checkRoots(roots, add);
  const cyclic = reportCycles(rows, leaderOf, add);

  return {
    rootLines: roots.map((row) => row.line),
    maxDepth: cyclic ? null : depthOf(rows, leaderOf),
    widest: [...directs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([line, count]) => ({
        line,
        rowId: rows.find((row) => row.line === line)?.rowId ?? '',
        directs: count,
      })),
  };
}

function checkRoots(roots: TreeRow[], add: (finding: Finding) => void): void {
  if (roots.length !== 2) {
    add({
      severity: 'error',
      code: 'ROOT_COUNT',
      line: roots[0]?.line ?? 1,
      message:
        `The file has ${roots.length} rows with an empty leader_row_id and must have exactly two — ` +
        'one root per Network (section 5)' +
        (roots.length > 2 ? `, at lines ${roots.map((row) => row.line).join(', ')}` : '') +
        (roots.length === 0
          ? '. Every row naming a leader with none of them a root means the whole file is one or more cycles'
          : '.'),
    });
    return;
  }
  const [a, b] = roots;
  const sexes = new Set([a.sex, b.sex]);
  if (!(sexes.has('MALE') && sexes.has('FEMALE'))) {
    add({
      severity: 'error',
      code: 'ROOT_NETWORK',
      line: a.line,
      rowId: a.rowId,
      relatedLine: b.line,
      message:
        'The two roots must be one MALE and one FEMALE — section 5 gives each Network exactly one root, and section 4 derives Network from sex. ' +
        `Lines ${a.line} and ${b.line} are ${a.sex} and ${b.sex}.`,
    });
  }
}

/**
 * Cycles, reported as the loop itself rather than as a list of implicated rows.
 *
 * Section 2 calls a spreadsheet "the most likely source of a cycle this system
 * will ever see", and a cycle in a leadership tree is not obvious from either
 * end: it is discovered by following pointers. Printing the loop in order is
 * what makes it a five-minute fix instead of an afternoon.
 *
 * Iterative rather than recursive — the tree is arbitrary-depth by rule
 * (Principle 11), and depth is exactly what a recursive walk spends stack on.
 */
function reportCycles(
  rows: TreeRow[],
  leaderOf: Map<number, TreeRow>,
  add: (finding: Finding) => void,
): boolean {
  const SETTLED = 2;
  const state = new Map<number, number>();
  const reported = new Set<number>();
  let found = false;

  for (const start of rows) {
    if (state.get(start.line) === SETTLED) continue;

    const path: TreeRow[] = [];
    const seenAt = new Map<number, number>();
    let current: TreeRow | undefined = start;

    while (current && state.get(current.line) !== SETTLED) {
      const at = seenAt.get(current.line);
      if (at !== undefined) {
        const loop = path.slice(at);
        // One finding per cycle, not one per row that walks into it.
        const key = Math.min(...loop.map((row) => row.line));
        if (!reported.has(key)) {
          reported.add(key);
          found = true;
          add({
            severity: 'error',
            code: 'CYCLE',
            line: loop[0].line,
            rowId: loop[0].rowId,
            message:
              `${loop.length} rows form a cycle: each is led by the next and the last is led by the first. ` +
              'Section 5 rejects it, and a tree cannot contain one. Lines ' +
              loop.map((row) => row.line).join(' -> ') +
              ` -> ${loop[0].line}`,
            detail: loop
              .map((row) => `${row.rowId} (${row.firstName} ${row.lastName})`)
              .join(' -> '),
          });
        }
        break;
      }
      seenAt.set(current.line, path.length);
      path.push(current);
      current = leaderOf.get(current.line);
    }

    for (const row of path) state.set(row.line, SETTLED);
  }

  return found;
}

function depthOf(rows: TreeRow[], leaderOf: Map<number, TreeRow>): number {
  const depth = new Map<number, number>();
  const resolve = (row: TreeRow): number => {
    const known = depth.get(row.line);
    if (known !== undefined) return known;
    const chain: TreeRow[] = [];
    let current: TreeRow | undefined = row;
    while (current && depth.get(current.line) === undefined) {
      chain.push(current);
      current = leaderOf.get(current.line);
    }
    let level = current ? depth.get(current.line)! : 0;
    for (const link of chain.reverse()) {
      level += 1;
      depth.set(link.line, level);
    }
    return depth.get(row.line)!;
  };
  return rows.reduce((max, row) => Math.max(max, resolve(row)), 0);
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

/**
 * Duplicate candidates **within the file**, run through the same matcher the
 * application uses (`people/duplicate-matching`) rather than a second
 * implementation of section 3's rules, which would drift from it.
 *
 * Everything here is a warning, and that is section 3 rather than caution: the
 * system never merges automatically and never blocks creation. A Tier 1 pair is
 * work the import's adjudication step already provides for — this reports it
 * early, while the operator still has the source records open, instead of at the
 * dry run when the file is finished.
 *
 * It compares each row against earlier rows only, which reports each pair once
 * and halves a quadratic pass.
 */
function checkDuplicates(
  rows: TreeRow[],
  add: (finding: Finding) => void,
): { tier1: number; tier2: number } {
  const population: Candidate[] = [];
  const lineOf = new Map<string, TreeRow>();
  let tier1 = 0;
  let tier2 = 0;

  // Two rows a leader reference cannot tell apart. Not a duplicate finding —
  // these may well be two people — but section 3's reason for refusing a name as
  // a leader reference at all, made concrete: if the source named leaders by
  // name, this is exactly the set where the conversion could have picked wrongly
  // and nothing downstream would ever say so.
  const byName = new Map<string, TreeRow[]>();

  for (const row of rows) {
    if (row.firstName === '' || row.lastName === '') continue;

    const key = `${normalizeName(row.firstName)}|${normalizeName(row.lastName)}`;
    byName.set(key, [...(byName.get(key) ?? []), row]);

    const id = String(row.line);
    lineOf.set(id, row);
    const matches = findCandidates(
      {
        firstName: row.firstName,
        lastName: row.lastName,
        birthDate: ISO_DATE.test(row.birthDate) ? row.birthDate : null,
        sex: (SEXES as readonly string[]).includes(row.sex)
          ? (row.sex as 'MALE' | 'FEMALE')
          : undefined,
      },
      population,
    );

    for (const match of matches) {
      const other = lineOf.get(match.candidate.id);
      if (!other) continue;
      if (match.tier === 1) {
        tier1 += 1;
        add({
          severity: 'warning',
          code: 'DUPLICATE_TIER1',
          line: row.line,
          rowId: row.rowId,
          relatedLine: other.line,
          message:
            `Tier 1 duplicate candidate against line ${other.line}: ${match.reasons.join('; ')}. ` +
            'Section 3 requires a person to acknowledge this before the second Person is created, so the import will stop for it at adjudication. If they are one person, remove a row now.',
          detail: `${row.firstName} ${row.lastName} ${row.birthDate} vs ${other.firstName} ${other.lastName} ${other.birthDate}`,
        });
      } else {
        tier2 += 1;
      }
    }

    population.push({
      id,
      memberId: '',
      firstName: row.firstName,
      middleName: null,
      lastName: row.lastName,
      birthDate: ISO_DATE.test(row.birthDate) ? row.birthDate : null,
      sex: row.sex === 'FEMALE' ? 'FEMALE' : 'MALE',
      mobileNumberNormalized: null,
    });
  }

  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const [first, ...rest] = group;
    add({
      severity: 'warning',
      code: 'AMBIGUOUS_AS_LEADER',
      line: first.line,
      rowId: first.rowId,
      relatedLine: rest[0].line,
      message:
        `${group.length} rows share this first and last name, at lines ${group.map((row) => row.line).join(', ')}. ` +
        'They may well be different people. Check every leader_row_id pointing at any of them, because a conversion from leader names could not have told them apart and nothing downstream will ever say so.',
      detail: `${first.firstName} ${first.lastName}`,
    });
  }

  return { tier1, tier2 };
}

// ---------------------------------------------------------------------------
// The fingerprint
// ---------------------------------------------------------------------------

/**
 * The digest a decisions file carries on every row (SKILL.md section 2, The
 * fingerprint).
 *
 * It exists so that a file cannot be edited between the dry run and the commit
 * while the decisions taken against it are still applied — decisions about row 41
 * landing on a row 41 that is now somebody else.
 *
 * Section 2 fixes the construction exactly, and every part of it is load-bearing:
 *
 * - **Over the parsed rows, never the file's bytes.** Re-saving a spreadsheet
 *   changes quoting and line endings without changing a single fact, and a
 *   byte-level digest would refuse a file nobody meaningfully touched.
 * - **Trimmed values**, because surrounding whitespace is precisely what a
 *   spreadsheet adds and removes on its own. `TreeRow` already holds them
 *   trimmed, which is why this reads the row rather than re-reading the field.
 * - **JSON-encoded, not delimited.** Section 3 lets a name contain any character,
 *   so there is no delimiter that cannot occur inside a field — and a digest that
 *   can be forced to collide by putting a comma in a surname is worse than none,
 *   because it is trusted.
 * - **Row order is part of it.** Sorting the input invalidates a decisions file
 *   even though every decision would still apply correctly, since decisions key
 *   on `row_id` rather than on position. That is deliberate: the dry-run report
 *   the adjudicator was reading names *line numbers*, and in a re-sorted file
 *   those numbers point at other people, so the file they answered is no longer
 *   the file in front of them.
 *
 * The header contributes nothing. It is fixed, and a file whose header differs is
 * refused by `validateTreeCsv` before any fingerprint is taken.
 */
export function fingerprintOf(rows: readonly TreeRow[]): string {
  const encoded = rows
    .map((row) =>
      JSON.stringify([
        row.rowId,
        row.firstName,
        row.lastName,
        row.birthDate,
        row.sex,
        row.civilStatus,
        row.leaderRowId,
      ]),
    )
    .join('\n');

  return createHash('sha256').update(encoded, 'utf8').digest('hex');
}
