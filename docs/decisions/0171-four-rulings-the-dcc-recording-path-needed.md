# 2026-08-31 — Four rulings the DCC recording path needed, settled before the code

`GET /api/v1/dcc/events/{id}/roster` and `POST /api/v1/dcc/events/{id}/submit` are the
first endpoints to write attendance. Four questions had to be answered before either
could be written, and one of them is a correction to Section 22 rather than a gap in it.

## 1. The instant the responsible leader is resolved at

Section 9 fixes the responsible leader as the person's direct pastoral leader "as of the
event date". A date is not an instant, and a pastoral assignment starts and ends at one,
so a reassignment landing on the Sunday itself has no answer in what Section 9 says.

**The responsible leader is the person's direct pastoral leader in force at the latest
instant of the event's Manila day that has already passed** — the earlier of the end of
that day and the moment the record is written.

Both simpler readings were tried and each breaks a path the specification requires.

- **The start of the event's day** breaks Section 9's own VIP workflow. Adding a DCC VIP
  creates the Person "including the pastoral leader they are being placed under" and then
  records DCC attendance, in one sitting, at the service. That assignment starts on the
  Sunday, so at 00:00 the person has no open assignment and Section 9's rule that a
  Person with no open assignment row cannot have DCC attendance recorded would refuse the
  record the workflow was written to produce.
- **The end of the event's day, unconditionally**, resolves a record written during the
  service against an instant that has not happened. The answer is unknown while the day
  is in progress, which is exactly when leaders record.

Clamping to the present is what makes the instant exist at every moment a record can be
written, and it is always inside the event's own day, which is what "as of the event
date" means at day granularity.

**Nothing recomputes it.** The column is written once and frozen — Section 9 already says
a later reassignment never moves historical records, and Section 14 lists the responsible
leader among what a correction preserves. A correction therefore carries the predecessor's
responsible leader rather than resolving it again, which is stated here because the
append-only shape writes a *new row* and the obvious implementation of a new row is to
resolve its columns afresh.

## 2. An event whose day has not begun takes no attendance

The calendar is generated thirteen months ahead (Section 9), so most rows in
`dcc_events` are for services that have not happened. Nothing refused a record against
one, and the submission window does not: a future month's window is open, because it does
not shut until the 7th of the month after it.

**Attendance may not be recorded for an event whose Manila day has not begun.** It
answers `INVARIANT_VIOLATION` — the body has to change before any attempt can succeed,
which is the question decision 0158 places a refusal by.

The harm is not hypothetical. Classification derives from lifetime attendance history
evaluated as of the end of a reporting month (Section 9), so a record against a future
Sunday advances a person's classification in months that have not been reported yet, and
the window would not close over it for another two months.

It is also what makes the clamp in ruling 1 total: with the event's day begun, the
earlier of *now* and the end of that day is never before the day starts.

## 3. Section 22's "one case carries a null `submitted_version`" was false

Section 22 says: "**One case carries a null `submitted_version`, and it is the only one.**"
It then describes two first submissions of one Cell meeting racing with neither holding a
version, the loser meeting the uniqueness of `(cell_id, scheduled_date)`.

**DCC has the identical case, and the sentence had to be corrected rather than worked
around.** `dcc_attendance` has no row until a person is recorded, and
`dcc_attendance_one_live` is unique over `(dcc_event_id, person_id)` where
`superseded_at` is null. Two actors can reach one person's first record concurrently:
the responsible leader's own submitter files it, and an upline holding
`dcc.submit_on_behalf` files it on behalf (Sections 9 and 14). Both read a roster showing
no record, both send a null version, and the loser meets that index.

Left alone, a uniqueness violation surfaces as `INTERNAL_ERROR` on an ordinary race —
which is the exact failure Section 22 named the Cell case in order to prevent, reached
one domain over.

So the DCC first submission answers `VERSION_CONFLICT` with `submitted_version: null` and
the stored row as `current`, and Section 22 now says **two** cases carry a null submitted
version and names both. The count is stated rather than the sentence being softened,
because a claim about how many cases exist is checkable and a hedge is not.

## 4. What target a DCC endpoint declares to the guard

Section 7 says a DCC event "is church-wide and resolves through nothing; the endpoints on
it are scoped by the people they return". `scopes.ts` records that a DCC event target
"arrives with the module that owns it, and until then the resolver has no rule for it and
denies". It arrives here.

**It does not become a member of the `Target` union.** The endpoints declare
`{ kind: 'actor' }`, and the domain layer restricts what they return and write to the
people the actor may record.

`{ kind: 'church' }` was the reading the words "church-wide" invite and is wrong: that
target is Whole Church only, so it would deny every Leader holding `dcc.take_attendance`
at own/subtree — which is every leader who records DCC, the whole point of the endpoint.
The actor target passes because `OWN_SUBTREE` includes the actor (Section 7), and it
leaves the real check where Section 7 puts it, on the people.

This is the shape `GET /api/v1/people/duplicate-candidates` already uses for a
church-wide read whose scoping is done by what it returns, so it is an existing reading
of an existing mechanism rather than a new one. It also keeps the Cell precedent intact:
a Cell resolves through a person and is not a member of the union either, for a reason
`scopes.ts` states — the union is for things that place *themselves* in the tree, and
neither a Cell nor a DCC event does.

---

Decision 0171, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — The submission window runs through the whole of the 7th](0170-the-submission-window-runs-through-the-whole-of-the-7th.md) | Next: [2026-08-31 — Who submits a person's DCC attendance, and where a root's is recorded](0172-who-submits-a-persons-dcc-attendance.md)
