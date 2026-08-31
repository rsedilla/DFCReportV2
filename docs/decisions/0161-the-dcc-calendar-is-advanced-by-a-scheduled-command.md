# 2026-08-31 — The DCC calendar is advanced by a scheduled command

Section 9 requires one DCC event per Sunday on "a rolling horizon of at least twelve
months ahead", and forbids creating one lazily on first use. The ruling of 2026-08-20
settled *that* and left *what advances it* unsaid, which is the half an implementer
needs.

**`npm run generate:dcc` generates thirteen months ahead, idempotently, and the
deployment schedules it.** It creates only the Sundays that are missing — so running it
twice, or daily, changes nothing the second time — and it writes one audit entry per
event created.

*This ruling was titled "advanced by an **Admin** command" and said "It is an Admin
action", and both were wrong: it is invoked by a schedule and has no interactive actor,
so it is a **system** action with a null `actor_id`, which Section 6 now names as the
second such thing. Requiring `ADMIN` would mean a stored credential or a person running
it weekly. The one exception is a back-fill into a closed month, which is a person's act
under `records.backdate_effective_date`. It also said "up to twelve months" against
Section 9's floor of twelve, which is satisfied only at the instant it runs, and "one
entry naming the range and the count", which has no target and folds many creations into
one entry against Section 21.*

## Why a command rather than something automatic

**Section 2 says queues and workers are not required for the initial release**, and
Section 13 already declined to introduce one: notifications are in-app only, with "no
scheduled mail job, no queue, and no background worker". A scheduler added here would be
the first background job in the system, introduced for the one task that tolerates being
late.

**What makes that acceptable is not the tolerance, and the first version of this ruling
said it was.** It argued that a late run "still leaves eleven months of calendar, and
nothing reads past the current month plus the submission window" — which Section 18
refutes, since a Senior Pastor may view January through December of the current year, and
each of those months takes its N from `dcc_events`.

It also placed the obligation with the deployment "alongside the backup schedule", on the
ground that both are periodic tasks whose failure is visible. That is Section 25 rule 19
failing on its own citation: a backup job's failure is visible **because the job reports
it**, and a command nobody runs reports nothing. The reason did not carry and the shape
was taken anyway.

**What makes it acceptable is that the horizon is surfaced and the lapse is
repairable** — the Admin dashboard carries the date the calendar reaches, and the command
back-fills a Sunday it finds missing. Both are settled in [decision 0165](0165-four-stop-conditions-the-stage-four-rulings-raised.md) and written into Section 9.

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

- **Idempotent.** It computes the Sundays in Asia/Manila out to **thirteen** months and
  inserts those with no row. Thirteen against Section 9's floor of twelve, because a
  top-up *to* the floor satisfies "at least twelve" at the instant it runs and at no
  instant after it. A unique constraint on `event_date` makes that a
  property of the table rather than of the command.
- **It never revives a removed Sunday.** Section 9 keeps a removed event as a row with
  `removed_at` set, precisely so a month showing four events where the calendar holds
  five is explained by a record. The command inserts missing rows, and a removed Sunday
  is not missing.
- ~~**It never creates an event in the past.**~~ *Withdrawn by [decision 0165](0165-four-stop-conditions-the-stage-four-rulings-raised.md).*
  It was this ruling's own invention rather than Section 9's, and it left a lapse with no
  remedy at all: no route creates a DCC event, so a month whose Sundays were missed would
  carry a wrong N for ever. Section 9's guarantee is that every Sunday carries an event
  unless one was deliberately removed, and back-filling restores that rather than
  breaking it. Back-filling a **closed** month is backdating and carries what backdating
  carries.
- **Audited**, one entry per event created, because Section 21 requires a target and one
  entry per action performed. A run that creates nothing writes nothing.

---

Decision 0161, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — One API instance, and the skew bound waits for the second](0160-one-api-instance-and-the-skew-bound-waits-for-the-second.md) | Next: [2026-08-31 — A Cell meeting is addressed by its week](0162-a-cell-meeting-is-addressed-by-its-week.md)
