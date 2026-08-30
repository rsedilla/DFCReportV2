# 2026-08-31 — A cursor that cannot be resolved is refused

Settled before any Stage 4 code, because Stage 4 adds a paginated collection of its own
— a Cell's meetings — and the three that exist agreed with each other by accident rather
than by decision.

*`CLAUDE.md`'s open item said there were two, naming `GET /api/v1/people` and the Cell
roster. There are three: `GET /api/v1/cells/leadership-requests` shipped its own cursor
with the leadership-request slice, and its file says in terms that it "makes the third
implementation agreeing rather than a second answer". The item was written before that
route existed and was not updated when it arrived, which is the count this log keeps
recording. Every claim below was checked against three files.*

**A `cursor` a collection endpoint cannot resolve is refused with `VALIDATION_FAILED`,
carrying `field: "cursor"` in `details`.** Unparseable, forged, or structurally wrong,
all the same answer. An **absent** cursor is still absent and starts at the first page;
this is about a cursor that was sent.

## What it replaces

All three endpoints treated an unreadable cursor as absent, and only the first of them
chose to. `GET /api/v1/people` argued for it in a docblock. `GET /api/v1/cells/{id}/members`
was changed to match on the fourth closure review, to agree with its neighbour rather
than because anyone had decided the neighbour was right — `roster-cursor.ts` says so
about itself. `GET /api/v1/cells/leadership-requests` then matched both, and says so too.
So one decision was made and copied twice, and each copy made the arrangement look more
settled than it was.

The third route is also the one with the most ways to be unresolvable: besides the two
the others have — not base64url JSON, and JSON of the wrong shape — its `requestedAt`
must match the exact rendering the query emits, because it is cast to `timestamptz` and
a value PostgreSQL cannot parse is a 500 rather than an empty page. All of them are now
one answer.

## Why refusing

**One refusal, shared, rather than three that agree today.** `common/cursor.ts` already
holds the length bound all three import; it now holds the refusal too, so a fourth
cursor cannot answer differently by being written on a different day. That is the whole
lesson of how these three came to agree.

**It is what Section 22 does everywhere else it has had this choice.** A request body
nested past twenty levels is "refused, not truncated", and the section gives the reason
in general terms: accepting the request and quietly doing something other than what was
asked is worse than refusing, because it is the requests nobody looks at that get the
silent treatment. A Cell closure naming more than 500 members "refuses rather than
truncating", on the same reasoning. Treating an unreadable cursor as absent is the same
move a third time — the server does something the client did not ask for and says
nothing.

**The failure it prevents is silent and looks like success.** A client paging a
collection sends `cursor` because it already holds page one. Handed page one again with
a `200`, it appends: rows it already has are delivered a second time, and a client
syncing a roster or a month of meetings has no way to tell that from a collection that
genuinely grew. Section 14's principle for this system is that a conflict is surfaced
rather than resolved silently, and this is that principle one layer down.

**The validation already in front of the decoder refused, and the decoder did not.**
Both DTOs bound `cursor` with `@Length`, so `?cursor=` and an over-long value are
already answered `VALIDATION_FAILED` — and `cells.dto.ts` says in a comment that the
bound is `Length` rather than `MaxLength` precisely so the empty case is refused. A
value one byte too long was therefore a 422 while a value of the right length carrying
nothing readable was a silent restart. This makes one path out of two, which is what
`roster-cursor.ts` was reaching for when it observed that "a consistency argument that
holds only for the last step of three is not one".

**The remedy is followable, which is the test Section 22 applies to a stored refusal.**
A `VALIDATION_FAILED` is a 4xx, so it is stored against the idempotency key — except
that this is a `GET`, which carries no key, so the store/release rule of decision 0158
does not reach it. The client drops the cursor and re-requests the collection from the
start, which is precisely what the old behaviour did for it, with the difference that it
now knows.

**Stranding was the argument against, and it does not survive contact.** A client cannot
be stranded by a code that tells it to start over: `VALIDATION_FAILED` on `cursor` is
distinguishable, and the recovery is a request the client can already make. What the old
behaviour bought was that a client which does *not* handle the code keeps working; what
it cost is that a client which does not handle it keeps working **wrongly**, and cannot
find out.

## Why `VALIDATION_FAILED` rather than a code of its own

`CURSOR_INVALID` would let a client branch on "restart this collection" without reading
`details.field`, which is real and small. Against it: Section 22 defines
`VALIDATION_FAILED` as "malformed or missing input", which a cursor the server cannot
read is exactly, and the envelope already carries `details.field` for binding a message
to what it concerns. Section 22 warns that a code is permanent across three client
surfaces that cannot be force-updated, so one is added when an existing one is wrong,
not when an existing one is merely general.

**`field: "cursor"` is a hint about a query parameter, and Section 23 governs what a
client does with it.** There is no form field named `cursor` on any screen, so by the
`field-invalid` rule the failure carries no colour and is not a statement that anybody
mistyped anything. It is a client-to-client message, and the client that reads it is the
one that constructed the request.

## Two things this deliberately does not settle

**Whether a cursor should be signed.** Refusing a cursor the server cannot *read* says
nothing about one that reads cleanly and was tampered with. Both endpoints' cursors are
base64url JSON, so a client can construct one, which Section 22 forbids clients from
doing and does not prevent. It discloses nothing either way, and both files
already give the reason: a forged cursor can only start the page elsewhere in a
collection the reader is authorized to see **in full** — a directory Section 8 makes
readable church-wide, or a roster its own guard has already admitted the reader to. So
this stays as it is.

**What the duplicate-candidate lookup does when its list exceeds `limit`.** That endpoint
returns `next_cursor: null` over a truncated set and accepts no cursor at all, so this
ruling does not reach it. It remains open in `CLAUDE.md`.

---

Decision 0159, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — A stale premise under a cleanly taken lock is transient](0158-a-stale-premise-under-a-cleanly-taken-lock-is-transient.md) | Next: [2026-08-31 — One API instance, and the skew bound waits for the second](0160-one-api-instance-and-the-skew-bound-waits-for-the-second.md)
