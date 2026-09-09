# 2026-09-09 — A `NETWORK`-scoped DCC coverage figure narrows by membership at the event date

Section 20 settles what a Network narrows for one key and enumerates two:

> "This narrows *which people* the **person key** runs over. It adds no fourth attribution
> key: a Network-scoped figure is still attributed by the person, and a Cell-scoped one
> still by the meeting's responsible leader."

Coverage is the third key, and it is not in that sentence. Section 9 says nothing about a
Network-scoped coverage figure either — its only statement about a coverage denominator and
a Network is that the two roots are excluded from one.

That omission decided nothing until now. The DCC monthly report has offered `NETWORK` since
decision 0219 and carried no coverage figure; adding one is what makes the question
reachable.

**A `NETWORK`-scoped DCC coverage denominator is the leaders holding a pastoral edge at the
event date whose `network_assignments` row names that Network at that same instant, and the
numerator is those of them carrying a record.** The narrowing is applied per event, at the
event's own instant.

## Why this rather than the period's end

**Section 20 already fixes coverage's instant, and says so for both domains.** It states
that a monthly report resolves the tree at more than one instant — "the period's end for the
person key, the same for the responsible-leader key, and each event or meeting date for
coverage" — and decision 0221 declined to disturb it: "Section 20 states coverage's instant
already — each event or meeting date — and this ruling deliberately leaves that alone."
Section 20 records that refusal in its own words, saying coverage "places its own party at
its own instant" and naming both domains. *The second phrase is Section 20's rather than
decision 0221's, which is checked here because a first draft of this ruling quoted it as the
ruling's.* A Network narrowing resolved at the period's end would be the one
part of a coverage figure not resolved at the event date, which is a second instant inside
one figure with nothing asking for it.

**The alternative measures a Sunday's obligation against a row that postdates it.** Section 4
effective-dates Network membership precisely so that "every Network-scoped report for a
closed period depends on that answer". A leader who owed a record on the first Sunday owed it
as a leader of the Network they were in *then*; resolving at the period's end attributes that
obligation to whichever Network they finished the month in, which is the backdating Section 3
forbids a period-based figure to be subject to.

**It follows the obligation, which is what Section 20 says coverage attributes by.** An
obligation exists at an instant — the event — and everything else about it is resolved there:
who was a responsible leader, and which subtree they sat in. Which Network they sat in is the
same question about the same instant.

## What was rejected

**Membership at the period's end**, which decision 0218 makes the period's final millisecond.
It has one real argument: it gives a leader one Network for the whole month, so a month's
figure cannot split a leader across two Networks. It is rejected because that tidiness is
bought by attributing an obligation to a Network that did not hold the leader when the
obligation arose, and because it would make this the only term of a coverage figure resolved
away from the event.

**Deferring the figure at `NETWORK` scope**, shipping coverage for `LEADER` and
`WHOLE_CHURCH` alone. It is the conservative arm and was seriously considered: the identical
question for a Cell figure is open, and the Cell report refuses `NETWORK` for that reason.
It is rejected because the two cases are not alike. What a `NETWORK`-scoped *Cell* figure
narrows is genuinely undecidable from Section 20 — the Cell domain does not use the person
key, so there is no stated narrowing to carry over, and two readings (the responsible
leader's Network, or the attendees') pick out different populations. Here the party is a
person, Section 4 gives that person a dated Network row, and coverage's instant is already
fixed; there is one reading rather than two.

## How narrow the divergence is

The two answers differ only for a leader whose Network changed between an event and the end
of the month, and decision 0082 refuses a Network change while a person holds any open
assignment as leader. So it takes a leader who held disciples on a Sunday, lost every one of
them, and changed Network before the month ended. It is reachable and it is rare, which is
stated because a rule settled on a case nobody meets is still a rule the code has to pick.

## What this does not settle

**Nothing about a `NETWORK`-scoped Cell figure**, which stays open and is why
`GET /api/v1/reports/cells/monthly` still refuses that scope. The argument above turns on the
coverage party being a person with a dated Network row, and does not reach a domain whose
narrowing is undecided for a different reason.

**It claims no Men's + Women's identity for coverage.** Section 20 claims one for the
unique-people total and records that it rests on every person holding exactly one Network row
at the instant, which nothing enforces. A coverage figure partitioned this way would inherit
that same unenforced property rather than a new one, and both of the open questions about
overlapping and absent `network_assignments` rows reach it identically. Section 20's
reconciliation requirement is over classification and monthly-attendance buckets, and coverage
has never been part of it.

**Whether an archived or merged disciple is a coverage obligation**, which is a Stop Condition
recorded in `CLAUDE.md` and is untouched. It decides which edges exist at the event date; this
ruling decides how the resulting leaders are partitioned by Network, and the two compose
without either deciding the other.

---

Decision 0230, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-09 — A DCC event that has not happened owes nobody a record](0229-a-dcc-event-that-has-not-happened-owes-nobody-a-record.md)
