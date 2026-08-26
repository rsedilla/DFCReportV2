/**
 * Imports the leadership-tree spine (SKILL.md section 2, How the tree import runs).
 *
 *   npm run import:tree -- --file tree.csv --actor admin@example.com --dry-run
 *   npm run import:tree -- --file tree.csv --actor admin@example.com \
 *                          --decisions decisions.csv --commit
 *
 * **Why this is a script and not an endpoint.** Section 22 makes a write endpoint
 * record its idempotency completion inside the transaction that performs the
 * write, so a bulk import over HTTP is a transaction of minutes holding one of the
 * ten connections section 24 bounds — the liveness hazard that section names. A
 * script calling the domain services in process satisfies section 2's "never as
 * direct database writes" and answers to no request timeout.
 *
 * The writing is in `src/admin/tree-import/`, because a script cannot be tested and
 * section 2 carries rules that would otherwise have nothing able to fail on them.
 * This file parses arguments, reads files, and prints.
 *
 * **It runs under `ts-node`, not `tsx`, for the reason `bootstrap-admin.ts`
 * records at length**: `tsx` compiles with esbuild, which does not implement
 * `emitDecoratorMetadata`, so Nest sees zero constructor parameters and injects
 * nothing. The failure is silent at build time and arrives from inside a service.
 * Every service this reaches has injected dependencies it dereferences, so the
 * failure here would be immediate rather than lucky.
 *
 * **The two phases are separate invocations, deliberately.** A `--dry-run` that
 * flowed into a commit on success would defeat the point of the phase: section 3
 * requires a *person* to decide a Tier 1 candidate, and the gap between the two
 * runs is where that person does it.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { NestFactory } from '@nestjs/core';
import 'dotenv/config';

import { AppModule } from '../src/app.module';
import {
  commitTreeImport,
  dryRunTreeImport,
  TreeImportRefused,
} from '../src/admin/tree-import/tree-import';
import { SettingsService } from '../src/admin/settings/settings.service';
import { AuthorizationService } from '../src/auth/authorization/authorization.service';
import { AccountsRepository } from '../src/auth/accounts.repository';
import { DATABASE, type Db } from '../src/database/database.module';
import { PeopleDuplicatesService } from '../src/people/people.duplicates.service';
import { PeopleImportService } from '../src/people/people.import.service';

import type { DryRunReport, ImportModules } from '../src/admin/tree-import/tree-import';
import type { Actor } from '../src/auth/authorization/authorization.service';
import type { Finding } from '../src/admin/tree-import/tree-csv';

const USAGE = `usage:
  npm run import:tree -- --file <tree.csv> --actor <email> --dry-run [--out <decisions.csv>] [--redact]
  npm run import:tree -- --file <tree.csv> --actor <email> --decisions <decisions.csv> --commit

The dry run writes nothing and may be run as often as needed. It validates the
file, matches every row against the Persons already recorded, and emits a
decisions template naming only the rows that matched something.

A person adjudicates that file — section 3 requires one for a Tier 1 candidate,
and silence is not acknowledgement — and the commit applies it, in one
transaction, refusing unless the fingerprint still matches the tree file.

  --redact  drop the one field that carries personal data, so the report can be
            shared. This repository is public and the church holds records for
            minors.`;

interface Options {
  file: string;
  actorEmail: string;
  mode: 'dry-run' | 'commit';
  decisions: string | null;
  out: string | null;
  redact: boolean;
}

function parseArgs(argv: string[]): Options | string {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) return `Unexpected argument ${arg}.`;
    const name = arg.slice(2);

    if (name === 'dry-run' || name === 'commit' || name === 'redact') {
      flags.add(name);
      continue;
    }

    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) return `${arg} needs a value.`;
    values.set(name, next);
    i += 1;
  }

  for (const key of values.keys()) {
    if (!['file', 'actor', 'decisions', 'out'].includes(key)) return `Unknown option --${key}.`;
  }

  const file = values.get('file')?.trim();
  if (!file) return '--file is required.';

  const actorEmail = values.get('actor')?.trim();
  if (!actorEmail) return '--actor is required: the Admin account the records are attributed to.';

  if (flags.has('dry-run') === flags.has('commit')) {
    return 'Give exactly one of --dry-run and --commit.';
  }

  const mode = flags.has('commit') ? 'commit' : 'dry-run';
  const decisions = values.get('decisions')?.trim() ?? null;

  if (mode === 'commit' && decisions === null) {
    return '--commit needs --decisions <file>: the adjudicated template from the dry run.';
  }

  if (mode === 'dry-run' && decisions !== null) {
    // Refused rather than ignored. A dry run given a decisions file reads as
    // though it were checking it, and it is not.
    return '--decisions belongs to --commit. A dry run has nothing to apply it to.';
  }

  return {
    file,
    actorEmail,
    mode,
    decisions,
    out: values.get('out')?.trim() ?? null,
    redact: flags.has('redact'),
  };
}

/**
 * Section 2 names the actor on the command line so the audit entries name an
 * account that could legitimately have done the work.
 *
 * By email rather than by account identifier, because that is what an operator
 * knows. The capability check is `tree-import.ts`'s and happens against the
 * resolved account; this only turns an address into one.
 */
