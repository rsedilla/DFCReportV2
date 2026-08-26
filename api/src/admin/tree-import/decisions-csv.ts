/**
 * The decisions file (SKILL.md section 2, The decisions file).
 *
 * Section 3 fixes two bounds on duplicate matching: the system never merges
 * automatically, and it never blocks creation — but a Tier 1 candidate must be
 * acknowledged by a person before a new Person is created. An unattended import
 * has nobody present at each row, so it can satisfy neither bound inline. Section
 * 2's answer is two phases: a dry run that writes nothing and reports candidates,
 * a person deciding, and only then a commit.
 *
 * This is the file that person returns.
 *
 *     input_fingerprint,row_id,decision,member_id
 *
 * A CSV rather than JSON, for the reason section 2 chose a file at all: it is
 * sorted, emailed to the leader who actually knows whether those two are one
 * person, and returned. That leader opens a CSV in a spreadsheet; they open a
 * JSON document in a text editor and edit it wrongly — a lost brace in a file
 * whose whole purpose is deciding which people exist.
 *
 * Pure functions over a string, like `tree-csv.ts` beside it. Whether a
 * `member_id` names a Person who exists, and whether that Person already holds an
 * assignment, are questions for the commit — they need a database, and every
 * refusal that does not is better made where an operator can see it without one.
 */

import { parseCsv } from './tree-csv';

import type { Finding } from './tree-csv';

/** The columns, in order. Section 2 fixes them. */
export const DECISION_COLUMNS = ['input_fingerprint', 'row_id', 'decision', 'member_id'] as const;

/**
 * Every finding this module can emit. Closed and exported for the reason
 * `FINDING_CODES` is: `detail` is the only field permitted to carry a name or a
 * quoted value, and a promise about *every* finding cannot be tested by a fixture
 * that happens to produce four of them. The test walks this list and fails if a
 * code has no fixture.
 *
 * Its own list rather than an extension of the tree file's, because the two files
 * refuse different things: a code here would have no tree-CSV fixture to write and
 * would be added to that test as an exception, which is how a closed list stops
 * closing anything.
 */
export const DECISION_FINDING_CODES = [
  'DECISIONS_FILE_EMPTY',
  'DECISIONS_HEADER_MISMATCH',
  'DECISIONS_FIELD_COUNT',
  'FINGERPRINT_MISMATCH',
  'DECISIONS_ROW_ID_MISSING',
  'DECISIONS_ROW_ID_UNKNOWN',
  'DECISIONS_ROW_ID_DUPLICATE',
  'TIER1_UNACKNOWLEDGED',
  'DECISION_INVALID',
  'MEMBER_ID_MISSING',
  'MEMBER_ID_SHAPE',
  'MEMBER_ID_UNEXPECTED',
] as const;

export type DecisionFindingCode = (typeof DECISION_FINDING_CODES)[number];

/** A refusal from this file, carrying the same redaction promise (`tree-csv.ts`). */
export type DecisionFinding = Finding<DecisionFindingCode>;

/**
 * `CREATE` or `USE_EXISTING` (section 2).
 *
 * There is deliberately no third value. A `SKIP` would leave every row naming that
 * `row_id` as its leader unresolvable, and the dry run already refuses a file
 * whose leader references do not resolve — so it would be a way of producing, from
 * the decisions file, the exact state the dry run exists to refuse.
 */
export const DECISIONS = ['CREATE', 'USE_EXISTING'] as const;
export type Decision = (typeof DECISIONS)[number];

/**
 * Member ID shape (section 3): `M-` and six digits, from a database sequence.
 *
 * Checked here so a retyping slip is caught by the file rather than by a lookup
 * that answers "no such Person" — section 2 chose the Member ID over the UUID
 * precisely because the adjudicator reads it off a report and may retype it.
 */
const MEMBER_ID = /^M-\d{6}$/;

export interface DecisionRow {
  line: number;
  rowId: string;
  decision: Decision;
  /** Present exactly where `decision` is `USE_EXISTING`. */
  memberId: string | null;
}

export interface DecisionsReport {
  /** Keyed by `row_id`. Incomplete where any finding is an error. */
  byRowId: Map<string, DecisionRow>;
  findings: DecisionFinding[];
}

