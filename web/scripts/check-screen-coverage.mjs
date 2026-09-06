/**
 * Every API route reaches a screen, or carries a waiver that says which stage
 * owes it one.
 *
 * Two completed stages shipped no interface. Stage 3 delivered Cells, Stage 4
 * delivered attendance, and `web/app` reaches neither — ten screens, all of them
 * authentication, the home page, or People, against thirty-five routes. Nothing
 * recorded that as owed, and the `CLAUDE.md` clause requiring it to be recorded
 * is prose (ruling of 2026-09-06). This is what makes the per-route half fail.
 *
 * **The route list is derived, never declared**, which is Section 20's argument
 * against enumerating a figure's invalidators — a hand-maintained list is a list
 * somebody eventually forgets to extend — and the Section 22 storability check
 * is the instance that has already paid for it, having derived its own field
 * list and found one nobody would have listed.
 *
 * **It parses TypeScript rather than scanning text, and that is the whole of why
 * the derivation can be trusted.** Two regular-expression versions preceded this
 * one and `architecture-guardian` broke both. The first *skipped* what it could
 * not read: seven shapes each dropped a real route and still exited 0. The
 * second refused what it could not read and was broken by a subtler class —
 * text it read **wrongly while believing it had read it**. An ordinary string
 * containing `/*`, such as a cache key `'reports/*'`, opened a comment that
 * swallowed the routes below it; a base class in another file carried routes
 * belonging to a controller that extended it; a second `@Controller` in one file
 * gave its routes the first one's base path. No quantity of added refusals
 * reaches that class, because a scanner has no way to notice.
 *
 * `typescript` is already a `web` devDependency, so the compiler's own parser
 * costs nothing new. It is syntax-only — `createSourceFile`, no program and no
 * type checker — so a string is a string, a comment is a comment, and a
 * decorator is a decorator, decided by the same code that compiles the API.
 *
 * **What it still cannot resolve, it refuses**, and those are now real
 * unknowables rather than gaps in a regex: a path that is not a literal, a
 * `@Controller` on a class this check cannot place, routing decorators on a
 * class with no `@Controller` (the inheritance shape), `RequestMapping`, a
 * global prefix or versioning call it cannot read, and a duplicate route.
 *
 * **It fails in both directions.** A route the ledger does not mention is one
 * half. A ledger entry naming no route is the other — the route was renamed or
 * removed and the ledger still claims to cover it — and a ledger allowed to
 * drift stops being evidence of anything.
 *
 * **A waiver is permitted and is not a defeat.** Shipping API-only is what the
 * API-first constraint asks for (`SKILL.md` §2), and twenty-one waivers is what
 * this repository owes today. What a waiver may not be is silent: it names the
 * stage that owes the screen, **and the stage must be one the ledger declares**.
 * Without that the requirement was decorative — an earlier version tested only
 * that the string was non-empty, so `"waived_to": "banana"` passed while
 * `CLAUDE.md` and decision 0213 described the naming as enforced.
 *
 * **A route may also owe no screen at all**, which is a third state rather than
 * a waiver with a distant stage on it. The liveness probe is called by the
 * deployment platform and never by a person, and waiving it to a stage would be
 * a claim nobody intends to honour — a ledger full of those is how the whole
 * file becomes a rubber stamp.
 *
 * **A named screen must be a file inside `web/`.** Existence alone was not
 * enough: a directory, `.` and `../..` all satisfied it, so a coverage claim
 * could be backed by the repository root.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import tsModule from 'typescript';

const ts = tsModule.default ?? tsModule;

const WEB = fileURLToPath(new URL('..', import.meta.url));
const REPO = path.resolve(WEB, '..');
const API = path.join(REPO, 'api', 'src');
const LEDGER = path.join(WEB, 'screen-coverage.json');

/**
 * Every routing decorator `@nestjs/common` exports, read off
 * `decorators/http/request-mapping.decorator.d.ts` rather than remembered. An
 * earlier version listed eight of them and `@Search` — the documented decorator
 * for a search endpoint, which this API is the kind to acquire — was invisible.
 * `RequestMapping` is the generic form and takes an options object; it is
 * refused rather than parsed, because nothing uses it.
 */
