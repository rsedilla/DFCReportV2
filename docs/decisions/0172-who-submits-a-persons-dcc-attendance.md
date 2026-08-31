# 2026-08-31 — Who submits a person's DCC attendance, and where a root's is recorded

Section 9 describes a leader's DCC checklist in prose — "their own direct pastoral
children, **and** the direct children of every downline leader for whom they are the
nearest account-holding upline" — and separately says a Network root's attendance is
recorded by Admin. Building the roster forced both into a form something can compute, and
the second turned out not to follow from the first.

## The submitter is one function, and the roster is its inverse

**A person's *submitter* is the nearest person holding an account, starting at their
direct pastoral leader and walking up.** The direct leader themselves first, then that
leader's leader, and so on.

A leader's roster is every person whose submitter is that leader.

This is Section 9's two clauses as one rule rather than two, and it is worth having as
one because the prose version reads as though it stopped at one level. It does not:
where a leader without an account has a downline leader who also has no account, the
walk passes through both and the deeper leader's children land on the same roster.
Section 9 already implies this — "the nearest account-holding upline" is a property of
the whole chain — but a reader building the first clause plus one level of the second
gets a roster that silently omits people, and nothing would have shown it.

The qualification Section 9 attaches survives unchanged and is the reason the walk stops
at the *first* account: "where a leader with an account sits between them and the leader
without one, the obligation is the nearer leader's, and showing it to both leaves each
assuming the other will submit."

**The whole walk is dated**, at the instant ruling 1 of decision 0171 fixes. Both halves
have to be — the direct leader and every leader above them — or a reassignment high in a
branch would move a historical roster while the record beneath it stayed frozen.

Holding an account means a row in `accounts`; it does not mean the account is usable.
Section 9 is explicit that a pending account can persist and that the covering
arrangement must persist with it. That is deliberate and is the one place this rule is
uncomfortable: a leader whose account was minted but never activated is their own
submitter and can file nothing. Section 6 owns provisioning and the remedy is there,
not in a roster that quietly routes around a state somebody is supposed to fix.

## A Network root is on the roster of a Whole Church holder

Section 9: "A Network root leader has no pastoral leader and therefore no responsible
leader. Admin records their attendance, and roots are excluded from coverage
denominators."

Under the submitter rule a root has no submitter at all — the walk starts at their direct
leader and they have none — so a root appears on nobody's roster and their attendance is
recordable by nobody. Section 9 names Admin as the answer without saying how Admin
reaches them.

**The two Network roots appear on the roster of any actor whose `dcc.take_attendance`
grant is Whole Church**, and their records carry a null `responsible_leader_id`.

Resting it on **scope rather than on the `ADMIN` role** is the part that was decided
rather than derived, and it was decided the other way from how this repository has read
"Admin" elsewhere. `CLAUDE.md` records as open whether "Admin" in Sections 2 and 10 is a
role requirement or a description of who holds the capabilities, and the conservative
reading — check the role — is what is implemented there.

It is refused here for a reason specific to this case. Section 7's role catalog gives
`dcc.take_attendance` at Whole Church to Senior Pastor as well as Admin, and a Senior
Pastor **is** a root. Reading Section 9's "Admin" as a role check would mean neither
Senior Pastor could record their own DCC attendance, or the other's — the two people in
the church whose attendance nobody else can record either. That is not a conservative
outcome; it is a hole. Section 9's sentence is explaining *why* roots are special, and
naming who fills the gap, rather than legislating a role.

So this is not a general answer to the open question, and does not move it. It settles
one place where the role reading produces a state with no legal writer, and says so.

## What is deliberately not settled

Whether an actor may submit for someone outside their own roster is not a new rule and
is not decided here: Section 9 and Section 14 already permit an upline within the
pastoral subtree to record on behalf, under `dcc.submit_on_behalf`. The roster is the
list of people a leader is *obliged* to record; the on-behalf capability is what widens
what they *may* record. Keeping the two apart is why coverage can go on measuring
whether the record exists rather than who entered it.

---

Decision 0172, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-31 — Four rulings the DCC recording path needed, settled before the code](0171-four-rulings-the-dcc-recording-path-needed.md) | Next: [2026-08-31 — Seven settlements from building DCC recording](0173-seven-settlements-from-building-dcc-recording.md)
