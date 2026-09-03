# 2026-09-03 — A write that writes nothing owes no *amendment* capability, and its confirmation is a disclosure

*The file name keeps the withdrawn wording — "owes no further capability" — because it is
this ruling's identity and every previous/next link in the sequence resolves by it. That is
deliberate and is recorded here rather than left to be discovered, on the same reasoning
migration 0011's frozen comment is recorded in decision 0190. The heading above, the index
entry in `CLAUDE.md` and 0192's link text all carry the narrowed form.*

Slice 2c settled that a submission matching what is already stored is not an amendment:
Section 9 states both the rule and the reason — "there is nothing here to
overwrite" — so it needs no `cell.correct_subtree`, writes no rows, writes no audit entry
and does not move the meeting's version.

The consequence is an oracle. An actor holding `cell.take_attendance` and not the
correction capability gets `201` for a roster that matches and `403` for one that does
not, so the pair of outcomes answers a question about stored attendance that no read route
answers.

Raised by `architecture-guardian` as a Stop Condition on the second pass of that slice.
Section 7 says a capability without a scope grant is not usable and Section 8 says what a
search may disclose; neither says whether a write that writes nothing owes the capability
its refusal would otherwise require.

## The ruling

**It owes no *amendment* capability, and the confirmation is accepted as a disclosure.**

**The amendment capability and nothing else**, which the first version of this ruling did
not say. Written as "no capability beyond the one that reached it" it was general, and two
things falsified it: `dcc.submit_on_behalf` is required of an unchanged DCC line today, and
decision 0192 — made the same day — requires `cell.submit_on_behalf` of a meeting that is
not the actor's. Read generally, this ruling put that check behind the roster comparison,
so the **success** answered what the refusal was withheld to protect: 201 for a matching
roster and 403 for a differing one, on a meeting the actor may not record at all.

Every capability except the amendment one is decided before the record's **contents** can
change what the caller is told, and must be: whether a record is the actor's to touch is
not a question about its contents.

*Stated over what the caller is told rather than over what the code reads. Both
implementations load a record before deciding, and cannot avoid it — the amendment
capability is decided **by** the contents. What must not differ according to them is a
refusal, a success or a status code. This sentence said "before the record's contents are
read" for part of 2026-09-03, which no implementation obeyed.*

**"Contents" means the per-person attendance figures**, and the term is defined because the
sentence turns on it: a meeting's own status, version, submitter and submission time are
not contents in this sense, and who was marked present is.

**This sentence has now been narrowed three times, and twice by the pass on the commit that
narrowed it.** It first said "no capability beyond the one that reached it". The correction
of 2026-09-03 replaced that with "before what is stored is read", which was false of both
implementations. The correction to *that* claimed the Cell path's ground covered the DCC
path as well — "both are safe, and not by luck" — and the pass on it showed that it does
not, because a DCC event resolves through the people a route returns rather than through
its declaration.

So this ruling settles the Cell path and **not** the DCC one. The Cell path is safe on a
checked ground: its early refusals expose the meeting's own status, version and submitter,
which `GET /cells/{id}/meetings/{meeting_id}/roster` returns to the same actor under an
identical declaration, asserted by `test/unit/capability-scope-resolution.spec.ts`. The
DCC roster and submit routes carry an identical declaration too and it proves nothing
there: one walks the actor's checklist and the other reaches everyone they hold
`dcc.take_attendance` over. **That question was settled the same day as decision 0193**:
§7's contents-ordering rule binds DCC, the correction-reason refusal moved behind the
on-behalf check, and the 409/403 record-existence pair it produced went with it. So the
two paths now state one rule, reached by two different arguments rather than by one
covering both.

Three narrowings are recorded at this length because each one was introduced by the fix
for the last. A rule restated to be more precise is a rule being rewritten, and on this
project a fix batch has introduced a defect more often than not.

## Why accepted rather than closed

**The bound is exponential, not linear.** Section 13 requires a submission to name every
member of the meeting exactly once, and the answer covers the whole set with no per-line
detail — so recovering N people's attendance costs 2^N submissions rather than N. For a
Cell of twelve that is four thousand requests to learn twelve booleans, each one a
state-changing call carrying its own idempotency key.

**The actor is not a stranger to the record.** Every actor who reaches this point holds
the capability that *records* this meeting and, under decision 0192, the right to record
it for whoever leads it — they may file it, and one more grant lets them overwrite it
outright. What they are being kept from is amending somebody else's account
of it, which is what `cell.correct_subtree` is for.

**The alternative costs an honest leader something real.** Requiring the correction
capability for an unchanged submission closes the bit and refuses a resubmission that
changes nothing — telling a leader they may not alter something they did not alter. It
also makes the no-op path answer differently from what it does, which is nothing.

## What would change it

**A route that reads per-person attendance, which no *Cell* route does.** `GET
/api/v1/cells/{id}/meetings/{meeting_id}/roster` returns the Cell's members and the
meeting's own row — its status, its versions, its submitter — and never who was marked
present. So for a Cell meeting the bit this ruling accepts is, today, the only way to
learn a per-person figure without the correction capability.

*This said "which none does today", of the whole system, and was false when written.*
`GET /api/v1/dcc/events/{id}/roster` returns each person's `present`, `version` and
`recorded_at` under `dcc.take_attendance` — so a DCC route has published per-person
attendance since the DCC recording slice, and for DCC the bit is already free. This
ruling covers the Cell path, which is what its scope was narrowed to above. **What the
DCC fact does to the acceptance was settled the same day as decision 0194**: the
acceptance is a Cell argument, and the DCC roster publishes those figures deliberately,
because a leader marking a checklist must see who is already marked and the version they
submit against.

The first surface that offers those figures makes the bit free, and at that point this
ruling is inherited rather than re-decided unless whoever builds it revisits it. It is
written here so they find it stated.

Stage 5's reporting reads are the likely first, and they carry `reports.view_subtree`
rather than `cell.take_attendance` — so the question is whether an actor holding only the
recording capability gains a read they did not have, not whether the figures exist.

## What this binds

- The unchanged-submission path sits before the *amendment* capability check and before the
  version comparison, and **after** the on-behalf one — which is the distinction this
  ruling's narrowing exists to draw, and which an earlier version of this bullet erased by
  saying "before the capability check".
- The refusal for a differing submission stays `SCOPE_DENIED` naming
  `cell.correct_subtree`, which is what tells an administrator what to grant.
- Section 7 carries the rule, because it is a rule about what a capability owes rather than
  about what a search may reveal.
- The roster read and the submit route must keep the identical capability and target
  declaration, because the ordering above is safe only while they admit the same actors.
  `test/unit/capability-scope-resolution.spec.ts` asserts it.

**One code change, and this said "No code changes" while the change was in the same
commit.** Reading the ruling generally put the on-behalf check behind the roster
comparison; the narrowing is what moves it in front, at `cell-meetings.service.ts`. The
reorder is often attributed to decision 0192, which requires the capability — but 0192 says
*that* it is required and this ruling says *when* it is decided, and the ordering is this
one's.

---

Decision 0191, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-03 — A Cell meeting has one write operation, and `cell_attendance.version` is not compared](0190-a-cell-meeting-has-one-write-operation.md)
