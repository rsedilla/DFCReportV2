import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { createTestDb, truncateAll } from '../setup/database';
import { EPOCH, createAccount, createTestApp, resetRateLimits } from '../setup/fixtures';

import type { INestApplication } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database, NetworkName } from '../../src/database/schema';
import type { TestAccount } from '../setup/fixtures';

/**
 * The scraping probe (SKILL.md section 8, decision 0303).
 *
 * It plays a scraper holding one leader's login against a made-up church of about
 * 2,000 people, and checks that the bounds decision 0303 puts on the church-wide
 * search hold end to end, including the one thing the suite cannot do: wait out a
 * real minute. It then tries the other routes a scraper would reach for, and prints
 * a report.
 *
 * **It is not part of `npm test`.** It takes about four minutes, most of it waiting,
 * and it truncates the same scratch database the suite does, so never run the two at
 * once. Run it with `npm run probe:scraping` in `api`.
 *
 * Every name and date here is invented (CLAUDE.md, Secrets).
 */

const FIRST_NAMES: Record<NetworkName, string[]> = {
  MENS: [
    'Adrian',
    'Benedict',
    'Carlo',
    'Dante',
    'Emilio',
    'Fermin',
    'Gabriel',
    'Hector',
    'Ignacio',
    'Jomar',
    'Kristoffer',
    'Leandro',
    'Marlon',
    'Nestor',
    'Orlando',
    'Paolo',
    'Quintin',
    'Rafael',
    'Santino',
    'Teodoro',
    'Ulysses',
    'Virgilio',
    'Wilfredo',
    'Xander',
  ],
  WOMENS: [
    'Andrea',
    'Bernadette',
    'Celestina',
    'Dolores',
    'Estela',
    'Florencia',
    'Graciela',
    'Herminia',
    'Imelda',
    'Jocelyn',
    'Katrina',
    'Leonora',
    'Marites',
    'Nerissa',
    'Ofelia',
    'Perla',
    'Rosalinda',
    'Soledad',
    'Teresita',
    'Urduja',
    'Violeta',
    'Wilhelmina',
    'Yolanda',
  ],
};

const LAST_NAMES = [
  'Abrenica',
  'Bagatsing',
  'Calimlim',
  'Dimaculangan',
  'Evangelista',
  'Fontanilla',
  'Galvez',
  'Hilario',
  'Ilagan',
  'Jimenez',
  'Katigbak',
  'Lacson',
  'Macaraeg',
  'Nepomuceno',
  'Ocampo',
  'Pangilinan',
  'Quiambao',
  'Rivera',
  'Salvador',
  'Tolentino',
  'Umali',
  'Villanueva',
  'Yambao',
  'Zamora',
];

/** Three-letter pieces a scraper with a name dictionary would try first. */
const TRIGRAMS = [
  'ana',
  'ari',
  'ina',
  'ela',
  'ora',
  'ali',
  'ino',
  'ita',
  'eli',
  'ist',
  'ian',
  'ria',
  'lan',
  'mar',
  'san',
  'tol',
  'riv',
  'oca',
  'cal',
  'dim',
  'gal',
  'lac',
  'mac',
  'pan',
  'vil',
  'zam',
  'bag',
  'fon',
  'hil',
  'ila',
  'jim',
  'kat',
  'nep',
  'qui',
  'sal',
  'uma',
  'yam',
  'abr',
  'eva',
  'ton',
  'nue',
  'ang',
  'ing',
  'ent',
  'ero',
  'ilo',
  'des',
  'ard',
];

/** The five fields section 8 publishes church-wide, plus the two markers. */
const IDENTITY_KEYS = [
  'direct_leader_name',
  'full_name',
  'id',
  'member_id',
  'network',
  'scope',
  'sex',
].join(',');

interface Seeded {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  network: NetworkName;
  leaderId: string | null;
}

