/**
 * Nothing rearranges above Tailwind's `sm`.
 *
 * This is not a style preference. `web/e2e/accessibility.spec.ts` scans five
 * widths and argues that 1024 is **the last width at which anything can break** —
 * so 1366, 1440, 1512, 1920 and a 4K panel are covered by the 1024 scan, because
 * a wider display adds margin rather than rearranging anything. Every laptop and
 * desktop this application will ever be opened on rests on that sentence.
 *
 * It is true only while no breakpoint above `sm` exists. One `lg:grid-cols-3`
 * silently converts the widest scanned width into the *narrowest* width of a
 * layout nothing scans, and every desktop falls out of coverage with no test
 * going red and nothing to say so.
 *
 * That is a rule whose whole premise is that review will not catch it — the same
 * argument `check-ui-dependencies.mjs` makes next door — so it is checked rather
 * than written in a comment. It was a comment until 2026-08-28, and the comment
 * happened to be true; nothing had held it there.
 *
 * **Adding a wider breakpoint is permitted.** It is not a rule of the
 * specification and there is no reason a screen may not want one. What is
 * forbidden is adding it *silently*: the scanned widths in the accessibility
 * suite have to grow to cover the layout it creates, and then this list changes
 * in the same commit.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const WEB = fileURLToPath(new URL('..', import.meta.url));

/** Where a utility class can be written. `e2e/` is excluded: it asserts about them. */
const ROOTS = ['app', 'components', 'lib'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.css']);

/**
 * Tailwind's breakpoints above `sm`, and the two container-query prefixes that
 * would reach the same outcome by another route.
 *
 * `sm` itself is absent deliberately: the suite scans 320 below it and 690 just
 * above it, so the one transition the application does make is covered on both
 * sides.
 */
const WIDER = ['md', 'lg', 'xl', '2xl', '@md', '@lg'];

/**
 * The breakpoints the accessibility suite has widths for, and the pixel each one
 * begins at (Tailwind's own value).
 *
 * **Being on this list is not the permission; being scanned is.** Every entry is
 * verified against `VIEWPORT_WIDTHS` below -- the suite must scan a width *below*
 * the breakpoint, one *at or above* it, and one wider still, so both sides of the
 * transition and the layout it creates are covered. An entry the suite has stopped
 * scanning fails exactly as an unlisted prefix does, which is what stops this being
 * a list somebody appends to in order to turn a red check green.
 */
const SCANNED = { lg: 1024 };

/** The widths the accessibility suite actually scans, read from the suite itself. */
async function scannedWidths() {
  const spec = await readFile(path.join(WEB, 'e2e', 'accessibility.spec.ts'), 'utf8');
  const opens = spec.indexOf('const VIEWPORT_WIDTHS = [');
  const closes = opens === -1 ? -1 : spec.indexOf('];', opens);
  if (opens === -1 || closes === -1) {
    throw new Error('check-breakpoints: VIEWPORT_WIDTHS not found in the accessibility suite.');
  }
  const widths = [
    ...spec.slice(opens, closes).matchAll(/width:\s*(\d+)/g),
  ].map((match) => Number(match[1]));
  if (widths.length === 0) {
    throw new Error('check-breakpoints: VIEWPORT_WIDTHS names no widths.');
  }
  return widths;
}

// A prefix binds a utility, so it is preceded by whitespace, a quote, a brace or
// a backtick rather than by a letter -- `bg-md:x` is not a breakpoint, and
// neither is a URL containing `lg:`.
// A prefix binds a utility, so it is preceded by whitespace, a quote, a brace or
// a bracket rather than by a letter: `bg-md:x` is not a breakpoint, and neither
// is a URL containing `lg:`. None of the prefixes is a regex metacharacter.
// A prefix binds a utility, so what may precede it is anything that is not part
// of a word: a space, a newline, a quote, a brace, a bracket. `bg-md:x` is not a
// breakpoint and neither is a URL containing `lg:`, so a letter, digit,
// underscore or hyphen before it disqualifies the match.
//
// **Written as a negated word class rather than as a list of the characters that
// may precede it**, because the list was wrong and nothing could tell. It was a
// character class inside a template literal, where `\s` is not an escape and
// collapses to a literal `s` -- so the class compiled to `[s"'`{([]` and a
// breakpoint written the ordinary way, after a space in a class list, was never
// matched. The check passed because the application contained no wider
// breakpoint at all, not because it would have found one. Verified by compiling
// the pattern and testing `'flex md:block'` against it, which it missed.
const PATTERN = new RegExp(
  `(^|[^A-Za-z0-9_-])(${WIDER.filter((prefix) => !(prefix in SCANNED)).join('|')}):`,
  'g',
);

async function* sourceFiles(directory) {
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
      yield* sourceFiles(full);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

const failures = [];

for (const root of ROOTS) {
  for await (const file of sourceFiles(path.join(WEB, root))) {
    const contents = await readFile(file, 'utf8');
    const lines = contents.split('\n');

    lines.forEach((line, index) => {
      for (const match of line.matchAll(PATTERN)) {
        failures.push(
          `${path.relative(WEB, file)}:${index + 1} uses \`${match[2]}:\``,
        );
      }
    });
  }
}

const widths = await scannedWidths();

for (const [prefix, at] of Object.entries(SCANNED)) {
  const covered =
    widths.some((width) => width < at) &&
    widths.some((width) => width >= at) &&
    widths.some((width) => width > at);

  if (!covered) {
    failures.push(
      `\`${prefix}:\` is permitted at ${at}px, and the suite no longer scans a width below it, ` +
        `at it, and wider still (it scans ${widths.join(', ')})`,
    );
  }
}

if (failures.length > 0) {
  process.stderr.write(
    'The web application uses a responsive breakpoint above `sm`, and the\n' +
      'accessibility suite does not scan the layout it creates:\n\n',
  );
  for (const failure of failures) {
    process.stderr.write(`  - ${failure}\n`);
  }
  process.stderr.write(
    '\n`web/e2e/accessibility.spec.ts` argues that 1024 is the last width at which\n' +
      'anything can break, and every laptop and desktop is covered by that sentence\n' +
      'rather than by a scan of its own. A wider breakpoint makes it false.\n\n' +
      'This is permitted, and it is not permitted silently: add the width the new\n' +
      'layout first appears at to VIEWPORT_WIDTHS, and update this list, in the same\n' +
      'commit.\n\n',
  );
  process.exit(1);
}

process.stdout.write(
  `web: ${Object.keys(SCANNED).length} breakpoint above \`sm\` (${Object.keys(SCANNED).map((p) => `\`${p}:\``).join(", ")}), scanned at ${widths.join(", ")}.
`,
);
