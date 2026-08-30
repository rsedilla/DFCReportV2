# 2026-08-22 — Seven Stage 2 rulings, settled before any Stage 2 code


Stage 2 opened with four Stop Conditions and three confirmations outstanding.
All seven are settled here, and each is amended into `SKILL.md` in the same
change. Three of them close items this log has been carrying as open since
2026-08-20; two close items opened by the Stage 1 verification.

**Refresh and activation tokens may be pruned, thirty days past expiry.** This
is the one exception to §5's no-deletion rule, and the floor is set by the
reuse signal rather than by the token's validity.

The catch was not previously written down anywhere. A rotated row is revoked
and carries a `replaced_by_id`, and §6 makes that pair the whole difference
between a stolen token and one the system never issued. Prune it and a
presented copy resolves to nothing, so it is refused as unknown and no
account-wide revocation fires — the theft is not merely undetected, it is
indistinguishable from a typo. So any retention rule has to outlive what can
still be presented, and thirty days beyond a thirty-day token is that.

Two costs are accepted in writing rather than discovered: a long-expired
stolen token stops raising the alarm, which today it does because the reuse
check runs before the expiry check; and rows must be deleted oldest first,
because `replaced_by_id` references `refresh_tokens` with no cascade and a
row is still referenced by the one it replaced. Nothing requires a retention
job to exist — the ruling permits one and bounds what it may touch. Written
to `SKILL.md` §6 and §5.

**`CHECK (ended_at > started_at)` is relaxed to `>=`.** §5 prescribes closing
a row entered in error and opening the right one, and the strict form made
that impossible to perform honestly: the only close it permitted recorded a
non-zero period during which a fact that was never true was in force.

Two safety properties were verified against the SQL before the ruling, and
both hold. A zero-length row is invisible to an as-of lookup, because
`network_as_of` asks for `started_at <= t AND ended_at > t` and no `t`
satisfies both. It occupies no one-open-row index, because every one of those
is partial over `ended_at IS NULL` — checked against every effective-dated
table, not only `network_assignments`.

**A third claim was asserted and was false, and is corrected here.** The
ruling as first written said the same-Network check on a Network change
"neither validates a zero-length row nor is broken by one", on the reasoning
that such a row is neither open at the effective date nor beginning after it.
It can be the second. A zero-length row whose shared timestamp falls after the
effective date satisfies `ended_at > v_row.started_at`, so it is selected and
compared at its own timestamp — and being closed, it cannot then be reassigned
to resolve what it reports.

Found by `architecture-guardian` on this branch, which is the point of running
it: the two properties that were checked held, and the one that was reasoned
about did not. `SKILL.md` §5 now says a zero-length row is inert as an
*answer* and is not thereby excluded from being *examined*, and §4's backdate
floor counts its timestamp like any other.

The cost is that an inert row is also an invisible one, so a defect closing a
live row at its own start date removes it from every query silently. That is
domain-layer discipline, not a schema property, and is written as such.

Landed by editing `0001_foundations.sql` in place, under the exception of the
2026-08-21 ruling, alongside migration 0002 — not as a corrective migration
afterwards. Nothing is deployed, so there is no history for a checksum to
disagree with, and beginning Stage 2 on a first migration known to make a
prescribed correction impossible is the alternative. Written to `SKILL.md` §5.

**A backdated Network correction reaches only to the person's most recent
pastoral event, in either direction of the tree.** *(**Amended** later the same
day by "A Network change is refused while the person leads anyone" below. Two
changes: the floor lost its leader-side `started_at` term, because open downline
edges can no longer exist at correction time and closed ones are dominated by
the `ended_at` term; and the bound became **strictly later than** the floor
rather than at-or-after, since both remaining terms fail at exact equality. The
two-term, exclusive form in `SKILL.md` §4 is the current rule. The reasoning
below stands, and the arithmetic does not.)* That is the latest of: the
start of their current assignment, the start of every assignment on which they
are the leader, and the end of every already-closed assignment touching them
either way. Further back there is no legal write that resolves it: the
reassignment §4 demands cannot be made for a period that has already ended,
and rewriting a closed row is forbidden by Principle 12 and §5. Permitting the
attempt would mean permitting a failure with no remedy.