const report: string[] = [];
const note = (line: string): void => {
  report.push(line);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('scraping probe (decision 0303)', () => {
  let app: INestApplication;
  let db: Kysely<Database>;
  let people: Seeded[];
  let mark: TestAccount;
  let manuel: TestAccount;
  let markScope: Set<string>;

  beforeAll(async () => {
    db = createTestDb();
    app = await createTestApp();
    await truncateAll(db);
    resetRateLimits(app);

    people = await seedChurch(db);
    // Two of the Men's root's twelve, so each oversees a branch of about 85 and the
    // other's branch is outside it.
    const menRoot = people.find((p) => p.network === 'MENS' && p.leaderId === null);
    const twelve = people.filter((p) => menRoot !== undefined && p.leaderId === menRoot.id);
    const [markPerson, manuelPerson] = twelve;
    mark = await createAccount(app, db, {
      person: { id: markPerson.id, firstName: 'Mark', network: 'MENS' },
      roles: ['LEADER'],
    });
    manuel = await createAccount(app, db, {
      person: { id: manuelPerson.id, firstName: 'Manuel', network: 'MENS' },
      roles: ['LEADER'],
    });
    markScope = subtreeOf(people, markPerson.id);
    note(
      `Church: ${people.length} people. The scraper's leader oversees ${markScope.size} of them; ` +
        `${people.length - markScope.size} are outside their branch.`,
    );
  }, 300_000);

  afterAll(async () => {
    resetRateLimits(app);
    await app.close();
    await db.destroy();
    process.stdout.write(`\n=== Scraping probe report ===\n${report.join('\n')}\n\n`);
  });

  const get = (actor: TestAccount, path: string, query: Record<string, string | number> = {}) =>
    request(app.getHttpServer())
      .get(path)
      .query(query)
      .set('Authorization', `Bearer ${actor.accessToken}`);

  const wide = (actor: TestAccount, q: string, extra: Record<string, string | number> = {}) =>
    get(actor, '/api/v1/people', { q, church_wide: 'true', ...extra });

  let answeredByMark = 0;
  let answeredByManuel = 0;
  const learned = new Map<string, Record<string, unknown>>();

  it('step 2: the shortcuts are refused and spend nothing', async () => {
    const tries: [string, () => request.Test][] = [
      ['a two-letter term', () => wide(mark, 'an')],
      ['a limit of 200', () => wide(mark, 'ana', { limit: 200 })],
      ['a limit of 21', () => wide(mark, 'ana', { limit: 21 })],
      ['a forged cursor', () => wide(mark, 'ana', { cursor: 'eyJmb3JnZWQiOnRydWV9' })],
    ];
    for (const [label, send] of tries) {
      for (let n = 0; n < 3; n += 1) {
        const response = await send();
        expect(response.status).toBe(422);
      }
      note(`Step 2: ${label}: refused (422), three times.`);
    }

    const own = await get(mark, '/api/v1/people', { q: 'an' });
    expect(own.status).toBe(200);
    note(`Step 2: a two-letter search of the leader's own branch still works (200).`);
  });

  it('step 1: the church-wide search answers 30 a minute, then refuses', async () => {
    const started = Date.now();
    const statuses: number[] = [];
    let extraFields = 0;

    outer: for (const trigram of TRIGRAMS) {
      let cursor: string | null = null;
      do {
        const response = await wide(mark, trigram, cursor === null ? {} : { cursor });
        statuses.push(response.status);
        if (response.status !== 200) {
          break outer;
        }
        answeredByMark += 1;
        for (const row of response.body.data as Record<string, unknown>[]) {
          learned.set(row.id as string, row);
          if (
            row.scope === 'IDENTITY_ONLY' &&
            Object.keys(row).sort().join(',') !== IDENTITY_KEYS
          ) {
            extraFields += 1;
          }
        }
        cursor = response.body.next_cursor as string | null;
      } while (cursor !== null);
    }

    // A few more after the first refusal, to show it keeps refusing.
    for (let n = 0; n < 4; n += 1) {
      statuses.push((await wide(mark, 'ana')).status);
    }
    const seconds = (Date.now() - started) / 1000;

    expect(statuses.filter((s) => s === 200)).toHaveLength(30);
    expect(statuses.slice(30).every((s) => s === 429)).toBe(true);
    expect(extraFields).toBe(0);

    const outside = [...learned.keys()].filter((id) => !markScope.has(id)).length;
    note(
      `Step 1: ${answeredByMark} searches answered in ${seconds.toFixed(1)}s, then 429 every time ` +
        `(${statuses.length - 30} refused). Learned ${learned.size} people, ${outside} of them ` +
        `outside the branch, each with only the 5 identity fields.`,
    );
    const perMinute = learned.size;
    for (const size of [people.length, 10_000, 15_000]) {
      note(
        `Step 1: at ${perMinute} new people a minute at best, copying ${size.toLocaleString()} ` +
          `people takes at least ${Math.ceil(size / Math.max(perMinute, 1))} minutes, every search ` +
          `in the audit log. The ceiling is 600 rows a minute (30 x 20), so never under ` +
          `${Math.ceil(size / 600)} minutes.`,
      );
    }
  });

  it('step 3: the block ends after a minute, and never freezes another leader', async () => {
    // Manuel searches while Mark is blocked, so his counts are still pending when
    // Mark's block ends. Under a shared throttler name, Mark's block ending cancelled
    // Manuel's pending counts, so they never came down again.
    await sleep(45_000);
    for (let n = 0; n < 25; n += 1) {
      expect((await wide(manuel, 'ana')).status).toBe(200);
      answeredByManuel += 1;
    }

    await sleep(20_000);
    const back = await wide(mark, 'ari');
    expect(back.status).toBe(200);
    answeredByMark += 1;
    note('Step 3: Mark can search again once the minute has passed (200).');

    // Manuel's 25 are now more than a minute old. If they had been frozen, he would be
    // refused after 5 more.
    await sleep(45_000);
    for (let n = 0; n < 30; n += 1) {
      const response = await wide(manuel, 'ina');
      expect(response.status).toBe(200);
      answeredByManuel += 1;
    }
    note(
      'Step 3: Manuel, searching in another branch, was never blocked by the end of ' +
        "Mark's block: 25 searches, then 30 more a minute later, all answered.",
    );
  }, 240_000);

  it('step 4: every person outside the branch is refused when opened', async () => {
    const outside = [...learned.keys()].filter((id) => !markScope.has(id)).slice(0, 40);
    const inside = [...markScope].find((id) => id !== mark.personId)!;
    const routes = [
      (id: string) => `/api/v1/people/${id}`,
      (id: string) => `/api/v1/people/${id}/pastoral-path`,
      (id: string) => `/api/v1/dcc/people/${id}/attendance`,
      (id: string) => `/api/v1/cells/people/${id}/membership`,
      (id: string) => `/api/v1/leaders/${id}/children`,
      (id: string) => `/api/v1/leaders/${id}/descendants`,
    ];

    let refused = 0;
    let answered = 0;
    for (const route of routes) {
      expect((await get(mark, route(inside))).status).toBe(200);
      for (const id of outside) {
        const status = (await get(mark, route(id))).status;
        if (status === 403 || status === 404) {
          refused += 1;
        } else {
          answered += 1;
        }
      }
    }

    expect(answered).toBe(0);
    note(
      `Step 4: opened ${outside.length} people from outside the branch on ${routes.length} ` +
        `routes (profile, pastoral path, DCC, Cell, children, descendants): ${refused} refused, ` +
        `${answered} answered. The same routes answer for somebody inside the branch.`,
    );
  });

  it('step 5: the duplicate check, measured', async () => {
    const outside = people.filter((p) => !markScope.has(p.id));

    // (a) Surname plus birthday, with a first name that matches nobody: decision 0090
    // says nobody outside the branch is surfaced by a rule reading a birthday.
    const targets = outside.slice(0, 40);
    let birthdayHits = 0;
    for (const target of targets) {
      const response = await get(mark, '/api/v1/people/duplicate-candidates', {
        first_name: 'Nobodyhere',
        last_name: target.lastName,
        birth_date: target.birthDate,
      });
      expect(response.status).toBe(200);
      if ((response.body.data as { id: string }[]).some((row) => row.id === target.id)) {
        birthdayHits += 1;
      }
    }
    expect(birthdayHits).toBe(0);
    note(
      `Step 5a: surname plus the real birthday for ${targets.length} people outside the ` +
        `branch: ${birthdayHits} revealed. A birthday cannot be worked out this way.`,
    );

    // (b) Guessing whole names from a name list. This is what the check exists to do,
    // so it is measured rather than refused.
    const started = Date.now();
    const revealed = new Set<string>();
    let requests = 0;
    let limited = 0;
    outer: for (const last of LAST_NAMES) {
      for (const first of [...FIRST_NAMES.MENS, ...FIRST_NAMES.WOMENS]) {
        const response = await get(mark, '/api/v1/people/duplicate-candidates', {
          first_name: first,
          last_name: last,
        });
        requests += 1;
        if (response.status === 429) {
          limited += 1;
          break outer;
        }
        for (const row of response.body.data as { id: string }[]) {
          if (!markScope.has(row.id)) {
            revealed.add(row.id);
          }
        }
      }
    }
    const seconds = (Date.now() - started) / 1000;
    const audited = await db
      .selectFrom('audit_log')
      .select(db.fn.countAll<string>().as('n'))
      .where('actor_id', '=', mark.id)
      .where('action', 'not in', ['directory.searched'])
      .executeTakeFirstOrThrow();
    note(
      `Step 5b: guessing whole names from a list of ${LAST_NAMES.length} surnames and ` +
        `${FIRST_NAMES.MENS.length + FIRST_NAMES.WOMENS.length} first names: ` +
        `${requests} requests in ${seconds.toFixed(1)}s ` +
        `(${limited > 0 ? 'stopped by the general limit of 120 a minute' : 'not limited'}), ` +
        `${revealed.size} people outside the branch revealed, each with the 5 identity fields. ` +
        `Audit entries written for them: ${audited.n}. Not bounded by decision 0303.`,
    );
  });

  it('step 6: every answered church-wide search is in the audit log, and nothing else', async () => {
    const count = async (actor: TestAccount) =>
      Number(
        (
          await db
            .selectFrom('audit_log')
            .select(db.fn.countAll<string>().as('n'))
            .where('actor_id', '=', actor.id)
            .where('action', '=', 'directory.searched')
            .executeTakeFirstOrThrow()
        ).n,
      );

    expect(await count(mark)).toBe(answeredByMark);
    expect(await count(manuel)).toBe(answeredByManuel);
    note(
      `Step 6: audit log holds ${answeredByMark} church-wide searches for Mark and ` +
        `${answeredByManuel} for Manuel, one for each answered search and none for a refused one.`,
    );
  });
});

/**
 * Two roots, twelve leaders under each, twelve under each of those, and about six
 * under each of those: roughly 2,000 people. Written in bulk rather than through the
 * one-at-a-time fixtures, which would take minutes at this size.
 */
async function seedChurch(db: Kysely<Database>): Promise<Seeded[]> {
  const seeded: Seeded[] = [];
  let n = 0;
  const make = (network: NetworkName, leaderId: string | null): Seeded => {
    const firsts = FIRST_NAMES[network];
    const person: Seeded = {
      id: randomUUID(),
      firstName: firsts[n % firsts.length],
      lastName: LAST_NAMES[Math.floor(n / firsts.length) % LAST_NAMES.length],
      birthDate: `${1950 + (n % 55)}-${String((n % 12) + 1).padStart(2, '0')}-${String((n % 28) + 1).padStart(2, '0')}`,
      network,
      leaderId,
    };
    n += 1;
    seeded.push(person);
    return person;
  };

  const levels: Seeded[][] = [];
  const roots = (['MENS', 'WOMENS'] as NetworkName[]).map((network) => make(network, null));
  levels.push(roots);
  for (const [fanOut, level] of [
    [12, 1],
    [12, 2],
    [6, 3],
  ] as const) {
    const next: Seeded[] = [];
    for (const leader of levels[level - 1]) {
      for (let k = 0; k < fanOut; k += 1) {
        next.push(make(leader.network, leader.id));
      }
    }
    levels.push(next);
  }

  for (const level of levels) {
    for (let start = 0; start < level.length; start += 500) {
      const chunk = level.slice(start, start + 500);
      await db
        .insertInto('persons')
        .values(
          chunk.map((p) => ({
            id: p.id,
            first_name: p.firstName,
            middle_name: null,
            last_name: p.lastName,
            birth_date: p.birthDate,
            sex: p.network === 'MENS' ? ('MALE' as const) : ('FEMALE' as const),
            civil_status: 'SINGLE' as const,
          })),
        )
        .execute();
      await db
        .insertInto('network_assignments')
        .values(chunk.map((p) => ({ person_id: p.id, network: p.network, started_at: EPOCH })))
        .execute();
      await db
        .insertInto('person_lifecycle')
        .values(
          chunk.map((p) => ({
            person_id: p.id,
            state: 'CURRENT' as const,
            reason: null,
            started_at: EPOCH,
          })),
        )
        .execute();
      await db
        .insertInto('pastoral_assignments')
        .values(
          chunk.map((p) => ({
            person_id: p.id,
            leader_id: p.leaderId,
            root_network: p.leaderId === null ? p.network : null,
            started_at: EPOCH,
          })),
        )
        .execute();
    }
  }

  return seeded;
}

function subtreeOf(people: Seeded[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const p of people) {
    if (p.leaderId !== null) {
      children.set(p.leaderId, [...(children.get(p.leaderId) ?? []), p.id]);
    }
  }
  const scope = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      scope.add(child);
      queue.push(child);
    }
  }
  return scope;
}
