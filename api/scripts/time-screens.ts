/**
 * Times every screen's API calls against the made-up church `seed:perf` builds.
 *
 *   DATABASE_URL=<dfc_perf> JWT_SECRET=<the running API's> PERF_API=http://127.0.0.1:3002 \
 *     npm run time:screens -- [--out report.md] [--only <screen>]
 *
 * **It measures the server, as the website asks it.** Each screen is the calls its page
 * makes when it first opens (mapped from `web/app` on 2026-09-30), in the page's order:
 * calls a page sends together are sent together, a call that needs another's answer waits
 * for it, and a list the page reads to the end is followed page by page. A screen's time is
 * what a person waits for before it is whole, less the browser.
 *
 * **It signs in by minting the access token the API would have issued**, with the running
 * API's `JWT_SECRET`, so an Admin or Senior Pastor needs no authenticator code.
 *
 * **It stays under the API's own rate limit** (120 a minute from one address) rather than
 * the API being changed to make the numbers easier, and reports the median of three.
 */
import { writeFileSync } from 'node:fs';

import { JwtService } from '@nestjs/jwt';
import { Client } from 'pg';

const API = process.env.PERF_API ?? 'http://127.0.0.1:3002';
const RUNS = 3;
const MIN_GAP_MS = 60_000 / 100;

interface Persona {
  name: string;
  accountId: string;
  personId: string;
  wholeChurch: boolean;
  token: string;
  cellId: string | null;
  meetingDate: string | null;
  otherPersonId: string;
  sundayId: string;
}

/** A call, or a list followed to its end: `next` reads a page and names the next, or null. */
interface Chain {
  first: string;
  next: (body: Body) => string | null;
}
// A response is read loosely: this script follows ids and cursors, and checks no shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
type Stage = (persona: Persona, previous: Body[]) => Array<string | Chain>;

interface Screen {
  name: string;
  who?: readonly string[];
  stages: Stage[];
}

// `PERF_TODAY` times the screens as they would open on another day, so a month with its
// Sundays held can be measured when the real month has barely begun.
const today =
  process.env.PERF_TODAY ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const M = `${today.slice(0, 7)}-01`;
