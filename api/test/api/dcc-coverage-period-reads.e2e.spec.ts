import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { Client } from 'pg';

import {
  DccCoverageService,
  type DccCoverageScope,
} from '../../src/attendance/dcc-coverage.service';
import { recordingInstant } from '../../src/attendance/recording-instant';
import { canonicalId } from '../../src/common/identifiers';
import { databaseNow } from '../../src/common/time/submission-window';
import { HierarchyService } from '../../src/hierarchy/hierarchy.service';
import { NetworksService } from '../../src/networks/networks.service';
import { createTestDb, truncateAll } from '../setup/database';
import { assignTo, createAccount, createPerson, createTestApp } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../src/database/schema';
import type { TestAccount, TestPerson } from '../setup/fixtures';

/**
 * A period's DCC coverage reads the period once rather than once per Sunday (checklist row
 * perf-year-view), and answers exactly what the per-Sunday reading answered.
 *
 * **The oracle is the per-Sunday algorithm the service used before**, rebuilt here from the
 * same public pieces: the scope walked at each Sunday's instant (`subtreeAsOf`,
 * `peopleInNetworkAsOf`), the edges in force then (`edgesAsOf`), and the leaders a live
 * record names. A removed Sunday owes nothing.
 *
 * 2020 is closed and in the past, so no case reads the clock. The tree is
 * `Raymond -> { Manuel -> { Mark -> Anacleto, Pio }, Onofre -> Benigno }` in the Men's
 * Network and `Oriel -> Carmelita` in the Women's. Anacleto moves from Mark to Onofre on
 * 15 April, Pio joins under Manuel on 20 April, and Sunday 12 April is removed. Names are
 * invented (CLAUDE.md, Secrets).
 */