const ROUTING = new Set([
  'Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Options', 'Head',
  'Search', 'QueryMethod', 'Propfind', 'Proppatch', 'Mkcol', 'Copy',
  'Move', 'Lock', 'Unlock',
]);
const GENERIC_ROUTING = 'RequestMapping';

const failures = [];

/** A repository-relative path with forward slashes, identical on every host. */
const relative = (target) => path.relative(REPO, target).split(path.sep).join('/');

function join(...segments) {
  const parts = segments
    .filter((segment) => segment !== undefined && segment !== '')
    .flatMap((segment) => segment.split('/'))
    .filter((segment) => segment !== '');
  return `/${parts.join('/')}`;
}

/** The decorators on a node, under the TypeScript 5 accessor. */
const decoratorsOf = (node) =>
  (ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined) ?? [];

/** `@Name(...)` — the decorator's name and its argument list, or null. */
function decoratorCall(decorator) {
  const expression = decorator.expression;
  if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)) {
    return null;
  }
  return { name: expression.expression.text, args: expression.arguments };
}

/**
 * The path or paths a routing decorator declares. NestJS accepts a string or an
 * array of them; anything else — a template literal, a constant, an options
 * object — cannot be resolved here and is refused by the caller.
 */
function literalPaths(args) {
  if (args.length === 0) {
    return [''];
  }
  if (args.length > 1) {
    return null;
  }
  const [argument] = args;
  if (ts.isStringLiteral(argument)) {
    return [argument.text];
  }
  if (ts.isArrayLiteralExpression(argument) && argument.elements.length > 0) {
    return argument.elements.every((element) => ts.isStringLiteral(element))
      ? argument.elements.map((element) => element.text)
      : null;
  }
  return null;
}

async function* typeScriptFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      failures.push(`${relative(directory)} does not exist, so no route can be derived`);
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* typeScriptFiles(full);
    } else if (entry.name.endsWith('.ts')) {
      yield full;
    }
  }
}

/**
 * One pass over `api/src`: the routes every controller declares, and the calls
 * that would move every one of them. Versioning and the global prefix are
 * looked for in **every** file rather than in `bootstrap.ts` alone — `main.ts`
 * configures the application too, and a check scoped to one of the two would
 * not see `enableVersioning` in the other.
 */
