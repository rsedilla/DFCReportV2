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
 * than restated at the top of every report method. Section 22 names five report routes and
 * one is built, so the next four are the reason.
 *
 * **Three revisions, each claiming more than it delivered**, which is why the enforcement
 * now has fixtures of its own:
 *
 * 1. The seam's docblock said a report "cannot" open its own transaction. Nothing stopped
 *    one: the seam is private, so the pool stayed in scope for every sibling method.
 * 2. This file replaced that with assertions about transactions and the pool — which only
 *    ever see a report that *opens* a transaction. `reporting` composes what the owning
 *    modules compute (decision 0206), so the idiomatic second report calls a figures
 *    service whose executor is optional, opens nothing, names no pool, and applies none of
 *    the three rules. It compiled clean and left every case green.
 * 3. The case added for that asked whether a method's source *text contained*
 *    `this.overPeriod(` — a substring check standing in for a call-path claim, in the file
 *    whose own rule is that a regular expression cannot tell a call from the same text in a
 *    comment. A mention in a comment, in a string, or in a closure that never runs all
 *    satisfied it.
 *
 * Each was found by `architecture-guardian`, the third by reproducing all three bypasses.
 * The fixtures below exist so the next such gap fails here instead of being demonstrated by
 * hand afterwards.
 *
 * **It parses, and a file it cannot parse fails rather than being skipped** — the rule
 * `web/scripts/check-screen-coverage.mjs` already follows for controllers.
 *
 * **What is still not reached.** Coming through `overPeriod` does not compel a callback to
 * *use* the transaction it is handed: `DccFiguresService.monthFigures` takes an optional
 * executor and falls back to the pool, so a report ignoring `trx` would read two snapshots
 * and lose decision 0210's identity — the defect that shipped once already, under two
 * docblocks claiming "by construction" over code that did not have it. Nothing here detects
 * that.
 */