**The first version of this ruling bounded only the person's own assignment,
and that was wrong.** The same-Network trigger selects edges where the person
is the `person_id` *or* the `leader_id`, so a floor covering one side leaves
the other unbounded — and two downline cases have no remedy at all: an edge on
which they are the leader that closed after the effective date, and an open
one that began after it, which can be closed neither at the effective date
(that precedes its own start) nor at its own start (it is then still selected).
A correction backdated inside a leader's own assignment could therefore still
fail with nothing the administrator could do, which is the exact failure this
ruling exists to prevent.

Found by `architecture-guardian`, and worth recording as a pattern rather than
a one-off: the rule was written by reasoning about the trigger's *purpose* and
not by reading its `WHERE` clause. Both defects corrected on this branch came
from that same shortcut.

The system rejects with the earliest date the correction can legally take,
answering `INVARIANT_VIOLATION` — it is a rule about what can be recorded,
not about the actor's authority over a target, which is the distinction §22
draws between that code and `SCOPE_DENIED`.

Two alternatives were rejected. Permitting it and flagging the stranded edge
would make §4's same-Network guarantee no longer absolute, which is a larger
change than the problem warrants and would have to be said in §4 rather than
here. Escalating each case as a Stop Condition is honest and leaves the Stage
2 endpoint with no behaviour to implement.

The accepted cost is that closed periods keep the Network recorded for them,
including where it is now known to be wrong. §3's reproducibility guarantee
already argues for that: those months have been reported, and a leader may be
holding one on paper. Where the true history matters it belongs in the audit
entry the correction already writes, not in a rewritten relationship row.
Written to `SKILL.md` §4.

**A Network change and the reassignment it forces share one exact effective
instant.** The schema already required it and nothing said so. The old edge
escapes validation only at exact equality, because the check considers edges
open at the effective date or beginning after it; closed a microsecond later
it is open at the date, is compared with the corrected Network in force on
one end and the old one on the other, and is rejected — correctly, because
for that microsecond it was genuinely a cross-Network edge.

So this writes down what the schema enforces rather than changing anything.
It is worth a ruling because the failure of leaving it implicit is specific:
an implementer meets a constraint violation, reads it as two timestamps being
too close together, and separates them — which does not fix the write, and
which would open the gap if the check were ever loosened to admit it.
Enforcing the equality with a second constraint was considered and rejected:
it spans two tables on one logical operation and would need its own deferred
constraint trigger, which is more machinery than the rule earns. Written to
`SKILL.md` §4.

**A form field failing validation carries `field-invalid`.** One token, and
the only one of its kind, closing the question §23 explicitly left open and
which an earlier version of the contrast check had quietly decided by
refusing `error` and `critical`.

The name is the ruling. `field-invalid` describes the state of an input, and
`field-` is a prefix that does not travel — a Cell is not a field, and a
leader is not a field. `error` and `danger` were refused on §23's own
argument, that a token is used by whoever writes the next screen on whatever
it seems to fit, and a token called `error` eventually colours a Cell that
reported `NOT_HELD`. It carries 1.4.11's 3:1 against its surface, since the
invalid state of a control is exactly the component state that criterion
names, and it is never the sole indicator, which 1.4.1 requires and which
matters for a leader reading a phone in a hall. Written to `SKILL.md` §23.

**The client libraries are confirmed.** TanStack Query, TanStack Table,
`lucide-react` and `next/font`, installed with the first real screen rather
than now. A chart library is deferred to Stage 5, where the first chart is.
This stays in this log and out of `SKILL.md`: §2 carries the rule — headless
primitives, no framework with its own design system — and a vendor meeting
that rule is not a rule.

**`settings` is in Stage 2 scope.** §2 puts the initial-encoding phase flag
under `settings.manage`, and Stage 2 runs the import inside that phase.
Without the table the relaxation has no terminating condition, which is the
exact failure the 2026-08-20 ruling on closing the phase was written to
prevent. It lands in migration 0002 beside `audit_log` and `idempotency_keys`.
`docs/ROADMAP.md` named only those two and is corrected in the same change.

---

Decision 0080, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-22 — A sign-in landing inside a revocation's transaction survives it](0079-a-sign-in-landing-inside-a-revocations-transaction-survives.md) | Next: [2026-08-22 — Four enforcement gaps found reviewing the Stage 2 rulings](0081-four-enforcement-gaps-found-reviewing-the-stage-2-rulings.md)
