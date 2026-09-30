/**
 * Builds a made-up church at the size SKILL.md section 2 records, for timing screens.
 *
 *   DATABASE_URL=<a database named dfc_perf> npm run seed:perf
 *
 * **It refuses any database not named `dfc_perf`**, and refuses to run twice, because it
 * writes a year of history nothing else could remove: every table it fills refuses a
 * delete. Rebuild the database to start again.
 *
 * **Every name is invented**, drawn from two short lists, because the repository is public
 * (CLAUDE.md, Secrets). No row describes a real member.
 *
 * **Every row goes through the schema's own triggers and constraints.** The data is shaped
 * to satisfy them rather than written past them, so a timing measured here is a timing of
 * data the application could have produced.
 *
 * Shape, per section 2 and the owner's choice of 2026-09-29: about 15,000 people in two
 * Networks under a G12 tree, 1,000 Cells, a year of DCC and Cell attendance to the day
 * before today, and some SUYNL lessons and Training graduations. One Admin, the two Senior
 * Pastors as the Network roots, and an account for every Cell leader.
 */
import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import { PasswordService } from '../src/auth/password.service';

const DATABASE = 'dfc_perf';
const PEOPLE_PER_NETWORK = { MENS: 7000, WOMENS: 8000 } as const;
const CELLS_PER_NETWORK = 500;
const MAX_MEMBERS = 16;

/** Everything structural starts here, a month before the history begins. */
const STRUCTURE_START = '2025-09-01T00:00:00+08:00';
const HISTORY_FROM = '2025-10-01';
const CALENDAR_START = '2025-10-05';
const CALENDAR_TO = '2027-09-26';

type Network = 'MENS' | 'WOMENS';

interface Person {
  id: string;
  network: Network;
  sex: 'MALE' | 'FEMALE';
  leaderId: string | null;
  disciples: string[];
  accountId: string | null;
  cellId: string | null;
  memberOf: string | null;
}

// A small deterministic generator, so two builds describe the same church.
let seed = 20260930;
function random(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
const chance = (p: number): boolean => random() < p;

const MALE = [
  'Juan',
  'Jose',
  'Mark',
  'Paolo',
  'Carlo',
  'Jomar',
  'Rafael',
  'Miguel',
  'Andres',
  'Noel',
  'Ramon',
  'Dennis',
  'Arnel',
  'Rodel',
  'Jerome',
  'Kevin',
  'Allan',
  'Ronaldo',
  'Edwin',
  'Joel',
];
const FEMALE = [
  'Maria',
  'Ana',
  'Liza',
  'Rosa',
  'Grace',
  'Joy',
  'Marites',
  'Cristina',
  'Teresa',
  'Carmela',
  'Jasmine',
  'Angela',
  'Rowena',
  'Lorna',
  'Shiela',
  'Janet',
  'Mylene',
  'Rachel',
  'Divina',
  'Faith',
];
const LAST = [
  'Santos',
  'Reyes',
  'Cruz',
  'Bautista',
  'Garcia',
  'Mendoza',
  'Torres',
  'Villanueva',
  'Ramos',
  'Aquino',
  'Castillo',
  'Rivera',
  'Flores',
  'Gonzales',
  'Navarro',
  'Salazar',
  'Domingo',
  'Pascual',
  'Morales',
  'Dizon',
  'Manalo',
  'Soriano',
  'Lim',
  'Tan',
  'Ocampo',
  'Mercado',
  'Aguilar',
  'Valdez',
  'Fernandez',
  'Lopez',
];

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return day(date);
}
/** ISO day of week, Monday 1 to Sunday 7. */
function isoDow(iso: string): number {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}
function manilaTodayMinus(days: number): string {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return addDays(day(now), -days);
}

