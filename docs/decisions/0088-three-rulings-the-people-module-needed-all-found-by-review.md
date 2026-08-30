# 2026-08-22 — Three rulings the `people` module needed, all found by review


**A sex mismatch annotates a duplicate candidate; it does not demote it.** §3's
Tier 1 conditions carry no sex term, and §3 separately calls sex "a frequently
mis-keyed field". The first implementation demoted a Tier 1 candidate to Tier 2 on
a mismatch — which quietly removed the acknowledgement requirement from precisely
the candidates most likely to be one person recorded twice: same name, same
birthday, sex entered wrong. The discrepancy is carried in the candidate's reasons
instead, where the person deciding sees it. A differing suffix follows the same
rule.

**An archived Person may not be the destination leader of a new assignment.** §5
refuses to *reassign* an archived Person and says nothing about them acquiring a
disciple, so the first implementation allowed it. A live pastoral edge under a
Person who is not `CURRENT` corrupts every subtree total walking through them —
the corruption §3 refuses when archiving a Person who leads a Cell. Written to §5
beside the merged-Person prohibition, answering `INVARIANT_VIOLATION`.

**Tier 2 candidates surface through a pre-flight lookup, not through creation.**
§3 says a Tier 2 candidate is "presented in a candidate list" and §22 sketched no
route for one, so they were computed and discarded: creation can only ever refuse
on Tier 1. `GET /api/v1/people/duplicate-candidates` is that list, and §9 already
asks for it as the first step of registering a VIP.

Returning them on the create response was rejected: it puts a duplicate-review
payload on every successful creation, and acts after the record exists rather than
before. Deferring was rejected because §3 says the matcher earns its keep during
the initial encoding effort, which is this stage's own step 11.

**The ruling had a consequence worth closing in the same change.** Match reasons
name the field that matched, so "same birthday" asserts that an out-of-scope
person's birthday equals a value the caller submitted — a disclosure §8 forbids.
Reasons are therefore withheld for a candidate outside the viewer's scope; the
tier still travels, because the encoder needs to know how strong the match is.

*The first version of this entry said the same leak on **creation** was tolerable
"because a probe there creates a record every time, which is loud", and the
second version called that false. Both were wrong, in opposite directions.*

A probe that **hits** throws before the transaction opens and writes nothing. A
probe that **misses** falls through and creates a Person — a Member ID off the
sequence, a Network row, a lifecycle row, an assignment, an audit entry. So
enumerating a birthday through creation writes tens of thousands of records,
which is what "loud" meant and is very nearly right; a single confirmatory probe
against a value already suspected is quiet, which is what the correction was
reaching for. Scoping the refusal identically is the right remedy either way, and
it stands.

Recorded rather than tidied, because this entry has now carried a wrong reason
twice — in the entry written to warn that a wrong reason here is worse than
none.

---

Decision 0088, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-22 — `people.create`, and how a Tier 1 duplicate is refused](0087-people-create-and-how-a-tier-1-duplicate-is-refused.md) | Next: [2026-08-22 — A duplicate candidate outside the viewer's scope carries no tier](0089-a-duplicate-candidate-outside-the-viewers-scope-carries-no.md)
