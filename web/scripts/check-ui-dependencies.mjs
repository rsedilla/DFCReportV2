/**
 * No component framework carrying its own design system.
 *
 * SKILL.md section 2 refuses them for the web application, and the argument it
 * makes is precisely that a framework's defaults get applied by whoever writes
 * the newest screen: `severity="error"` on a Cell that reported `NOT_HELD` is a
 * five-second change that reads as idiomatic in review. A rule whose whole
 * premise is that review will not catch it cannot be enforced by review.
 *
 * So it is checked, the same way the client boundary is checked next door. The
 * rule is the rule; this list is the part of it a script can see.
 *
 * This is not a moral position about these libraries. Each is good at what it
 * does, and each expresses state through a vocabulary of `error`, `success`,
 * `warning` and `severity` that sections 13, 17 and 19 forbid applying to
 * meeting status, to coverage, or to a leader. Headless primitives carry no such
 * vocabulary, which is the whole of why they were chosen.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const PACKAGE_JSON = fileURLToPath(new URL('../package.json', import.meta.url));

/** Named in SKILL.md section 2 and in the decisions log. */
const REFUSED = [
  '@mui/material',
  '@mui/joy',
  '@mui/base',
  'antd',
  '@ant-design/icons',
  '@chakra-ui/react',
  '@mantine/core',
  'bootstrap',
  'react-bootstrap',
  'primereact',
  '@fluentui/react-components',
];

/**
 * A second styling engine duplicates and fights Tailwind, which is the ordinary
 * half of the same rule.
 */
const REFUSED_STYLING = ['styled-components', '@emotion/styled', '@emotion/react'];

const manifest = JSON.parse(await readFile(PACKAGE_JSON, 'utf8'));
const declared = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
]);

const failures = [];

for (const name of REFUSED) {
  if (declared.has(name)) {
    failures.push(
      `${name} is a component framework carrying its own design system. SKILL.md ` +
        `section 2 refuses these: their state vocabulary makes the colour encoding ` +
        `sections 13, 17 and 19 forbid the easy thing to write.`,
    );
  }
}

for (const name of REFUSED_STYLING) {
  if (declared.has(name)) {
    failures.push(
      `${name} is a second styling engine beside Tailwind. SKILL.md section 2 ` +
        `settles one, and two of them fight.`,
    );
  }
}

if (failures.length > 0) {
  process.stderr.write('The web application declares a dependency SKILL.md section 2 refuses:\n\n');
  for (const failure of failures) {
    process.stderr.write(`  - ${failure}\n`);
  }
  process.stderr.write(
    '\nIf the rule should change, that is an amendment to SKILL.md section 2 and an ' +
      'entry in the decisions log, not a dependency added on a deadline.\n\n',
  );
  process.exit(1);
}

process.stdout.write('web: no design-system component framework, one styling engine.\n');
