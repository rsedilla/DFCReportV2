# 2026-09-20 — Restarting a closed Cell is a new-Cell request that names it

A Cell closes because its members dispersed, or because its leader stepped down and nobody took
it on. Sometimes the same people come back. Section 10 refuses to reverse a closure (decision
0133) and says nothing about what a leader does instead, so the only route was to create an
unrelated Cell and lose the connection to what came before.

On 2026-09-20 the owner asked for **Restart this Cell**, and chose that it goes through
request-and-approve like any other new Cell.

## The ruling

**1. A restart is a `NEW_CELL` request that names the Cell it resumes.** The request carries
`restart_of_cell_id`; everything else about the workflow is unchanged — the upline requests, Admin
approves, and no actor approves a request they submitted.

**2. The new Cell records where it came from.** Approval mints a Cell as it always has and sets
`restarted_from_cell_id` to the Cell named by the request. The closed Cell is not touched: its
state, its closure date, its reason and its history stay exactly as they are (decision 0133).

**3. A closed Cell is restarted at most once.** Two Cells claiming to resume one Cell are two Cells
claiming one history. A restart may itself be restarted, so the chain runs backwards and never
branches.

**4. A Cell closed `CREATED_IN_ERROR` may not be restarted.** That reason states the Cell should
never have existed, and resuming it would carry that assertion forward.

**5. The former leader may not restart their own Cell.** This needs no new rule: Section 10 already
says no holder of `cell.request_leadership`, at any scope, may name themselves, and gives the
reason in exactly this case — a leader whose Cell closed could otherwise restore their own Current
Cell Leader status, re-enter New Cell Leaders for the period, and restore their upline's 12+ count,
with no upline involved.

**6. A restart names the Cell's last leader.** What the link asserts is that this Cell resumes
under the person who led it; somebody else taking those people on is an ordinary new Cell, which is
what they would request. This is a rule about what the record means rather than about what any
total counts — the link is inert to every figure, and a first version of this item claimed Section
16's *New Cell Leaders* and Section 27's *Open a cell* read it, which neither does. The category,
the day and the time are the request's own, filled in from the closed Cell and changeable: people
come back to a Cell, not to a timetable.

**7. Members are not carried by the request.** The former members are re-added to the new Cell
afterwards, through the membership route that already exists, and the screen pre-ticks the people
who were members when the Cell closed.

## Why

**Request-and-approve rather than one step**, which is the owner's choice and is also the reading
that costs no amendment to Section 10's "only path" sentence. The readiness question is live here
rather than spent: a Cell closed under `LEADER_STEPPED_DOWN` closed *because* that leader stopped
leading, and restarting it under the same person is exactly the judgement Section 10 says no leader
should make alone about their own disciple.

**The member list is not on the request, and that is the part worth arguing.** A request waits for
an approver, and people move in the meantime: a list frozen at request time would re-add somebody
who has since joined another Cell, or miss somebody who left theirs. Re-adding through
`POST /cells/{id}/members` also keeps every refusal Section 10 owes a membership — same Network,
not archived, not merged, not already in the Cell — and audits each addition where the audit for a
membership belongs. What the screen offers is the convenience; the rules stay where they are.

**A restart is not a reopening, and the wording matters on screen.** The new Cell has its own
identifier, its own schedule history and its own attendance. A month that spans the closure and the
restart reports two Cells, which is what actually happened.

---

Decision 0264, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-20 — `GET /auth/me` names the roles it honours, and a client never derives one](0263-auth-me-names-the-roles-it-honours.md)
