/**
 * Every API route reaches a screen, or carries a waiver that says which stage
 * owes it one.
 *
 * Two completed stages shipped no interface. Stage 3 delivered Cells, Stage 4
 * delivered attendance, and `web/app` reaches neither — ten screens, all of them
 * authentication, the home page, or People, against thirty-five routes. Nothing
 * recorded that as owed, and the `CLAUDE.md` clause requiring it to be recorded
 * is prose (ruling of 2026-09-06). This is what makes that clause fail.
 *
 * **The route list is derived, never declared.** It is read out of the
 * controllers, so a route cannot be missing from it by being forgotten. That is
 * Section 20's own argument against enumerating a figure's invalidators — a
 * hand-maintained list is a list somebody eventually forgets to extend — and the
 * Section 22 storability check is the instance that has already paid for it,
 * having derived its own field list and found one nobody would have listed.
 *
 * **The ledger's unit is the individual route**, `METHOD /api/v1/path`, rather
 * than a family of them. It is the finer of the two and it cannot under-cover:
 * a family entry would let a route join an existing group unnoticed, which is
 * the failure this exists to catch, one level down.
 *
 * **It fails in both directions.** A route the ledger does not mention is the
 * case above. A ledger entry naming no route is a lie of the opposite kind — the
 * route was renamed or removed and the ledger still claims to cover it — and a
 * ledger that is allowed to drift stops being evidence of anything.
 *
 * **A waiver is permitted and is not a defeat.** Shipping API-only is what the
 * API-first constraint asks for (`SKILL.md` §2), and twenty-one waivers is what
 * this repository owes today — the check prints the three counts rather than
 * leaving them here to go stale. What a waiver may not be is silent: it names
 * the stage that owes the screen, **and the stage must be one the ledger
 * declares**. Without that the requirement was decorative — the first version
 * tested only that the string was non-empty, so `"waived_to": "banana"` passed,
 * while `CLAUDE.md` and decision 0213 described the naming as enforced. A
 * specification describing a guarantee its implementation does not provide is
 * the defect this whole change is named after.
 *
 * **A route may also owe no screen at all**, which is a third state rather than
 * a waiver with a distant stage on it. The liveness probe is called by the
 * deployment platform and never by a person, and waiving it to a stage would be
 * a claim nobody intends to honour — a ledger full of those is how the whole
 * file becomes a rubber stamp. It carries a reason for the same purpose a
 * waiver does: nothing can check either, so the reason is all a reader has.
 *
 * **A named screen must exist on disk**, so `screen` is a repository-relative
 * path and nothing else; anything a reader needs beyond the path goes in `note`.
 * An earlier draft skipped this on the ground that "no route names a screen
 * today", which was false when it was written — thirteen did — so the rule that
 * would have shipped untested in fact had thirteen cases the moment it landed.
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const REPO = path.resolve(WEB, '..');
const CONTROLLERS = path.join(REPO, 'api', 'src');
const LEDGER = path.join(WEB, 'screen-coverage.json');

/** `api/src/bootstrap.ts` sets this once, for every route in the application. */
const GLOBAL_PREFIX = 'api/v1';

const METHODS = ['Get', 'Post', 'Put', 'Patch', 'Delete'];

// `@Controller('cells')`, and the bare `@Controller()` a root controller would
// use. The quote style is either, because Prettier's is not this check's to
// assume.
const CONTROLLER = /@Controller\(\s*(?:['"]([^'"]*)['"])?\s*\)/;

// `@Get(':id/meetings')` or `@Post()`. Anchored at the start of a line so that
// the word inside a comment or a string cannot register as a route.
const ROUTE = new RegExp(`^\\s*@(${METHODS.join('|')})\\(\\s*(?:['"]([^'"]*)['"])?\\s*\\)`);

/**
 * A repository-relative path with forward slashes, so that a failure reads the
 * same on Windows as it does on the CI runner. A path in an error message is
 * something somebody pastes into an editor.
 */
function relative(target) {
  return path.relative(REPO, target).split(path.sep).join('/');
}

