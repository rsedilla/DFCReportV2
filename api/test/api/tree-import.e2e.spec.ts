/**
 * The leadership-tree import (SKILL.md section 2, How the tree import runs).
 *
 * **These exist because section 2 states a dozen rules about this path and a
 * script cannot be tested**, which is why the writing lives in
 * `src/admin/tree-import/`. The rules: the dry run writes nothing, the actor is
 * verified, the phase must be open, the fingerprint binds the decisions to the
 * file, a commit is one transaction with no resume, and an existing Person who
 * already holds an assignment refuses rather than being reassigned as a side
 * effect.
 *
 * **The guards are exercised directly as well as through the import.** Every case
 * that reaches them through `commitTreeImport` passes if *either* the orchestration
 * or the service's own refusal is present, so together they pin the disjunction and
 * neither half — the finding CLAUDE.md records for the identifier work and again
 * for the first-Admin bootstrap.
 *
 * There are two such guards and a first version pinned only one. `PeopleImportService`
 * refuses an actor without `ADMIN` as well as a closed phase, because it is exported
 * from `PeopleModule` and anything importing that module can inject Person creation
 * with no duplicate gate and no idempotency claim. Each is called directly here, and
 * each was verified red on its own.
 *
 * Fixture names are invented (CLAUDE.md, Secrets).
 */

import { sql } from 'kysely';

import { SettingsService } from '../../src/admin/settings/settings.service';
import {
  commitTreeImport,
  dryRunTreeImport,
  PRECONDITION_CODES,
  TreeImportRefused,
} from '../../src/admin/tree-import/tree-import';
import { fingerprintOf, validateTreeCsv } from '../../src/admin/tree-import/tree-csv';
import { AuthorizationService } from '../../src/auth/authorization/authorization.service';
import { DATABASE } from '../../src/database/database.module';
import { PeopleDuplicatesService } from '../../src/people/people.duplicates.service';
import { PeopleImportService } from '../../src/people/people.import.service';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { ImportModules } from '../../src/admin/tree-import/tree-import';
import type { Actor } from '../../src/auth/authorization/authorization.service';
import type { ImportActor } from '../../src/people/people.import.service';
import type { Database } from '../../src/database/schema';

const HEADER = 'row_id,first_name,last_name,birth_date,sex,civil_status,leader_row_id';

/**
 * The shape of the real spine: two roots, one per Network, and disciples beneath
 * each. Invented names throughout — the real file lives outside this repository,
 * which is public.
 */
const SPINE = [
  HEADER,
  '1,Andres,Batungbakal,1968-04-12,MALE,MARRIED,',
  '2,Perlita,Batungbakal,1970-09-03,FEMALE,MARRIED,',
  '3,Rogelio,Ventura,1979-11-02,MALE,MARRIED,1',
  '4,Marisol,Ventura,1985-06-15,FEMALE,SINGLE,2',
  '5,Teodoro,Salazar,1990-01-20,MALE,SINGLE,3',
].join('\n');

const DECISIONS_HEADER = 'input_fingerprint,row_id,decision,member_id';

