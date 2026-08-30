# 2026-08-24 — Birthday is optional on a Person


Found by building the tree import: §2 has Admin import "names, sex, and each
person's direct leader", §3 required a birthday and a civil status, and
`persons.birth_date` is `NOT NULL` — so the import as specified could not create a
single Person. The tree turned out to hold birthdays, which unblocked the import;
the question it exposed was the ordinary one, at consolidation.

**Birthday becomes optional.** The argument is §3's own, made two sections earlier
about email: "a mandatory field that people cannot fill is filled with fictions,
which corrupts both the data and duplicate matching."

**For a birthday the corruption is worse than the general case**, which is what
makes this more than consistency. Two of the three Tier 1 rules read the birthday,
and Tier 1 *blocks* creation. So two unrelated people carrying the same invented date match each
other at Tier 1, and the system refuses to record one of them on the strength of a
value nobody meant. Requiring the field does not protect the matcher; it poisons it,
and then acts on the poison.

*My first recommendation was the opposite — that making it optional "guts the
matcher" — and it was wrong because it reasoned about wholesale absence rather than
about the population that actually lacks one.* Absence drops a candidate to Tier 2,
which is honest: less is known, so less is claimed. Fabrication produces false
confidence. The owner's question about consolidation is what surfaced the
distinction.

*The first version of this entry said "both Tier 1 rules", in §3 twice, in the Decisions entry,
in migration 0007, in a test comment, in that test's title, and in the commit
message — **seven**, of which six could be corrected and the commit message could
not. *Two earlier versions of this sentence were wrong in two different ways, and a
third version collapsed them into one.* The first enumerated five places and gave no
total at all, omitting the Decisions entry and the test's own title — an incomplete
list. The second enumerated seven and called them six — bad arithmetic over a
complete list. Saying they "said five and then six" describes neither: the first
said no number. Two failures, not one repeated, and treating them as one repeated is
§25 rule 19 applied to the paragraph's own history, exactly as the 2026-08-24 entry
had to correct "three successive versions" to one.

*One miscount is now itself immutable.* `65a9835`'s commit message carries "it was
six places and not five, of which five could be corrected", which is wrong on both
counts and cannot be edited. This paragraph accounted for the immutable false claim
in `6a6d5a8` and not for that one; it does now.* §3 makes a matching mobile number
with equal first and last names a Tier 1 as well, and states the generalisation three
subsections along: "Every Tier 1 rule reads a birthday or a mobile number." The
argument survives — a fabricated date still produces a false Tier 1 that blocks a
real person — but "no birthday means no Tier 1" is false, and the case is pastoral
rather than theoretical: names compare with `Jr` and `Sr` stripped and households
share numbers, so a father and son with no birthdays on one number are a Tier 1
refusal today.*

*Two live defects came with the ruling and are recorded here rather than only in the
fix. The null guard in `duplicate-matching.ts` became load-bearing the moment a
candidate could carry null, and nothing held it — removing it passed all 436 tests
while refusing two birthday-less people at Tier 1 on a claim their birthdays matched.
And `@IsOptional()` skips null as well as undefined, so `PATCH {"birth_date": null}`
erased a recorded date, answering 200; before the column was nullable the database
refused it. Relaxing a constraint turned into a capability nobody decided on, which
is worth remembering as a class rather than an incident.*

**An explicit null on `birth_date` is refused, and that is a rule rather than a
patch.** `@ValidateIf` replaces `@IsOptional()` so the edit answers
`VALIDATION_FAILED`. §3 defines adding a birthday and does not define removing one,
and a relaxation must not become a capability by omission — so the conservative
reading is taken and the question is left open rather than answered by a side
effect. It refuses any explicit null, whether or not one is recorded, because the
check reads the request and not the stored row; omitting the field is unaffected.

**Two situations produce a Person with no birthday**, and the second decided it. A
leader may not have asked. Or somebody may **decline** — a first conversation is not
the moment to press for personal information, and a church that insists serves least
the people most guarded about their details. That is a privacy position, not a data
gap, and no later gate may coerce it: a milestone that refuses attendance or Cell
membership until a birthday appears would press hardest on exactly the person who
withheld it.

**The matcher needed no change.** `Subject.birthDate` and `Candidate.birthDate` were
already `string | null`, and §3 already carried a Tier 2 rule naming an absent
birthday. The edit endpoint needed none either: `PATCH /api/v1/people/{id}` under
`people.edit_basic` already accepts `birth_date`, so "the leader adds it later" was
built before the rule required it.

**The import still requires it** (§2), because it loads from a central record that
holds them — a gap there is an omission rather than a person's decision.

**Reversibility has a deadline, and the migration says so.** Re-adding `NOT NULL`
works only while no row lacks a birthday, which is true today and false after the
first person is recorded without one.

Three things are deliberately **not** settled here, and are listed as open below: a
"details to collect" attention list so an optional field is not an invisible one,
whether "asked, not given" is a state on the Person distinguishing a decision from a
gap, and whether a recorded birthday may ever be removed. The first two wait for the first real screens, since an attention list with
no dashboard to live on is a list nobody sees; the third is a specification question
with no dashboard dependency at all.

Written to `SKILL.md` §3 in the same change.

---

Decision 0112, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-24 — How the leadership tree import runs](0111-how-the-leadership-tree-import-runs.md) | Next: [2026-08-25 — The decisions file is a CSV, and the fingerprint is over trimmed fields in order](0113-the-decisions-file-is-a-csv-and-the-fingerprint-is-over.md)
