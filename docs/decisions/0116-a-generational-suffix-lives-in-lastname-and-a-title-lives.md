# 2026-08-25 — A generational suffix lives in `last_name`, and a title lives nowhere


Found preparing the spine file, where two of the thirty rows carried `II` and `III`
and four carried `Bishop` or `Pastor` inside `first_name`.

**Suffixes were not forgotten; where they are *stored* was never said.** §3's
matching rules already name `Jr`, `Sr`, `II`, `III` and say to ignore them when
comparing and compare them separately as a weak signal, and `duplicate-matching.ts`
implements exactly that — `normalizeName` strips them, `suffixOf` reads them back.
What no section stated is which field they go in, and the silence has a live failure
mode rather than being merely untidy.

`suffixOf` reads `first_name` and `last_name` and nothing else, and `middle_name` is
never compared at all. So a suffix written into `middle_name` is **invisible**: not
stripped, which is harmless, and never surfaced as a distinguishing signal, which is
not — a father and son recorded that way lose the one signal §3 provides for telling
them apart, silently. That is reachable today, because encoders are about to type
names into a form and nothing tells them where `Jr` goes.

**`last_name`, and no column.** A `suffix` column was rejected: the matcher already
reaches the right answer from the name fields, and §3's rule is *written* on that
assumption — "ignore the suffixes when comparing" presupposes they are inside the
compared string — so a column would mean amending the rule, the `persons` shape and
the matcher in order to arrive at behaviour that is already correct. The list is also
deliberately closed, and `duplicate-matching.ts` records that `IV` was in the set and
was removed because "a closed list in the specification is not a starting point to
extend". A column invites exactly that extension; a suffix inside a name is just part
of the name, and only the four get special treatment.

`last_name` rather than `first_name` is a choice between two that both work, since
both fields are stripped and both are read. The surname is what a generational suffix
qualifies, sorting by last name keeps a father and son adjacent, and one stated place
beats two working ones.

**A title is a different question and is left open.** `Bishop`, `Pastor` and `Pastora`
are not suffixes and §3 now says plainly that a name field is not where they go —
because anything put there is compared as though it were part of the name, which is
how `Bishop Oriel` fails to match `Oriel` and a second record for the same person goes
unnoticed. Where a title *does* live is listed below rather than decided here: a
stored title is not effective-dated and so cannot answer what somebody was called in a
past period, which is the mistake the 2026-08-20 structures ruling names, and two of
them are derivable from `SENIOR_PASTOR_PERSON_IDS` in any case. It is a display
question, and there are no screens yet to decide it against.

Written to `SKILL.md` §3 (*Name handling*), and verified by grep rather than asserted.

---

Decision 0116 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-25 — The tree is known centrally only to its first level, and no birthday is required](0115-the-tree-is-known-centrally-only-to-its-first-level-and-no.md) | Next: [2026-08-25 — The first Admin account is a one-time command, and an administrator need not be in the tree](0117-the-first-admin-account-is-a-one-time-command-and-an.md)
