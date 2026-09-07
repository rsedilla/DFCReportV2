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
 * **The first version of this file checked the wrong thing**, and that is worth stating
 * because the mistake is easy to repeat. It asserted one transaction opening and one pool
 * reference — which only ever sees a report that *opens a transaction*. The idiomatic
 * second report method opens none: `reporting` composes what the owning modules compute
 * (decision 0206), so it calls a figures service whose executor is optional, applies none
 * of the three rules, and left every case green. The claim that binds is therefore about
 * the module's **public surface**, not about transactions, and that is the case below.
 *
 * **What it still does not reach.** Coming through `overPeriod` does not compel a callback
 * to *use* the transaction it is handed. `DccFiguresService.monthFigures` takes an optional
 * executor and falls back to the pool (`dcc-figures.service.ts`), so a report that ignored
 * `trx` would read two snapshots and break decision 0210's identity — the defect that
 * shipped once already, with two docblocks claiming "by construction" over code that did
 * not have it. Nothing here detects that.
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

      assertParsed(file, source);

      return { file, source };
    });
  };

  /**
   * **A file that will not parse fails rather than being skipped.** `createSourceFile` is
   * permissive: it returns a tree with `parseDiagnostics` attached rather than throwing, so
   * this has to be asked for explicitly, and a check that quietly walked a truncated tree
   * would report a clean sweep over a file it never read.
   *
   * **`parseDiagnostics` is an internal property**, reached through a cast, so a TypeScript
   * that stopped exposing it would leave `diagnostics` undefined and degrade this to a
   * silent pass. That is why it is a named function with its own case below rather than
   * four lines inside a `map` — the case fails the day the property goes away, which is the
   * standard this whole file invokes.
   */
  const assertParsed = (file: string, source: ts.SourceFile): void => {
    const diagnostics = (source as unknown as { parseDiagnostics?: ts.Diagnostic[] })
      .parseDiagnostics;

    if (diagnostics === undefined) {
      throw new Error(
        'TypeScript no longer exposes `parseDiagnostics` on a SourceFile, so this check ' +
          'cannot tell a parsed file from an unparsed one. Find the replacement rather ' +
          'than removing the guard.',
      );
    }

    if (diagnostics.length > 0) {
      throw new Error(
        `${file} did not parse cleanly, so this check cannot claim to have read it: ` +
          ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' '),
      );
    }
  };

  /**
   * The name of the property carrying the connection pool, read off the `@Inject(DATABASE)`
   * constructor parameter rather than assumed.
   */
  const injectedPoolName = (): string => {
    for (const { source } of sourceFiles()) {
      let found: string | undefined;
      const visit = (node: ts.Node): void => {
        if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
          const decorators = ts.getDecorators(node) ?? [];
          const injectsDatabase = decorators.some((decorator) =>
            decorator.getText().replace(/\s/g, '').startsWith('@Inject(DATABASE)'),
          );
          if (injectsDatabase) {
            found = node.name.text;
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      if (found !== undefined) {
        return found;
      }
    }

    throw new Error(
      'No @Inject(DATABASE) parameter found in src/reporting, so this check cannot say ' +
        'which property is the pool. If the pool is now obtained another way, this file ' +
        'is what has to say so.',
    );
  };

  /**
   * Every method declared on an `@Injectable()` class in the module.
   *
   * **Providers rather than every class, and the discriminator is parsed rather than a name
   * list.** A `@Controller()` delegates and holds no pool, so its public methods route
   * through a service and not through the seam; sweeping them made the first version of the
   * case below fail on correct code. A provider is what can reach the database.
   */
  const providerMethods = (): {
    klass: string;
    name: string;
    isPrivate: boolean;
    body: string;
  }[] => {
    const methods: { klass: string; name: string; isPrivate: boolean; body: string }[] = [];

    for (const { source } of sourceFiles()) {
      const visit = (node: ts.Node): void => {
        if (ts.isClassDeclaration(node) && node.name !== undefined) {
          const isProvider = (ts.getDecorators(node) ?? []).some((decorator) =>
            decorator.getText().replace(/\s/g, '').startsWith('@Injectable('),
          );

          if (isProvider) {
            for (const member of node.members) {
              if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
                const modifiers = ts.getModifiers(member) ?? [];
                methods.push({
                  klass: node.name.text,
                  name: member.name.text,
                  isPrivate: modifiers.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword),
                  body: member.body?.getText() ?? '',
                });
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    return methods;
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

  /**
   * The parse guard itself, which was a claim with nothing that could fail: every file in
   * the module parses, so the branch that refuses an unparsable one never ran.
   */
  it('refuses a file it cannot parse, rather than walking a truncated tree', () => {
    const broken = ts.createSourceFile(
      'broken.ts',
      'class Nope { constructor( }',
      ts.ScriptTarget.Latest,
      true,
    );

    expect(() => assertParsed('broken.ts', broken)).toThrow(/did not parse cleanly/);

    const fine = ts.createSourceFile(
      'fine.ts',
      'export const a = 1;',
      ts.ScriptTarget.Latest,
      true,
    );
    expect(() => assertParsed('fine.ts', fine)).not.toThrow();
  });

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
    // **The property name is derived, not written here.** Keying on `db` would let a pool
    // injected as `private readonly database: Db` be read anywhere in the module without
    // this case noticing -- a hard-coded name is the shape this whole file exists to avoid.
    const pool = injectedPoolName();

    const poolReads = referencesMatching(
      (node) =>
        ts.isPropertyAccessExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ThisKeyword &&
        node.name.text === pool,
    );

    expect(poolReads.length).toBeGreaterThan(0);
    for (const read of poolReads) {
      expect(read.method).toBe(SEAM);
    }
  });

  /**
   * **The bypass the two assertions above cannot see**, and the reason they were not enough.
   *
   * `reporting` roots no query of its own and composes what the owning modules compute
   * (decision 0206), so the *idiomatic* second report method opens no transaction and names
   * no pool:
   *
   * ```ts
   * async cellsMonthly(period: string) {
   *   const figures = await this.cellFigures.monthFigures(period);   // executor defaults
   *   ...
   * }
   * ```
   *
   * That applies none of the three period rules, compiles clean, and left all the cases
   * above green — `architecture-guardian` demonstrated it by running them against exactly
   * such a method. Three of section 22's four remaining report routes will be written this
   * way, so it is the likely shape rather than a contrived one.
   *
   * So the enforceable claim is not about transactions at all: **every public method of
   * every provider in this module routes through the seam.** Providers, because a
   * `@Controller()` delegates and holds no pool; the discriminator is the class decorator,
   * parsed rather than a name list.
   *
   * Two consequences worth stating rather than discovering. A provider's public method that
   * is *not* a report reddens this — none is anticipated, since this module's public surface
   * is reports, and one that is genuinely needed is a decision to record rather than a case
   * to widen quietly. And a **second provider** reddens it too, because the seam is private
   * to the class that declares it: that is the right pressure rather than an obstacle, since
   * the answer is to make the seam reachable to both, not to let the second one open its own
   * transaction.
   */
  it('routes every public method of every provider through the seam', () => {
    const methods = providerMethods();
    const publicMethods = methods.filter((method) => !method.isPrivate && method.name !== SEAM);

    // The seam itself must be private: public, it is a way to open a transaction that
    // takes no responsibility for what the callback does with it.
    expect(methods.find((method) => method.name === SEAM)?.isPrivate).toBe(true);

    // A guard on the guard, as above: were the parse to find nothing, this would pass vacuously.
    expect(publicMethods.length).toBeGreaterThan(0);

    const bypassing = publicMethods
      .filter((method) => !method.body.includes(`this.${SEAM}(`))
      .map((method) => `${method.klass}.${method.name}`);

    expect(bypassing).toEqual([]);
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
