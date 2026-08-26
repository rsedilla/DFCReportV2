/**
 * The leadership-tree import, in the two phases section 2 requires (SKILL.md
 * section 2, How the tree import runs).
 *
 *   dry run   validates, matches against existing Persons, writes nothing, and
 *             emits the decisions template a person adjudicates
 *   commit    verifies the fingerprint, applies the decisions, and writes the
 *             whole tree in one transaction
 *
 * **The writing is here and not in `scripts/import-tree.ts`** for the reason the
 * first-Admin bootstrap split the same way: a script cannot be tested, and section
 * 2 carries rules — the actor check, the phase, the fingerprint, the refusal on an
 * existing assignment — that would otherwise be stated with nothing able to fail
 * on them. The script parses arguments, reads files and prints.
 *
 * **It touches no table.** Every write goes through the module that owns it:
 * `PeopleImportService` for `persons`, `person_lifecycle` and, through
 * `hierarchy`, the assignment; `SettingsService` for the phase. That is section
 * 2's ownership rule, which this repository has already defended once at the cost
 * of restructuring the module graph.
 *
 * Plain functions rather than a Nest service, like `bootstrapFirstAdmin`. Nothing
 * injects this — the only caller is a script that builds an application context
 * and reaches for what it needs.
 */

import { randomUUID } from 'node:crypto';

import { Capability } from '../../auth/authorization/capabilities';

import { decisionsTemplate, hasErrors, readDecisionsCsv } from './decisions-csv';
import { fingerprintOf, validateTreeCsv } from './tree-csv';

import type { AuthorizationService } from '../../auth/authorization/authorization.service';
import type { Actor } from '../../auth/authorization/authorization.service';
import type { Db } from '../../database/database.module';
import type { CivilStatus, Sex } from '../../database/schema';
import type { Match, Subject } from '../../people/duplicate-matching';
import type { PeopleDuplicatesService } from '../../people/people.duplicates.service';
import type { PeopleImportService } from '../../people/people.import.service';
import type { SettingsService } from '../settings/settings.service';
import type { DecisionRow } from './decisions-csv';
import type { Finding, TreeReport, TreeRow } from './tree-csv';

export interface ImportModules {
  db: Db;
  people: PeopleImportService;
  duplicates: PeopleDuplicatesService;
  settings: SettingsService;
  authorization: AuthorizationService;
}

/**
 * A row the matcher matched against a Person who already exists.
 *
 * Only these appear in the decisions template (section 2): a row matching nobody
 * has nothing to decide, and asking a person to fill three thousand rows in order
 * to say so produces a file completed without being read.
 */
export interface MatchedRow {
  line: number;
  rowId: string;
  /** The name in the file, so a report can show what was being matched. */
  subjectName: string;
  /** Strongest tier among this row's candidates. */
  tier: 1 | 2;
  candidates: {
    memberId: string;
    fullName: string;
    tier: 1 | 2;
    reasons: string[];
  }[];
}

export interface DryRunReport {
  tree: TreeReport;
  /** Null where the tree file was refused, since there are no rows to digest. */
  fingerprint: string | null;
  matched: MatchedRow[];
  /** The rows section 3 requires a person to answer for. */
  tier1RowIds: Set<string>;
  /** Null where the tree file was refused. */
  decisionsTemplate: string | null;
  /**
   * Refusals that are not about the file: the actor's authority, and the phase.
   *
   * Reported by the dry run as well as enforced by the commit so that an operator
   * finds out before adjudicating thirty rows rather than after.
   */
  preconditions: Finding<PreconditionCode>[];
}

export const PRECONDITION_CODES = [
  'ACTOR_UNKNOWN',
  'ACTOR_LACKS_CAPABILITY',
  'ENCODING_PHASE_CLOSED',
] as const;

export type PreconditionCode = (typeof PRECONDITION_CODES)[number];

export interface CommitResult {
  batchId: string;
  encodedAt: Date;
  created: { rowId: string; memberId: string; fullName: string }[];
  reused: { rowId: string; memberId: string; fullName: string }[];
}

