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
 * **What it cannot read, it refuses**, and the widest of those refusals is the one
 * that was missing. A table argument that is not a literal fails; a raw `sql` target
 * it cannot resolve fails; and **a builder it does not know, handed a name that is a
 * table, fails** — because the first version enumerated the builders and skipped
 * everything else, which left `crossJoin`, `crossJoinLateral`, `using`, `from`,
 * `mergeInto` and `replaceInto` invisible rather than refused. A derivation that
 * skips what it cannot read claims a completeness a declared list never claimed.
 *
 * **Its scope is `api/src`.** `api/scripts` and `api/test` are outside the walk: no
 * script roots a query, and the suite's fixtures write other modules' tables
 * constantly and are not application code. What the derivation is *required* to
 * reach is recorded as an open Stop Condition in `CLAUDE.md` rather than asserted
 * here, because a completeness claim needs a stated boundary.
 *
 * **A name that is not in `Database` is not a table** and is ignored: it is a CTE
 * or an alias. That is sound rather than lenient, because the set it is checked
 * against is itself derived.
 */
import { existsSync } from 'node:fs';
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

/**
 * Every builder that takes a table name, and what each one means.
 *
 * **The enumeration is not what makes this safe** — a closed list of builders is a list
 * somebody forgets to extend, and the first version of this file was missing six of them:
 * `crossJoin`, `crossJoinLateral`, `using`, `from`, `mergeInto` and `replaceInto`, each of
 * which reached another module's table and was not examined at all. What makes it safe is
 * the rule below it: **any call taking a known table name as its first argument must be a
 * builder this file knows, or it is refused.** A builder nobody enumerated then fails
 * loudly rather than being invisible, which is the difference between a derivation and a
 * guess.
 */
const ROOT_METHODS = new Set([
  'selectFrom',
  'updateTable',
  'insertInto',
  'deleteFrom',
  'mergeInto',
  'replaceInto',
]);
/** Builders that write. Section 2 admits no exemption here and the ledger holds no entry. */
const WRITE_METHODS = new Set([
  'updateTable',
  'insertInto',
  'deleteFrom',
  'mergeInto',
  'replaceInto',
]);
/** Builders that bring another table alongside the root. */
const JOIN_METHODS = new Set([
  'innerJoin',
  'leftJoin',
  'rightJoin',
  'fullJoin',
  'crossJoin',
  'innerJoinLateral',
  'leftJoinLateral',
  'crossJoinLateral',
  'crossApply',
  'outerApply',
]);
/**
 * Builders that name a second table and whose names are also ordinary JavaScript.
 *
 * `using` on a DELETE and `from` on an UPDATE each bring a second table the statement
 * reads, and neither is a join in SQL's grammar. They are separated from the set above
 * because `Buffer.from` and `Array.from` are everywhere: enumerating `from` as a builder
 * refused nine call sites that have nothing to do with the database, on the first run.
 *
 * **They act only on an argument that is already a known table name**, and are otherwise
 * ignored rather than refused. That is a stated hole: `updateTable(x).from(computed)` is
 * not reachable by this check. Nothing writes one, and the alternative refuses every
 * `Buffer.from` in the tree.
 */
const AMBIGUOUS_JOIN_METHODS = new Set(['using', 'from']);
/**
 * Builders whose first argument names a CTE rather than a table, and which are therefore
 * not a table reference at all.
 *
 * **A CTE named after a real table would shadow it**, and this file would then read a
 * reference to the CTE as a reference to the table. No Kysely CTE exists today and the raw
 * ones are named `upline`, `subtree` and `in_force`, so the case is recorded rather than
 * handled.
 */
const CTE_METHODS = new Set(['with', 'withRecursive']);

/**
 * Calls that may take an arrow whose body is a **subquery** rather than a fresh statement.
 *
 * This is the discriminator, and the first version got it wrong by asking only whether an
 * arrow stood anywhere above the call. `db.transaction().execute(async (trx) => ...)` puts
 * an arrow above every write path in this repository, so a genuine main-rule violation
 * inside a transaction was downgraded from a hard failure to an inventoriable entry. What
 * matters is which builder the arrow was handed to.
 */
const SUBQUERY_HOSTS = new Set([
  'where',
  'andWhere',
  'orWhere',
  'having',
  'on',
  'select',
  'exists',
  'notExists',
  'not',
  'and',
  'or',
  'whereExists',
  'whereNotExists',
]);