describe('reporting: every report goes through the seam that owns the period rules', () => {
  const REPORTING_DIR = join(__dirname, '..', '..', 'src', 'reporting');

  /** The seam. Named once so a rename is one line rather than a hunt. */
  const SEAM = 'overPeriod';

  interface Parsed {
    file: string;
    source: ts.SourceFile;
  }

  /** A member callers can reach: a method, an accessor, or a function-valued field. */
  interface Member {
    klass: string;
    name: string;
    isPrivate: boolean;
    node: ts.Node;
  }

  /**
   * **A file that will not parse fails rather than being skipped.** `createSourceFile` is
   * permissive: it returns a tree with `parseDiagnostics` attached rather than throwing, so
   * a check that did not ask would walk a truncated tree and report a clean sweep over a
   * file it never read.
   *
   * **`parseDiagnostics` is internal**, reached through a cast, so a TypeScript that stopped
   * exposing it would leave this undefined. That is refused rather than treated as clean.
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

  const parse = (file: string, text: string): Parsed => {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    assertParsed(file, source);
    return { file, source };
  };

  /**
   * The module's own files. **Every analysis below takes its sources as an argument**, so
   * the identical code runs against the fixtures — which is what makes a failing branch
   * testable rather than only demonstrable by hand.
   */
  const moduleSources = (): Parsed[] => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          return walk(path);
        }
        return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
      });

    return walk(REPORTING_DIR).map((file) => parse(file, readFileSync(file, 'utf8')));
  };

  const decoratedWith = (node: ts.Node, name: string): boolean =>
    (ts.getDecorators(node as ts.HasDecorators) ?? []).some((decorator) =>
      decorator.getText().replace(/\s/g, '').startsWith(`@${name}(`),
    );

  /**
   * Every reachable member of every class that is **not** a `@Controller`.
   *
   * **Excluding controllers rather than including providers, which is the fail-closed
   * direction and was the other way round one revision ago.** Keying on `@Injectable(`
   * silently dropped any provider that decorator text did not match — and a class whose
   * constructor parameters all carry `@Inject(TOKEN)` resolves under Nest without
   * `@Injectable()` at all, which is exactly how the service takes its pool. A controller
   * is what legitimately delegates instead of reaching the database; everything else
   * answers for itself.
   *
   * **Fields and accessors count, not only methods.** A public surface written
   * `readonly cellsMonthly = async (p) => …` is a `PropertyDeclaration`, and collecting
   * only `MethodDeclaration` left it invisible while the guard-on-the-guard stayed
   * satisfied by the correct method beside it.
   */
  const membersOf = (sources: Parsed[]): Member[] => {
    const members: Member[] = [];

    for (const { source } of sources) {
      const visit = (node: ts.Node): void => {
        if (
          ts.isClassDeclaration(node) &&
          node.name !== undefined &&
          !decoratedWith(node, 'Controller')
        ) {
          for (const member of node.members) {
            const isFunctionField =
              ts.isPropertyDeclaration(member) &&
              member.initializer !== undefined &&
              (ts.isArrowFunction(member.initializer) ||
                ts.isFunctionExpression(member.initializer));

            const reachable =
              ts.isMethodDeclaration(member) ||
              ts.isGetAccessorDeclaration(member) ||
              ts.isSetAccessorDeclaration(member) ||
              isFunctionField;

            if (reachable && member.name !== undefined && ts.isIdentifier(member.name)) {
              members.push({
                klass: node.name.text,
                name: member.name.text,
                isPrivate: (ts.getModifiers(member) ?? []).some(
                  (m) => m.kind === ts.SyntaxKind.PrivateKeyword,
                ),
                node: member,
              });
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    return members;
  };

  /** The nearest enclosing function-like ancestor, which is what "runs inside" means. */
  const enclosingFunction = (node: ts.Node): ts.Node | undefined => {
    for (let current = node.parent; current; current = current.parent) {
      if (
        ts.isMethodDeclaration(current) ||
        ts.isFunctionDeclaration(current) ||
        ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current) ||
        ts.isGetAccessorDeclaration(current) ||
        ts.isSetAccessorDeclaration(current) ||
        ts.isPropertyDeclaration(current)
      ) {
        return current;
      }
    }
    return undefined;
  };

  /**
   * Whether a member calls the seam **on its own body**, as a call rather than as text.
   *
   * An AST predicate, which is the standard the sibling assertions already meet and the one
   * the substring check broke: a mention in a comment or a string is not a `CallExpression`,
   * and a call inside a nested closure has that closure as its enclosing function rather
   * than this member, so a seam call that never runs does not count.
   */
  const callsSeamDirectly = (member: Member): boolean => {
    let found = false;

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
        node.expression.name.text === SEAM &&
        enclosingFunction(node) === member.node
      ) {
        found = true;
      }
      ts.forEachChild(node, visit);
    };

    visit(member.node);
    return found;
  };

  /** Public members that do not reach the seam — the list that must always be empty. */
  const bypassing = (sources: Parsed[]): string[] =>
    membersOf(sources)
      .filter((member) => !member.isPrivate && member.name !== SEAM)
      .filter((member) => !callsSeamDirectly(member))
      .map((member) => `${member.klass}.${member.name}`);

  const nodesMatching = (sources: Parsed[], predicate: (node: ts.Node) => boolean): ts.Node[] => {
    const found: ts.Node[] = [];
    for (const { source } of sources) {
      const visit = (node: ts.Node): void => {
        if (predicate(node)) {
          found.push(node);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    return found;
  };

  /** The member a node sits in, by name, for reporting where a match was found. */
  const memberNameAt = (node: ts.Node): string => {
    for (let current: ts.Node | undefined = node; current; current = current.parent) {
      if (
        (ts.isMethodDeclaration(current) || ts.isPropertyDeclaration(current)) &&
        current.name !== undefined
      ) {
        return current.name.getText();
      }
    }
    return '<top level>';
  };

  describe('the parse guard, which was itself a claim nothing could fail on', () => {
    it('refuses a file it cannot parse rather than walking a truncated tree', () => {
      const broken = ts.createSourceFile(
        'broken.ts',
        'class Nope { constructor( }',
        ts.ScriptTarget.Latest,
        true,
      );

      expect(() => assertParsed('broken.ts', broken)).toThrow(/did not parse cleanly/);
    });

    it('accepts a file that parses', () => {
      const fine = ts.createSourceFile(
        'fine.ts',
        'export const a = 1;',
        ts.ScriptTarget.Latest,
        true,
      );

      expect(() => assertParsed('fine.ts', fine)).not.toThrow();
    });
  });

  /**
   * **The fixtures, and why they exist.** Every assertion over the real module is green by
   * construction — `dccMonthly` is correct — so the branch that names a bypass had never
   * run, and three successive versions of it were each wrong in a way only a hand-written
   * demonstration exposed. These run the identical analysis over sources that are wrong on
   * purpose, so the next such gap fails here.
   */
  describe('the bypass detector, run against sources that are wrong on purpose', () => {
    const provider = (body: string): Parsed[] => [
      parse('fixture.ts', `@Injectable()\nexport class Fixture {\n${body}\n}\n`),
    ];

    it('names a report that never mentions the seam', () => {
      expect(
        bypassing(provider(`  async cellsMonthly(p: string) { return this.figures.f(p); }`)),
      ).toEqual(['Fixture.cellsMonthly']);
    });

    it('names one that mentions the seam only in a comment', () => {
      expect(
        bypassing(
          provider(
            `  // TODO: route through this.overPeriod( ) like dccMonthly does.\n` +
              `  async cellsMonthly(p: string) { return this.figures.f(p); }`,
          ),
        ),
      ).toEqual(['Fixture.cellsMonthly']);
    });

    it('names one that mentions the seam only in a string', () => {
      expect(
        bypassing(
          provider(
            `  async cellsMonthly(p: string) { this.log.debug('this.overPeriod('); return this.figures.f(p); }`,
          ),
        ),
      ).toEqual(['Fixture.cellsMonthly']);
    });

    it('names one whose seam call sits in a closure that never runs', () => {
      expect(
        bypassing(
          provider(
            `  async cellsMonthly(p: string) {\n` +
              `    const never = async () => this.overPeriod(p, async () => 0);\n` +
              `    return this.figures.f(p);\n` +
              `  }`,
          ),
        ),
      ).toEqual(['Fixture.cellsMonthly']);
    });

    it('names a function-valued field, not only a method', () => {
      expect(
        bypassing(provider(`  readonly cellsMonthly = async (p: string) => this.figures.f(p);`)),
      ).toEqual(['Fixture.cellsMonthly']);
    });

    it('names a getter', () => {
      expect(bypassing(provider(`  get latest() { return this.figures.f('x'); }`))).toEqual([
        'Fixture.latest',
      ]);
    });

    it('sees a provider carrying no @Injectable decorator at all', () => {
      const sources = [
        parse(
          'fixture.ts',
          `export class Fixture {\n  async cellsMonthly(p: string) { return this.figures.f(p); }\n}\n`,
        ),
      ];

      expect(bypassing(sources)).toEqual(['Fixture.cellsMonthly']);
    });

    it('does not name a controller, which delegates rather than reaching the database', () => {
      const sources = [
        parse(
          'fixture.ts',
          `@Controller('reports')\nexport class Fixture {\n` +
            `  async cellsMonthly(p: string) { return this.reporting.cellsMonthly(p); }\n}\n`,
        ),
      ];

      expect(bypassing(sources)).toEqual([]);
    });

    it('does not name a method that genuinely calls the seam', () => {
      expect(
        bypassing(
          provider(`  async cellsMonthly(p: string) { return this.overPeriod(p, async () => 0); }`),
        ),
      ).toEqual([]);
    });

    it('does not name a private helper', () => {
      expect(
        bypassing(provider(`  private async helper(p: string) { return this.figures.f(p); }`)),
      ).toEqual([]);
    });
  });

  describe('the module itself', () => {
    it('parses every file, so its claim covers all of them', () => {
      const sources = moduleSources();

      // A guard on the guard: were the directory to move, `walk` would return nothing and
      // every assertion below would pass over an empty set.
      expect(sources.length).toBeGreaterThan(0);
      expect(sources.map(({ file }) => file)).toEqual(
        expect.arrayContaining([expect.stringContaining('reporting.service.ts')]),
      );
    });

    /**
     * **The load-bearing one.** A report that does not come through the seam applies none of
     * the three period rules, and nothing else would say so: not a type, not a route test,
     * and not the transaction assertions below, which see only a report that opens one.
     */
    it('routes every public member of every non-controller class through the seam', () => {
      const sources = moduleSources();
      const publicMembers = membersOf(sources).filter(
        (member) => !member.isPrivate && member.name !== SEAM,
      );

      expect(publicMembers.length).toBeGreaterThan(0);
      expect(bypassing(sources)).toEqual([]);
    });

    it('keeps the seam private, so it is entered rather than offered', () => {
      const seam = membersOf(moduleSources()).filter((member) => member.name === SEAM);

      expect(seam).toHaveLength(1);
      expect(seam[0].isPrivate).toBe(true);
    });

    it('opens exactly one transaction, inside the seam', () => {
      const openings = nodesMatching(
        moduleSources(),
        (node) =>
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'transaction',
      );

      expect(openings).toHaveLength(1);
      expect(memberNameAt(openings[0])).toBe(SEAM);
    });

    /**
     * The pool is the other way to read outside the transaction. Section 20's identity is a
     * property of one snapshot, so a figure taken beside the transaction describes another.
     *
     * **Every injected pool property is swept, not the first one found**, and the names are
     * derived from `@Inject(DATABASE)` rather than written here — a hard-coded `db` would
     * miss a pool injected as `database`, and taking only the first would miss a second
     * provider's.
     */
    it('touches the connection pool only inside the seam', () => {
      const sources = moduleSources();

      const poolNames = new Set(
        nodesMatching(
          sources,
          (node) =>
            ts.isParameter(node) &&
            ts.isIdentifier(node.name) &&
            decoratedWith(node, 'Inject') &&
            node.getText().includes('DATABASE'),
        ).map((node) => ((node as ts.ParameterDeclaration).name as ts.Identifier).text),
      );

      expect(poolNames.size).toBeGreaterThan(0);

      const poolReads = nodesMatching(
        sources,
        (node) =>
          ts.isPropertyAccessExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ThisKeyword &&
          poolNames.has(node.name.text),
      );

      expect(poolReads.length).toBeGreaterThan(0);
      for (const read of poolReads) {
        expect(memberNameAt(read)).toBe(SEAM);
      }
    });

    /** The three rules are in the seam rather than merely near it. */
    it('applies all three period rules inside the seam', () => {
      const sources = moduleSources();

      const callsInSeam = (callee: string): ts.Node[] =>
        nodesMatching(
          sources,
          (node) =>
            ts.isCallExpression(node) &&
            node.expression.getText().endsWith(callee) &&
            memberNameAt(node) === SEAM,
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
});