/**
 * Section 2: the actor is named on the command line, and refuses unless that
 * account holds `people.create` and `people.manage_pastoral_assignment` at Whole
 * Church.
 *
 * **What that is worth is stated rather than assumed.** It is not authentication:
 * whoever can run the script can already reach the database directly and do
 * anything at all. What it buys is that the audit entries name an account that
 * could legitimately have performed the work, and that an operator cannot
 * attribute several thousand records to a Leader.
 *
 * The target is `{ kind: 'church' }`, which is the whole of how "at Whole Church"
 * is expressed: `scopeCovers` returns true for a Whole Church grant before it
 * looks at anything, and returns false for a church-wide target under every
 * narrower scope. Naming a person target instead would pass for a subtree-scoped
 * grant over anyone inside that subtree, which is the hole the 2026-08-24 ruling
 * closed for the single-scope capabilities.
 */
const REQUIRED: readonly Capability[] = [
  Capability.PeopleCreate,
  Capability.PeopleManagePastoralAssignment,
];

async function checkPreconditions(
  modules: ImportModules,
  actor: Actor,
): Promise<Finding<PreconditionCode>[]> {
  const findings: Finding<PreconditionCode>[] = [];

  for (const capability of REQUIRED) {
    try {
      await modules.authorization.authorize(actor, capability, { kind: 'church' });
    } catch {
      findings.push({
        severity: 'error',
        code: 'ACTOR_LACKS_CAPABILITY',
        line: 1,
        message:
          `The account running this import does not hold ${capability} at Whole Church. ` +
          'Section 2 requires both that and `people.manage_pastoral_assignment`, so that the ' +
          'audit entries name an account that could legitimately have done the work.',
        detail: capability,
      });
    }
  }

  if (!(await modules.settings.initialEncodingOpenWithin(modules.db))) {
    findings.push({
      severity: 'error',
      code: 'ENCODING_PHASE_CLOSED',
      line: 1,
      message:
        'The initial-encoding phase is closed, so this import cannot run. The phase is what ' +
        'makes its relaxations temporary, and one that could run after it closed would be a ' +
        'relaxation with no end (section 2).',
    });
  }

  return findings;
}

/**
 * The dry run. It writes nothing — no Person, no assignment, no audit entry — so
 * it may be run as often as needed, which is what makes refusing a re-sorted file
 * cheap rather than punitive.
 *
 * Two halves. The structural one is `validateTreeCsv`, which needs no database and
 * carries section 2's whole validation burden: cycles, the root count, every
 * `leader_row_id` resolving, sex present and mapping to a Network, and every edge
 * same-Network. The other is this: matching each row against the Persons who
 * already exist, which needs one.
 *
 * **A refused file stops before the matcher.** Every candidate would be computed
 * against rows whose leader references may not resolve, and the decisions file
 * built from it would key on a fingerprint of a tree nobody can import.
 */
export async function dryRunTreeImport(
  modules: ImportModules,
  input: { treeCsv: string; actor: Actor; today?: string },
): Promise<DryRunReport> {
  const preconditions = await checkPreconditions(modules, input.actor);
  const tree = validateTreeCsv(input.treeCsv, { today: input.today });

  if (hasErrors(tree.findings)) {
    return {
      tree,
      fingerprint: null,
      matched: [],
      tier1RowIds: new Set(),
      decisionsTemplate: null,
      preconditions,
    };
  }

  const fingerprint = fingerprintOf(tree.rows);
  const matched = await matchAgainstExisting(modules, tree.rows);
  const tier1RowIds = new Set(matched.filter((row) => row.tier === 1).map((row) => row.rowId));

  return {
    tree,
    fingerprint,
    matched,
    tier1RowIds,
    decisionsTemplate: decisionsTemplate(fingerprint, matched),
    preconditions,
  };
}

/**
 * Every row, against the Persons already recorded.
 *
 * **Not `visibleDuplicatesFor`**, which is the section 8 redaction and answers the
 * question "what may *this viewer* be shown". The actor here holds Whole Church by
 * the precondition above, so every candidate is in scope and the redaction would
 * be a no-op computed at the cost of a second matcher run per row. The report is
 * for an administrator, and the CLI's `--redact` is what makes it shareable.
 *
 * Sequential rather than concurrent. The pool is bounded at ten (section 24) and
 * this runs against thirty rows, so a fan-out buys nothing measurable and risks
 * the thing that bound exists to prevent.
 */
