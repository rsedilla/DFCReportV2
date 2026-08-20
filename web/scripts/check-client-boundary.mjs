/**
 * The web application is a client, like the phones.
 *
 * SKILL.md section 2 is unambiguous: this application contains no API routes and
 * no server actions, and consumes `/api/v1` exactly as the Android and iOS apps
 * will. Any logic placed here is logic the mobile apps do not have.
 *
 * The boundary is easy to hold on day one and easy to breach on a deadline, and a
 * breach does not look like a mistake in review -- a route handler under `app/api`
 * looks like ordinary Next.js. So it is checked rather than remembered. If holding
 * it proves hard, the answer in section 2 is to replace Next.js with a plain React
 * SPA, which removes the option entirely.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SEARCHED = ['app', 'src', 'components', 'lib'];
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SERVER_DIRECTIVE = /^\s*['"]use server['"]/m;
const SKIPPED = new Set(['node_modules', '.next', 'dist']);

const failures = [];

function describe(path) {
  return relative(ROOT, path).split(sep).join('/');
}

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (SKIPPED.has(entry.name)) {
        continue;
      }

      if (entry.name === 'api' && describe(path).startsWith('app/')) {
        failures.push(
          `${describe(path)} is an API route directory. The API is a separate ` +
            `deployable (SKILL.md section 2); this application calls it and never ` +
            `becomes it.`,
        );
      }

      await walk(path);
      continue;
    }

    if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
      failures.push(
        `${describe(path)} is a Next.js route handler. Business logic and data ` +
          `access belong to the API, so that all three client surfaces behave ` +
          `identically.`,
      );
      continue;
    }

    if (SOURCE.test(entry.name)) {
      const contents = await readFile(path, 'utf8');
      if (SERVER_DIRECTIVE.test(contents)) {
        failures.push(
          `${describe(path)} declares "use server". A server action is server-side ` +
            `logic the mobile clients do not have (SKILL.md section 2).`,
        );
      }
    }
  }
}

for (const directory of SEARCHED) {
  const path = join(ROOT, directory);
  try {
    if ((await stat(path)).isDirectory()) {
      await walk(path);
    }
  } catch {
    // The directory does not exist in this application yet.
  }
}

if (failures.length > 0) {
  process.stderr.write('The web application must stay a pure client:\n\n');
  for (const failure of failures) {
    process.stderr.write(`  - ${failure}\n`);
  }
  process.stderr.write('\n');
  process.exit(1);
}

process.stdout.write('web: no API routes, no server actions.\n');
