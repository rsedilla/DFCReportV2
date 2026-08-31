# 2026-08-31 — The DCC calendar is advanced by an Admin command

Section 9 requires one DCC event per Sunday on "a rolling horizon of at least twelve
months ahead", and forbids creating one lazily on first use. The ruling of 2026-08-20
settled *that* and left *what advances it* unsaid, which is the half an implementer
needs.

**`npm run generate:dcc` tops the calendar up to twelve months, idempotently, and the
deployment schedules it.** It is an Admin action, audited, and it creates only the
Sundays that are missing — so running it twice, or daily, changes nothing the second
time.

## Why a command rather than something automatic

**Section 2 says queues and workers are not required for the initial release**, and
Section 13 already declined to introduce one: notifications are in-app only, with "no
scheduled mail job, no queue, and no background worker". A scheduler added here would be
the first background job in the system, introduced for the one task that tolerates being
late.

It tolerates it because the horizon is twelve months and the need is one Sunday a week.
A generation that runs late by a month leaves eleven months of calendar, and nothing
reads past the current month plus the submission window.

**Where it sits is where the backup schedule sits.** Section 24 already puts a daily
obligation on the deployment rather than inside the application, and this is the same
kind of thing: a periodic task the platform runs, whose failure is visible.

## What was rejected

**A top-up at startup.** No scheduler to forget, and Section 24 already makes the
application require a reachable database to finish starting — so the machinery is
there. Refused because a process that runs for months never advances the horizon, which
makes the guarantee depend on how often the deployment restarts, and because a boot that
writes rows is a side effect nothing else in this application has.

**An in-process timer.** Self-maintaining, and it fires once per instance — harmless
today at one instance (0160) and wrong the moment there are two, which is exactly the
kind of thing that is not noticed when it changes.

**A command plus a startup check that refuses to serve.** The strongest guarantee and
the wrong failure: a missed schedule would become an outage. The `DateStyle` pin refuses
to start because a wrong `DateStyle` corrupts every date silently; a short calendar is
neither silent nor immediate.

## What the command owes

- **Idempotent.** It computes the Sundays in Asia/Manila between today and twelve months
  out and inserts those with no row. A unique constraint on `event_date` makes that a
  property of the table rather than of the command.
- **It never revives a removed Sunday.** Section 9 keeps a removed event as a row with
  `removed_at` set, precisely so a month showing four events where the calendar holds
  five is explained by a record. The command inserts missing rows, and a removed Sunday
  is not missing.
- **It never creates an event in the past.** The horizon runs forward from today. A
  Sunday that has already passed with no event is a fact about the calendar, and
  inserting one after the fact would change a closed month's denominator.
- **Audited**, with one entry naming the range and the count, because Section 21 audits
  the removal of an event and the creation of the calendar is the same kind of act.

---

Decision 0161, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — One API instance, and the skew bound waits for the second](0160-one-api-instance-and-the-skew-bound-waits-for-the-second.md) | Next: [2026-08-31 — A Cell meeting is addressed by its week](0162-a-cell-meeting-is-addressed-by-its-week.md)
