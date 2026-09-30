/**
 * Many leaders using the made-up church `seed:perf` builds at once, as on a Sunday night.
 *
 *   DATABASE_URL=<dfc_perf> JWT_SECRET=<the running API's> PERF_API=http://127.0.0.1:3002 \
 *     npm run load:test -- [--levels 50,100,200] [--seconds 90] [--out report.md]
 *
 * **It refuses any database not named `dfc_perf`**, because it writes: every leader saves
 * their DCC checklist, flipping each mark, over and over. Nothing it writes can be removed.
 *
 * Each level runs that many leaders together, each a different account, because the API
 * limits signed-in requests per account (120 a minute) and a church's leaders each have
 * their own. Each leader repeats one round until the level's time is up:
 *
 *   Record      the calls the Record page makes when it opens (as `time:screens` maps it)
 *   Checklist   last Sunday's DCC checklist, every page
 *   Save        that checklist saved with every mark flipped
 *   Reports     My 12, Cell Groups and DCC, for the month
 *
 * with a pause of one to three seconds between steps, and never faster than 100 requests
 * a minute per leader. It signs in by minting the access token the API would have issued,
 * as `time:screens` does. A step's time is what the leader waits for; a request's time is
 * the server's answer to one call.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { JwtService } from '@nestjs/jwt';
import { Client } from 'pg';

const API = process.env.PERF_API ?? 'http://127.0.0.1:3002';
const MIN_GAP_MS = 60_000 / 100;
const TIMEOUT_MS = 60_000;

const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const M = `${today.slice(0, 7)}-01`;
const PREVIOUS = (() => {
  const d = new Date(`${M}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
})();

// A response is read loosely: this script follows ids and cursors, and checks no shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

interface Leader {
  accountId: string;
  personId: string;
  token: string;
  nextSlot: number;
}

interface Sample {
  ms: number;
  status: number;
}

type Step = 'Record' | 'Checklist' | 'Save' | 'Reports';

interface Level {
  requests: Sample[];
  steps: Record<Step, number[]>;
}

async function reserve(leader: Leader, count: number): Promise<void> {
  const wait = leader.nextSlot - Date.now();
  if (wait > 0) await sleep(wait);
  leader.nextSlot = Math.max(Date.now(), leader.nextSlot) + count * MIN_GAP_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function call(
  level: Level,
  leader: Leader,
  path: string,
  post?: { body: unknown },
): Promise<{ ms: number; status: number; body: Body }> {
  const started = performance.now();
  let status = 0;
  let body: Body = {};
  try {
    const response = await fetch(`${API}${path}`, {
      method: post ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${leader.token}`,
        ...(post ? { 'content-type': 'application/json', 'idempotency-key': randomUUID() } : {}),
      },
      body: post ? JSON.stringify(post.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = response.status;
    const text = await response.text();
    try {
      body = JSON.parse(text) as Body;
    } catch {
      body = {};
    }
  } catch {
    status = 0; // no answer: refused connection or timed out
  }
  const ms = performance.now() - started;
  level.requests.push({ ms, status });
  return { ms, status, body };
}

/** Calls sent together; the step waits for the slowest. */
async function together(
  level: Level,
  leader: Leader,
  paths: string[],
): Promise<{ ms: number; bodies: Body[] }> {
  await reserve(leader, paths.length);
  const results = await Promise.all(paths.map((path) => call(level, leader, path)));
  return {
    ms: Math.max(0, ...results.map((r) => r.ms)),
    bodies: results.map((r) => r.body),
  };
}

/** A list read to its end, page after page. */
async function whole(
  level: Level,
  leader: Leader,
  first: string,
): Promise<{ ms: number; data: Body[] }> {
  const joiner = first.includes('?') ? '&' : '?';
  let path: string | null = first;
  let ms = 0;
  const data: Body[] = [];
  while (path !== null) {
    await reserve(leader, 1);
    const result = await call(level, leader, path);
    ms += result.ms;
    if (result.status >= 400 || result.status === 0) break;
    data.push(...((result.body.data ?? []) as Body[]));
    path = result.body.next_cursor
      ? `${first}${joiner}cursor=${encodeURIComponent(result.body.next_cursor)}`
      : null;
  }
  return { ms, data };
}