/** Joins a global prefix, a controller path and a route path into one route. */
function join(...segments) {
  const parts = segments
    .filter((segment) => segment !== undefined && segment !== '')
    .flatMap((segment) => segment.split('/'))
    .filter((segment) => segment !== '');
  return `/${parts.join('/')}`;
}

async function* controllerFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* controllerFiles(full);
    } else if (entry.name.endsWith('.controller.ts')) {
      yield full;
    }
  }
}

/** Every route the controllers declare, as `METHOD /api/v1/path`. */
async function declaredRoutes() {
  const routes = new Map();

  for await (const file of controllerFiles(CONTROLLERS)) {
    const contents = await readFile(file, 'utf8');
    const controller = contents.match(CONTROLLER);

    // A file named `*.controller.ts` with no `@Controller` is not a controller,
    // and guessing a base path for it would invent routes.
    if (controller === null) {
      continue;
    }

    contents.split('\n').forEach((line, index) => {
      const match = line.match(ROUTE);
      if (match === null) {
        return;
      }
      const route = `${match[1].toUpperCase()} ${join(GLOBAL_PREFIX, controller[1], match[2])}`;
      routes.set(route, `${relative(file)}:${index + 1}`);
    });
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
    process.stderr.write(
      `web: ${relative(LEDGER)} is not valid JSON: ${error.message}\n`,
    );
    process.exit(1);
  }
}

const routes = await declaredRoutes();
const ledger = await readLedger();
const entries = Array.isArray(ledger.routes) ? ledger.routes : [];

// The stages a waiver may name. Declared once, so a typo fails rather than
// inventing a stage, and so adding one is a deliberate edit in a single place.
const stages = Array.isArray(ledger.stages) ? ledger.stages : [];

const failures = [];
const seen = new Set();

if (stages.length === 0) {
  failures.push('the ledger declares no `stages`, so no waiver can name one');
}

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
  const owesNone = entry.no_screen_owed === true;
  const states = [hasScreen, hasWaiver, owesNone].filter(Boolean).length;

  if (states !== 1) {
    failures.push(
      `\`${entry.route}\` must carry exactly one of \`screen\`, \`waived_to\` or ` +
        `\`no_screen_owed\`, and carries ${states === 0 ? 'none' : `${states}`}`,
    );
    continue;
  }

  // A waiver and a no-screen claim are both assertions about the future, and
  // neither is checkable in itself. The reason is the only thing a reader has,
  // so it is required; `screen` names a file and is checked below instead.
  if (!hasScreen && (typeof entry.reason !== 'string' || entry.reason === '')) {
    failures.push(
      `\`${entry.route}\` is ${hasWaiver ? `waived to \`${entry.waived_to}\`` : 'marked as owing no screen'} and gives no \`reason\``,
    );
  }

  // The stage must be one the ledger declares. Without this the requirement to
  // "name the stage that owes the screen" is satisfied by any non-empty string.
  if (hasWaiver && !stages.includes(entry.waived_to)) {
    failures.push(
      `\`${entry.route}\` is waived to \`${entry.waived_to}\`, which is not a stage the ` +
        `ledger declares (${stages.map((stage) => `\`${stage}\``).join(', ')})`,
    );
  }

  // A screen that does not exist is a coverage claim nothing backs.
  if (hasScreen && !existsSync(path.join(REPO, entry.screen))) {
    failures.push(
      `\`${entry.route}\` names the screen \`${entry.screen}\`, which does not exist`,
    );
  }
}

for (const [route, where] of routes) {
  if (!seen.has(route)) {
    failures.push(`\`${route}\` (${where}) is declared and the ledger does not mention it`);
  }
}

if (failures.length > 0) {
  process.stderr.write(
    'web: the screen-coverage ledger and the API routes disagree.\n\n',
  );
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

const waived = entries.filter((entry) => typeof entry.waived_to === 'string').length;
const owesNone = entries.filter((entry) => entry.no_screen_owed === true).length;
const reached = entries.length - waived - owesNone;

process.stdout.write(
  `web: ${entries.length} API routes in the screen-coverage ledger — ` +
    `${reached} reached by a screen, ${waived} waived to a later stage, ` +
    `${owesNone} owing none.\n`,
);