async function matchAgainstExisting(
  modules: ImportModules,
  rows: readonly TreeRow[],
): Promise<MatchedRow[]> {
  const matched: MatchedRow[] = [];

  for (const row of rows) {
    const subject: Subject = {
      firstName: row.firstName,
      middleName: null,
      lastName: row.lastName,
      // The file's own value, and empty means absent rather than blank. Section 3
      // makes a birthday optional and its absence drops a candidate to Tier 2,
      // which is honest: less is known, so less is claimed.
      birthDate: row.birthDate === '' ? null : row.birthDate,
      sex: row.sex as Sex,
      // Section 2 does not load one, so there is none to match on.
      mobileNumberNormalized: null,
    };

    const matches: Match[] = await modules.duplicates.findDuplicates(subject);
    if (matches.length === 0) {
      continue;
    }

    matched.push({
      line: row.line,
      rowId: row.rowId,
      subjectName: `${row.firstName} ${row.lastName}`,
      tier: matches.some((match) => match.tier === 1) ? 1 : 2,
      candidates: matches.map((match) => ({
        memberId: match.candidate.memberId,
        fullName: [match.candidate.firstName, match.candidate.middleName, match.candidate.lastName]
          .filter((part) => part !== null && part !== '')
          .join(' '),
        tier: match.tier,
        reasons: match.reasons,
      })),
    });
  }

  return matched;
}

/**
 * The commit. One transaction, and there is no resume (section 2).
 *
 * A failure writes nothing; the file is corrected and the import run again.
 * Resuming was rejected for a specific reason rather than for simplicity: a
 * resumed run meets the Persons its own earlier attempt created, each of them a
 * Tier 1 candidate against the row that created it, and section 3 forbids
 * adjudicating those inline because nobody is present.
 *
 * **The matcher runs again here, and only to rebuild the Tier 1 set.** Section 3's
 * acknowledgement gate is enforced by the decisions file, which is what the
 * fingerprint makes sound — but the gate needs to know which rows *have* a Tier 1
 * candidate, and that set is not carried in the file.
 *
 * **What that catches, and what it does not.** The fingerprint covers the input
 * file and says nothing about the database, so a Person created between the dry
 * run and the commit is a candidate the adjudicator never saw. Where that gives a
 * row its *first* Tier 1 candidate, the row is blank or absent from the decisions
 * file and is refused — the "something changed underneath it" case section 2
 * leaves room for.
 *
 * Where the row already carries a decision, it is not caught, and the reason is
 * that section 2's decisions file has no candidate column: a `CREATE` records "I
 * looked at this row's candidates and decided create", against a candidate set
 * nothing pins. So a new Tier 1 candidate arriving for an already-decided row is
 * created past an acknowledgement that was made about somebody else.
 *
 * That gap is stated rather than closed because closing it means adding structure
 * section 2 does not describe — a per-row digest of the candidate identifiers,
 * carried in the file and compared here. It is narrow in practice: the import runs
 * once, on a spine of thirty rows, against a database in which the only other
 * Person is the administrator. It is recorded in `CLAUDE.md` as open.
 */
export async function commitTreeImport(
  modules: ImportModules,
  input: { treeCsv: string; decisionsCsv: string; actor: Actor; today?: string },
): Promise<CommitResult> {
  const preconditions = await checkPreconditions(modules, input.actor);
  if (preconditions.length > 0) {
    throw new TreeImportRefused(preconditions);
  }

  const tree = validateTreeCsv(input.treeCsv, { today: input.today });
  if (hasErrors(tree.findings)) {
    throw new TreeImportRefused(tree.findings);
  }

  const fingerprint = fingerprintOf(tree.rows);
  const matched = await matchAgainstExisting(modules, tree.rows);
  const tier1RowIds = new Set(matched.filter((row) => row.tier === 1).map((row) => row.rowId));

  const decisions = readDecisionsCsv(input.decisionsCsv, {
    expectedFingerprint: fingerprint,
    knownRowIds: new Set(tree.rows.map((row) => row.rowId)),
    tier1RowIds,
  });

  if (hasErrors(decisions.findings)) {
    throw new TreeImportRefused(decisions.findings);
  }

  return applyWithinOneTransaction(modules, {
    rows: tree.rows,
    decisions: decisions.byRowId,
    actor: input.actor,
  });
}

/**
 * Refused, carrying every finding rather than the first.
 *
 * An operator fixing a spreadsheet wants the list; handing them one refusal at a
 * time turns a ten-minute correction into ten runs. `Finding<string>` rather than
 * a union of the three code enumerations, because the CLI groups and redacts by
 * shape and has nothing to say about which file a code came from.
 */
export class TreeImportRefused extends Error {
  constructor(readonly findings: readonly Finding<string>[]) {
    super(
      `The import was refused: ${findings.filter((finding) => finding.severity === 'error').length} error(s).`,
    );
    this.name = 'TreeImportRefused';
  }
}

