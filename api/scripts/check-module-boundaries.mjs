/**
 * Every cross-module table read is named, or the build fails.
 *
 * `SKILL.md` §2 says a module owns its tables, that no other module writes them
 * and none reaches them "for anything a service interface can answer", and it
 * exempts one shape: a read joined onto a query rooted in a table the reading
 * module owns. Until the ruling of 2026-09-11 that section also *enumerated* the
 * instances of the exemption and claimed "nothing else qualifies today" — a total
 * nothing checked, which was wrong twice, and which was wrong again the day it was
 * written: `cells` joins `persons` in two places the enumeration never named.
 *
 * That ruling separates the two. §2 argues the **shape**, which is the rule; this
 * check derives the **inventory**, which is the fact. A join the ledger does not
 * name fails the build, so the list cannot silently grow — and a ledger entry
 * matching nothing fails too, so it cannot silently rot.
 *
 * **It parses TypeScript rather than scanning text**, for the reason
 * `check-screen-coverage.mjs` states at length: a scanner cannot notice that it
 * read something wrongly. `typescript` is already a dependency here, and this is
 * syntax-only — `createSourceFile`, no program and no type checker — so a string
 * is a string and a comment is a comment, decided by the same parser that compiles
 * the API.
 *
 * **The table list is derived too**, from `interface Database` in
 * `src/database/schema.ts`. A migration adding a table therefore cannot ship
 * without that table being assigned an owner, which is the half a hand-written
 * map would lose first.
 *
 * **What it cannot read, it refuses.** A table argument that is not a string
 * literal, and a raw `sql` template whose `FROM`/`JOIN` target it cannot resolve,
 * both fail rather than being skipped. A derivation that skipped what it could not
 * read would claim a completeness a declared list never claimed.
 *
 * **A name that is not in `Database` is not a table** and is ignored: it is a CTE
 * or an alias. That is sound rather than lenient, because the set it is checked
 * against is itself derived.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import tsModule from 'typescript';

const ts = tsModule.default ?? tsModule;

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');
const srcRoot = path.join(apiRoot, 'src');
const schemaFile = path.join(srcRoot, 'database', 'schema.ts');
const ledgerFile = path.join(apiRoot, 'module-boundaries.json');

/** Kysely builders that establish what a query is rooted in. */
const ROOT_METHODS = new Set(['selectFrom', 'updateTable', 'insertInto', 'deleteFrom']);
/** Kysely builders that write. */
const WRITE_METHODS = new Set(['updateTable', 'insertInto', 'deleteFrom']);
/** Kysely builders that join another table onto the root. */
const JOIN_METHODS = new Set([
  'innerJoin',
  'leftJoin',
  'rightJoin',
  'fullJoin',
  'innerJoinLateral',
  'leftJoinLateral',
]);

const problems = [];
const fail = (file, message) => problems.push({ file, message });

/** `'persons as person'` and `'persons'` both name `persons`. */
const tableOf = (literal) => literal.split(/\s+as\s+/i)[0].trim();

const listFiles = async (dir) => {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(full)));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) found.push(full);
  }
  return found;
};

const parse = (file, text) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, /* setParentNodes */ true);

// ---------------------------------------------------------------------------
// The table list, derived from the schema rather than declared
// ---------------------------------------------------------------------------

const deriveTables = (source) => {
  const tables = new Set();
  let found = false;

  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'Database') {
      found = true;
      for (const member of node.members) {
        if (!ts.isPropertySignature(member) || member.name === undefined) {
          fail('src/database/schema.ts', 'a member of `interface Database` this check cannot read');
          continue;
        }
        if (ts.isIdentifier(member.name)) tables.add(member.name.text);
        else if (ts.isStringLiteral(member.name)) tables.add(member.name.text);
        else fail('src/database/schema.ts', 'a `Database` member whose name is not a literal');
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  if (!found) fail('src/database/schema.ts', 'no `interface Database` found');
  return tables;
};

// ---------------------------------------------------------------------------
// Which module a file belongs to
// ---------------------------------------------------------------------------

const moduleOf = (file) => {
  const relative = path.relative(srcRoot, file).split(path.sep);
  return relative.length === 1 ? '<root>' : relative[0];
};

/**
 * The nearest enclosing named method or function.
 *
 * **A method beats an intervening variable**, which the first version got backwards:
 * `const rows = await db.selectFrom(...)` reported the join against `rows`, so the
 * ledger would have been keyed on local variable names and a rename would have
 * rotted it silently.
 */
const enclosingName = (node) => {
  let fallback = null;

  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (
      (ts.isMethodDeclaration(current) ||
        ts.isFunctionDeclaration(current) ||
        ts.isGetAccessorDeclaration(current) ||
        ts.isConstructorDeclaration(current)) &&
      current.name !== undefined &&
      ts.isIdentifier(current.name)
    ) {
      return current.name.text;
    }
    if (
      fallback === null &&
      (ts.isPropertyDeclaration(current) || ts.isVariableDeclaration(current)) &&
      ts.isIdentifier(current.name)
    ) {
      fallback = current.name.text;
    }
  }

  return fallback ?? '<module scope>';
};