async function resolveActor(accounts: AccountsRepository, email: string): Promise<Actor | string> {
  const account = await accounts.findByEmail(email);
  if (!account) {
    return `No account is registered to ${email}.`;
  }

  return { accountId: account.id, personId: account.person_id };
}

function printFindings(findings: readonly Finding<string>[], redact: boolean): void {
  for (const finding of findings) {
    const where = finding.rowId === undefined ? '' : `  row ${finding.rowId}`;
    const related = finding.relatedLine === undefined ? '' : `  (see line ${finding.relatedLine})`;
    // `detail` is the only field permitted to carry a name or a quoted value,
    // which is the promise that makes `--redact` a matter of dropping one field
    // rather than of rewriting messages.
    const detail = finding.detail === undefined || redact ? '' : `  ${finding.detail}`;
    console.error(
      `  ${finding.severity.toUpperCase().padEnd(7)} ${finding.code.padEnd(28)} line ${String(finding.line).padStart(4)}${where}${related}${detail}`,
    );
    console.error(`          ${finding.message}`);
  }
}

function printDryRun(report: DryRunReport, redact: boolean): void {
  const { summary } = report.tree;

  console.log(`
Dry run — nothing was written.

  Rows            ${summary.rowCount}
  Roots           ${summary.rootLines.length} (lines ${summary.rootLines.join(', ') || 'none'})
  Men's / Women's ${summary.mens} / ${summary.womens}
  Max depth       ${summary.maxDepth ?? 'undefined (cycles or unresolved leaders)'}
  Fingerprint     ${report.fingerprint ?? 'not taken — the file was refused'}
`);

  if (report.preconditions.length > 0) {
    console.error('Preconditions the commit will refuse on:');
    printFindings(report.preconditions, redact);
    console.error('');
  }

  const errors = report.tree.findings.filter((finding) => finding.severity === 'error');
  const warnings = report.tree.findings.filter((finding) => finding.severity === 'warning');

  if (errors.length > 0) {
    console.error(`${errors.length} error(s) — the commit will refuse this file:`);
    printFindings(errors, redact);
    console.error('');
  }

  if (warnings.length > 0) {
    console.error(`${warnings.length} warning(s) — worth reading, none of them refuse the file:`);
    printFindings(warnings, redact);
    console.error('');
  }

  if (report.matched.length === 0) {
    console.log('No row matched a Person who already exists, so there is nothing to adjudicate.');
    return;
  }

  console.log(`${report.matched.length} row(s) matched an existing Person:\n`);
  for (const row of report.matched) {
    const subject = redact ? '(redacted)' : row.subjectName;
    console.log(`  line ${row.line}  row ${row.rowId}  Tier ${row.tier}  ${subject}`);
    for (const candidate of row.candidates) {
      const who = redact ? '(redacted)' : `${candidate.memberId}  ${candidate.fullName}`;
      console.log(`      Tier ${candidate.tier}  ${who}`);
      console.log(`               ${redact ? '(redacted)' : candidate.reasons.join('; ')}`);
    }
  }

  console.log(`
${report.tier1RowIds.size} of them carry a Tier 1 candidate and must be answered explicitly —
section 3 requires a person to acknowledge one before a Person is created, and
silence is not acknowledgement. A row with only Tier 2 candidates may be left
blank, which means create.`);
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (typeof options === 'string') {
    console.error(`${options}\n\n${USAGE}`);
    return 2;
  }

  const treeCsv = readFileSync(options.file, 'utf8');
  const decisionsCsv = options.decisions === null ? null : readFileSync(options.decisions, 'utf8');

  // The whole application, so configuration is validated exactly as it is at
  // startup and the services are the deployed ones. `logger: false` is wrong here:
  // Nest reports a failure to build the context through its own logger and then
  // exits, so silencing it turns a missing `JWT_SECRET` into an exit code with no
  // output at all, before any `catch` in this file can run.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const actor = await resolveActor(app.get(AccountsRepository), options.actorEmail);
    if (typeof actor === 'string') {
      console.error(`\n${actor}\n`);
      return 1;
    }

    const modules: ImportModules = {
      db: app.get<Db>(DATABASE),
      people: app.get(PeopleImportService),
      duplicates: app.get(PeopleDuplicatesService),
      settings: app.get(SettingsService),
      authorization: app.get(AuthorizationService),
    };

    if (options.mode === 'dry-run') {
      const report = await dryRunTreeImport(modules, { treeCsv, actor });
      printDryRun(report, options.redact);

      if (report.decisionsTemplate !== null && options.out !== null) {
        writeFileSync(options.out, report.decisionsTemplate, 'utf8');
        console.log(`\nDecisions template written to ${options.out}.`);
      } else if (report.decisionsTemplate !== null && report.matched.length > 0) {
        console.log('\nPass --out <file> to write the decisions template.');
      }

      // A dry run that found errors exits non-zero even though it wrote nothing,
      // so a shell script or a CI step cannot mistake a refused file for a clean
      // one.
      const refused =
        report.preconditions.length > 0 ||
        report.tree.findings.some((finding) => finding.severity === 'error');
      return refused ? 1 : 0;
    }

    const result = await commitTreeImport(modules, {
      treeCsv,
      decisionsCsv: decisionsCsv!,
      actor,
    });

    console.log(`
Imported the leadership-tree spine.

  Batch      ${result.batchId}
  Effective  ${result.encodedAt.toISOString()}
  Created    ${result.created.length} Person(s)
  Reused     ${result.reused.length} existing Person(s)

Every record carries its own audit entry, linked by the batch identifier
(section 2).

Where the section 5 invariants were enforced, since "all of them were" would be
an overclaim: invariant 5 (same-Network) and invariant 3 (one active assignment)
by the domain layer on every row and by the database besides; invariant 1 by the
Whole Church precondition on the actor; invariant 2 (no cycles) by the file
validator over the CSV graph, before any of this ran; and invariant 4 by
requiring the actor to hold ADMIN, which is the role it exempts, rather than by
being evaluated per row.

Next: read the two root Person identifiers out of the database, set
SENIOR_PASTOR_PERSON_IDS to them, and restart. The value is read once when the
process starts (section 7), so until that is done no SENIOR_PASTOR account can
be provisioned and any such role row grants nothing.
`);

    if (options.redact) {
      return 0;
    }

    for (const row of result.created) {
      console.log(`  created   row ${row.rowId.padEnd(6)} ${row.memberId}  ${row.fullName}`);
    }
    for (const row of result.reused) {
      console.log(`  reused    row ${row.rowId.padEnd(6)} ${row.memberId}  ${row.fullName}`);
    }

    return 0;
  } catch (error) {
    if (error instanceof TreeImportRefused) {
      console.error(`\n${error.message}\n`);
      printFindings(error.findings, options.redact);
      console.error('\nNothing was written.\n');
      return 1;
    }
    throw error;
  } finally {
    await app.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