const PREVIOUS = (() => {
  const d = new Date(`${M}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
})();
const QUARTER_START = `${today.slice(0, 4)}-${String(
  Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1,
).padStart(2, '0')}-01`;
const YEAR_MONTHS = Array.from(
  { length: Number(today.slice(5, 7)) },
  (_, i) => `${today.slice(0, 4)}-${String(i + 1).padStart(2, '0')}-01`,
);

function scope(persona: Persona): string {
  return persona.wholeChurch ? 'scope=WHOLE_CHURCH' : `scope=LEADER&leader_id=${persona.personId}`;
}
function paged(first: string): Chain {
  const joiner = first.includes('?') ? '&' : '?';
  return {
    first,
    next: (body) =>
      body?.next_cursor ? `${first}${joiner}cursor=${encodeURIComponent(body.next_cursor)}` : null,
  };
}

const LEADERS = ['Upline leader', 'Cell leader'];

const SCREENS: Screen[] = [
  {
    name: 'Record (dashboard)',
    stages: [
      () => [
        '/api/v1/auth/me',
        '/api/v1/people/awaiting-reassignment?limit=50',
        '/api/v1/cells/people-without-a-cell?limit=50',
        `/api/v1/cells/meetings/awaiting?month=${M}&whose=mine`,
        `/api/v1/cells?month=${M}`,
        `/api/v1/cells?month=${M}&state=CLOSED`,
        `/api/v1/dcc/events?month=${M}`,
        paged('/api/v1/cells/leadership-requests/sent'),
      ],
      (p, [, , , , , , events]) => [
        `/api/v1/reports/cells/monthly?period=${M}&${scope(p)}`,
        `/api/v1/reports/cells/monthly?period=${PREVIOUS}&${scope(p)}`,
        `/api/v1/reports/dcc/monthly?period=${M}&${scope(p)}`,
        `/api/v1/reports/dcc/monthly?period=${PREVIOUS}&${scope(p)}`,
        ...((events?.data ?? []) as Body[])
          .filter((event) => event.recordable)
          .map((event) => paged(`/api/v1/dcc/events/${event.id}/roster`)),
      ],
    ],
  },
  {
    name: 'DCC calendar',
    who: LEADERS,
    stages: [
      () => [
        `/api/v1/cells?month=${M}&led_by=me`,
        `/api/v1/cells/meetings/awaiting?month=${M}&whose=mine`,
        `/api/v1/dcc/events?month=${M}`,
      ],
      (_p, [cells, , events]) => [
        ...((cells?.data ?? []) as Body[]).map(
          (cell) => `/api/v1/cells/${cell.id}/meetings?month=${M}`,
        ),
        ...((events?.data ?? []) as Body[])
          .filter((event) => !event.removed)
          .map((event) => paged(`/api/v1/dcc/events/${event.id}/roster`)),
      ],
    ],
  },
  {
    name: 'DCC checklist (one Sunday)',
    stages: [(p) => ['/api/v1/auth/me', `/api/v1/dcc/events/${p.sundayId}/roster`]],
  },
  {
    name: 'DCC coverage gaps',
    stages: [(p) => [`/api/v1/dcc/events/${p.sundayId}/coverage-gaps`]],
  },
  {
    name: 'Reports › Cell Groups, month',
    stages: [
      () => ['/api/v1/auth/me'],
      (p) => [`/api/v1/reports/cells/twelve?kind=MONTH&start=${M}&period=${M}&${scope(p)}`],
    ],
  },
  {
    name: 'Reports › Cell Groups, year',
    stages: [
      () => ['/api/v1/auth/me'],
      (p) => [
        `/api/v1/reports/cells/twelve?kind=YEAR&start=${YEAR_MONTHS[0]}&period=${M}&${scope(p)}`,
      ],
      (p) =>
        YEAR_MONTHS.map((month) => `/api/v1/reports/cells/monthly?period=${month}&${scope(p)}`),
    ],
  },
  {
    name: 'Reports › DCC, month',
    stages: [
      () => ['/api/v1/auth/me'],
      (p) => [`/api/v1/reports/dcc/twelve?kind=MONTH&start=${M}&period=${M}&${scope(p)}`],
    ],
  },
  {
    name: 'Reports › DCC, quarter',
    stages: [
      () => ['/api/v1/auth/me'],
      (p) => [
        `/api/v1/reports/dcc/twelve?kind=QUARTER&start=${QUARTER_START}&period=${M}&${scope(p)}`,
      ],
    ],
  },
  {
    name: 'Record › People I oversee, DCC',
    stages: [() => [`/api/v1/dcc/owed?month=${M}`]],
  },
  {
    name: 'Reports › DCC, year',
    stages: [
      () => ['/api/v1/auth/me'],
      (p) => [
        `/api/v1/reports/dcc/twelve?kind=YEAR&start=${YEAR_MONTHS[0]}&period=${M}&${scope(p)}`,
      ],
      (p) => YEAR_MONTHS.map((month) => `/api/v1/reports/dcc/monthly?period=${month}&${scope(p)}`),
    ],
  },
  {
    name: 'Reports › Filed, by Cell',
    stages: [
      () => ['/api/v1/auth/me', paged(`/api/v1/cells?month=${M}`)],
      (p) => [`/api/v1/reports/cells/monthly?period=${M}&${scope(p)}`],
    ],
  },
  {
    name: 'Reports › Filed, by leader',
    stages: [
      () => ['/api/v1/auth/me'],
      (p) => [
        `/api/v1/reports/cells/monthly?period=${M}&${scope(p)}`,
        `/api/v1/reports/cells/monthly/by-leader?period=${M}&${scope(p)}&limit=10`,
      ],
    ],
  },
  {
    name: 'Reports › SUYNL',
    stages: [
      () => [
        '/api/v1/suynl/counts',
        '/api/v1/encounter-seasons',
        '/api/v1/suynl/readiness',
        '/api/v1/auth/me',
      ],
    ],
  },
  { name: 'Reports › Training', stages: [() => ['/api/v1/training/counts']] },
  { name: 'Reports › Conquest', stages: [() => ['/api/v1/conquest/counts']] },
  {
    name: 'People',
    stages: [
      () => ['/api/v1/people?limit=10'],
      (_p, [people]) => {
        const ids = ((people?.data ?? []) as Body[])
          .filter((row) => row.scope === 'FULL')
          .map((row) => `person_id=${row.id}`);
        return ids.length === 0 ? [] : [`/api/v1/cells/people/membership?${ids.join('&')}`];
      },
    ],
  },
  {
    name: 'A person’s page',
    stages: [
      (p) => [
        `/api/v1/people/${p.otherPersonId}`,
        `/api/v1/people/${p.otherPersonId}/pastoral-path`,
        '/api/v1/auth/me',
        `/api/v1/cells/people/${p.otherPersonId}/membership`,
      ],
      (p, [person]) => [
        `/api/v1/dcc/people/${p.otherPersonId}/attendance`,
        `/api/v1/dcc/events?month=${M}`,
        `/api/v1/dcc/events?month=${PREVIOUS}`,
        `/api/v1/suynl/people?q=${person?.member_id}&limit=1`,
        `/api/v1/training/people?q=${person?.member_id}&limit=1`,
        ...(p.name === 'Admin' ? [`/api/v1/accounts/for-person/${p.otherPersonId}`] : []),
      ],
    ],
  },
  {
    name: 'Add a Person',
    who: LEADERS,
    stages: [
      () => ['/api/v1/auth/me'],
      (p) => [`/api/v1/people/${p.personId}/pastoral-path`, `/api/v1/people/${p.personId}`],
      (_p, [, me]) => [
        `/api/v1/cells?month=${M}&q=${encodeURIComponent(me?.last_name ?? 'Santos')}&limit=200`,
      ],
    ],
  },
  {
    name: 'People › Network',
    stages: [
      () => ['/api/v1/auth/me', '/api/v1/network/my-tree?limit=20'],
      (p, [, tree]) =>
        tree?.roots
          ? ((tree.roots ?? []) as Body[]).flatMap((root) => [
              `/api/v1/leaders/${root.id ?? root.person_id}/dcc-behind`,
              `/api/v1/leaders/${root.id ?? root.person_id}/cell-figures`,
            ])
          : [
              `/api/v1/people/${p.personId}/pastoral-path`,
              `/api/v1/leaders/${p.personId}/dcc-behind`,
              `/api/v1/leaders/${p.personId}/cell-figures`,
            ],
    ],
  },
  {
    name: 'Cells',
    stages: [
      () => [
        '/api/v1/auth/me',
        `/api/v1/cells?month=${M}&limit=10`,
        paged(`/api/v1/cells?month=${M}&led_by=me&limit=200`),
        paged(`/api/v1/cells?month=${M}&limit=200`),
      ],
    ],
  },
  { name: 'People without a Cell', stages: [() => ['/api/v1/cells/people-without-a-cell']] },
  {
    name: 'A Cell’s meetings',
    who: LEADERS,
    stages: [(p) => [`/api/v1/cells/${p.cellId}/meetings?month=${M}`]],
  },
  {
    name: 'Recording a Cell meeting',
    who: LEADERS,
    stages: [
      (p) => ['/api/v1/auth/me', `/api/v1/cells/${p.cellId}/meetings/${p.meetingDate}/roster`],
      (p, [, roster]) => [
        `/api/v1/cells/${p.cellId}/meetings?month=${roster?.reporting_month ?? M}`,
      ],
    ],
  },
  {
    name: 'Growth › SUYNL',
    stages: [
      () => [
        '/api/v1/auth/me',
        '/api/v1/suynl/counts',
        '/api/v1/suynl/people?step=STILL_TO_FINISH&limit=15',
      ],
    ],
  },
  {
    name: 'Growth › Training',
    stages: [
      () => [
        '/api/v1/auth/me',
        '/api/v1/training/counts',
        '/api/v1/training/people?step=STILL_TO_FINISH&limit=15',
      ],
    ],
  },
  {
    name: 'Growth › Conquest',
    stages: [() => ['/api/v1/conquest/counts', '/api/v1/conquest/people?limit=15']],
  },
];

let nextSlot = 0;
let requests = 0;

/**
 * Waits until `count` requests fit under the rate limit, then reserves their slots. A
 * stage's calls are sent together, as the page sends them, and the average rate still holds.
 */
async function reserve(count: number): Promise<void> {
  const wait = nextSlot - Date.now();
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  nextSlot = Math.max(Date.now(), nextSlot) + count * MIN_GAP_MS;
  requests += count;
}

interface CallTime {
  path: string;
  ms: number;
  status: number;
}

async function call(persona: Persona, path: string): Promise<{ time: CallTime; body: Body }> {
  const started = performance.now();
  const response = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${persona.token}` },
  });
  const text = await response.text();
  const ms = performance.now() - started;
  let body: Body = {};
  try {
    body = JSON.parse(text) as Body;
  } catch {
    body = { text };
  }
  return { time: { path, ms, status: response.status }, body };
}

