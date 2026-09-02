# 2026-09-02 — A date-only field that is not a day is refused at the edge, by one predicate

Section 22 fixed the format of a date-only field — "plain `YYYY-MM-DD` and always
Asia/Manila dates" — and said nothing about `2026-02-30`, which matches that format and
is not a date. The question was recorded as open on 2026-09-02 with the dated
Cell-meeting scope, after the predicate deciding it had been written four times in four
modules before anyone noticed the first three.

It is settled now rather than later because slice 2c adds more date-carrying routes than
anything built so far — an actual date and an actual time on a reschedule, and a closed-
month amendment — and because the open item named a live defect that nothing had caught.

## The ruling

**A date-only value that is well-shaped and is not a day is refused with
`VALIDATION_FAILED`, at the edge, by one shared predicate.** The edge is the DTO for a
body or query field and the capability guard for a path parameter it authorizes against.
The predicate is `isCalendarDate`, reached through `IsManilaCalendarDate` in a DTO and
directly in the guard.

**The conversion to an instant refuses too**, and that is a backstop rather than the
rule: `startOfManilaDay` no longer normalises an impossible day, it throws the refusal
the edge would have thrown.

Nothing here bounds a date's **range**. A day in 1900 is a day, and whether a field
should take one belongs to that field's own section.

## What was actually wrong, which is three different things

The open item called this "not blocking the routes already written, each of which now
refuses correctly". That was true of the two routes it had been found on and false of the
rest of the API, and the worst instance was the one nothing had caught.

**A refusal that never happened.** `CloseCellDto.effective_date` carried
`@Matches(/^\d{4}-\d{2}-\d{2}$/)` and nothing else. `2026-02-30` passed it and reached
`startOfManilaDay`, where `Date.UTC(2026, 1, 30)` rolls into **2026-03-02** — so a Cell
closure was written effective on a day nobody named, into an effective-dated history
table, and the response and the `effective_date.backdated` audit entry both rendered the
invented day back through `manilaDayOf` as though it had been asked for. No step after
the shape check could have noticed: each was handed a value that had already become
plausible.

**A refusal that happened too late.** The same value as a `{meeting_id}` reached a
`::date` cast and answered `INTERNAL_ERROR` — a refusal from the wrong layer, on a
documented path parameter, which a client cannot act on.

**A plausible answer for the wrong period.** The same value as a `month` was truncated to
a reporting month and answered with a listing, before it was a 500 and before it was a
refusal.

Three failure modes, one missing rule. What made them look like three problems is that
each was found on its own route and fixed there.

## Why one predicate, and not a convention

This codebase had three conventions for one rule at the moment this was written:

- `@Matches` alone, on `CloseCellDto.effective_date`
- `@Matches` plus `@IsDateString({ strict: true })`, documented in `people.dto.ts` and
  used on every date it takes, and added to `CellMeetingsQueryDto.month` a commit after
  that field answered 500
- `isCalendarDate`, in the capability guard

A convention is what an author copies from a neighbour, and the three differ by which
neighbour. That is not a hypothetical failure mode here — it is the mechanism by which
the closure route ended up with the loosest of the three, and the reason section 22 now
names a predicate rather than a practice.

`IsManilaCalendarDate` replaces the pair rather than joining it, because it does both
halves of what the pair did: `@IsDateString({ strict: true })` refuses a date that does
not exist and accepts a full ISO timestamp, which section 22 forbids, and
`isCalendarDate` anchors the shape itself.

## What it costs, and one thing it does not

**On `people.dto.ts` nothing changes at all, and the first draft of this ruling said
otherwise.** That draft claimed the pair accepted years 1 to 99 where `isCalendarDate`
refuses them, on the strength of the divergence `isCalendarDate` documents — which is a
divergence from PostgreSQL's `::date`, not from `@IsDateString({ strict: true })`. The
mutation written to catch the change survived, which is how the claim was found; checked
afterwards, the pair and the predicate agree on all 7,854 well-shaped candidates over
seventeen years, months 00 to 13 and days 00 to 32.

So the five fields in `people.dto.ts` are a consolidation with no behaviour to point at,
and saying so is the point: the value of the ruling is not that those fields got
stricter. It is that `CloseCellDto.effective_date` could be written in the first place,
by an author copying the neighbour that happened to be nearest, and that section 22 now
names one predicate so the next author has nothing to choose between.

**The backstop answers a 422 from inside a service, which is a layer that should not be
deciding validation.** It is unreachable from any route that carries the decorator, and
it is there for the next one that does not. `reportingMonthOf` already made this choice
and gave the reason: a backstop that answers `INTERNAL_ERROR` is not one.

## What this binds

- Every date-only field in every DTO carries `IsManilaCalendarDate`. Six today:
  `CloseCellDto.effective_date`, `CellMeetingsQueryDto.month`, and the five in
  `people.dto.ts`.
- Every date-only field slice 2c adds carries it, including `actual_date`.
- The guard keeps `isCalendarDate` directly, because a path parameter it authorizes
  against is validated before the port sees it and there is no DTO in that path.
- `startOfManilaDay` refuses rather than normalising, so the class of defect cannot
  return through a caller that skips the edge.

It does not settle the related question of whether a **path** identifier should be
validated as strictly as one in a body, which is a separate open item about UUIDs and is
untouched by this.

---

Decision 0185, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-01 — A Cell meets on the day it was created, and the bound is a date at both ends](0184-a-cell-meets-on-the-day-it-was-created.md)