async function round(level: Level, leader: Leader, sundayId: string): Promise<void> {
  const scope = `scope=LEADER&leader_id=${leader.personId}`;

  // Record: the page's first calls, then its month reports and the open Sundays' checklists.
  const first = await together(level, leader, [
    '/api/v1/auth/me',
    '/api/v1/people/awaiting-reassignment?limit=50',
    '/api/v1/cells/people-without-a-cell?limit=50',
    `/api/v1/cells/meetings/awaiting?month=${M}&whose=mine`,
    `/api/v1/cells?month=${M}`,
    `/api/v1/cells?month=${M}&state=CLOSED`,
    `/api/v1/dcc/events?month=${M}`,
    '/api/v1/cells/leadership-requests/sent',
  ]);
  const recordable = ((first.bodies[6]?.data ?? []) as Body[]).filter((e) => e.recordable);
  const reports = together(level, leader, [
    `/api/v1/reports/cells/monthly?period=${M}&${scope}`,
    `/api/v1/reports/cells/monthly?period=${PREVIOUS}&${scope}`,
    `/api/v1/reports/dcc/monthly?period=${M}&${scope}`,
    `/api/v1/reports/dcc/monthly?period=${PREVIOUS}&${scope}`,
  ]);
  const rosters = recordable.map((e) => whole(level, leader, `/api/v1/dcc/events/${e.id}/roster`));
  const second = await Promise.all([reports, ...rosters]);
  level.steps.Record.push(first.ms + Math.max(...second.map((s) => s.ms)));
  await sleep(1000 + Math.random() * 2000);

  // Checklist, then Save with every mark flipped.
  const checklist = await whole(level, leader, `/api/v1/dcc/events/${sundayId}/roster`);
  level.steps.Checklist.push(checklist.ms);
  await sleep(1000 + Math.random() * 2000);

  const records = checklist.data.slice(0, 500).map((line) =>
    line.record
      ? {
          person_id: line.person_id,
          present: !line.record.present,
          version: line.record.version,
          correction_reason: 'Load test',
        }
      : { person_id: line.person_id, present: true, version: null },
  );
  if (records.length > 0) {
    await reserve(leader, 1);
    const saved = await call(level, leader, `/api/v1/dcc/events/${sundayId}/submit`, {
      body: { records },
    });
    level.steps.Save.push(saved.ms);
  }
  await sleep(1000 + Math.random() * 2000);

  // Reports: My 12 for the month, Cell Groups and DCC.
  const twelve = await together(level, leader, [
    `/api/v1/reports/cells/twelve?kind=MONTH&start=${M}&period=${M}&${scope}`,
    `/api/v1/reports/dcc/twelve?kind=MONTH&start=${M}&period=${M}&${scope}`,
  ]);
  level.steps.Reports.push(twelve.ms);
  await sleep(1000 + Math.random() * 2000);
}

async function runLevel(leaders: Leader[], seconds: number, sundayId: string): Promise<Level> {
  const level: Level = {
    requests: [],
    steps: { Record: [], Checklist: [], Save: [], Reports: [] },
  };
  const until = Date.now() + seconds * 1000;
  await Promise.all(
    leaders.map(async (leader, index) => {
      await sleep((index / leaders.length) * 5000); // arriving over five seconds, not in one instant
      while (Date.now() < until) {
        await round(level, leader, sundayId);
      }
    }),
  );
  return level;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const s = (ms: number): string => (ms / 1000).toFixed(1);

async function main(): Promise<void> {
  if (new URL(process.env.DATABASE_URL ?? 'x:').pathname.replace('/', '') !== 'dfc_perf') {
    throw new Error('load:test runs only against a database named dfc_perf.');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('load:test never runs in production.');
  }
  const levels = (argument('--levels') ?? '50,100,200').split(',').map(Number);
  const seconds = Number(argument('--seconds') ?? '90');
  const out = argument('--out');
  const leaders = await loadLeaders(Math.max(...levels));
  if (leaders.length < Math.max(...levels)) {
    throw new Error(`dfc_perf has ${leaders.length} leader accounts; a level asks for more.`);
  }

  const events = await call(
    { requests: [], steps: { Record: [], Checklist: [], Save: [], Reports: [] } },
    leaders[0],
    `/api/v1/dcc/events?month=${M}`,
  );
  const sunday = ((events.body.data ?? []) as Body[]).filter((e) => e.recordable).pop();
  if (!sunday) throw new Error(`No recordable Sunday in ${M}.`);
  console.log(`Sunday ${sunday.event_date ?? sunday.date ?? sunday.id}, ${seconds} s per level.`);

  const lines = [
    `Load test ${today} against ${new URL(process.env.DATABASE_URL ?? '').pathname.slice(1)}, ${seconds} s per level.`,
    '',
    '| Leaders at once | Requests | Per second | Typical request | Slowest 5% | Slowest | Errors | Record | Checklist | Save | Reports |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |',
  ];
  for (const count of levels) {
    const level = await runLevel(leaders.slice(0, count), seconds, sunday.id);
    const times = level.requests.map((r) => r.ms);
    const errors = new Map<number, number>();
    for (const r of level.requests) {
      if (r.status >= 400 || r.status === 0) errors.set(r.status, (errors.get(r.status) ?? 0) + 1);
    }
    const step = (name: Step): string =>
      `${s(percentile(level.steps[name], 50))} s (worst ${s(percentile(level.steps[name], 100))} s)`;
    const line = `| ${count} | ${times.length} | ${(times.length / seconds).toFixed(1)} | ${s(
      percentile(times, 50),
    )} s | ${s(percentile(times, 95))} s | ${s(percentile(times, 100))} s | ${
      errors.size === 0
        ? '0'
        : [...errors].map(([code, n]) => `${n} × ${code === 0 ? 'no answer' : code}`).join(', ')
    } | ${step('Record')} | ${step('Checklist')} | ${step('Save')} | ${step('Reports')} |`;
    lines.push(line);
    console.log(line);
    await sleep(15_000); // let the server settle between levels
  }
  if (out !== null) writeFileSync(out, `${lines.join('\n')}\n`);
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

/** Leader accounts that file a DCC checklist, spread across the tree rather than one branch. */
async function loadLeaders(count: number): Promise<Leader[]> {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET must be the running API’s.');
  const jwt = new JwtService({ secret, signOptions: { algorithm: 'HS256' } });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const rows = await client.query(
      `SELECT a.id AS account_id, a.person_id
         FROM accounts a
         JOIN account_roles ar ON ar.account_id = a.id AND ar.role = 'LEADER' AND ar.revoked_at IS NULL
        WHERE a.status = 'ACTIVE'
        ORDER BY md5(a.id::text)
        LIMIT $1`,
      [count],
    );
    return rows.rows.map((row) => ({
      accountId: row.account_id,
      personId: row.person_id,
      token: jwt.sign({ pid: row.person_id }, { subject: row.account_id, expiresIn: 3600 }),
      nextSlot: 0,
    }));
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
