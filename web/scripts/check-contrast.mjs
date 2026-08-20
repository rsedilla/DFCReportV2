/**
 * WCAG 2.2 Level AA contrast, checked against the palette itself.
 *
 * SKILL.md section 23 commits the web application to Level AA. A conformance
 * claim with nothing that can fail is a wish, so the criterion that can be
 * checked deterministically is checked here rather than asserted:
 *
 *   1.4.3 Contrast (Minimum)  — 4.5:1 for body text, 3:1 for large text
 *   1.4.11 Non-text Contrast  — 3:1 for the boundary of a control, its visible
 *                               states, and a graphical object needed to understand
 *                               content, which is what a chart mark is
 *
 * This reads the tokens out of `app/globals.css` and computes the pairs listed
 * below, in both themes. It is deliberately not a browser test: contrast is
 * decided by the palette, and a defect there is a defect on every screen at once.
 *
 * **What it cannot do is notice a pair nobody listed.** `bg-accent text-ink` is
 * idiomatic Tailwind and produces a 2.14:1 button, and no script that checks a
 * fixed list will see it until the pair is added here. Adding a token, or using
 * an existing one in a new position, means adding the pair — the list below is
 * the set of combinations the application is permitted to use, not a survey of
 * what it happens to use today. Whatever is not listed is not approved.
 *
 * The criteria a browser is needed for — focus order, keyboard operability,
 * accessible names — are checked by axe from the first real screen (CLAUDE.md,
 * Definition of Done).
 *
 * Colour is for structure and legibility only. This file says nothing about
 * meaning: sections 13, 17 and 19 forbid encoding meeting status, coverage or a
 * leader in colour, and no contrast ratio makes that permissible.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const CSS = fileURLToPath(new URL('../app/globals.css', import.meta.url));

/**
 * Body text. WCAG 1.4.3 asks 4.5:1, and nothing here is large enough to relax it.
 *
 * `accent` appears on both sides. As a foreground it is a link on a page; as a
 * background it is a primary button, and then the only permitted foregrounds are
 * `surface` and `raised`. `ink` on `accent` is 2.14:1 and `muted` on `accent` is
 * 1.37:1 — both fail, and neither is listed, which is what makes them not
 * permitted rather than merely unchecked.
 */
const TEXT_PAIRS = [
  ['ink', 'surface'],
  ['ink', 'raised'],
  ['muted', 'surface'],
  ['muted', 'raised'],
  ['accent', 'surface'],
  ['accent', 'raised'],
  ['surface', 'accent'],
  ['raised', 'accent'],
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
  const mediaBlocks = [...css.matchAll(/@media[^{]*\{/g)];
  if (mediaBlocks.length !== 1 || !/prefers-color-scheme:\s*dark/.test(mediaBlocks[0][0])) {
    throw new Error(
      'globals.css no longer has exactly one @media block for the dark theme. This ' +
        'reader assigns every declaration after it to dark, so a second block would ' +
        'be misfiled silently. Teach it the new shape rather than trusting it.',
    );
  }

  const light = {};
  const dark = {};
  const darkAt = mediaBlocks[0].index;
  // Any custom property with a colour-ish value; the hex requirement is checked
  // below, so a token written in oklch() reports what it is rather than reading
  // as undeclared.
  const declaration = /^\s*--([a-z-]+):\s*([^;]+);/gm;

  for (const match of css.matchAll(declaration)) {
    const [, name, rawValue] = match;
    const value = rawValue.trim();
    if (value.startsWith('var(')) {
      continue;
    }
    (match.index < darkAt ? light : dark)[name] = value;
  }

  return { light, dark: { ...light, ...dark } };
}

/**
 * Names a token may not have.
 *
 * The decisions log says: "No `success`, no `danger`, no `warning` token exists,
 * and none is to be added." That is the rule sections 13, 17 and 19 actually
 * turn on, and it was enforced by a comment while the framework rule next door
 * was enforced by a script. A palette that acquires a `danger` token has already
 * lost the argument, whatever the ratio comes out at.
 */
const FORBIDDEN_TOKEN_NAMES = [
  'success',
  'danger',
  'warning',
  'error',
  'positive',
  'negative',
  'good',
  'bad',
  'critical',
  'severity',
];

const css = await readFile(CSS, 'utf8');
const themes = readThemes(css);
const failures = [];
let checked = 0;

for (const name of Object.keys(themes.dark)) {
  const offending = FORBIDDEN_TOKEN_NAMES.find(
    (word) => name === word || name.startsWith(`${word}-`) || name.endsWith(`-${word}`),
  );

  if (offending) {
    failures.push(
      `--${name} names a judgement, not a colour. Sections 13, 17 and 19 forbid encoding ` +
        `meeting status, coverage or a leader in colour; a token called "${offending}" is ` +
        `how that arrives. A figure needing attention belongs on the attention list ` +
        `(section 15), not in red.`,
    );
  }
}

for (const [themeName, tokens] of Object.entries(themes)) {
  const check = (pairs, minimum, kind) => {
    for (const [foreground, background] of pairs) {
      const missing = [foreground, background].find((token) => !tokens[token]);
      if (missing) {
        failures.push(
          `${themeName}: token --${missing} is not declared, so ${foreground} on ` +
            `${background} cannot be checked.`,
        );
        continue;
      }

      const notHex = [foreground, background].find((token) => !/^#[0-9a-fA-F]{6}$/.test(tokens[token]));
      if (notHex) {
        failures.push(
          `${themeName}: token --${notHex} is "${tokens[notHex]}", which this check cannot ` +
            `read. It computes six-digit hex. Teach it the new colour syntax rather than ` +
            `dropping the token from the palette.`,
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