async function insert(
  client: Client,
  table: string,
  columns: Record<string, string>,
  rows: Record<string, unknown>[],
): Promise<void> {
  const names = Object.keys(columns);
  for (let start = 0; start < rows.length; start += 5000) {
    const batch = rows.slice(start, start + 5000);
    const params = names.map((name) => batch.map((row) => row[name] ?? null));
    const selects = names.map((name, index) => `$${index + 1}::${columns[name]}[]`).join(', ');
    await client.query(
      `INSERT INTO ${table} (${names.join(', ')}) SELECT * FROM unnest(${selects})`,
      params,
    );
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url || new URL(url).pathname.replace('/', '') !== DATABASE) {
    throw new Error(`seed:perf writes only to a database named ${DATABASE}.`);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed:perf never runs in production.');
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const existing = await client.query('SELECT count(*)::int AS n FROM persons');
    if (existing.rows[0].n > 0) {
      throw new Error('dfc_perf already holds people. Drop and recreate it to build again.');
    }
    await build(client);
  } finally {
    await client.end();
  }
}

async function build(client: Client): Promise<void> {
  const today = manilaTodayMinus(0);
  const people = new Map<string, Person>();
  const byNetwork: Record<Network, Person[]> = { MENS: [], WOMENS: [] };
  const personRows: Record<string, unknown>[] = [];

  function newPerson(network: Network, leaderId: string | null): Person {
    const sex = network === 'MENS' ? 'MALE' : 'FEMALE';
    const person: Person = {
      id: randomUUID(),
      network,
      sex,
      leaderId,
      disciples: [],
      accountId: null,
      cellId: null,
      memberOf: null,
    };
    people.set(person.id, person);
    byNetwork[network].push(person);
    const year = 1958 + Math.floor(random() * 52);
    personRows.push({
      id: person.id,
      first_name: pick(sex === 'MALE' ? MALE : FEMALE),
      middle_name: chance(0.6) ? pick(LAST) : null,
      last_name: pick(LAST),
      birth_date: chance(0.8)
        ? `${year}-${String(1 + Math.floor(random() * 12)).padStart(2, '0')}-${String(1 + Math.floor(random() * 28)).padStart(2, '0')}`
        : null,
      sex,
      civil_status: pick(['SINGLE', 'MARRIED', 'MARRIED', 'WIDOWED']),
    });
    if (leaderId !== null) {
      people.get(leaderId)!.disciples.push(person.id);
    }
    return person;
  }

  // The G12 tree, breadth first: a root with twelve, then each person with none to twelve.
  const roots: Record<Network, Person> = {} as Record<Network, Person>;
  for (const network of ['MENS', 'WOMENS'] as const) {
    const root = newPerson(network, null);
    roots[network] = root;
    const queue: Person[] = [];
    for (let i = 0; i < 12; i += 1) {
      queue.push(newPerson(network, root.id));
    }
    while (queue.length > 0 && byNetwork[network].length < PEOPLE_PER_NETWORK[network]) {
      const leader = queue.shift()!;
      const count = chance(0.45) ? 0 : 1 + Math.floor(random() * 12);
      for (
        let i = 0;
        i < count && byNetwork[network].length < PEOPLE_PER_NETWORK[network];
        i += 1
      ) {
        queue.push(newPerson(network, leader.id));
      }
    }
  }
  const admin = newPerson('MENS', null);
  admin.leaderId = null;

  // Cells: the first leaders in breadth-first order with at least two disciples, which is
  // an upline leading a Cell as G12 leaders do.
  const cellRows: Record<string, unknown>[] = [];
  for (const network of ['MENS', 'WOMENS'] as const) {
    const leaders = byNetwork[network]
      .filter((person) => person !== roots[network] && person.disciples.length >= 2)
      .slice(0, CELLS_PER_NETWORK);
    for (const leader of leaders) {
      leader.cellId = randomUUID();
      cellRows.push({ id: leader.cellId, leader: leader.id });
    }
  }

  // Members: each person joins the Cell of their nearest Cell-leading ancestor, while it
  // has room; one in ten is left in no Cell. A Cell leader is a member of none.
  const memberCount = new Map<string, number>();
  for (const person of people.values()) {
    if (person.cellId !== null || person.leaderId === null || chance(0.1)) {
      continue;
    }
    let ancestor = people.get(person.leaderId);
    while (ancestor && ancestor.cellId === null) {
      ancestor = ancestor.leaderId === null ? undefined : people.get(ancestor.leaderId);
    }
    if (ancestor && (memberCount.get(ancestor.cellId!) ?? 0) < MAX_MEMBERS) {
      person.memberOf = ancestor.cellId;
      memberCount.set(ancestor.cellId!, (memberCount.get(ancestor.cellId!) ?? 0) + 1);
    }
  }

  // Accounts: the Admin, the two roots and every Cell leader.
  const hash = await new PasswordService().hash(randomUUID());
  const accountRows: Record<string, unknown>[] = [];
  const roleRows: Record<string, unknown>[] = [];
  const holders: { person: Person; role: string; slot: number | null }[] = [
    { person: admin, role: 'ADMIN', slot: null },
    { person: roots.MENS, role: 'SENIOR_PASTOR', slot: 1 },
    { person: roots.WOMENS, role: 'SENIOR_PASTOR', slot: 2 },
    ...[...people.values()]
      .filter((p) => p.cellId !== null)
      .map((person) => ({ person, role: 'LEADER', slot: null })),
  ];
  holders.forEach(({ person, role, slot }, index) => {
    person.accountId = randomUUID();
    const email = `perf-${index}@perf.invalid`;
    accountRows.push({
      id: person.accountId,
      person_id: person.id,
      email,
      email_normalized: email,
      password_hash: hash,
      status: 'ACTIVE',
    });
    roleRows.push({ account_id: person.accountId, role, senior_pastor_slot: slot });
  });

  /** Who files for a person: their nearest upline holding an account (section 9). */
  const filer = new Map<string, string>();
  function filerOf(person: Person): string {
    const known = filer.get(person.id);
    if (known) return known;
    const leader = person.leaderId === null ? null : people.get(person.leaderId)!;
    const account = leader === null ? admin.accountId! : (leader.accountId ?? filerOf(leader));
    filer.set(person.id, account);
    return account;
  }

  console.log(`people ${people.size}, cells ${cellRows.length}, accounts ${accountRows.length}`);

  await client.query('BEGIN');
  await insert(
    client,
    'persons',
    {
      id: 'uuid',
      first_name: 'text',
      middle_name: 'text',
      last_name: 'text',
      birth_date: 'date',
      sex: 'sex',
      civil_status: 'civil_status',
    },
    personRows,
  );
  const all = [...people.values()];
  await insert(
    client,
    'person_lifecycle',
    { person_id: 'uuid', state: 'lifecycle_state', started_at: 'timestamptz' },
    all.map((p) => ({ person_id: p.id, state: 'CURRENT', started_at: STRUCTURE_START })),
  );
  await insert(
    client,
    'network_assignments',
    { person_id: 'uuid', network: 'network', started_at: 'timestamptz' },
    all.map((p) => ({ person_id: p.id, network: p.network, started_at: STRUCTURE_START })),
  );
  await insert(
    client,
    'pastoral_assignments',
    { person_id: 'uuid', leader_id: 'uuid', root_network: 'network', started_at: 'timestamptz' },
    all
      .filter((p) => p !== admin)
      .map((p) => ({
        person_id: p.id,
        leader_id: p.leaderId,
        root_network: p.leaderId === null ? p.network : null,
        started_at: STRUCTURE_START,
      })),
  );
  await client.query('COMMIT');
  console.log('people and tree written');

  await client.query('BEGIN');
  await insert(
    client,
    'accounts',
    {
      id: 'uuid',
      person_id: 'uuid',
      email: 'text',
      email_normalized: 'text',
      password_hash: 'text',
      status: 'account_status',
    },
    accountRows,
  );
  await insert(
    client,
    'account_roles',
    { account_id: 'uuid', role: 'account_role', senior_pastor_slot: 'int' },
    roleRows,
  );
  // The second step an Admin or Senior Pastor owes (section 6), set up before any session the
  // timing script issues. Its secret is never read here, so it is not a real one.
  await insert(
    client,
    'second_steps',
    { account_id: 'uuid', secret_ciphertext: 'text', set_up_at: 'timestamptz' },
    holders.slice(0, 3).map(({ person }) => ({
      account_id: person.accountId,
      secret_ciphertext: 'not-a-secret',
      set_up_at: STRUCTURE_START,
    })),
  );
  await client.query('COMMIT');
  console.log('accounts written');

  const schedule = new Map<string, number>();
  await client.query('BEGIN');
  await insert(
    client,
    'cells',
    { id: 'uuid', created_at: 'timestamptz' },
    cellRows.map((c) => ({ id: c.id, created_at: STRUCTURE_START })),
  );
  await insert(
    client,
    'cell_categories',
    { cell_id: 'uuid', category: 'cell_category', started_at: 'timestamptz' },
    cellRows.map((c) => ({
      cell_id: c.id,
      category: pick(['YOUTH', 'YOUNG_PRO', 'COUPLE']),
      started_at: STRUCTURE_START,
    })),
  );
  await insert(
    client,
    'cell_schedules',
    { cell_id: 'uuid', day_of_week: 'int', time_of_day: 'time', started_at: 'timestamptz' },
    cellRows.map((c) => {
      const dow = pick([2, 3, 4, 5, 5, 6, 6, 6, 7]);
      schedule.set(c.id as string, dow);
      return { cell_id: c.id, day_of_week: dow, time_of_day: '19:00', started_at: STRUCTURE_START };
    }),
  );
  await insert(
    client,
    'cell_leaderships',
    { person_id: 'uuid', cell_id: 'uuid', started_at: 'timestamptz' },
    cellRows.map((c) => ({ person_id: c.leader, cell_id: c.id, started_at: STRUCTURE_START })),
  );
  await insert(
    client,
    'cell_memberships',
    { person_id: 'uuid', cell_id: 'uuid', started_at: 'timestamptz' },
    all
      .filter((p) => p.memberOf !== null)
      .map((p) => ({ person_id: p.id, cell_id: p.memberOf, started_at: STRUCTURE_START })),
  );
  await client.query('COMMIT');
  console.log('cells written');

  await client.query(
    `UPDATE settings SET value = to_jsonb($1::text) WHERE key = 'dcc_calendar_start'`,
    [CALENDAR_START],
  );
  const sundays: { id: string; date: string }[] = [];
  for (let date = CALENDAR_START; date <= CALENDAR_TO; date = addDays(date, 7)) {
    sundays.push({ id: randomUUID(), date });
  }
  await insert(
    client,
    'dcc_events',
    { id: 'uuid', event_date: 'date' },
    sundays.map((s) => ({ id: s.id, event_date: s.date })),
  );

  // DCC: about a third of the church recorded each past Sunday, three in four present.
  const recorded = sundays.filter((s) => s.date < today);
  let dccTotal = 0;
  for (const sunday of recorded) {
    const rows: Record<string, unknown>[] = [];
    for (const person of all) {
      if (person === admin || !chance(0.35)) continue;
      rows.push({
        dcc_event_id: sunday.id,
        person_id: person.id,
        present: chance(0.75),
        responsible_leader_id: person.leaderId,
        recorded_by: filerOf(person),
        recorded_at: `${sunday.date}T20:00:00+08:00`,
      });
    }
    await insert(
      client,
      'dcc_attendance',
      {
        dcc_event_id: 'uuid',
        person_id: 'uuid',
        present: 'bool',
        responsible_leader_id: 'uuid',
        recorded_by: 'uuid',
        recorded_at: 'timestamptz',
      },
      rows,
    );
    dccTotal += rows.length;
  }
  console.log(`dcc attendance ${dccTotal}`);

  // Cell meetings: every scheduled day of the year before today; most held, some not held,
  // some never reported (no row at all, section 13).
  const members = new Map<string, string[]>();
  for (const person of all) {
    if (person.memberOf)
      members.set(person.memberOf, [...(members.get(person.memberOf) ?? []), person.id]);
  }
  let meetings = 0;
  let marks = 0;
  for (let start = 0; start < cellRows.length; start += 50) {
    const meetingRows: Record<string, unknown>[] = [];
    const markRows: Record<string, unknown>[] = [];
    for (const cell of cellRows.slice(start, start + 50)) {
      const leader = people.get(cell.leader as string)!;
      const dow = schedule.get(cell.id as string)!;
      for (let date = HISTORY_FROM; date < today; date = addDays(date, 1)) {
        if (isoDow(date) !== dow || chance(0.07)) continue;
        const id = randomUUID();
        const held = !chance(0.08);
        const at = `${date}T21:00:00+08:00`;
        meetingRows.push({
          id,
          cell_id: cell.id,
          scheduled_date: date,
          scheduled_time: '19:00',
          week_starting: addDays(date, 1 - isoDow(date)),
          reporting_month: `${date.slice(0, 7)}-01`,
          status: held ? 'HELD' : 'NOT_HELD',
          not_held_reason: held ? null : 'LEADER_UNAVAILABLE',
          responsible_leader_id: leader.id,
          submitted_by: leader.accountId,
          submitted_at: at,
        });
        if (held) {
          for (const member of members.get(cell.id as string) ?? []) {
            markRows.push({
              cell_meeting_id: id,
              person_id: member,
              present: chance(0.7),
              recorded_by: leader.accountId,
              recorded_at: at,
            });
          }
        }
      }
    }
    await client.query('BEGIN');
    await insert(
      client,
      'cell_meetings',
      {
        id: 'uuid',
        cell_id: 'uuid',
        scheduled_date: 'date',
        scheduled_time: 'time',
        week_starting: 'date',
        reporting_month: 'date',
        status: 'cell_meeting_status',
        not_held_reason: 'cell_meeting_not_held_reason',
        responsible_leader_id: 'uuid',
        submitted_by: 'uuid',
        submitted_at: 'timestamptz',
      },
      meetingRows,
    );
    await insert(
      client,
      'cell_attendance',
      {
        cell_meeting_id: 'uuid',
        person_id: 'uuid',
        present: 'bool',
        recorded_by: 'uuid',
        recorded_at: 'timestamptz',
      },
      markRows,
    );
    await client.query('COMMIT');
    meetings += meetingRows.length;
    marks += markRows.length;
  }
  console.log(`cell meetings ${meetings}, cell marks ${marks}`);

  // Growth: a fifth of the church with SUYNL lessons, fewer with graduations.
  const lessons: Record<string, unknown>[] = [];
  const graduations: Record<string, unknown>[] = [];
  for (const person of all) {
    if (person.leaderId === null) continue;
    const confirmedAt = `${addDays(HISTORY_FROM, Math.floor(random() * 360))}T20:00:00+08:00`;
    if (chance(0.2)) {
      const count = 1 + Math.floor(random() * 10);
      for (let lesson = 1; lesson <= count; lesson += 1) {
        lessons.push({
          person_id: person.id,
          lesson,
          confirmed_by: person.leaderId,
          recorded_by: filerOf(person),
          confirmed_at: confirmedAt,
        });
      }
    }
    for (const [program, p] of [
      ['ENCOUNTER', 0.15],
      ['LIFE_CLASS', 0.1],
      ['SOL_1', 0.06],
      ['SOL_2', 0.04],
      ['SOL_3', 0.03],
    ] as const) {
      if (chance(p)) {
        graduations.push({
          person_id: person.id,
          program,
          graduated_on: chance(0.7) ? addDays('2019-01-06', Math.floor(random() * 2400)) : null,
          confirmed_by: person.leaderId,
          recorded_by: filerOf(person),
          confirmed_at: confirmedAt,
        });
      }
    }
  }
  await insert(
    client,
    'suynl_lessons',
    {
      person_id: 'uuid',
      lesson: 'int',
      confirmed_by: 'uuid',
      recorded_by: 'uuid',
      confirmed_at: 'timestamptz',
    },
    lessons,
  );
  await insert(
    client,
    'training_graduations',
    {
      person_id: 'uuid',
      program: 'training_program',
      graduated_on: 'date',
      confirmed_by: 'uuid',
      recorded_by: 'uuid',
      confirmed_at: 'timestamptz',
    },
    graduations,
  );
  console.log(`suynl lessons ${lessons.length}, graduations ${graduations.length}`);

  await client.query('ANALYZE');
  console.log(`SENIOR_PASTOR_PERSON_IDS=${roots.MENS.id},${roots.WOMENS.id}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
