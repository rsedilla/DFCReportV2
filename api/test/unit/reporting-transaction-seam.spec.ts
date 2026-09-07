import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as ts from 'typescript';

/**
 * Every report comes through one seam (SKILL.md sections 20 and 22, decisions 0185, 0210
 * and 0216).
 *
 * **This exists because the claim it checks was written before anything could fail on it.**
 * `ReportingService.overPeriod` was extracted so that the three rules a report owes its
 * period — the month's shape (decision 0185), a period that has begun (decision 0216), and
 * one `READ ONLY REPEATABLE READ` transaction (decision 0210) — are applied once rather
 * than restated at the top of every report method. Its docblock then said a report "cannot
 * open its transaction without coming through here", and `architecture-guardian` refuted
 * the word *cannot*: `this.db` was in scope for every method of the class, a second
 * provider in the module could not reach a private method at all, and nothing anywhere
 * reddened for either. That is a conformance claim with nothing that can fail, written into
 * the fix for a rule that had shipped with nothing that can fail.
 *
 * Section 22 names five report routes and one is built, so the next four are the reason.
 *
 * **It parses rather than greps.** A regular expression cannot make the completeness claim
 * this is for: it cannot tell `this.db.transaction()` from the same text in a comment or a
 * string, and a check that quietly skips what it cannot read would assert a completeness it
 * never had. The TypeScript parser reads the files, and a file it cannot parse fails the
 * test rather than being passed over — which is the rule `web/scripts/check-screen-coverage.mjs`
 * already follows for controllers.
 *
 * **What it does not reach, stated so the next reader does not over-read it.** Coming
 * through `overPeriod` does not compel a callback to *use* the transaction it is handed.
 * `DccFiguresService.monthFigures` takes an optional executor and falls back to the pool
 * (`dcc-figures.service.ts`), so a report that ignored `trx` would read two snapshots and
 * break decision 0210's identity — which is the defect that shipped once already, with two
 * docblocks claiming "by construction" over code that did not have it. What is enforced
 * below is that `reporting` opens exactly one transaction and touches the pool in exactly
 * one place; that a callback then uses what it is given is not.
 */
describe('reporting opens one transaction, in the seam that owns the period rules', () => {
  const REPORTING_DIR = join(__dirname, '..', '..', 'src', 'reporting');

  /** The seam. Named once here so a rename is a one-line change rather than a hunt. */
  const SEAM = 'overPeriod';

  interface Reference {
    file: string;
    /** The method the reference sits inside, or `<top level>`. */
    method: string;
    text: string;
  }

  const sourceFiles = (): { file: string; source: ts.SourceFile }[] => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          return walk(path);
        }
        return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
      });

    return walk(REPORTING_DIR).map((file) => {
      const text = readFileSync(file, 'utf8');
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

      // **A file that will not parse fails rather than being skipped.** `createSourceFile`
      // is permissive and returns a tree with `parseDiagnostics` attached rather than
      // throwing, so this has to be asked for explicitly.
      const diagnostics = (source as unknown as { parseDiagnostics?: ts.Diagnostic[] })
        .parseDiagnostics;
      if (diagnostics !== undefined && diagnostics.length > 0) {
        throw new Error(
          `${file} did not parse cleanly, so this check cannot claim to have read it: ` +
            ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' '),
        );
      }

      return { file, source };
    });
  };

  /** The method a node sits inside, by walking up to the nearest named member. */
  const enclosingMethod = (node: ts.Node): string => {
    for (let current: ts.Node | undefined = node; current; current = current.parent) {
      if (ts.isMethodDeclaration(current) || ts.isFunctionDeclaration(current)) {
        return current.name?.getText() ?? '<anonymous>';
      }
    }
    return '<top level>';
  };

  const referencesMatching = (predicate: (node: ts.Node) => boolean): Reference[] => {
    const found: Reference[] = [];

    for (const { file, source } of sourceFiles()) {
      const visit = (node: ts.Node): void => {
        if (predicate(node)) {
          found.push({
            file: file.slice(file.lastIndexOf('src')),
            method: enclosingMethod(node),
            text: node.getText().split('\n')[0].trim(),
          });
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    return found;
  };

  it('parses every file in the module, so its claim covers all of them', () => {
    const files = sourceFiles();

    // A guard on the guard: were the directory to move, `walk` would return nothing and
    // every assertion below would pass over an empty set.
    expect(files.length).toBeGreaterThan(0);
    expect(files.map(({ file }) => file)).toEqual(
      expect.arrayContaining([expect.stringContaining('reporting.service.ts')]),
    );
  });

  /**
   * **The load-bearing one.** A second report route that opens its own transaction gets all
   * three rules wrong at once and silently: no type refuses it, and every existing test
   * still passes because they exercise the route that does it correctly.
   */
  it('opens exactly one transaction, inside the seam', () => {
    const openings = referencesMatching(
      (node) =>
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'transaction',
    );

    expect(openings).toHaveLength(1);
    expect(openings[0].method).toBe(SEAM);
  });

  /**
   * The pool, which is the other way to read outside the transaction. `this.db` in a report
   * method is a read on a pooled connection: section 20's identity is a property of one
   * snapshot, and a figure taken beside the transaction rather than inside it describes a
   * different one.
   */
  it('touches the connection pool only inside the seam', () => {
    const poolReads = referencesMatching(
      (node) =>
        ts.isPropertyAccessExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ThisKeyword &&
        node.name.text === 'db',
    );

    expect(poolReads.length).toBeGreaterThan(0);
    for (const read of poolReads) {
      expect(read.method).toBe(SEAM);
    }
  });

  /**
   * The three rules are in the seam rather than merely near it. Without this, moving any of
   * them back into a report method leaves both assertions above green.
   */
  it('applies all three period rules inside the seam', () => {
    const callsInSeam = (callee: string): Reference[] =>
      referencesMatching(
        (node) =>
          ts.isCallExpression(node) &&
          node.expression.getText().endsWith(callee) &&
          enclosingMethod(node) === SEAM,
      );

    // Decision 0185: the shape, refused before anything is derived from the month.
    expect(callsInSeam('assertReportingMonth')).toHaveLength(1);
    // Decision 0216: a period that has not begun.
    expect(callsInSeam('assertReportingPeriodHasBegun')).toHaveLength(1);
    // Decision 0210: one READ ONLY REPEATABLE READ transaction. Both halves, because
    // either alone is a different guarantee.
    expect(callsInSeam('setIsolationLevel')).toHaveLength(1);
    expect(callsInSeam('setAccessMode')).toHaveLength(1);
  });
});
