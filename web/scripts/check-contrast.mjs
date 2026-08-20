/**
 * WCAG 2.2 Level AA contrast, checked against the palette itself.
 *
 * SKILL.md section 23 commits the web application to Level AA. A conformance
 * claim with nothing that can fail is a wish, so the criterion that can be
 * checked deterministically is checked here rather than asserted:
 *
 *   1.4.3 Contrast (Minimum)  — 4.5:1 for body text, 3:1 for large text
 *   1.4.11 Non-text Contrast  — 3:1 for the boundary of a control
 *
 * This reads the tokens out of `app/globals.css` and computes every pair the
 * application actually uses, in both themes. It is deliberately not a browser
 * test: contrast is decided by the palette, and a defect here is a defect on
 * every screen at once. The criteria a browser is needed for — focus order,
 * keyboard operability, accessible names — are checked by axe from the first real
 * screen (CLAUDE.md, Definition of Done).
 *
 * Colour is for structure and legibility only. This file says nothing about
 * meaning: sections 13, 17 and 19 forbid encoding meeting status, coverage or a
 * leader in colour, and no contrast ratio makes that permissible.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const CSS = fileURLToPath(new URL('../app/globals.css', import.meta.url));

/** Body text. WCAG 1.4.3 asks 4.5:1, and nothing here is large enough to relax it. */
const TEXT_PAIRS = [
  ['ink', 'surface'],
  ['ink', 'raised'],
  ['muted', 'surface'],
  ['muted', 'raised'],
  ['accent', 'surface'],
  ['accent', 'raised'],
];

/** The boundary of a control. WCAG 1.4.11 asks 3:1. */
const NON_TEXT_PAIRS = [
  ['edge', 'surface'],
  ['edge', 'raised'],
];

const TEXT_MINIMUM = 4.5;
const NON_TEXT_MINIMUM = 3;

function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const [lighter, darker] = first > second ? [first, second] : [second, first];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The light theme is declared on bare `:root`; the dark theme redeclares the same
 * names inside the `prefers-color-scheme` block. Reading them in order and
 * layering the second over the first gives exactly what a browser resolves.
 */
function readThemes(css) {
  const light = {};
  const dark = {};
  const darkAt = css.indexOf('prefers-color-scheme: dark');
  const declaration = /^\s*--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/gm;

  for (const match of css.matchAll(declaration)) {
    const [, name, value] = match;
    if (match.index < darkAt || darkAt === -1) {
      light[name] = value;
    } else {
      dark[name] = value;
    }
  }

  return { light, dark: { ...light, ...dark } };
}

const css = await readFile(CSS, 'utf8');
const themes = readThemes(css);
const failures = [];
let checked = 0;

for (const [themeName, tokens] of Object.entries(themes)) {
  const check = (pairs, minimum, kind) => {
    for (const [foreground, background] of pairs) {
      if (!tokens[foreground] || !tokens[background]) {
        failures.push(
          `${themeName}: token --${!tokens[foreground] ? foreground : background} is not declared, ` +
            `so ${foreground} on ${background} cannot be checked.`,
        );
        continue;
      }

      const ratio = contrast(tokens[foreground], tokens[background]);
      checked += 1;

      if (ratio < minimum) {
        failures.push(
          `${themeName}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1, below the ` +
            `${minimum}:1 WCAG 2.2 AA requires for ${kind} (${tokens[foreground]} on ${tokens[background]}).`,
        );
      }
    }
  };

  check(TEXT_PAIRS, TEXT_MINIMUM, 'body text');
  check(NON_TEXT_PAIRS, NON_TEXT_MINIMUM, 'the boundary of a control');
}

if (failures.length > 0) {
  process.stderr.write('The palette does not meet WCAG 2.2 AA contrast:\n\n');
  for (const failure of failures) {
    process.stderr.write(`  - ${failure}\n`);
  }
  process.stderr.write(
    '\nAdjust the token rather than the threshold. Leaders read these figures on their ' +
      'own phones, in a hall, at a range of ages.\n\n',
  );
  process.exit(1);
}

process.stdout.write(`web: ${checked} colour pairs meet WCAG 2.2 AA contrast.\n`);