/**
 * Reads a decisions file and checks everything decidable without a database.
 *
 * `expectedFingerprint` is the digest of the tree file this commit is running
 * against. Every row must carry it — section 2 repeats it per row rather than
 * once because a comment line is not CSV, a companion file can be separated from
 * the file it describes, and a spreadsheet round-trip preserves a column while
 * preserving little else. Requiring every row to agree also catches the case none
 * of the others do: two decisions files spliced together.
 *
 * `tier1RowIds` are the rows the dry run found a Tier 1 candidate for. Section 3
 * requires a person to acknowledge one before a Person is created and silence is
 * not acknowledgement, so a Tier 1 row that is absent or blank is refused. A row
 * carrying only Tier 2 candidates may be left blank, which means create — section
 * 3 presents Tier 2 in a list and asks nothing of the person reading it.
 */
export function readDecisionsCsv(
  text: string,
  context: {
    expectedFingerprint: string;
    knownRowIds: ReadonlySet<string>;
    tier1RowIds: ReadonlySet<string>;
  },
): DecisionsReport {
  const findings: DecisionFinding[] = [];
  const add = (finding: DecisionFinding) => findings.push(finding);
  const byRowId = new Map<string, DecisionRow>();

  const records = parseCsv(text);
  if (records.length === 0) {
    add({
      severity: 'error',
      code: 'DECISIONS_FILE_EMPTY',
      line: 1,
      message: 'The decisions file has no content.',
    });
    return { byRowId, findings };
  }

  const header = records[0].fields.map((field) => field.trim());
  if (
    header.length !== DECISION_COLUMNS.length ||
    DECISION_COLUMNS.some((name, i) => header[i] !== name)
  ) {
    add({
      severity: 'error',
      code: 'DECISIONS_HEADER_MISMATCH',
      line: records[0].line,
      message: `The header must be exactly: ${DECISION_COLUMNS.join(',')}`,
      detail: `found: ${header.join(',')}`,
    });
    // Every rule below reads its column by position, so a wrong header makes every
    // later finding a guess.
    return { byRowId, findings };
  }

  for (const { fields, line } of records.slice(1)) {
    if (fields.length !== DECISION_COLUMNS.length) {
      add({
        severity: 'error',
        code: 'DECISIONS_FIELD_COUNT',
        line,
        message: `Expected ${DECISION_COLUMNS.length} columns and found ${fields.length}.`,
      });
      continue;
    }

    const [fingerprint, rowId, decision, memberId] = fields.map((field) => field.trim());

    if (fingerprint !== context.expectedFingerprint) {
      add({
        severity: 'error',
        code: 'FINGERPRINT_MISMATCH',
        line,
        rowId,
        message:
          'This row was decided against a different version of the tree file. Re-run the dry ' +
          'run and adjudicate the report it produces — the decisions in this file may name ' +
          'people the tree no longer describes.',
      });
      continue;
    }

    if (rowId === '') {
      add({
        severity: 'error',
        code: 'DECISIONS_ROW_ID_MISSING',
        line,
        message: 'row_id is required — it is what this decision applies to.',
      });
      continue;
    }

    if (!context.knownRowIds.has(rowId)) {
      add({
        severity: 'error',
        code: 'DECISIONS_ROW_ID_UNKNOWN',
        line,
        rowId,
        message:
          'No row in the tree file carries this row_id. The fingerprint matched, so the tree ' +
          'file is the one this was decided against and the row_id is a typing slip.',
      });
      continue;
    }

    const already = byRowId.get(rowId);
    if (already !== undefined) {
      add({
        severity: 'error',
        code: 'DECISIONS_ROW_ID_DUPLICATE',
        line,
        rowId,
        relatedLine: already.line,
        message:
          'Two rows decide the same row_id. Which one governs is not something this import ' +
          'will choose.',
      });
      continue;
    }

    if (decision === '') {
      // Blank means create, and section 3 permits that only where nothing needs
      // acknowledging. A Tier 1 row is refused here rather than at the commit so
      // the operator is told which line to answer.
      if (context.tier1RowIds.has(rowId)) {
        add({
          severity: 'error',
          code: 'TIER1_UNACKNOWLEDGED',
          line,
          rowId,
          message:
            'This row has a Tier 1 duplicate candidate and no decision. Section 3 requires a ' +
            'person to acknowledge one before a Person is created, and silence is not ' +
            'acknowledgement. Write CREATE or USE_EXISTING.',
        });
      }

      // A blank decision carrying a member_id is refused for the same reason a
      // CREATE carrying one is, below: the two readings of the row are different
      // decisions and neither is safe to guess.
      if (memberId !== '') {
        add({
          severity: 'error',
          code: 'MEMBER_ID_UNEXPECTED',
          line,
          rowId,
          message:
            'A blank decision means create, and creating uses no member_id. Write ' +
            'USE_EXISTING if that is what was meant.',
          detail: memberId,
        });
      }

      continue;
    }

    if (!(DECISIONS as readonly string[]).includes(decision)) {
      add({
        severity: 'error',
        code: 'DECISION_INVALID',
        line,
        rowId,
        message: `decision must be exactly ${DECISIONS.join(' or ')}, or blank to create.`,
        detail: decision,
      });
      continue;
    }

    if (decision === 'USE_EXISTING') {
      if (memberId === '') {
        add({
          severity: 'error',
          code: 'MEMBER_ID_MISSING',
          line,
          rowId,
          message: 'USE_EXISTING names the Person to use. Give their Member ID, as M-000000.',
        });
        continue;
      }

      if (!MEMBER_ID.test(memberId)) {
        add({
          severity: 'error',
          code: 'MEMBER_ID_SHAPE',
          line,
          rowId,
          message: 'A Member ID is M- and six digits (section 3).',
          detail: memberId,
        });
        continue;
      }
    } else if (memberId !== '') {
      add({
        severity: 'error',
        code: 'MEMBER_ID_UNEXPECTED',
        line,
        rowId,
        message:
          'member_id names the Person that USE_EXISTING uses, and CREATE uses none. Refused ' +
          'rather than ignored: the two readings of this row are "create a new Person" and ' +
          '"use that one", and they are not the same decision.',
        detail: memberId,
      });
      continue;
    }

    byRowId.set(rowId, {
      line,
      rowId,
      decision: decision as Decision,
      memberId: decision === 'USE_EXISTING' ? memberId : null,
    });
  }

  // A Tier 1 row absent from the file altogether is the same silence as a blank
  // one, and the loop above cannot see it because it only walks rows that are
  // present. Section 2 says a row absent from the decisions file is created —
  // which is right for Tier 2 and is exactly what section 3 forbids for Tier 1.
  //
  // Skipped where the row already carries a finding, so that one unanswered row
  // does not produce two refusals saying the same thing.
  for (const rowId of context.tier1RowIds) {
    if (byRowId.has(rowId) || findings.some((finding) => finding.rowId === rowId)) {
      continue;
    }

    add({
      severity: 'error',
      code: 'TIER1_UNACKNOWLEDGED',
      line: 1,
      rowId,
      message:
        'This row has a Tier 1 duplicate candidate and does not appear in the decisions file ' +
        'at all. Section 2 creates an absent row, and section 3 forbids creating this one ' +
        'unacknowledged.',
    });
  }

  return { byRowId, findings };
}

/**
 * The template the dry run emits: one line per row the matcher found a candidate
 * for, and nothing else.
 *
 * **Only matched rows appear** (section 2). A row matching nobody has nothing to
 * decide, and asking a person to fill three thousand rows in order to say so
 * produces a file completed without being read — the failure section 4 gives for
 * asking anyone to confirm a tautology, and here the unread rows are the ones that
 * matter.
 *
 * Every row is written with `decision` blank. For a Tier 2 row that is already the
 * answer; for a Tier 1 row the file refuses until it is filled in, which is what
 * makes the template safe to hand over unedited.
 */
export function decisionsTemplate(fingerprint: string, rows: readonly { rowId: string }[]): string {
  const lines = [DECISION_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(`${fingerprint},${row.rowId},,`);
  }
  return `${lines.join('\n')}\n`;
}

/** Whether `findings` contains anything that refuses the file. */
export function hasErrors(findings: readonly Finding<string>[]): boolean {
  return findings.some((finding) => finding.severity === 'error');
}