async function readApi() {
  // Routes are collected without their prefix and composed once the pass ends.
  // Composing them as they were found made every route in a file the walk
  // reached before `bootstrap.ts` carry no prefix at all -- fifteen of the
  // thirty-five, decided by alphabetical order.
  const pending = [];
  let prefix = null;
  let prefixSeenIn = null;

  for await (const file of typeScriptFiles(API)) {
    const source = ts.createSourceFile(
      file,
      await readFile(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const at = (node) =>
      `${relative(file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;

    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const called = node.expression.name.text;
        if (called === 'enableVersioning') {
          failures.push(`${at(node)} enables versioning, which this check does not model`);
        }
        if (called === 'setGlobalPrefix') {
          const paths = literalPaths(node.arguments);
          if (paths === null || paths.length !== 1) {
            failures.push(
              `${at(node)} calls \`setGlobalPrefix\` with something this check cannot ` +
                'read — a variable, or an options object carrying `exclude`',
            );
          } else if (prefix !== null && prefix !== paths[0]) {
            failures.push(
              `${at(node)} sets the global prefix to \`${paths[0]}\`, and ` +
                `${prefixSeenIn} sets it to \`${prefix}\``,
            );
          } else {
            prefix = paths[0];
            prefixSeenIn = at(node);
          }
        }
      }

      if (ts.isClassDeclaration(node)) {
        collectClass(node, file, at);
      }
      ts.forEachChild(node, visit);
    };

    const collectClass = (node, file, at) => {
      let base = null;
      let isController = false;

      for (const decorator of decoratorsOf(node)) {
        const call = decoratorCall(decorator);
        if (call === null || call.name !== 'Controller') {
          continue;
        }
        isController = true;
        const paths = literalPaths(call.args);
        if (paths === null || paths.length !== 1) {
          failures.push(
            `${at(decorator)} declares a \`@Controller\` this check cannot read — a ` +
              'template literal, a constant, several paths, or the `{ path }` object form',
          );
          return;
        }
        [base] = paths;
      }

      const methods = node.members.filter((member) => ts.isMethodDeclaration(member));
      const routed = methods.filter((member) =>
        decoratorsOf(member).some((decorator) => {
          const call = decoratorCall(decorator);
          return call !== null && (ROUTING.has(call.name) || call.name === GENERIC_ROUTING);
        }),
      );

      if (!isController) {
        // A class carrying routing decorators without `@Controller` is a base
        // class a controller extends, and its routes are served under the
        // subclass's path. Nothing here can resolve that, so it refuses rather
        // than passing over it: this shape used to be invisible.
        if (routed.length > 0) {
          failures.push(
            `${at(node)} declares routing decorators and no \`@Controller\` — a base ` +
              'class whose routes this check cannot place',
          );
        }
        return;
      }

      // The naming convention is not what the scan keys on any more, but a
      // controller outside it is still worth saying aloud: every tool that
      // looks for controllers by filename would miss it.
      if (!file.endsWith('.controller.ts')) {
        failures.push(
          `${at(node)} declares a \`@Controller\` and is not named \`*.controller.ts\``,
        );
      }

      for (const member of routed) {
        for (const decorator of decoratorsOf(member)) {
          const call = decoratorCall(decorator);
          if (call === null) {
            continue;
          }
          if (call.name === GENERIC_ROUTING) {
            failures.push(
              `${at(decorator)} uses \`@${GENERIC_ROUTING}\`, whose options object this ` +
                'check does not read',
            );
            continue;
          }
          if (!ROUTING.has(call.name)) {
            continue;
          }
          const paths = literalPaths(call.args);
          if (paths === null) {
            failures.push(
              `${at(decorator)} declares \`@${call.name}\` with an argument this check ` +
                'cannot read — a template literal, a constant, or an options object',
            );
            continue;
          }
          for (const routePath of paths) {
            pending.push({
              method: call.name.toUpperCase(),
              base,
              routePath,
              where: at(decorator),
            });
          }
        }
      }
    };

    ts.forEachChild(source, visit);
  }

  if (prefix === null) {
    failures.push('no `setGlobalPrefix` was found in `api/src`, so no route path is known');
    return new Map();
  }

  const routes = new Map();
  for (const { method, base, routePath, where } of pending) {
    const route = `${method} ${join(prefix, base, routePath)}`;
    const already = routes.get(route);
    if (already !== undefined) {
      failures.push(`\`${route}\` is declared twice — ${already} and ${where}`);
      continue;
    }
    routes.set(route, where);
  }
  return routes;
}

async function readLedger() {
  let contents;
  try {
    contents = await readFile(LEDGER, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      process.stderr.write(
        `web: ${relative(LEDGER)} is missing. It is what records which\n` +
          'screen reaches each API route, and without it this check cannot run.\n',
      );
      process.exit(1);
    }
    throw error;
  }
  try {
    return JSON.parse(contents);
  } catch (error) {
    process.stderr.write(`web: ${relative(LEDGER)} is not valid JSON: ${error.message}\n`);
    process.exit(1);
  }
}

/** A screen is a file, inside `web/`, named by a path this check can resolve. */
async function screenIsAFileInWeb(screen) {
  if (screen.includes('\\')) {
    return 'uses a backslash, which is a separator on Windows and a filename character on Linux';
  }
  const resolved = path.resolve(REPO, screen);
  if (!resolved.startsWith(WEB)) {
    return 'is outside `web/`';
  }
  try {
    if (!(await stat(resolved)).isFile()) {
      return 'is not a file';
    }
  } catch {
    return 'does not exist';
  }
  return null;
}

const routes = await readApi();
const ledger = await readLedger();
const entries = Array.isArray(ledger.routes) ? ledger.routes : [];