function fingerprintFor(treeCsv: string): string {
  const report = validateTreeCsv(treeCsv, { skipDuplicates: true });
  expect(report.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
  return fingerprintOf(report.rows);
}

function decisionsFor(treeCsv: string, ...rows: string[]): string {
  const fingerprint = fingerprintFor(treeCsv);
  return [DECISIONS_HEADER, ...rows.map((row) => `${fingerprint},${row}`)].join('\n') + '\n';
}

describe('the leadership-tree import (SKILL.md section 2)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let modules: ImportModules;
  let admin: Actor;
  let adminImportActor: ImportActor;

  async function countEverything() {
    const one = async (table: 'persons' | 'pastoral_assignments' | 'audit_log') =>
      Number(
        (
          await db
            .selectFrom(table)
            .select(({ fn }) => fn.countAll<string>().as('n'))
            .executeTakeFirstOrThrow()
        ).n,
      );

    return {
      persons: await one('persons'),
      assignments: await one('pastoral_assignments'),
      audit: await one('audit_log'),
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    db = createTestDb();
    modules = {
      db: app.get(DATABASE),
      people: app.get(PeopleImportService),
      duplicates: app.get(PeopleDuplicatesService),
      settings: app.get(SettingsService),
      authorization: app.get(AuthorizationService),
    };
  });

  beforeEach(async () => {
    await truncateAll(db);

    // The administrator, who is deliberately not part of the pastoral tree
    // (section 5 invariant 3, third case). They are the actor on every entry.
    const person = await createPerson(db, { firstName: 'Adelina', network: 'WOMENS' });
    const account = await createAccount(app, db, { person, roles: ['ADMIN'] });
    admin = { accountId: account.id, personId: person.id };
    // Just the identifier. The service reads the roles from `account_roles`
    // itself, which is what makes its refusal a refusal rather than an assertion
    // about a value the caller handed it.
    adminImportActor = { accountId: account.id };
  });

  afterAll(async () => {
    await db.destroy();
    await app.close();
  });

  describe('the precondition codes', () => {
    /**
     * Walked from the list rather than from the cases, which is what
     * `FINDING_CODES` and `DECISION_FINDING_CODES` each get and this list did not.
     * An `ACTOR_UNKNOWN` member survived a whole review that way: it was declared,
     * emitted nowhere, and handled in the CLI instead.
     *
     * All four are provoked, `ACTOR_AUTHORITY_UNREADABLE` included. A first version
     * excluded it, on the claim that it "cannot be provoked from here" because it
     * needs a database fault — which is wrong twice: `ImportModules` is a
     * structural interface the suite builds as an object literal, so substituting
     * an `authorization` whose `authorityFor` rejects is one line; and the same
     * docblock then justified the exclusion by conflating the two `catch` blocks in
     * `checkPreconditions`, only one of which raises this code.
     */
    it('are all emitted by something', async () => {
      const emitted = new Set<string>();

      const unreadable = await dryRunTreeImport(
        {
          ...modules,
          authorization: {
            ...modules.authorization,
            authorityFor: () => Promise.reject(new Error('connection terminated')),
          } as unknown as AuthorizationService,
        },
        { treeCsv: SPINE, actor: admin },
      );

      // It stops there rather than continuing: nothing about the account's
      // authority is known, so the other two actor codes would be guesses.
      expect(unreadable.preconditions.map((finding) => finding.code)).toEqual([
        'ACTOR_AUTHORITY_UNREADABLE',
      ]);
      for (const finding of unreadable.preconditions) {
        emitted.add(finding.code);
      }

      const person = await createPerson(db, { firstName: 'Bienvenido', network: 'MENS' });
      const account = await createAccount(app, db, {
        person,
        roles: ['LEADER'],
        grantedBy: admin.accountId,
      });
      const leader: Actor = { accountId: account.id, personId: person.id };

      for (const finding of (await dryRunTreeImport(modules, { treeCsv: SPINE, actor: leader }))
        .preconditions) {
        emitted.add(finding.code);
      }

      await db
        .updateTable('settings')
        .set({ value: sql`'false'::jsonb` })
        .where('key', '=', 'initial_encoding_open')
        .execute();

      for (const finding of (await dryRunTreeImport(modules, { treeCsv: SPINE, actor: admin }))
        .preconditions) {
        emitted.add(finding.code);
      }

      expect([...emitted].sort()).toEqual(PRECONDITION_CODES.slice().sort());
    });

    it('does not report an unexpected failure as a missing capability', async () => {
      // The narrowing this batch added and did not pin: a bare `catch {}` around
      // `authorize` reported *any* failure as `ACTOR_LACKS_CAPABILITY`, which sends
      // an operator to fix a grant that is not the problem. Reverting it leaves the
      // suite green without this.
      const broken = {
        ...modules,
        authorization: {
          ...modules.authorization,
          authorityFor: modules.authorization.authorityFor.bind(modules.authorization),
          authorize: () => Promise.reject(new Error('connection terminated')),
        } as unknown as AuthorizationService,
      };

      await expect(dryRunTreeImport(broken, { treeCsv: SPINE, actor: admin })).rejects.toThrow(
        /connection terminated/,
      );
    });
  });

  describe('the dry run', () => {
    it('writes nothing — no Person, no assignment, no audit entry', async () => {
      const before = await countEverything();
      const report = await dryRunTreeImport(modules, { treeCsv: SPINE, actor: admin });

      expect(report.preconditions).toEqual([]);
      expect(report.tree.summary.rowCount).toBe(5);
      expect(await countEverything()).toEqual(before);
    });

    it('emits a fingerprint and a decisions template', async () => {
      const report = await dryRunTreeImport(modules, { treeCsv: SPINE, actor: admin });

      expect(report.fingerprint).toBe(fingerprintFor(SPINE));
      expect(report.decisionsTemplate).toContain(DECISIONS_HEADER);
    });

    it('names only the rows that matched an existing Person', async () => {
      // The administrator is in `persons` and matches nobody in the file, so a
      // clean spine has nothing to adjudicate.
      const clean = await dryRunTreeImport(modules, { treeCsv: SPINE, actor: admin });
      expect(clean.matched).toEqual([]);

      // A Person who is one of the rows. Same name and same birthday is Tier 1.
      const existing = await db
        .insertInto('persons')
        .values({
          first_name: 'Marisol',
          last_name: 'Ventura',
          birth_date: '1985-06-15',
          sex: 'FEMALE',
          civil_status: 'SINGLE',
        })
        .returning('member_id')
        .executeTakeFirstOrThrow();

      const report = await dryRunTreeImport(modules, { treeCsv: SPINE, actor: admin });

      expect(report.matched.map((row) => row.rowId)).toEqual(['4']);
      expect(report.tier1RowIds).toEqual(new Set(['4']));
      expect(report.matched[0].candidates[0].memberId).toBe(existing.member_id);
      // Only the matched row appears in the template, which is section 2's rule
      // and the reason a three-thousand-row file does not get returned unread.
      expect(report.decisionsTemplate).toBe(`${DECISIONS_HEADER}\n${report.fingerprint},4,,\n`);
    });

    it('lists every root row, matched or not', async () => {
      // The warning printed from this is the only thing telling an adjudicator that
      // a root decision cannot be undone, and a first version carried the flag on
      // matched rows alone — so a root row matching nobody was never warned. That
      // is the reachable case: `readDecisionsCsv` accepts USE_EXISTING for any
      // row_id with any well-shaped Member ID, candidate or not.
      const clean = await dryRunTreeImport(modules, { treeCsv: SPINE, actor: admin });

      expect(clean.matched).toEqual([]);
      expect(clean.rootRows).toEqual([
        { line: 2, rowId: '1' },
        { line: 3, rowId: '2' },
      ]);
    });

    it('marks a matched root row as one', async () => {
      // Perlita is row 2, the Women's root. Same names and same birthday is Tier 1.
      await db
        .insertInto('persons')
        .values({
          first_name: 'Perlita',
          last_name: 'Batungbakal',
          birth_date: '1970-09-03',
          sex: 'FEMALE',
          civil_status: 'MARRIED',
        })
        .execute();

      const report = await dryRunTreeImport(modules, { treeCsv: SPINE, actor: admin });
      const row = report.matched.find((matched) => matched.rowId === '2');

      expect(row?.isRoot).toBe(true);
      // And the non-root rows are not marked, so the flag is not simply constant.
      expect(report.matched.filter((matched) => matched.isRoot)).toHaveLength(1);
    });

    it('stops before the matcher where the file is refused', async () => {
      // Every candidate would be computed against rows whose leader references may
      // not resolve, and the decisions file built from it would key on a
      // fingerprint of a tree nobody can import.
      const cycle = [
        HEADER,
        '1,Andres,Batungbakal,1968-04-12,MALE,MARRIED,',
        '2,Perlita,Batungbakal,1970-09-03,FEMALE,MARRIED,',
        '3,Rogelio,Ventura,1979-11-02,MALE,MARRIED,5',
        '5,Teodoro,Salazar,1990-01-20,MALE,SINGLE,3',
      ].join('\n');

      const report = await dryRunTreeImport(modules, { treeCsv: cycle, actor: admin });

      expect(report.fingerprint).toBeNull();
      expect(report.decisionsTemplate).toBeNull();
      expect(report.matched).toEqual([]);
      expect(report.tree.findings.map((finding) => finding.code)).toContain('CYCLE');
    });
  });

  describe('the actor (section 2)', () => {
    it('must hold ADMIN, not merely the two capabilities at Whole Church', async () => {
      // **The escalation this closes.** Neither `people.create` nor
      // `people.manage_pastoral_assignment` is in `WHOLE_CHURCH_ONLY`, so an
      // explicit Admin-issued Whole Church grant of both to a LEADER account is
      // representable — and the capability check alone accepted it. Section 5
      // invariant 4 is decided by *role* (2026-08-23), and every assignment the
      // import opens is a first assignment that never reaches it, so such an
      // account could name its own Person on a USE_EXISTING row and place itself
      // anywhere in either tree.
      const person = await createPerson(db, { firstName: 'Bienvenido', network: 'MENS' });
      const account = await createAccount(app, db, {
        person,
        roles: ['LEADER'],
        grantedBy: admin.accountId,
      });

      for (const capability of ['people.create', 'people.manage_pastoral_assignment']) {
        await db
          .insertInto('capability_grants')
          .values({
            account_id: account.id,
            capability: capability as 'people.create',
            scope_type: 'WHOLE_CHURCH',
            scope_network: null,
            read_only: false,
            granted_by: admin.accountId,
            reason: 'Fixture: the grant that made this escalation representable.',
          })
          .execute();
      }

      const granted: Actor = { accountId: account.id, personId: person.id };
      const report = await dryRunTreeImport(modules, { treeCsv: SPINE, actor: granted });

      // The capabilities pass; the role does not. Both halves asserted, because a
      // case checking only "refused" would pass against the version that refused
      // for the capability reason and never grew a role check.
      expect(report.preconditions.map((finding) => finding.code)).toEqual(['ACTOR_NOT_ADMIN']);

      await expect(
        commitTreeImport(modules, {
          treeCsv: SPINE,
          decisionsCsv: decisionsFor(SPINE),
          actor: granted,
        }),
      ).rejects.toBeInstanceOf(TreeImportRefused);

      expect((await countEverything()).persons).toBe(2);
    });

    it('is refused where they do not hold the capabilities at Whole Church', async () => {
      const person = await createPerson(db, { firstName: 'Bienvenido', network: 'MENS' });
      const account = await createAccount(app, db, {
        person,
        roles: ['LEADER'],
        grantedBy: admin.accountId,
      });
      const leader: Actor = { accountId: account.id, personId: person.id };

      // All three, and every one reported rather than the first: an operator
      // fixing a grant wants the list, and handing them one refusal at a time
      // turns a two-minute correction into three runs.
      const report = await dryRunTreeImport(modules, { treeCsv: SPINE, actor: leader });
      expect(report.preconditions.map((finding) => finding.code)).toEqual([
        'ACTOR_NOT_ADMIN',
        'ACTOR_LACKS_CAPABILITY',
        'ACTOR_LACKS_CAPABILITY',
      ]);

      // And the commit refuses rather than merely reporting.
      await expect(
        commitTreeImport(modules, {
          treeCsv: SPINE,
          decisionsCsv: decisionsFor(SPINE),
          actor: leader,
        }),
      ).rejects.toBeInstanceOf(TreeImportRefused);

      expect((await countEverything()).persons).toBe(2);
    });
  });

  describe('the initial-encoding phase (section 2)', () => {
    async function closePhase() {
      await db
        .updateTable('settings')
        .set({ value: sql`'false'::jsonb` })
        .where('key', '=', 'initial_encoding_open')
        .execute();
    }

    it('refuses the import once the phase is closed', async () => {
      await closePhase();

      const report = await dryRunTreeImport(modules, { treeCsv: SPINE, actor: admin });
      expect(report.preconditions.map((finding) => finding.code)).toEqual([
        'ENCODING_PHASE_CLOSED',
      ]);

      await expect(
        commitTreeImport(modules, {
          treeCsv: SPINE,
          decisionsCsv: decisionsFor(SPINE),
          actor: admin,
        }),
      ).rejects.toBeInstanceOf(TreeImportRefused);
    });

    it('is refused by the service itself, not only by the import', async () => {
      // The disjunction this file exists to avoid pinning. `createForImportWithin`
      // is public on a service the injector resolves, and what it offers is Person
      // creation with no duplicate gate — so its refusal has to hold when the
      // orchestration is not there to have checked first.
      await closePhase();

      await expect(
        db.transaction().execute((trx) =>
          modules.people.createForImportWithin(
            trx,
            {
              firstName: 'Teodoro',
              middleName: null,
              lastName: 'Salazar',
              birthDate: null,
              sex: 'MALE',
              civilStatus: 'SINGLE',
              placement: { kind: 'ROOT' },
              encodedAt: new Date(),
            },
            adminImportActor,
            'batch',
          ),
        ),
      ).rejects.toThrow(/initial-encoding phase is closed/);

      expect((await countEverything()).persons).toBe(1);
    });

    it('refuses a non-Admin actor at the service, not only at the import door', async () => {
      // The door this file's header is about. `PeopleImportService` is exported
      // from `PeopleModule`, so any module importing it can inject these methods —
      // and a first version put the ADMIN check only in `admin/tree-import`, then
      // said in three places that it was closed "for the whole run".
      const person = await createPerson(db, { firstName: 'Bienvenido', network: 'MENS' });
      const account = await createAccount(app, db, {
        person,
        roles: ['LEADER'],
        grantedBy: admin.accountId,
      });
      const leaderActor: ImportActor = { accountId: account.id };

      await expect(
        db.transaction().execute((trx) =>
          modules.people.createForImportWithin(
            trx,
            {
              firstName: 'Teodoro',
              middleName: null,
              lastName: 'Salazar',
              birthDate: null,
              sex: 'MALE',
              civilStatus: 'SINGLE',
              placement: { kind: 'ROOT' },
              encodedAt: new Date(),
            },
            leaderActor,
            'batch',
          ),
        ),
      ).rejects.toThrow(/runs as an Admin account/);

      // The phase is open here, so this is the role check refusing and nothing else.
      expect((await countEverything()).persons).toBe(2);
    });

    it('reads the role from `account_roles`, not from anything the caller passed', async () => {
      // The property that makes this a refusal rather than an assertion, and the
      // one the version before it did not have: `ImportActor` carried the actor's
      // `ActorAuthority` and the check read the role out of it, so a caller could
      // hand over `{ roles: ['ADMIN'] }` and satisfy it.
      //
      // Revoking the row is what distinguishes the two implementations. The
      // identifier the caller passes is unchanged and still names an account that
      // held ADMIN a moment ago; only the table has moved.
      // `now()` rather than a JS `Date`. `account_roles_period_ordered` is
      // `revoked_at IS NULL OR revoked_at >= granted_at`, so strictness is not the
      // hazard — what fails is a test machine's clock landing behind the server's,
      // which puts a JS `Date` before the `granted_at` this row was written with.
      await db
        .updateTable('account_roles')
        .set({ revoked_at: sql<Date>`now()` })
        .where('account_id', '=', admin.accountId)
        .execute();

      await expect(
        db.transaction().execute((trx) =>
          modules.people.createForImportWithin(
            trx,
            {
              firstName: 'Teodoro',
              middleName: null,
              lastName: 'Salazar',
              birthDate: null,
              sex: 'MALE',
              civilStatus: 'SINGLE',
              placement: { kind: 'ROOT' },
              encodedAt: new Date(),
            },
            adminImportActor,
            'batch',
          ),
        ),
      ).rejects.toThrow(/runs as an Admin account/);
    });

    it('is refused by `attachExistingWithin` too', async () => {
      const person = await createPerson(db, { firstName: 'Corazon', network: 'WOMENS' });
      const leader = await createPerson(db, { firstName: 'Dalisay', network: 'WOMENS' });
      await closePhase();

      await expect(
        db.transaction().execute((trx) =>
          modules.people.attachExistingWithin(
            trx,
            {
              personId: person.id,
              memberId: 'M-000001',
              placement: { kind: 'UNDER', pastoralLeaderId: leader.id },
              encodedAt: new Date(),
            },
            adminImportActor,
            'batch',
          ),
        ),
      ).rejects.toThrow(/initial-encoding phase is closed/);
    });
  });

  describe('the commit', () => {
    it('creates the whole tree, leaders before their disciples', async () => {
      const result = await commitTreeImport(modules, {
        treeCsv: SPINE,
        decisionsCsv: decisionsFor(SPINE),
        actor: admin,
      });

      expect(result.created).toHaveLength(5);
      expect(result.reused).toEqual([]);

      const people = await db
        .selectFrom('persons')
        .select(['id', 'first_name', 'last_name', 'birth_date', 'sex'])
        .where('first_name', '!=', 'Adelina')
        .execute();
      expect(people).toHaveLength(5);

      const idOf = (firstName: string) => people.find((p) => p.first_name === firstName)!.id;

      const edges = await db
        .selectFrom('pastoral_assignments')
        .select(['person_id', 'leader_id', 'root_network', 'started_at'])
        .where('ended_at', 'is', null)
        .execute();

      // The two roots carry a null leader and their Network's seat, which is what
      // makes them roots rather than merely unassigned (section 5, 2026-08-23).
      expect(edges).toContainEqual(
        expect.objectContaining({
          person_id: idOf('Andres'),
          leader_id: null,
          root_network: 'MENS',
        }),
      );
      expect(edges).toContainEqual(
        expect.objectContaining({
          person_id: idOf('Perlita'),
          leader_id: null,
          root_network: 'WOMENS',
        }),
      );

      // A disciple's edge names the leader their row named, which is the whole
      // point of `leader_row_id` rather than a leader's name (section 2).
      expect(edges).toContainEqual(
        expect.objectContaining({ person_id: idOf('Rogelio'), leader_id: idOf('Andres') }),
      );
      expect(edges).toContainEqual(
        expect.objectContaining({ person_id: idOf('Marisol'), leader_id: idOf('Perlita') }),
      );
      // Two levels down, which is what proves the walk is leaders-first rather
      // than file order: row 5 names row 3, which is created after the roots.
      expect(edges).toContainEqual(
        expect.objectContaining({ person_id: idOf('Teodoro'), leader_id: idOf('Rogelio') }),
      );
    });

    it('gives every row of one import the same effective instant', async () => {
      // Section 2: every assignment created this way takes the encoding date, and
      // nothing is backdated. One instant, so a month boundary cannot fall inside
      // one import.
      const result = await commitTreeImport(modules, {
        treeCsv: SPINE,
        decisionsCsv: decisionsFor(SPINE),
        actor: admin,
      });

      const starts = await db
        .selectFrom('pastoral_assignments')
        .select('started_at')
        .distinct()
        .execute();

      expect(starts).toHaveLength(1);
      expect(starts[0].started_at.getTime()).toBe(result.encodedAt.getTime());
    });

    it('writes one audit entry per Person, all sharing the batch identifier', async () => {
      // Section 2: a single entry for an import touching thousands of Persons
      // records no target and no before-and-after values, which section 21 requires.
      const result = await commitTreeImport(modules, {
        treeCsv: SPINE,
        decisionsCsv: decisionsFor(SPINE),
        actor: admin,
      });

      const entries = await db
        .selectFrom('audit_log')
        .select(['action', 'target_id', 'actor_id', 'batch_id', 'after'])
        .where('batch_id', '=', result.batchId)
        .execute();

      expect(entries).toHaveLength(5);
      expect(entries.every((entry) => entry.action === 'person.created')).toBe(true);
      // Section 3's acknowledgement has to survive into the system. Nothing
      // matched here, so the list is empty — the field's presence is what a later
      // acknowledgement is recorded in, and its absence is what left that decision
      // living only in an operator's spreadsheet.
      expect(entries[0].after).toHaveProperty('acknowledged_duplicate_member_ids', []);
      expect(entries.every((entry) => entry.actor_id === admin.accountId)).toBe(true);
      // Section 21 wants the values, not merely that it happened.
      const andres = entries.find(
        (entry) => (entry.after as Record<string, unknown>).first_name === 'Andres',
      )!;
      expect(andres.after).toMatchObject({ network: 'MENS', network_root: true });
    });

    it('assigns each Person the Network their sex gives them (section 4)', async () => {
      await commitTreeImport(modules, {
        treeCsv: SPINE,
        decisionsCsv: decisionsFor(SPINE),
        actor: admin,
      });

      const rows = await db
        .selectFrom('persons')
        .innerJoin('network_assignments', 'network_assignments.person_id', 'persons.id')
        .select(['persons.sex', 'network_assignments.network'])
        .where('network_assignments.ended_at', 'is', null)
        .where('persons.first_name', '!=', 'Adelina')
        .execute();

      expect(rows).toHaveLength(5);
      for (const row of rows) {
        expect(row.network).toBe(row.sex === 'MALE' ? 'MENS' : 'WOMENS');
      }
    });

    it('refuses a decisions file whose fingerprint no longer matches', async () => {
      const decisions = decisionsFor(SPINE, '4,CREATE,');
      const edited = SPINE.replace('1985-06-15', '1985-06-16');

      await expect(
        commitTreeImport(modules, { treeCsv: edited, decisionsCsv: decisions, actor: admin }),
      ).rejects.toMatchObject({
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'FINGERPRINT_MISMATCH' }),
        ]),
      });

      expect((await countEverything()).persons).toBe(1);
    });

    it('writes nothing at all when it fails part-way', async () => {
      // Section 2: a commit is one transaction and there is no resume. A failure
      // writes nothing; the file is corrected and the import run again.
      //
      // Row 5 names a Member ID nobody carries, and it is the *last* row the walk
      // reaches — so four Persons have been created by the time it throws.
      const decisions = decisionsFor(SPINE, '5,USE_EXISTING,M-999999');

      await expect(
        commitTreeImport(modules, { treeCsv: SPINE, decisionsCsv: decisions, actor: admin }),
      ).rejects.toThrow(/M-999999/);

      const counts = await countEverything();
      expect(counts.persons).toBe(1); // the administrator, and nobody else
      expect(counts.assignments).toBe(0);
      expect(counts.audit).toBe(0);
    });

    it('refuses where a Tier 1 candidate was never acknowledged', async () => {
      await db
        .insertInto('persons')
        .values({
          first_name: 'Marisol',
          last_name: 'Ventura',
          birth_date: '1985-06-15',
          sex: 'FEMALE',
          civil_status: 'SINGLE',
        })
        .execute();

      await expect(
        commitTreeImport(modules, {
          treeCsv: SPINE,
          decisionsCsv: decisionsFor(SPINE),
          actor: admin,
        }),
      ).rejects.toMatchObject({
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'TIER1_UNACKNOWLEDGED', rowId: '4' }),
        ]),
      });
    });

    it('records which Tier 1 candidates a CREATE was decided past', async () => {
      // Section 3's acknowledgement is the whole reason section 2 built two
      // phases, and without this it exists only in the operator's spreadsheet —
      // outside the system and outside `audit_log`. Section 21 asks for the
      // relevant values, and "who was on the table and passed over" is the
      // relevant value for this path.
      const existing = await db
        .insertInto('persons')
        .values({
          first_name: 'Marisol',
          last_name: 'Ventura',
          birth_date: '1985-06-15',
          sex: 'FEMALE',
          civil_status: 'SINGLE',
        })
        .returning('member_id')
        .executeTakeFirstOrThrow();

      const result = await commitTreeImport(modules, {
        treeCsv: SPINE,
        decisionsCsv: decisionsFor(SPINE, '4,CREATE,'),
        actor: admin,
      });

      const entries = await db
        .selectFrom('audit_log')
        .select('after')
        .where('batch_id', '=', result.batchId)
        .execute();

      const marisol = entries.find(
        (entry) => (entry.after as Record<string, unknown>).first_name === 'Marisol',
      )!;
      expect(marisol.after).toHaveProperty('acknowledged_duplicate_member_ids', [
        existing.member_id,
      ]);
    });

    it('records only the Tier 1 candidates, not every candidate on the row', async () => {
      // The inner filter, which had nothing able to fail on it: the previous case
      // gave the row exactly one candidate and it was Tier 1, so deleting the
      // candidate-level filter kept the suite green while writing Tier 2 candidates
      // into `audit_log` as acknowledged. Section 3 asks nothing of a person
      // reading a Tier 2 list, so such an entry asserts an acknowledgement that was
      // neither given nor required.
      const tier1 = await db
        .insertInto('persons')
        .values({
          first_name: 'Marisol',
          last_name: 'Ventura',
          birth_date: '1985-06-15',
          sex: 'FEMALE',
          civil_status: 'SINGLE',
        })
        .returning('member_id')
        .executeTakeFirstOrThrow();

      // Same names, no birthday — Tier 2, because section 3 drops a candidate a
      // tier when less is known rather than claiming more.
      const tier2 = await db
        .insertInto('persons')
        .values({
          first_name: 'Marisol',
          last_name: 'Ventura',
          birth_date: null,
          sex: 'FEMALE',
          civil_status: 'SINGLE',
        })
        .returning('member_id')
        .executeTakeFirstOrThrow();

      const report = await dryRunTreeImport(modules, { treeCsv: SPINE, actor: admin });
      const row = report.matched.find((matched) => matched.rowId === '4')!;
      // The fixture is only worth anything if it really produced both tiers.
      expect(row.candidates.map((candidate) => candidate.tier).sort()).toEqual([1, 2]);

      const result = await commitTreeImport(modules, {
        treeCsv: SPINE,
        decisionsCsv: decisionsFor(SPINE, '4,CREATE,'),
        actor: admin,
      });

      const entries = await db
        .selectFrom('audit_log')
        .select('after')
        .where('batch_id', '=', result.batchId)
        .execute();

      const marisol = entries.find(
        (entry) => (entry.after as Record<string, unknown>).first_name === 'Marisol',
      )!;
      expect(marisol.after).toHaveProperty('acknowledged_duplicate_member_ids', [tier1.member_id]);
      expect(JSON.stringify(marisol.after)).not.toContain(tier2.member_id);
    });

    it('catches a Tier 1 candidate created after the dry run', async () => {
      // The gap the fingerprint cannot close, in the half that *is* closed: the
      // fingerprint covers the input file and says nothing about the database, and
      // a Person arriving between the two runs gives row 4 its first Tier 1
      // candidate. The decisions file has nothing for that row, so it refuses.
      const report = await dryRunTreeImport(modules, { treeCsv: SPINE, actor: admin });
      expect(report.matched).toEqual([]);
      const decisions = report.decisionsTemplate!;

      await db
        .insertInto('persons')
        .values({
          first_name: 'Marisol',
          last_name: 'Ventura',
          birth_date: '1985-06-15',
          sex: 'FEMALE',
          civil_status: 'SINGLE',
        })
        .execute();

      await expect(
        commitTreeImport(modules, { treeCsv: SPINE, decisionsCsv: decisions, actor: admin }),
      ).rejects.toMatchObject({
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'TIER1_UNACKNOWLEDGED' }),
        ]),
      });
    });
  });

  describe('USE_EXISTING (section 2)', () => {
    async function existingMarisol(options: { archived?: boolean } = {}) {
      const person = await db
        .insertInto('persons')
        .values({
          first_name: 'Marisol',
          last_name: 'Ventura',
          birth_date: '1985-06-15',
          sex: 'FEMALE',
          civil_status: 'SINGLE',
        })
        .returning(['id', 'member_id'])
        .executeTakeFirstOrThrow();

      await db
        .insertInto('network_assignments')
        .values({
          person_id: person.id,
          network: 'WOMENS',
          started_at: new Date('2020-01-01T00:00:00+08:00'),
        })
        .execute();

      await db
        .insertInto('person_lifecycle')
        .values({
          person_id: person.id,
          state: options.archived ? 'ARCHIVED' : 'CURRENT',
          reason: options.archived ? 'NO_LONGER_IN_CURRENT_NETWORK' : null,
          started_at: new Date('2020-01-01T00:00:00+08:00'),
        })
        .execute();

      return person;
    }

    it('gives the existing Person the assignment the tree gives them, drawing no Member ID', async () => {
      const existing = await existingMarisol();
      const before = await db
        .selectFrom('persons')
        .select(({ fn }) => fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow();

      const result = await commitTreeImport(modules, {
        treeCsv: SPINE,
        decisionsCsv: decisionsFor(SPINE, `4,USE_EXISTING,${existing.member_id}`),
        actor: admin,
      });

      expect(result.created).toHaveLength(4);
      expect(result.reused).toEqual([
        expect.objectContaining({ rowId: '4', memberId: existing.member_id }),
      ]);

      // Four created, so the total rises by four rather than five: no Person was
      // created for row 4 and no Member ID was drawn from the sequence.
      const after = await db
        .selectFrom('persons')
        .select(({ fn }) => fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow();
      expect(Number(after.n)).toBe(Number(before.n) + 4);

      const edge = await db
        .selectFrom('pastoral_assignments')
        .select('leader_id')
        .where('person_id', '=', existing.id)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();
      expect(edge.leader_id).not.toBeNull();
    });

    it('refuses where that Person already holds an active assignment', async () => {
      // Section 2: proceeding means closing the one they have, which is a
      // reassignment carrying its own authorization and its own audit entry. The
      // person who decided these two records are one person was never asked
      // whether to move anybody.
      const existing = await existingMarisol();
      // Deliberately *not* a root. The Women's root seat is the one the import is
      // about to take for row 2, and a fixture holding it refuses the import for a
      // reason that has nothing to do with this case (section 5, migration 0008).
      const someoneElse = await createPerson(db, { firstName: 'Corazon', network: 'WOMENS' });
      await assignTo(db, existing.id, someoneElse.id);

      await expect(
        commitTreeImport(modules, {
          treeCsv: SPINE,
          decisionsCsv: decisionsFor(SPINE, `4,USE_EXISTING,${existing.member_id}`),
          actor: admin,
        }),
      ).rejects.toThrow(/already holds an active pastoral assignment/);

      // And nothing of the import survives it.
      expect((await countEverything()).persons).toBe(3);
    });

    it('refuses an archived Person', async () => {
      const existing = await existingMarisol({ archived: true });

      await expect(
        commitTreeImport(modules, {
          treeCsv: SPINE,
          decisionsCsv: decisionsFor(SPINE, `4,USE_EXISTING,${existing.member_id}`),
          actor: admin,
        }),
      ).rejects.toThrow(/archived/);
    });

    it('refuses a Person whose recorded sex differs from the file', async () => {
      // Sex decides Network (section 4), and changing it is `people.correct_sex` —
      // Admin only, audited, and forcing a pastoral reassignment. An import that
      // did it quietly would move a person between Networks with nothing to say so.
      const existing = await existingMarisol();

      await expect(
        commitTreeImport(modules, {
          // Row 3 is MALE; naming a FEMALE Person for it is the mismatch. Row 4 is
          // answered too, because this Person is a Tier 1 candidate for it and an
          // unanswered Tier 1 would refuse the file before the walk ever runs.
          treeCsv: SPINE,
          decisionsCsv: decisionsFor(SPINE, `3,USE_EXISTING,${existing.member_id}`, '4,CREATE,'),
          actor: admin,
        }),
      ).rejects.toThrow(/people\.correct_sex/);
    });

    it('seats an existing Person as a Network root, taking the Network from their row', async () => {
      // Section 2 says a row resolving to an existing Person "receives the pastoral
      // assignment the tree gives them" and states no exception for a root row;
      // section 5's "a root is created only by the initial import" is about
      // creating the root *row*, which is what this does. This was refused for one
      // commit, on a rule invented in a service.
      //
      // The Network comes from `network_assignments`, not from sex — the same read
      // the UNDER branch uses, and the one migration 0008's index compares the seat
      // against.
      const adminMemberId = await db
        .selectFrom('persons')
        .select('member_id')
        .where('id', '=', admin.personId)
        .executeTakeFirstOrThrow();

      // Row 2 is the Women's root and the administrator is FEMALE, so the sex check
      // passes and the seat is legal.
      const result = await commitTreeImport(modules, {
        treeCsv: SPINE,
        decisionsCsv: decisionsFor(SPINE, `2,USE_EXISTING,${adminMemberId.member_id}`),
        actor: admin,
      });

      expect(result.reused).toEqual([
        expect.objectContaining({ rowId: '2', memberId: adminMemberId.member_id }),
      ]);

      const seat = await db
        .selectFrom('pastoral_assignments')
        .select(['leader_id', 'root_network'])
        .where('person_id', '=', admin.personId)
        .where('ended_at', 'is', null)
        .executeTakeFirstOrThrow();

      expect(seat).toEqual({ leader_id: null, root_network: 'WOMENS' });
    });

    it('refuses a Person with no Network recorded, rather than failing at COMMIT', async () => {
      // `attachExistingWithin` writes no Network row, so the edge is checked
      // against the one already recorded. A Person carrying none has no Network
      // for the edge to be legal in, and deriving one from their sex would let the
      // pre-check pass on a value the database does not hold — the deferred
      // trigger then raises a raw `check_violation` at COMMIT.
      const person = await db
        .insertInto('persons')
        .values({
          first_name: 'Marisol',
          last_name: 'Ventura',
          birth_date: '1985-06-15',
          sex: 'FEMALE',
          civil_status: 'SINGLE',
        })
        .returning('member_id')
        .executeTakeFirstOrThrow();

      await db
        .insertInto('person_lifecycle')
        .values({
          person_id: (
            await db
              .selectFrom('persons')
              .select('id')
              .where('member_id', '=', person.member_id)
              .executeTakeFirstOrThrow()
          ).id,
          state: 'CURRENT',
          started_at: new Date('2020-01-01T00:00:00+08:00'),
        })
        .execute();

      await expect(
        commitTreeImport(modules, {
          treeCsv: SPINE,
          decisionsCsv: decisionsFor(SPINE, `4,USE_EXISTING,${person.member_id}`),
          actor: admin,
        }),
      ).rejects.toThrow(/no Network recorded/);
    });

    it('refuses a Member ID nobody carries', async () => {
      await expect(
        commitTreeImport(modules, {
          treeCsv: SPINE,
          decisionsCsv: decisionsFor(SPINE, '4,USE_EXISTING,M-999999'),
          actor: admin,
        }),
      ).rejects.toThrow(/M-999999/);
    });
  });
});
