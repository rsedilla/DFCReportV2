# 2026-08-22 — Membership of a candidate list is itself a disclosure


Three attempts at one redaction, and the first two failed the same way: each
removed a field from the returned object while the answer stayed in the response
by construction.

First the reasons were withheld out of scope, because they name the field that
matched. Then the tier, because a tier is derived from which rule fired and so
carries the same fact one step removed. Neither touched **which candidates were
returned** — and with a first name matching nobody, the only rule that can fire
is the one comparing birthdays, so presence in the list *is* the predicate "this
person's birthday equals the value I submitted". One bit per request, 200 either
way, nothing written. Substituting a mobile number confirms a suspected number in
a single request.

**An out-of-scope candidate is surfaced only where the rule that matched rests on
what §8 already publishes** — the names and sex. Membership is then a function of
nothing §8 protects, which is the property the first two attempts were reaching
for and neither expressed.

**The test is whether a publishable rule *would* have matched, not which rule
actually won**, and getting that backwards cost a CI round. The matcher runs
twice: once on the subject as given, and once on a subject stripped of everything
§8 protects. The second run decides membership out of scope.

Keying it on the winning rule instead — a flag the rule sets when it reads a
protected field — hid anyone matching on *both* their names and their birthday,
because the stronger rule wins and the stronger rule reads the birthday. Their
presence was already explained by the names, so hiding them protected nothing and
lost a real candidate. The failing test said so before the reasoning did.

Both runs happen inside one service method used by every surface, so a third one
cannot be added that runs the matcher once and leaks.

**Two consequences, both accepted in writing.**

Only a candidate the viewer can be shown in full may gate creation. Refusing on
an invisible one would answer "acknowledge this" with nothing to acknowledge —
and, less obviously, **the refusal is itself a channel**: every Tier 1 rule reads
a protected field, so gating on an out-of-scope candidate would make the response
vary, refused against created, with a value §8 protects. That is the same
disclosure one field further out, and it is why the gate is in-scope-only rather
than merely why the message would be unhelpful.

And a cross-branch duplicate resting on a birthday is no longer caught for a
leader outside that branch; it is still caught by the leader who holds them, and
by Admin, which is where §3 authorizes a merge from anyway.

Two alternatives were rejected. Amending §8 to permit the channel, with a rate
limit and an audit entry per lookup, trades prevention for detection on the
section that exists to prevent exactly this. Scoping the rows to the viewer's
subtree closes it and defeats the endpoint, since a cross-branch duplicate is
what §3 says the matcher is for.

*Recorded at length because the failure repeated.* Both earlier attempts were
reasoned about in terms of what the response contained rather than what the
response was a function of, and both were written into `SKILL.md` as settled
before they were. That is the same fault as the backdate floor, the zero-length
row and the Nest status ordering — a mechanism described from the part of it that
was being looked at.

---

Decision 0090, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-22 — A duplicate candidate outside the viewer's scope carries no tier](0089-a-duplicate-candidate-outside-the-viewers-scope-carries-no.md) | Next: [2026-08-23 — Six rulings the sex-correction route needed, settled before the code](0091-six-rulings-the-sex-correction-route-needed-settled-before.md)