/**
 * Whether this query is a subquery: an arrow or function expression stands between
 * it and its method, which is how Kysely writes an `EXISTS` or an anti-join.
 *
 * Section 2 draws the same line in its own words — `withoutACell` is "rooted in
 * `persons`" and "anti-joins" three Cell tables — so a nested root is inventoried
 * beside a join rather than refused as a main-rule violation.
 */
const isNested = (node) => {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) return true;
    if (
      ts.isMethodDeclaration(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isConstructorDeclaration(current)
    ) {
      return false;
    }
  }
  return false;
};

/**
 * A table argument that is an identifier may still be readable: a parameter typed as
 * a union of string literals names exactly the tables it can be. `latestWithin` in
 * `cells.closure.service.ts` is the instance — `'cell_leaderships' | 'cell_memberships'`,
 * both owned by the module that reads them.
 */
const literalTypesOfParameter = (node, name) => {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (
      !ts.isMethodDeclaration(current) &&
      !ts.isFunctionDeclaration(current) &&
      !ts.isArrowFunction(current) &&
      !ts.isFunctionExpression(current)
    ) {
      continue;
    }

    for (const parameter of current.parameters) {
      if (!ts.isIdentifier(parameter.name) || parameter.name.text !== name) continue;
      const type = parameter.type;
      if (type === undefined) return null;

      const members = ts.isUnionTypeNode(type) ? type.types : [type];
      const literals = [];
      for (const member of members) {
        if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
          literals.push(member.literal.text);
        } else {
          return null;
        }
      }
      return literals;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Deriving every table reference
// ---------------------------------------------------------------------------

/**
 * Raw SQL: the tables a `sql` template names after FROM or JOIN.
 *
 * Narrower than it looks, and deliberately so. It only *classifies* names the
 * derived schema already calls tables, so a word in a comment cannot invent one.
 * What it must not do is miss one, which is why an unresolvable FROM/JOIN target
 * is a refusal rather than a shrug.
 */
const rawSqlReferences = (text, tables) => {
  const roots = new Set();
  const joined = new Set();
  const unreadable = [];

  for (const match of text.matchAll(/\b(from|join)\s+([^\s(;,)]+)/gi)) {
    const keyword = match[1].toLowerCase();
    const target = match[2].replace(/^["`]|["`]$/g, '');

    if (target.startsWith('$') || target.startsWith('{')) {
      unreadable.push(match[0].trim());
      continue;
    }
    if (!tables.has(target)) continue;
    (keyword === 'from' ? roots : joined).add(target);
  }

  return { roots, joined, unreadable };
};

const collect = (file, source, tables) => {
  /** key: enclosing method name -> { roots, joined, writes } */
  const groups = new Map();
  const groupFor = (name) => {
    if (!groups.has(name)) {
      groups.set(name, {
        roots: new Set(),
        subqueries: new Set(),
        joined: new Set(),
        writes: new Set(),
      });
    }
    return groups.get(name);
  };

  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const isRoot = ROOT_METHODS.has(method);
      const isJoin = JOIN_METHODS.has(method);

      if (isRoot || isJoin) {
        const arg = node.arguments[0];
        const where = enclosingName(node);

        /** Every table this call can name: one literal, or a parameter's literal union. */
        let candidates = null;

        if (arg === undefined) {
          fail(path.relative(apiRoot, file), `\`${method}\` with no argument in \`${where}\``);
        } else if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
          candidates = [arg.text];
        } else if (ts.isIdentifier(arg)) {
          const literals = literalTypesOfParameter(node, arg.text);
          if (literals !== null) candidates = literals;
        }

        if (arg !== undefined && candidates === null) {
          // Refused rather than skipped: a computed table name is exactly what a
          // check claiming completeness must not wave through.
          fail(
            path.relative(apiRoot, file),
            `\`${method}\` in \`${where}\` takes a table argument this check cannot resolve to a literal`,
          );
        }

        for (const candidate of candidates ?? []) {
          const table = tableOf(candidate);
          if (!tables.has(table)) continue;

          const group = groupFor(where);
          if (isJoin) group.joined.add(table);
          else if (isNested(node)) group.subqueries.add(table);
          else group.roots.add(table);
          if (WRITE_METHODS.has(method)) group.writes.add(table);
        }
      }
    }

    if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag;
      const tagName = ts.isIdentifier(tag)
        ? tag.text
        : ts.isPropertyAccessExpression(tag)
          ? tag.name.text
          : '';

      if (tagName === 'sql' || tagName === 'raw') {
        const where = enclosingName(node);
        const { roots, joined, unreadable } = rawSqlReferences(node.template.getText(), tables);
        const group = groupFor(where);
        for (const table of roots) group.roots.add(table);
        for (const table of joined) group.joined.add(table);
        for (const fragment of unreadable) {
          fail(
            path.relative(apiRoot, file),
            `raw SQL in \`${where}\` names a table this check cannot resolve: \`${fragment}\``,
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return groups;
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const main = async () => {
  const ledger = JSON.parse(await readFile(ledgerFile, 'utf8'));
  const owners = ledger.owners ?? {};
  const declared = ledger.crossModule ?? [];

  const tables = deriveTables(parse(schemaFile, await readFile(schemaFile, 'utf8')));

  // Every derived table has exactly one owner, and every owner names a real table.
  for (const table of tables) {
    if (!(table in owners)) {
      fail(
        'module-boundaries.json',
        `\`${table}\` is a table in \`interface Database\` and the ledger assigns it no owner`,
      );
    }
  }
  for (const table of Object.keys(owners)) {
    if (!tables.has(table)) {
      fail('module-boundaries.json', `the ledger assigns an owner to \`${table}\`, which is not a table`);
    }
  }

  const infrastructure = new Set(ledger.infrastructure ?? []);

  /** Declared cross-module reads, keyed so a match can be struck off. */
  const unmatched = new Map(
    declared.map((entry) => [`${entry.file}#${entry.method}#${entry.table}#${entry.kind}`, entry]),
  );

  for (const file of await listFiles(srcRoot)) {
    const relative = path.relative(apiRoot, file).split(path.sep).join('/');
    const owner = moduleOf(file);
    const isInfrastructure = infrastructure.has(owner);
    const groups = collect(file, parse(file, await readFile(file, 'utf8')), tables);

    for (const [method, { roots, subqueries, joined, writes }] of groups) {
      /** Unowned tables belong to nobody, so anything may reach them (section 2). */
      const ownIt = (table) => owners[table] === owner || owners[table] === null;

      /** The inventory is where a permitted cross-module read lives. */
      const inventory = (table, kind, describe) => {
        const key = `${relative}#${method}#${table}#${kind}`;
        if (unmatched.has(key)) {
          unmatched.delete(key);
          return;
        }
        fail(relative, describe(table));
      };

      for (const table of writes) {
        if (ownIt(table)) continue;
        // The write side has no exemption and no inventory: section 2 is absolute here,
        // because a write is what an invariant guards.
        fail(
          relative,
          `\`${method}\` writes \`${table}\`, owned by \`${owners[table]}\`. Section 2 permits no exemption on the write side.`,
        );
      }

      for (const table of roots) {
        if (ownIt(table) || writes.has(table)) continue;

        if (isInfrastructure) {
          inventory(
            table,
            'root',
            (name) =>
              `\`${method}\` roots a query in \`${name}\`, owned by \`${owners[name]}\`, and the ledger does not name it. Shared infrastructure may reach a table, and never silently.`,
          );
          continue;
        }

        fail(
          relative,
          `\`${method}\` roots a query in \`${table}\`, owned by \`${owners[table]}\`. That is section 2's main rule, which has no exemption — ask the owning module.`,
        );
      }

      for (const table of subqueries) {
        if (ownIt(table)) continue;
        inventory(
          table,
          'subquery',
          (name) =>
            `\`${method}\` reaches \`${name}\` in a subquery, owned by \`${owners[name]}\`, and the ledger does not name it. Section 2 exempts this shape; the ledger holds the instances.`,
        );
      }

      for (const table of joined) {
        if (ownIt(table)) continue;
        inventory(
          table,
          'join',
          (name) =>
            `\`${method}\` joins \`${name}\`, owned by \`${owners[name]}\`, and the ledger does not name it. Section 2 exempts this shape; the ledger holds the instances.`,
        );
      }
    }
  }

  for (const [key, entry] of unmatched) {
    fail(
      'module-boundaries.json',
      `names a cross-module read that no longer exists: \`${key}\`. A ledger allowed to drift stops being evidence of anything.${entry.reason ? ` (Recorded reason: ${entry.reason})` : ''}`,
    );
  }

  if (problems.length > 0) {
    console.error('Section 2 module boundaries: FAILED\n');
    for (const { file, message } of problems) console.error(`  ${file}\n    ${message}\n`);
    console.error(
      `${problems.length} problem${problems.length === 1 ? '' : 's'}. SKILL.md section 2 argues the shape; module-boundaries.json holds the inventory.`,
    );
    process.exit(1);
  }

  console.log(
    `Section 2 module boundaries: OK — ${tables.size} tables, ${declared.length} inventoried cross-module read${declared.length === 1 ? '' : 's'}.`,
  );
};

await main();
