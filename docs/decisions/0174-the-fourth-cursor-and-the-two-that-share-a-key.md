# 2026-08-31 — The fourth cursor, and the two that share a key

`CLAUDE.md` has carried, since 2026-08-31, the question of whether the keyset cursors
should share an encode/decode pair — and said where to settle it: "Stage 4 adds a
fourth — settle it there, with four in front of whoever decides rather than three."
The fourth is `GET /api/v1/dcc/events/{id}/roster`. This is that settlement.

## The DCC roster is paginated, which it was not going to be

The endpoint first shipped returning the whole checklist with `next_cursor: null` and
no `limit`. The justification written beside it was that a page boundary "would let a
leader submit a checklist they had seen half of".

**That is the same argument `GET /api/v1/cells/{id}/members` was corrected for**, and
it fails the same way: it bounds the *request* rather than the data. Section 22 makes
pagination cursor-based on every collection endpoint, and an envelope answering
`next_cursor: null` over a list it silently truncated reads as "this is the last
page". Nothing truncated here — which is worse, not better: the response grew without
bound instead, on an endpoint whose size Section 9 explicitly does not bound. A leader
covering several account-less downlines carries their children too, and Section 9 says
that arrangement persists.

It also used the wrong envelope. Every other collection in this API answers
`{ data, next_cursor }`; this one answered `{ people, next_cursor }`. One shape, or a
client writes a special case for one route.

The order changed with it, from the composed full name to `(last_name, first_name,
member_id)` — the ordering Section 8's directory search already uses, and a total one:
two people legitimately share a name, so the Member ID breaks the tie.

## The two that share a key now share the pair

That key is, character for character, the one `GET /api/v1/cells/{id}/members` pages
by. So `roster-cursor.ts` moved from `cells/` to `common/` and both routes use it.

**Sharing where the key is identical, and not otherwise.** The four cursors do not
divide into "generic" and "specific": two of them order by the same three fields and
two do not. `people.controller.ts` keys on two names and a UUID;
`leadership-request-cursor.ts` on an instant and a UUID, and needs a format predicate
the others do not. A single generic pair over all four would be a type parameter plus
a per-route validator, which is most of what each file already holds — the argument
`CLAUDE.md` recorded against generifying, and it still holds for those two.

What it does not hold for is two files encoding the same three strings. The history
`CLAUDE.md` cites as the argument *for* sharing is a history of one decision copied
and diverging: the roster cursor shipped with a key that could not be planned at all,
the queue cursor shipped with `Date.parse` where PostgreSQL's parser was meant, and
the unreadable-cursor behaviour was one decision copied twice that read as three
agreeing. A fourth file re-deriving the same three fields is where that history
repeats.

The two remaining files keep their own pairs, and the open question closes with them
named rather than left to the next reader to recount.

## What the shared file is, and is not

It is an encode/decode pair over one key, with a shape check. It is **not** a
pagination framework, and deliberately does not know how the key is compared: the Cell
roster compares it in SQL as a lexicographic keyset, and the DCC roster compares it
against a list its own service assembled, because the checklist is computed by walking
the pastoral tree rather than by a query. That difference is real and is not worth
abstracting over — what the two share is the wire format, which is the part a client
sees and the part that was diverging.

Its docblock keeps the whole of the Cell roster's history, because that history is why
the file exists, and gains the DCC route as a second caller rather than being
rewritten around it.

---

Decision 0174, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — Seven settlements from building DCC recording](0173-seven-settlements-from-building-dcc-recording.md)