describe('a period of DCC coverage, read once (perf-year-view)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let coverage: DccCoverageService;
  let hierarchy: HierarchyService;
  let networks: NetworksService;

  let raymond: TestPerson;
  let manuel: TestPerson;
  let mark: TestPerson;
  let onofre: TestPerson;
  let anacleto: TestPerson;
  let benigno: TestPerson;
  let pio: TestPerson;
  let oriel: TestPerson;
  let carmelita: TestPerson;
  let admin: TestAccount;

  const events = new Map<string, string>();

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
    coverage = app.get(DccCoverageService);
    hierarchy = app.get(HierarchyService);
    networks = app.get(NetworksService);
  });

  beforeEach(async () => {
    await truncateAll(db);
    events.clear();

    raymond = await createPerson(db, { firstName: 'Raymond', network: 'MENS' });
    manuel = await createPerson(db, { firstName: 'Manuel', network: 'MENS' });
    mark = await createPerson(db, { firstName: 'Mark', network: 'MENS' });
    onofre = await createPerson(db, { firstName: 'Onofre', network: 'MENS' });
    anacleto = await createPerson(db, { firstName: 'Anacleto', network: 'MENS' });
    benigno = await createPerson(db, { firstName: 'Benigno', network: 'MENS' });
    pio = await createPerson(db, { firstName: 'Pio', network: 'MENS' });
    oriel = await createPerson(db, { firstName: 'Oriel', network: 'WOMENS' });
    carmelita = await createPerson(db, { firstName: 'Carmelita', network: 'WOMENS' });

    await assignTo(db, raymond.id, null);
    await assignTo(db, manuel.id, raymond.id);
    await assignTo(db, mark.id, manuel.id);
    await assignTo(db, onofre.id, raymond.id);
    await assignTo(db, anacleto.id, mark.id);
    await assignTo(db, benigno.id, onofre.id);
    await assignTo(db, oriel.id, null);
    await assignTo(db, carmelita.id, oriel.id);

    const moved = new Date('2020-04-15T00:00:00+08:00');
    await db
      .updateTable('pastoral_assignments')
      .set({ ended_at: moved })
      .where('person_id', '=', anacleto.id)
      .where('ended_at', 'is', null)
      .execute();
    await assignTo(db, anacleto.id, onofre.id, moved);
    await assignTo(db, pio.id, manuel.id, new Date('2020-04-20T00:00:00+08:00'));

    admin = await createAccount(app, db, { person: raymond, roles: ['ADMIN'] });

    // Every Sunday from March to May 2020, one of them removed.
    for (let day = new Date(Date.UTC(2020, 2, 1)); day < new Date(Date.UTC(2020, 5, 1));) {
      const sunday = day.toISOString().slice(0, 10);
      const row = await db
        .insertInto('dcc_events')
        .values({ event_date: sunday })
        .returning('id')
        .executeTakeFirstOrThrow();
      events.set(sunday, row.id);
      day = new Date(day.getTime() + 7 * 86_400_000);
    }
    await db
      .updateTable('dcc_events')
      .set({ removed_at: new Date(), removed_by: admin.id, removal_reason: 'No service.' })
      .where('event_date', '=', '2020-04-12')
      .execute();

    // Some leaders record some Sundays; one record is later closed, so it no longer counts.
    const record = async (sunday: string, person: TestPerson, leader: TestPerson) =>
      db
        .insertInto('dcc_attendance')
        .values({
          dcc_event_id: events.get(sunday)!,
          person_id: person.id,
          present: true,
          responsible_leader_id: leader.id,
          recorded_by: admin.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

    for (const sunday of ['2020-03-01', '2020-03-08', '2020-04-05', '2020-05-03', '2020-05-31']) {
      await record(sunday, manuel, raymond);
      await record(sunday, mark, manuel);
    }
    await record('2020-03-15', anacleto, mark);
    await record('2020-04-19', anacleto, onofre);
    await record('2020-05-10', carmelita, oriel);
    // A record naming Mark, corrected to name Manuel: only the live row may count, so Mark
    // owes 22 March unmet. Closed and replaced in one transaction, as a correction is.
    const wrong = await record('2020-03-22', anacleto, mark);
    await db.transaction().execute(async (trx) => {
      const replacement = randomUUID();
      await trx
        .updateTable('dcc_attendance')
        .set({ superseded_at: sql<Date>`now()`, superseded_by: replacement })
        .where('id', '=', wrong.id)
        .execute();
      await trx
        .insertInto('dcc_attendance')
        .values({
          id: replacement,
          dcc_event_id: events.get('2020-03-22')!,
          person_id: anacleto.id,
          present: true,
          responsible_leader_id: manuel.id,
          recorded_by: admin.id,
        })
        .execute();
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
  });

  /** The per-Sunday reading, one Sunday at a time, as the service did it before. */
  async function oracle(
    from: string,
    before: string,
    scope: DccCoverageScope,
  ): Promise<Map<string, { met: number; owed: number }>> {
    const now = await databaseNow(db);
    const rows = await db
      .selectFrom('dcc_events')
      .select(['id', 'event_date'])
      .where('event_date', '>=', from)
      .where('event_date', '<', before)
      .where('removed_at', 'is', null)
      .orderBy('event_date')
      .execute();

    const lines = new Map<string, { met: number; owed: number }>();
    for (const row of rows) {
      const at = recordingInstant(String(row.event_date), now);
      const leaders =
        scope.kind === 'WHOLE_CHURCH'
          ? null
          : scope.kind === 'LEADER'
            ? await hierarchy.subtreeAsOf(db, scope.personId, at)
            : await networks.peopleInNetworkAsOf(db, scope.network, at);
      const owed = new Set(
        (await hierarchy.edgesAsOf(db, at, leaders)).map((edge) => canonicalId(edge.leaderId)),
      );
      const met = new Set(
        (
          await db
            .selectFrom('dcc_attendance')
            .select('responsible_leader_id')
            .where('dcc_event_id', '=', row.id)
            .where('superseded_at', 'is', null)
            .where('responsible_leader_id', 'is not', null)
            .execute()
        ).map((line) => canonicalId(line.responsible_leader_id as string)),
      );
      for (const leader of owed) {
        const line = lines.get(leader) ?? { met: 0, owed: 0 };
        line.owed += 1;
        line.met += met.has(leader) ? 1 : 0;
        lines.set(leader, line);
      }
    }
    return lines;
  }

  const sorted = (lines: Map<string, { met: number; owed: number }>) =>
    [...lines.entries()].sort(([left], [right]) => left.localeCompare(right));

  const scopes = (): [string, DccCoverageScope][] => [
    ['the whole church', { kind: 'WHOLE_CHURCH' }],
    ['Raymond', { kind: 'LEADER', personId: raymond.id }],
    ['Manuel', { kind: 'LEADER', personId: manuel.id }],
    ['Onofre', { kind: 'LEADER', personId: onofre.id }],
    ["the Men's Network", { kind: 'NETWORK', network: 'MENS' }],
    ["the Women's Network", { kind: 'NETWORK', network: 'WOMENS' }],
  ];

  it('answers each month, leader by leader, exactly as the per-Sunday reading did', async () => {
    for (const [name, scope] of scopes()) {
      for (const [month, next] of [
        ['2020-03-01', '2020-04-01'],
        ['2020-04-01', '2020-05-01'],
        ['2020-05-01', '2020-06-01'],
      ]) {
        const expected = await oracle(month, next, scope);
        const actual = await coverage.monthCoverageByLeader(month, scope);

        expect({ name, month, lines: sorted(actual) }).toEqual({
          name,
          month,
          lines: sorted(expected),
        });
      }
    }

    // The fixture reaches what it is for. March: Mark met only 15 March, the corrected 22nd
    // not counting. April: Anacleto's move leaves Mark owing 5 April alone and Onofre owing
    // three Sundays, one met; the removed 12th owes nothing.
    const church = { kind: 'WHOLE_CHURCH' } as const;
    const march = await coverage.monthCoverageByLeader('2020-03-01', church);
    const april = await coverage.monthCoverageByLeader('2020-04-01', church);
    expect(march.get(canonicalId(mark.id))).toEqual({ met: 1, owed: 5 });
    expect(march.get(canonicalId(onofre.id))).toEqual({ met: 0, owed: 5 });
    expect(april.get(canonicalId(mark.id))).toEqual({ met: 0, owed: 1 });
    expect(april.get(canonicalId(onofre.id))).toEqual({ met: 1, owed: 3 });
  });

  it('answers a quarter as the per-Sunday reading summed', async () => {
    for (const [name, scope] of scopes()) {
      const expected = [...(await oracle('2020-03-01', '2020-06-01', scope)).values()].reduce(
        (sum, line) => ({ met: sum.met + line.met, owed: sum.owed + line.owed }),
        { met: 0, owed: 0 },
      );

      expect({
        name,
        figure: await coverage.rangeCoverage('2020-03-01', '2020-05-31', scope),
      }).toEqual({
        name,
        figure: expected,
      });
    }
  });

  it('reads as many times for three months as for one, for a leader and for the whole church', async () => {
    const queries = async (to: string, scope: DccCoverageScope) => {
      const spy = jest.spyOn(Client.prototype, 'query');
      await coverage.rangeCoverage('2020-03-01', to, scope);
      const count = spy.mock.calls.length;
      spy.mockRestore();
      return count;
    };

    for (const scope of [
      { kind: 'WHOLE_CHURCH' } as const,
      { kind: 'LEADER', personId: raymond.id } as const,
    ]) {
      const month = await queries('2020-03-31', scope);
      expect(await queries('2020-05-31', scope)).toBe(month);
    }
  });
});
