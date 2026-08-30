# 2026-08-25 — The decisions file is a CSV, and the fingerprint is over trimmed fields in order


The two things §2's *How the tree import runs* describes and does not fix. Both are
reachable the moment somebody writes the import, and neither has a defensible
default, so they are settled here rather than invented at a keyboard.

**A CSV, not JSON, and the reason is §2's own reason for choosing a file.** The
file exists to be sorted, emailed to the leader who actually knows whether those
two records are one person, and returned. That leader opens a CSV in a
spreadsheet. They open JSON in a text editor and edit it wrongly — a lost brace
in a file whose whole purpose is deciding which people exist.

**The fingerprint is a column on every row rather than a header.** Three
alternatives were weighed. A comment line is not CSV and every parser disagrees
about it. A companion file can be separated from the file it describes, which is
the failure mode of a fingerprint. A single first row is a second record shape in
one file. A repeated column survives a spreadsheet round-trip, and requiring every
row to agree catches the case none of the others do: two decisions files spliced
together.

**Only rows with a candidate appear, and blankness means different things by
tier.** A row matching nobody has nothing to decide. Listing all three thousand
to say so produces a file completed without being read, which is the argument §4
already makes for refusing to ask anyone to confirm a tautology — and here the
unread rows are the ones that matter.

A Tier 1 row left blank is refused, because §3 requires acknowledgement before
creation and silence is not acknowledgement. A Tier 2 row left blank means create,
because §3 asks nothing of the person reading a Tier 2 list. That asymmetry is the
tier rules restated rather than a convenience: the two tiers differ precisely in
whether a person must answer.

**`USE_EXISTING` names a Member ID, not a UUID.** The adjudicator reads it off the
dry-run report and may retype it. `M-000000` survives retyping; a UUID does not,
and a mistyped one either matches nothing or — far worse — matches somebody.

**An existing Person who already holds an active pastoral assignment refuses the
commit, naming the row.** §5 permits exactly one, so proceeding means closing the
one they have, which is a reassignment carrying its own authorization and its own
audit entry. The import must not perform one as a side effect: the person who
decided these two records are one person was never asked whether to move anybody,
and a pastoral move nobody requested is the kind of silent change §5 exists to
prevent. Refusing hands it back as an ordinary reassignment, decided by whoever
should decide it.

**The fingerprint is SHA-256 over the seven trimmed fields of each row, JSON-encoded
per row, rows joined by a newline, in file order.**

JSON encoding rather than a delimiter, because §3 requires names to support any
character and there is therefore no delimiter that cannot occur in a field.
Trimmed rather than raw, because surrounding whitespace is exactly what a
spreadsheet adds and removes unbidden — the class of change §2 says this must not
refuse. The header contributes nothing: it is fixed, and a file whose header
differs is refused before a fingerprint is taken.

**Row order is included, and the cost is stated rather than discovered.** Sorting
the input invalidates a decisions file although every decision would still apply
correctly, since decisions key on `row_id` and not on position. An
order-independent digest was considered on exactly that ground and rejected: the
dry-run report the adjudicator was reading names **line numbers**, so in a
re-sorted file those numbers point at other people and the file they answered is
no longer the file in front of them. Refusing forces a fresh report, and the dry
run writes nothing and may be re-run as often as needed.

Written to `SKILL.md` §2 (*The decisions file*, *The fingerprint*) in the same
change — and, this repository having now recorded four false "written to §x"
claims, that was checked by grepping §2 for both subsections rather than by
asserting it here.

---

Decision 0113, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-24 — Birthday is optional on a Person](0112-birthday-is-optional-on-a-person.md) | Next: [2026-08-25 — A root has a seat, and a nullable leader could not say what it meant](0114-a-root-has-a-seat-and-a-nullable-leader-could-not-say-what.md)