const problems = [];
const fail = (file, message) => problems.push({ file, message });

/**
 * `'persons as person'`, `'persons'` and `'public.persons'` all name `persons`.
 *
 * **The schema qualifier is stripped**, because the rule "a name not in `Database` is not
 * a table" is sound only if every spelling a table can take is in `Database`, and
 * `public.persons` is not. It was silently discarded as an alias until it was probed.
 */
const tableOf = (literal) => {
  const withoutAlias = literal.split(/\s+as\s+/i)[0].trim();
  const lastDot = withoutAlias.lastIndexOf('.');
  return lastDot === -1 ? withoutAlias : withoutAlias.slice(lastDot + 1);
};

const listFiles = async (dir) => {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(full)));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) found.push(full);
  }
  return found;
};

/** Always `/`, so a refusal and an inventory failure name one file one way. */
const relativeTo = (file) => path.relative(apiRoot, file).split(path.sep).join('/');

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
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      // Which builder was this arrow handed to? An expression-builder callback on `where`
      // or `exists` is a subquery; a transaction callback on `execute` is not, and every
      // write path in this repository is written inside one.
      const call = current.parent;
      if (
        call !== undefined &&
        ts.isCallExpression(call) &&
        call.arguments.some((argument) => argument === current) &&
        ts.isPropertyAccessExpression(call.expression)
      ) {
        return SUBQUERY_HOSTS.has(call.expression.name.text);
      }
      return false;
    }
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
const rawSqlReferences = (text, tables, resolveSubstitution) => {
  const roots = new Set();
  const joined = new Set();
  const writes = new Set();
  const unreadable = [];

  // **Writes are matched first and by their own keywords**, which the first version did not
  // do at all: it matched `FROM` and `JOIN` only, so `UPDATE persons SET ...` and
  // `INSERT INTO persons ...` reached nothing and a cross-module write passed silently --
  // the one clause section 2 states with no exemption. `DELETE FROM` was worse than missed,
  // being read as an ordinary `FROM` and filed as a read.
  //
  // `delete\s+from` and `insert\s+into` precede the bare `from` in the alternation so the
  // engine prefers them at the same position.
  const pattern =
    /\b(update|insert\s+into|merge\s+into|delete\s+from|from|join)\s+(\$\{[^}]*\}|[^\s(;,)]+)/gi;

  for (const match of text.matchAll(pattern)) {
    const keyword = match[1].toLowerCase().replace(/\s+/g, ' ');
    const target = match[2].trim();

    /** One target may name several tables: `sql.table(t)` where `t` is a literal union. */
    let named = null;

    if (target.startsWith('${')) {
      // **Resolved rather than refused where the answer is syntactically present.**
      // `endConfigurationWithin` writes `UPDATE ${sql.table(table)}` with `table` typed
      // `'cell_categories' | 'cell_schedules'`, both owned by the module that writes them.
      named = resolveSubstitution(target.slice(2, -1).trim());
      if (named === null) {
        unreadable.push(match[0].trim());
        continue;
      }
    } else {
      named = [target];
    }

    for (const candidate of named) {
      const table = tableOf(candidate.replace(/^["`]|["`]$/g, ''));
      if (!tables.has(table)) continue;

      if (keyword === 'join') joined.add(table);
      else if (keyword === 'from') roots.add(table);
      else {
        // update / insert into / merge into / delete from
        writes.add(table);
        roots.add(table);
      }
    }
  }

  return { roots, joined, writes, unreadable };
};

/**
 * What a `${...}` inside a raw `sql` template names, where that is decidable.
 *
 * Only one shape is decided: `sql.table(x)` where `x` is a parameter typed as a union of
 * string literals. That is the shape `endConfigurationWithin` uses to write a Cell's own
 * category and schedule rows, and the names are present in the signature rather than
 * computed. Anything else answers null and is refused by the caller, which is the half
 * that keeps the derivation honest.
 */
const resolveSqlSubstitution = (templateNode, fragment) => {
  const match = /^sql\.table\(\s*([A-Za-z_$][\w$]*)\s*\)$/.exec(fragment);
  if (match === null) return null;
  return literalTypesOfParameter(templateNode, match[1]);
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
      const first = node.arguments[0];
      const namesATable =
        first !== undefined &&
        (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) &&
        tables.has(tableOf(first.text));
      const isJoin =
        JOIN_METHODS.has(method) || (AMBIGUOUS_JOIN_METHODS.has(method) && namesATable);

      // **The rule that makes the enumeration above safe rather than hopeful.** A call
      // handing a known table name to a builder this file does not know is refused, so the
      // next builder nobody listed fails loudly instead of being skipped. Without it, six
      // table-taking builders were invisible and a cross-module join through `crossJoin`
      // passed at exit 0.
      if (!isRoot && !isJoin && !CTE_METHODS.has(method) && !AMBIGUOUS_JOIN_METHODS.has(method)) {
        if (namesATable) {
          fail(
            relativeTo(file),
            `\`${method}\` in \`${enclosingName(node)}\` is handed the table \`${tableOf(first.text)}\`, and this check does not know that builder. Enumerate it in ROOT_METHODS, JOIN_METHODS or CTE_METHODS rather than leaving it unexamined.`,
          );
        }
      }

      if (isRoot || isJoin) {
        const arg = node.arguments[0];
        const where = enclosingName(node);

        /** Every table this call can name: one literal, or a parameter's literal union. */
        let candidates = null;

        if (arg === undefined) {
          fail(relativeTo(file), `\`${method}\` with no argument in \`${where}\``);
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
            relativeTo(file),
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
        const { roots, joined, writes, unreadable } = rawSqlReferences(
          node.template.getText(),
          tables,
          (fragment) => resolveSqlSubstitution(node, fragment),
        );
        const group = groupFor(where);
        for (const table of roots) group.roots.add(table);
        for (const table of joined) group.joined.add(table);
        for (const table of writes) group.writes.add(table);
        for (const fragment of unreadable) {
          fail(
            relativeTo(file),
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

  // **Checked like everything else here.** `owners` and `crossModule` each fail in both
  // directions and this list failed in neither, so a name that matched no directory
  // granted nothing and said nothing — `idempotency` was such an entry, the module being
  // `src/common/idempotency` and therefore `common`. Naming a directory here converts
  // every future foreign root beneath it from a hard failure into a ledger line, which is
  // too large a widening to sit in an unchecked list.
  for (const name of infrastructure) {
    if (!existsSync(path.join(srcRoot, name))) {
      fail(
        'module-boundaries.json',
        `\`infrastructure\` names \`${name}\`, which is not a directory under \`src/\`.`,
      );
    }
  }

  /** Declared cross-module reads, keyed so a match can be struck off. */
  const unmatched = new Map(
    declared.map((entry) => [`${entry.file}#${entry.method}#${entry.table}#${entry.kind}`, entry]),
  );

  for (const file of await listFiles(srcRoot)) {
    const relative = relativeTo(file);
    const owner = moduleOf(file);
    const isInfrastructure = infrastructure.has(owner);
    const groups = collect(file, parse(file, await readFile(file, 'utf8')), tables);

    for (const [method, { roots, subqueries, joined, writes }] of groups) {
      /** Unowned tables belong to nobody, so anything may reach them (section 2). */
      const ownIt = (table) => owners[table] === owner || owners[table] === null;

      // **Owned by *this* module, not merely reachable.** `ownIt` also admits a table
      // section 2 assigns to nobody, so rooting in `idempotency_keys` alone would have
      // satisfied "a query rooted in a table the reading module owns" while satisfying no
      // such thing. The exemption's premise names ownership and this asks for ownership.
      const rootsItsOwn = [...roots, ...subqueries].some((table) => owners[table] === owner);

      /** The inventory is where a permitted cross-module read lives. */
      const inventory = (table, kind, describe) => {
        const key = `${relative}#${method}#${table}#${kind}`;
        if (!unmatched.has(key)) {
          fail(relative, describe(table));
          return;
        }

        unmatched.delete(key);

        // **The exempt shape is checked, not taken on the ledger's word.** Section 2
        // exempts "a read joined onto a query rooted in a table the reading module owns",
        // and membership of the ledger is not that property. Without this, a `join` entry
        // for a method that roots nothing of its own — or roots only in `idempotency_keys`,
        // which nobody owns — was admitted by being written down, which is the distinction
        // this whole file exists to draw, missed one level in.
        if ((kind === 'join' || kind === 'subquery') && !rootsItsOwn) {
          fail(
            relative,
            `\`${method}\` is inventoried as a \`${kind}\` of \`${table}\`, and it roots no query in a table \`${owner}\` owns. Section 2 exempts a read joined onto a query you root yourself; this is not that shape.`,
          );
        }
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
