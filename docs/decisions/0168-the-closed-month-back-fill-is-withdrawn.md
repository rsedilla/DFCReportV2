# 2026-08-31 — The closed-month back-fill is withdrawn

The fourth `architecture-guardian` pass over the Stage 4 rulings found fourteen more, and
one of them was a hole in the remedy 0165 introduced. Three things are settled here. The
first deletes six mechanisms.

## A missed Sunday is filled in an open month and never in a closed one

**`npm run generate:dcc` fills a gap forward from `dcc_calendar_start` while the month is
open, and never touches a month whose window has shut. A run that finds a closed month
short says so and changes nothing.**

0165 introduced the back-fill to close a hole 0161 had left, and by 0167 it had grown a
coverage exclusion, an N exclusion, a re-entry rule, a capability entry, a CLI actor
mechanism and a settings key. The fourth review showed the re-entry rule does not work,
and the reason it cannot be patched is worth stating.

**DCC's N is church-wide.** One applicable event set covers the whole church, so every
person shares one N (Section 9). The re-entry rule triggered on the event holding *any*
attendance — so one Admin correction for one leader's people would move N from four to
five for the entire church, and every person under every other leader, whose leader was
never given the opportunity and still has none, would drop out of `Completed`. That is the
manufactured evidence the exclusion existed to prevent, arriving through the exclusion's
own escape clause.

Coverage was worse: either the event re-enters with its true denominator, and every leader
without a correction reads as having failed to submit, or the denominator narrows to the
leaders who got one, and coverage is 100% by construction and says nothing.

**The condition cannot be repaired because the reason will not narrow.** The exclusion
rests on *no leader had the opportunity*, and that fact does not stop being true when one
leader is retrospectively given one. What the rule needed was a notion of the record being
*complete*, which this specification has nowhere and which would have to define "every
responsible leader for a past Sunday" against a tree that has since moved.

**So the remedy is withdrawn rather than completed.** What is left is the dashboard, which
is what makes it unnecessary: reaching a closed month requires the schedule to have failed
for more than a month *and* nobody to have looked at the horizon date (Section 19). If it
happens anyway, it is a data incident somebody decides about with the facts in front of
them, not something a scheduled command resolves on its own.

Six mechanisms go with it: the `backfilled_at`, `backfilled_by` and `backfill_reason`
columns; the coverage exclusion; the N exclusion and its re-entry rule; Section 7's third
`records.backdate_effective_date` item; the CLI capability check; and the audit exception
for a person-run back-fill. All of them existed to serve one case the dashboard makes very
unlikely.

*0161 was right that a lapse needs surfacing and wrong that it needs repairing. Its
"never creates an event in the past" bullet, withdrawn by 0165 as a hole, was closer to
correct than what replaced it — for a reason 0161 did not give and 0165 did not find.*

## `dcc_calendar_start` is seeded with the other defaults

Section 9 said the generate command sets the key when the calendar is first generated, and
that the command runs as a system action. Section 7 permits a system action to write
`settings.updated_by` null **only for the action that seeds the defaults** — so a command
that wrote this key would be a second such writer.

That is the identical parity defect this branch had just corrected one section over, where
`audit_log.actor_id` gained a second permitted writer and the neighbouring `granted_by`
allowance was left claiming they mirror each other.

**The key is seeded with the attention threshold and the encoding flag**, and the command
only reads it. That is what lets the command stay a system action with nothing to
authorize, and it leaves Section 7's allowance with one writer. An Admin may change it
afterwards under `settings.manage`, audited with previous and new values like any other.

## The closed-Cell write authorizes on the instant the record freezes at

0166 and 0167 built an authorization triangle without noticing. Section 19 showed a
meeting to the leader it names; Section 7 authorized the write on whoever led on the
**scheduled** date; Section 13 froze the record to whoever led on the **actual** date.

Reachable, and it changes the record's owner as it is written: a Cell led by A, handed to
B on 10 March. A meeting scheduled Saturday 7 March, not yet recorded, is A's to file. A
submits it, declaring an actual date of 14 March — and Section 13 freezes it to B. A has
just written a record A can no longer correct.

**So Section 7 authorizes against the date the submission declares** — the actual date
where it has one, the scheduled date otherwise, which is Section 13's freeze instant
exactly. The person authorized is always the person the record lands on, and A's
submission above is refused instead, which is right: a meeting moved into B's tenure is
B's.

**And the exception carries the reads that write needs**: the meeting, and the Cell's
roster as of that date. Recording a meeting means marking every member present or not
(Section 13), and every read of a closed Cell's membership otherwise resolves through its
last leader — so A would have been authorized to write a roster A could not read. A
permission that cannot be exercised is not one.

Section 15's attention list is aligned with Section 19's dashboard in the same change:
each meeting appears for the leader it names, rather than every outstanding meeting
appearing for the last leader.

---

Decision 0168, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — Four more from the third review, including a key that was wrong](0167-four-more-from-the-third-review-including-a-key-that-was-wrong.md)