// The stages a waiver may name. Declared once, so a typo fails rather than
// inventing a stage, and so adding one is a deliberate edit in a single place.
const stages = Array.isArray(ledger.stages) ? ledger.stages : [];
if (stages.length === 0) {
  failures.push('the ledger declares no `stages`, so no waiver can name one');
}

const seen = new Set();
let reached = 0;
let waived = 0;
let owesNone = 0;

for (const entry of entries) {
  if (typeof entry?.route !== 'string') {
    failures.push(`a ledger entry has no \`route\`: ${JSON.stringify(entry)}`);
    continue;
  }
  if (seen.has(entry.route)) {
    failures.push(`\`${entry.route}\` appears twice in the ledger`);
    continue;
  }
  seen.add(entry.route);

  if (!routes.has(entry.route)) {
    failures.push(
      `\`${entry.route}\` is in the ledger and is declared by no controller — ` +
        'it was renamed or removed, and the ledger still claims to cover it',
    );
    continue;
  }

  const hasScreen = typeof entry.screen === 'string' && entry.screen !== '';
  const hasWaiver = typeof entry.waived_to === 'string' && entry.waived_to !== '';
  const claimsNone = entry.no_screen_owed === true;
  const states = [hasScreen, hasWaiver, claimsNone].filter(Boolean).length;

  if (states !== 1) {
    failures.push(
      `\`${entry.route}\` must carry exactly one of \`screen\`, \`waived_to\` or ` +
        `\`no_screen_owed\`, and carries ${states === 0 ? 'none' : states}`,
    );
    continue;
  }

  // Counted by the predicates that validate, so the printed figures cannot
  // disagree with what passed. They did: `waived` was once counted by `typeof
  // entry.waived_to === 'string'`, which an empty string satisfies, so an entry
  // with a valid screen and `"waived_to": ""` moved the banner and failed nothing.
  if (hasScreen) reached += 1;
  if (hasWaiver) waived += 1;
  if (claimsNone) owesNone += 1;

  // A waiver and a no-screen claim are both assertions about the future. The
  // reason is the only thing a reader has, so it is required.
  if (!hasScreen && (typeof entry.reason !== 'string' || entry.reason === '')) {
    failures.push(
      `\`${entry.route}\` is ${hasWaiver ? `waived to \`${entry.waived_to}\`` : 'marked as owing no screen'} and gives no \`reason\``,
    );
  }

  if (hasWaiver && !stages.includes(entry.waived_to)) {
    failures.push(
      `\`${entry.route}\` is waived to \`${entry.waived_to}\`, which is not a stage the ` +
        `ledger declares (${stages.map((stage) => `\`${stage}\``).join(', ')})`,
    );
  }

  if (hasScreen) {
    const wrong = await screenIsAFileInWeb(entry.screen);
    if (wrong !== null) {
      failures.push(`\`${entry.route}\` names the screen \`${entry.screen}\`, which ${wrong}`);
    }
  }
}

for (const [route, where] of routes) {
  if (!seen.has(route)) {
    failures.push(`\`${route}\` (${where}) is declared and the ledger does not mention it`);
  }
}

if (failures.length > 0) {
  process.stderr.write('web: the screen-coverage ledger and the API routes disagree.\n\n');
  for (const failure of failures) {
    process.stderr.write(`  - ${failure}\n`);
  }
  process.stderr.write(
    `\n${relative(LEDGER)} records, for every route the API declares,\n` +
      'either the screen that reaches it or a waiver naming the stage that owes one.\n' +
      'A new route needs a line there in the same commit that adds it.\n\n' +
      'Shipping a route with no screen is permitted — `SKILL.md` §2 asks for it —\n' +
      'and shipping one silently is what the Definition of Done forbids, because\n' +
      'two completed stages already did (ruling of 2026-09-06).\n\n',
  );
  process.exit(1);
}

process.stdout.write(
  `web: ${entries.length} API routes in the screen-coverage ledger — ` +
    `${reached} reached by a screen, ${waived} waived to a later stage, ` +
    `${owesNone} owing none.\n`,
);
