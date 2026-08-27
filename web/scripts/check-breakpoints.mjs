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

// A prefix binds a utility, so it is preceded by whitespace, a quote, a brace or
// a backtick rather than by a letter -- `bg-md:x` is not a breakpoint, and
// neither is a URL containing `lg:`.
// A prefix binds a utility, so it is preceded by whitespace, a quote, a brace or
// a bracket rather than by a letter: `bg-md:x` is not a breakpoint, and neither
// is a URL containing `lg:`. None of the prefixes is a regex metacharacter.
const PATTERN = new RegExp(`(^|[\s"'\`{(\[])(${WIDER.join('|')}):`, 'g');

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
  'web: no responsive breakpoint above `sm`, so the 1024px scan covers every wider display.\n',
);
