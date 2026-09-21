# 2026-09-21 — The Cells list has a closed view, and it is where a restart is asked for

Decision 0264 gave a leader **Restart this Cell** and decision 0265 settled who may ask for
one: a leader upline of the Cell's last leader. Neither gave that leader a way to find the
Cell. `GET /api/v1/cells` filters `state = 'ACTIVE'`, so no screen lists a closed Cell, and
the one live path to one — the recording queue (decision 0251) — carries only a closed Cell
with a meeting still awaiting a record in an open month, which is nothing at all a week
after the 7th.

## The ruling

**`GET /api/v1/cells` takes `state`, and `CLOSED` is a view of its own.** The default stays
`ACTIVE`, because every count of Cells means active Cells unless it says otherwise (Section
10). The two are never mixed: a closed Cell appears only where the reader asked for closed
ones.

**A closed Cell is in the reader's scope through its last leader**, which is what Section 7's
base bullet resolves a closed Cell through, and `cell.view_subtree` is a viewing capability,
which that bullet governs without the tension the closed-Cell clause raises for a write.

**Each row carries what a closure is**: the day it closed, the reason, and the Cell that has
since resumed it, where one has. Its category and schedule are the last rows it held that were ever in force — a closure can leave a
later row zero-length, and Section 5 says no instant resolves to one — and a restart request
starts from them.

**Whether a restart may be asked for is the server's answer**, `may_restart`, and never a
client's derivation. It is the scope half of what the request checks — `cell.request_leadership`
over the last leader, who must never be the actor, and `cell.manage_lifecycle` over the same
person — together with the Cell's own state: not closed as created in error, and not already
restarted.

**Section 15's attention list reads both views.** The list of Cells with meetings still
awaiting a record keeps a closed Cell while its month's window is open, which the
`ACTIVE`-only index could not carry at all. **It is not thereby complete**: both halves are
read one page at a time, so a Cell beyond that page is absent from the list — which was
already true of the running half. What a page bound owes a Section 15 list stays open, and
this ruling does not settle it.

## Why

**A view rather than a mixed list**, because a closed Cell's row answers different questions:
when it closed and whether it may resume, where a running one answers when it meets and what
is left to record. Mixing them would put two kinds of row under one set of columns and would
quietly change what "the Cells you oversee" counts. Their coverage figures are bounded
differently too — a closed Cell's denominator stops at its closure — which is why the
attention list reading both is recorded above as a question rather than as a settled shape.

**Through the last leader rather than through anybody who once led it**, which is what
Section 7 resolves a closed Cell through. An earlier leader is refused `GET /cells/{id}/meetings`
today, which `CLAUDE.md` records as open, so listing the Cell for them would add a row leading
to a refusal — while their own meeting's roster and submit route still resolve through the
record's frozen responsible leader and are unaffected either way.

**`may_restart` rather than the client working it out.** The rule has four parts and two of
them are scope questions, so a client deriving it would be a second authorization rule in a
place Section 7 does not reach — and it would go stale the day the request's rules change.

**What it deliberately does not answer.** A pending request is not consulted: Section 10
allows one pending new-Cell request per prospective leader, so a second restart asked for the
same leader is refused by the request route rather than by a greyed-out button. That is
recorded as open rather than fixed here, because saying so on the row means publishing that a
request exists, which is a disclosure nobody has ruled on.

**The membership of this view is undated, like the running one's.** Decision 0231's question —
whether a collection's state filter dates with its period — is untouched: this adds a second
view rather than dating either.

**It reaches one shape of one route, not the route.** `POST /cells/leadership-requests` is now
reached by a screen for a restart alone; an ordinary new-Cell request and a handover still have
none, and `web/screen-coverage.json` records that the route's screen is the restart dialog.

---

Decision 0266, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-21 — Section 7's closed-Cell clause governs the Cell an operation acts on, not a Cell a request names](0265-the-closed-cell-clause-governs-the-cell-an-operation-acts-on.md)