/**
 * Every write, inside one transaction.
 *
 * **Rows are applied leaders-first.** A disciple's assignment names their leader,
 * so the leader's Person must exist by the time the edge is opened — and the file
 * is in whatever order a spreadsheet happened to hold. The traversal starts at the
 * roots and walks down, which `validateTreeCsv` has already proved terminates:
 * it refuses a cycle, refuses an unresolved `leader_row_id`, and refuses anything
 * other than exactly two roots.
 *
 * That last one is why an unreached row is an assertion rather than a finding. If
 * a row is neither a root nor reachable from one, it is in a cycle or points at
 * nothing, and both were refused before this function was called. Raising here
 * means the validator and this walk disagree, which is a defect rather than a bad
 * file.
 */
async function applyWithinOneTransaction(
  modules: ImportModules,
  input: {
    rows: readonly TreeRow[];
    decisions: ReadonlyMap<string, DecisionRow>;
    actor: Actor;
  },
): Promise<CommitResult> {
  const batchId = randomUUID();
  // One instant for the whole import, so every row of the tree shares an effective
  // date. Section 2: every assignment created this way takes the encoding date,
  // and nothing is backdated.
  const encodedAt = new Date();

  const childrenOf = new Map<string, TreeRow[]>();
  const roots: TreeRow[] = [];

  for (const row of input.rows) {
    if (row.leaderRowId === '') {
      roots.push(row);
      continue;
    }
    const siblings = childrenOf.get(row.leaderRowId);
    if (siblings === undefined) {
      childrenOf.set(row.leaderRowId, [row]);
    } else {
      siblings.push(row);
    }
  }

  const created: CommitResult['created'] = [];
  const reused: CommitResult['reused'] = [];

  await modules.db.transaction().execute(async (trx) => {
    /** The Person each `row_id` resolved to, whether created here or reused. */
    const personOf = new Map<string, string>();

    const place = async (row: TreeRow): Promise<void> => {
      const placement =
        row.leaderRowId === ''
          ? ({ kind: 'ROOT' } as const)
          : ({ kind: 'UNDER', pastoralLeaderId: personOf.get(row.leaderRowId)! } as const);

      const decision = input.decisions.get(row.rowId);

      if (decision?.decision === 'USE_EXISTING') {
        const existing = await modules.people.resolveExistingWithin(trx, decision.memberId!, {
          sex: row.sex as Sex,
        });

        await modules.people.attachExistingWithin(
          trx,
          {
            personId: existing.id,
            memberId: existing.memberId,
            placement,
            network: existing.network,
            encodedAt,
          },
          input.actor,
          batchId,
        );

        personOf.set(row.rowId, existing.id);
        reused.push({
          rowId: row.rowId,
          memberId: existing.memberId,
          fullName: existing.fullName,
        });
        return;
      }

      const person = await modules.people.createForImportWithin(
        trx,
        {
          firstName: row.firstName,
          // Section 2 does not load a middle name, so there is none to record.
          // Section 3 makes it optional; absent is the honest value.
          middleName: null,
          lastName: row.lastName,
          birthDate: row.birthDate === '' ? null : row.birthDate,
          sex: row.sex as Sex,
          civilStatus: row.civilStatus as CivilStatus,
          placement,
          encodedAt,
        },
        input.actor,
        batchId,
      );

      personOf.set(row.rowId, person.id);
      created.push({
        rowId: row.rowId,
        memberId: person.memberId,
        fullName: `${row.firstName} ${row.lastName}`,
      });
    };

    // Breadth-first from the roots, so a leader is always placed before anyone
    // naming them. Iterative rather than recursive: the tree is arbitrary-depth by
    // rule (principle 11), and a recursive walk would put a limit on it that
    // nothing states.
    const queue = [...roots];
    while (queue.length > 0) {
      const row = queue.shift()!;
      await place(row);
      queue.push(...(childrenOf.get(row.rowId) ?? []));
    }

    if (personOf.size !== input.rows.length) {
      const unreached = input.rows.filter((row) => !personOf.has(row.rowId));
      throw new Error(
        `${unreached.length} row(s) were not reachable from a root, at line(s) ` +
          `${unreached.map((row) => row.line).join(', ')}. The validator refuses cycles, ` +
          'unresolved leaders and a root count other than two, so this means the validator ' +
          'and this walk disagree — a defect, not a bad file.',
      );
    }
  });

  return { batchId, encodedAt, created, reused };
}
