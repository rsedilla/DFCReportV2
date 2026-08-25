/**
 * Validate a leadership-tree CSV before the import consumes it
 * (SKILL.md section 2, How the tree import runs).
 *
 *   npm run validate:tree -- <path> [--redact] [--no-duplicates] [--json]
 *
 * **It needs no database, no Admin account, and no open initial-encoding phase.**
 * The import needs all three, and none of them helps an operator find out that
 * two rows lead each other. Everything decidable from the file is decidable here,
 * on the machine holding the file — which matters, because the real file must
 * never enter this repository.
 *
 * `--redact` prints line numbers, row_ids and finding codes with every name,
 * birthday and quoted value removed, so a report can be pasted into an issue or
 * shared with somebody helping. Without it the output names people, which is
 * correct for an operator's own terminal and wrong everywhere else.
 *
 * Exit codes: 0 clean (warnings allowed), 1 findings the import will refuse,
 * 2 the file could not be read or parsed far enough to judge.
 */

import { readFileSync } from 'node:fs';

import { type Finding, type TreeReport, validateTreeCsv } from '../src/admin/tree-import/tree-csv';

interface Args {
  path: string;
  redact: boolean;
  skipDuplicates: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args | string {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const positional = argv.filter((arg) => !arg.startsWith('--'));

  for (const flag of flags) {
    if (!['--redact', '--no-duplicates', '--json'].includes(flag)) {
      return `Unknown option ${flag}.`;
    }
  }
  if (positional.length === 0) return 'Give the path to the CSV file.';
  if (positional.length > 1) return 'Give exactly one path.';

  return {
    path: positional[0],
    redact: flags.has('--redact'),
    skipDuplicates: flags.has('--no-duplicates'),
    json: flags.has('--json'),
  };
}

const USAGE = `usage: npm run validate:tree -- <path-to-csv> [--redact] [--no-duplicates] [--json]

  --redact          omit names, birthdays and quoted values, so the report can be shared
  --no-duplicates   skip the within-file duplicate pass, which is quadratic
  --json            machine-readable findings`;

function describe(finding: Finding, redact: boolean): string {
  const where = finding.rowId
    ? `line ${finding.line} (row_id ${finding.rowId})`
    : `line ${finding.line}`;
  const related = finding.relatedLine === undefined ? '' : ` [also line ${finding.relatedLine}]`;
  const detail = finding.detail !== undefined && !redact ? `\n      ${finding.detail}` : '';
  return `  ${where}${related}\n      ${finding.message}${detail}`;
}

function report(result: TreeReport, redact: boolean): void {
  const errors = result.findings.filter((finding) => finding.severity === 'error');
  const warnings = result.findings.filter((finding) => finding.severity === 'warning');

  const byCode = (findings: Finding[]) => {
    const groups = new Map<string, Finding[]>();
    for (const finding of findings) {
      groups.set(finding.code, [...(groups.get(finding.code) ?? []), finding]);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  };

  const print = (label: string, findings: Finding[]) => {
    if (findings.length === 0) return;
    console.log(`\n${label}\n${'='.repeat(label.length)}`);
    for (const [code, group] of byCode(findings)) {
      console.log(`\n${code}  (${group.length})`);
      // A file exported with the wrong date format has one defect and several
      // thousand findings. Printing them all buries everything else, so each
      // code shows the first twenty and says how many it held back.
      for (const finding of group.slice(0, 20)) console.log(describe(finding, redact));
      if (group.length > 20) console.log(`  ... and ${group.length - 20} more`);
    }
  };

  print('ERRORS — the import will refuse these', errors);
  print('WARNINGS — look at these, the import will not stop for them', warnings);

  const { summary } = result;
  console.log('\nSUMMARY\n=======');
  console.log(`  rows                ${summary.rowCount}`);
  console.log(`  Men's / Women's     ${summary.mens} / ${summary.womens}`);
  console.log(
    `  roots               ${summary.rootLines.length}${
      summary.rootLines.length > 0 ? ` (line ${summary.rootLines.join(', line ')})` : ''
    }`,
  );
  console.log(`  deepest chain       ${summary.maxDepth ?? 'undefined while a cycle stands'}`);
  if (summary.widest.length > 0) {
    // A sanity check on the shape of the tree, never a ranking. SKILL.md section
    // 13 and section 17 forbid ordering leaders against one another in the
    // application; this is an operator counting rows in a file before it is
    // loaded, which is a different thing, and it is worth saying so here because
    // the two look alike.
    const widest = summary.widest
      .map((entry) => `row_id ${entry.rowId} has ${entry.directs}`)
      .join(', ');
    console.log(`  widest fan-out      ${widest}`);
  }
  console.log(`  duplicate pairs     Tier 1: ${summary.tier1Pairs}, Tier 2: ${summary.tier2Pairs}`);
  console.log(`\n  ${errors.length} error(s), ${warnings.length} warning(s)`);

  if (errors.length === 0) {
    console.log('\nNo structural errors. The dry run is what decides duplicates (section 2).');
  }
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    console.error(`${args}\n\n${USAGE}`);
    return 2;
  }

  let text: string;
  try {
    text = readFileSync(args.path, 'utf8');
  } catch (error) {
    console.error(`Could not read ${args.path}: ${(error as Error).message}`);
    return 2;
  }

  const result = validateTreeCsv(text, { skipDuplicates: args.skipDuplicates });

  if (args.json) {
    const findings = args.redact
      ? result.findings.map((finding) => {
          const rest = { ...finding };
          delete rest.detail;
          return rest;
        })
      : result.findings;
    console.log(JSON.stringify({ findings, summary: result.summary }, null, 2));
  } else {
    report(result, args.redact);
  }

  const fatal = result.findings.some(
    (finding) =>
      finding.severity === 'error' &&
      ['FILE_EMPTY', 'HEADER_MISMATCH', 'NO_ROWS'].includes(finding.code),
  );
  if (fatal) return 2;
  return result.findings.some((finding) => finding.severity === 'error') ? 1 : 0;
}

process.exitCode = main();
