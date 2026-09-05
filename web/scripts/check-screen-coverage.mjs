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
 * **Deriving is only worth anything if what it cannot read is a failure.** The
 * first version skipped what it could not parse, and `architecture-guardian`
 * reproduced seven shapes that each dropped a real route and still exited 0 —
 * `@Controller({ path })`, a template-literal or constant argument, a decorator
 * sharing a line with another, a Prettier-wrapped multi-line decorator, `@All`,
 * `@Head`, and a `@Controller` in a file not named `*.controller.ts`. The worst
 * was the constant argument, because the controller is still read and its other
 * routes still covered, so nothing about the ledger looks short. So this file
 * now **refuses what it cannot parse** rather than passing over it: an
 * unreadable decorator, an unreadable controller, a `@Controller` outside the
 * naming convention, or a global prefix it cannot confirm all fail the build.
 * A derivation that silently under-reads is worse than a declared list, because
 * it claims the completeness a declared list never claimed.
 *
 * **The ledger's unit is the individual route**, `METHOD /api/v1/path`, rather
 * than a family of them. It is the finer of the two and it cannot under-cover:
 * a family entry would let a route join an existing group unnoticed, which is
 * the failure this exists to catch, one level down.
 *
 * **It fails in both directions.** A route the ledger does not mention is the
 * case above. A ledger entry naming no route is a lie of the opposite kind — the
 * route was renamed or removed and the ledger still claims to cover it — and a
 * ledger that is allowed to drift stops being evidence of anything. Comments are
 * stripped before anything is read, so a route commented out is a route removed;
 * it was not, and a block-commented route stayed "covered".
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
 * file becomes a rubber stamp. It carries a reason for the same purpose a
 * waiver does: nothing can check either, so the reason is all a reader has.
 *
 * **A named screen must be a file inside `web/`**, so `screen` is a
 * repository-relative path and nothing else; anything more a reader needs goes
 * in `note`. Existence alone was not enough — a directory, `.` and `../..` all
 * satisfied it, so a coverage claim could be backed by the repository root.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const REPO = path.resolve(WEB, '..');
const API = path.join(REPO, 'api', 'src');
const BOOTSTRAP = path.join(API, 'bootstrap.ts');
const LEDGER = path.join(WEB, 'screen-coverage.json');

/** Every decorator NestJS routes with, not only the five this API uses today. */
const METHODS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options'];

const failures = [];

/**
 * A repository-relative path with forward slashes, so a failure reads the same
 * on Windows as on the CI runner. A path in an error message is something
 * somebody pastes into an editor.
 */
function relative(target) {
  return path.relative(REPO, target).split(path.sep).join('/');
}

/**
 * Blanks comments while preserving every newline and offset, so line numbers
 * and indices still point where they did. A route inside a comment is not a
 * route, and a `@Controller` named in a docblock is not a base path.
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
    } else if (two === '/*') {
      while (i < source.length && source.slice(i, i + 2) !== '*/') {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
    } else {
      out += source[i];
      i += 1;
    }
  }
  return out;
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

/**
 * The single argument of a decorator, when it is a plain quoted string or
 * absent. Returns `null` for anything else — a template literal, a constant, an
 * object — which the caller turns into a failure rather than a skip.
 */
function simpleArgument(source, openParen) {
  const close = source.indexOf(')', openParen);
  if (close === -1) {
    return null;
  }
  const raw = source.slice(openParen + 1, close).trim().replace(/,$/, '').trim();
  if (raw === '') {
    return { value: '', end: close };
  }
  const quoted = /^(['"])([^'"]*)\1$/.exec(raw);
  return quoted === null ? null : { value: quoted[2], end: close };
}

/** `api/src/bootstrap.ts` sets one prefix for every route in the application. */
async function globalPrefix() {
  const source = stripComments(await readFile(BOOTSTRAP, 'utf8'));

  // A second argument to setGlobalPrefix carries `exclude`, which would serve a
  // route somewhere the ledger does not name. Versioning moves every path.
  if (/enableVersioning\s*\(/.test(source)) {
    failures.push(
      `${relative(BOOTSTRAP)} enables versioning, which this check does not model`,
    );
  }

  const match = /setGlobalPrefix\s*\(/.exec(source);
  if (match === null) {
    failures.push(`${relative(BOOTSTRAP)} calls no \`setGlobalPrefix\``);
    return '';
  }
  const argument = simpleArgument(source, match.index + match[0].length - 1);
  if (argument === null) {
    failures.push(
      `${relative(BOOTSTRAP)} calls \`setGlobalPrefix\` with something this check ` +
        'cannot read — a variable, or an options object carrying `exclude`',
    );
    return '';
  }
  return argument.value;
}

function join(...segments) {
  const parts = segments
    .filter((segment) => segment !== undefined && segment !== '')
    .flatMap((segment) => segment.split('/'))
    .filter((segment) => segment !== '');
  return `/${parts.join('/')}`;
}

async function* typeScriptFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      // Distinguished from "an API with no routes", which it is not: every
      // ledger entry would otherwise be reported as a route since removed.
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

/** Every route the controllers declare, as `METHOD /api/v1/path`. */
async function declaredRoutes(prefix) {
  const routes = new Map();

  for await (const file of typeScriptFiles(API)) {
    const source = stripComments(await readFile(file, 'utf8'));
    const controller = /@Controller\s*\(/.exec(source);

    if (controller === null) {
      continue;
    }

    // The naming convention is what this check scans by, so a controller that
    // breaks it must say so rather than disappear.
    if (!file.endsWith('.controller.ts')) {
      failures.push(
        `${relative(file)}:${lineOf(source, controller.index)} declares a \`@Controller\` ` +
          'and is not named `*.controller.ts`',
      );
      continue;
    }

    const base = simpleArgument(source, controller.index + controller[0].length - 1);
    if (base === null) {
      failures.push(
        `${relative(file)}:${lineOf(source, controller.index)} declares a \`@Controller\` ` +
          'this check cannot read — a template literal, a constant, or the ' +
          '`{ path }` object form',
      );
      continue;
    }

    const decorator = new RegExp(`@(${METHODS.join('|')})\\s*\\(`, 'g');
    for (const match of source.matchAll(decorator)) {
      const line = lineOf(source, match.index);
      const argument = simpleArgument(source, match.index + match[0].length - 1);
      if (argument === null) {
        failures.push(
          `${relative(file)}:${line} declares \`@${match[1]}\` with an argument this ` +
            'check cannot read — a template literal, a constant, or an options object',
        );
        continue;
      }
      const route = `${match[1].toUpperCase()} ${join(prefix, base.value, argument.value)}`;
      const already = routes.get(route);
      if (already !== undefined) {
        failures.push(
          `\`${route}\` is declared twice — ${already} and ${relative(file)}:${line}`,
        );
        continue;
      }
      routes.set(route, `${relative(file)}:${line}`);
    }
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
  if (resolved !== WEB.replace(/[\\/]$/, '') && !resolved.startsWith(WEB)) {
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

const prefix = await globalPrefix();
const routes = await declaredRoutes(prefix);
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

  // Counted by the same predicates that validate, so the printed figures cannot
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