/**
 * A chain's pages one after another; the stage waits for the last. A later page waits for
 * a rate-limit slot, and that wait is the script's rather than the screen's, so a chain's
 * time is the sum of its calls' times, never its wall time.
 */
async function follow(
  persona: Persona,
  item: string | Chain,
): Promise<{ times: CallTime[]; body: Body }> {
  const chain = typeof item === 'string' ? { first: item, next: () => null } : item;
  const times: CallTime[] = [];
  let path: string | null = chain.first;
  let first: Body = {};
  while (path !== null) {
    if (times.length > 0) await reserve(1);
    const result = await call(persona, path);
    if (times.length === 0) first = result.body;
    times.push(result.time);
    path = result.time.status < 400 ? chain.next(result.body) : null;
  }
  return { times, body: first };
}

async function openScreen(
  screen: Screen,
  persona: Persona,
): Promise<{ total: number; calls: CallTime[] }> {
  const calls: CallTime[] = [];
  let previous: Body[] = [];
  let total = 0;

  for (const stage of screen.stages) {
    const items = stage(persona, previous);
    await reserve(items.length);
    const results = await Promise.all(items.map((item) => follow(persona, item)));
    // Sent together, so the stage lasts as long as its longest chain.
    total += Math.max(
      0,
      ...results.map((result) => result.times.reduce((sum, t) => sum + t.ms, 0)),
    );
    calls.push(...results.flatMap((result) => result.times));
    previous = results.map((result) => result.body);
  }

  return { total, calls };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main(): Promise<void> {
  // The seed script's guard: the screens include church-wide searches, which are audited, so
  // this never runs against a database holding real people.
  if (new URL(process.env.DATABASE_URL ?? 'x:').pathname.replace('/', '') !== 'dfc_perf') {
    throw new Error('time:screens runs only against a database named dfc_perf.');
  }
  const out = argument('--out');
  const only = argument('--only');
  const personas = await loadPersonas();
  console.log(`Personas: ${personas.map((p) => p.name).join(', ')}. Month ${M}.`);

  const lines = [
    `Timed ${today} against ${new URL(process.env.DATABASE_URL ?? '').pathname.slice(1)}, median of ${RUNS}.`,
    '',
    '| Screen | Who | Median (ms) | Slowest call (ms) | Calls | Refused |',
    '| --- | --- | ---: | --- | ---: | ---: |',
  ];

  for (const screen of SCREENS) {
    if (only !== null && !screen.name.includes(only)) continue;
    for (const persona of personas) {
      if (screen.who && !screen.who.includes(persona.name)) continue;
      const totals: number[] = [];
      let slowest: CallTime | null = null;
      let count = 0;
      let refused: string[] = [];
      for (let attempt = 0; attempt < RUNS; attempt += 1) {
        const opened = await openScreen(screen, persona);
        totals.push(opened.total);
        count = opened.calls.length;
        refused = opened.calls
          .filter((c) => c.status >= 400)
          .map((c) => `${c.status} ${c.path.split('?')[0]}`);
        for (const c of opened.calls) {
          if (slowest === null || c.ms > slowest.ms) slowest = c;
        }
      }
      const line = `| ${screen.name} | ${persona.name} | ${Math.round(median(totals))} | ${
        slowest ? `${Math.round(slowest.ms)} ${slowest.path.split('?')[0]}` : '-'
      } | ${count} | ${refused.length === 0 ? 0 : refused.join('; ')} |`;
      lines.push(line);
      console.log(line);
    }
  }

  lines.push('', `${requests} requests.`);
  if (out !== null) {
    writeFileSync(out, `${lines.join('\n')}\n`);
  }
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

async function loadPersonas(): Promise<Persona[]> {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET must be the running API’s.');
  const jwt = new JwtService({ secret, signOptions: { algorithm: 'HS256' } });

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const rows = await client.query(PERSONAS_SQL, [today]);
    return rows.rows.map((row) => ({
      name: row.name,
      accountId: row.account_id,
      personId: row.person_id,
      wholeChurch: row.name === 'Admin' || row.name === 'Senior Pastor',
      token: jwt.sign({ pid: row.person_id }, { subject: row.account_id, expiresIn: 3600 }),
      cellId: row.cell_id,
      meetingDate: row.meeting_date,
      otherPersonId: row.other_person_id,
      sundayId: row.sunday_id,
    }));
  } finally {
    await client.end();
  }
}

/**
 * The four personas, read from the database rather than remembered: the Admin, a Senior
 * Pastor, the leader with the largest branch directly under a root, and a Cell leader deep
 * in the tree. Each carries a Cell to open (their own, or else any), its latest meeting,
 * somebody else to open a page for (a disciple, or anybody), and the latest past Sunday.
 */
const PERSONAS_SQL = `
WITH RECURSIVE depth AS (
  SELECT person_id, 0 AS d FROM pastoral_assignments WHERE leader_id IS NULL AND ended_at IS NULL
  UNION ALL
  SELECT pa.person_id, depth.d + 1 FROM pastoral_assignments pa JOIN depth ON pa.leader_id = depth.person_id
  WHERE pa.ended_at IS NULL
),
branch AS (
  SELECT person_id AS top, person_id FROM pastoral_assignments WHERE ended_at IS NULL
  UNION ALL
  SELECT branch.top, pa.person_id FROM pastoral_assignments pa JOIN branch ON pa.leader_id = branch.person_id
  WHERE pa.ended_at IS NULL
),
sizes AS (SELECT top, count(*) - 1 AS size FROM branch GROUP BY top),
leaders AS (
  SELECT a.id AS account_id, a.person_id, depth.d, sizes.size
  FROM accounts a
  JOIN account_roles ar ON ar.account_id = a.id AND ar.role = 'LEADER' AND ar.revoked_at IS NULL
  JOIN depth ON depth.person_id = a.person_id
  JOIN sizes ON sizes.top = a.person_id
),
chosen AS (
  (SELECT 1 AS n, 'Admin' AS name, a.id AS account_id, a.person_id FROM accounts a
     JOIN account_roles ar ON ar.account_id = a.id AND ar.role = 'ADMIN' LIMIT 1)
  UNION ALL
  (SELECT 2, 'Senior Pastor', a.id, a.person_id FROM accounts a
     JOIN account_roles ar ON ar.account_id = a.id AND ar.role = 'SENIOR_PASTOR'
     ORDER BY ar.senior_pastor_slot LIMIT 1)
  UNION ALL
  (SELECT 3, 'Upline leader', account_id, person_id FROM leaders WHERE d = 1 ORDER BY size DESC LIMIT 1)
  UNION ALL
  (SELECT 4, 'Cell leader', account_id, person_id FROM leaders WHERE d >= 3 AND size BETWEEN 6 AND 20
     ORDER BY d DESC, size DESC LIMIT 1)
)
SELECT chosen.name, chosen.account_id, chosen.person_id,
  cell.cell_id,
  (SELECT max(m.scheduled_date)::text FROM cell_meetings m WHERE m.cell_id = cell.cell_id AND m.status = 'HELD') AS meeting_date,
  coalesce(
    (SELECT pa.person_id FROM pastoral_assignments pa WHERE pa.leader_id = chosen.person_id AND pa.ended_at IS NULL LIMIT 1),
    (SELECT pa.person_id FROM pastoral_assignments pa WHERE pa.leader_id IS NOT NULL LIMIT 1)
  ) AS other_person_id,
  (SELECT e.id FROM dcc_events e WHERE e.event_date < $1::date ORDER BY e.event_date DESC LIMIT 1) AS sunday_id
FROM chosen
LEFT JOIN LATERAL (
  SELECT coalesce(
    (SELECT cl.cell_id FROM cell_leaderships cl WHERE cl.person_id = chosen.person_id AND cl.ended_at IS NULL LIMIT 1),
    (SELECT cl.cell_id FROM cell_leaderships cl WHERE cl.ended_at IS NULL LIMIT 1)
  ) AS cell_id
) cell ON true
ORDER BY chosen.n
`;

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
