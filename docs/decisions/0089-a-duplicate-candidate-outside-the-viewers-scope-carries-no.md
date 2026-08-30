# 2026-08-22 — A duplicate candidate outside the viewer's scope carries no tier


§3 as first amended let the duplicate lookup return a candidate's tier
church-wide, and §8 forbids disclosing an out-of-scope person's birthday or
mobile number. Both could not stand, and the contradiction was introduced by the
amendment rather than found in the specification.

**The tier is withheld out of scope, along with the reasons.** What travels is
that the person is a possible match — which is what §3 needs the encoder to know:
somebody may already be recorded, so stop and ask the leader who holds them.

The tier had to go because it *is* the disclosure. It is derived from which rule
fired, so with an equal first and last name Tier 1 means the submitted birthday
matched and Tier 2 means it did not. Returning it church-wide is a yes/no
birthday oracle over a name §8 already makes visible — enumerable over a few
thousand values, answered 200 every time, writing nothing. Withholding the
reasons while keeping the tier hid the wording and kept the information, which is
the shape of the two corrections above it in this log.

Two alternatives were rejected. Amending §8 to permit the tier, with a rate limit
and an audit entry per lookup, is honest but widens the section that exists to
stop exactly this, for a convenience the encoder does not need — knowing someone
is a possible match is enough to make them ask. Scoping the rows to the viewer's
subtree closes it completely and defeats the endpoint: a cross-branch duplicate
is the one §3 says the matcher exists to catch, and §8 makes the directory
church-wide for that reason.

Written to `SKILL.md` §3, which now states the redaction rather than sanctioning
the leak, and applies it to the Tier 1 refusal as well.

---

Decision 0089, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-22 — Three rulings the `people` module needed, all found by review](0088-three-rulings-the-people-module-needed-all-found-by-review.md) | Next: [2026-08-22 — Membership of a candidate list is itself a disclosure](0090-membership-of-a-candidate-list-is-itself-a-disclosure.md)
