# 2026-09-13 — The People screen lists the searcher's own scope, and the pickers keep the church

Section 8 says leaders may search the church-wide Person directory by name. The People
screen implements that literally: one search field, and every match in the church comes
back — in full for somebody the searcher pastors, and as five fields for everybody else.

The owner asked for the opposite default. A leader opening People should see the people
under their care, so that a leader in one Network is not presented with the other
Network's members as a matter of course.

## The ruling

**The People screen lists only people within the searching leader's pastoral scope.**

**The church-wide directory is unchanged and stays reachable where a task names a
specific person** — adding a Person, adding a member to a Cell, and choosing whose
network to view. Those are person *pickers* inside an operation, not a place to look
around.

**The five fields are untouched.** Nothing becomes visible that was not, and nothing
becomes invisible that a rule required. What moves is which surface presents them
without being asked.

For an actor whose scope is the whole church — a Senior Pastor (Section 4), an
administrator (Section 7) — "their pastoral scope" is the church, so the screen is
unchanged for them. This needs no carve-out and is not given one.

## The ground

**The purpose Section 8 names for church-wide search does not run through this screen.**
That sentence says "primarily for identity resolution and duplicate prevention (see
Section 3)". Duplicate prevention is not performed here and never was:
`GET /api/v1/people/duplicate-candidates` answers it, the Add a Person screen calls it as
the name is typed, and it reaches the whole church whatever this screen shows. So the
narrowing does not weaken the thing Section 8 gives as its primary reason for existing.

*That is the opposite of this session's first assessment, which held that narrowing the
search would let two leaders in different branches each create the same Person. It was
wrong, and reading the Add a Person screen is what corrected it. The ruling is recorded
with the refutation rather than the original claim, because a reader who reconstructs the
duplicate argument from Section 8 alone will reach the wrong conclusion the same way.*

**Browsing and naming are different acts, and only one of them is a disclosure.** A
screen whose whole content is a search field invites looking around: type three letters,
see who is in the other Network. A picker inside Add a Cell member is reached only by
somebody already performing an operation on a person they have in mind. Section 8's own
field list draws its line at what may be *known*; this draws a second line at what is
*offered*, which is a weaker rule and a different one.

**The pickers cannot be narrowed with the screen, and this is the load-bearing part.**
Section 10 makes Cell membership independent of pastoral assignment, so a Cell
legitimately holds members its leader does not pastor. Narrowing the underlying search
rather than this screen would make those people unaddable — the feature would fail
precisely for the case it exists to serve. `web/components/person-picker.tsx` is shared
by all three pickers, so the change belongs in the People screen and not in the search
it calls.

## What this does not do

**It changes no field, no route's authorization, and no table.** The API's per-person
decision between a full profile and a minimal identity is untouched, and so are
`duplicate-candidates`, the pastoral-path endpoint, and every capability in Section 7.
There is no migration.

**It does not make the church-wide directory unreachable.** A leader who needs to find
somebody outside their care can still do so through any of the three pickers. What they
lose is a general-purpose place to browse for them, which is the point.

**It states no rule about auditing the wider lookups.** Whether reaching outside one's
own scope should be written to the audit log was raised and deliberately not settled
here; the audit column is plain `text`, so adding such an action later needs no
migration, only a line in Section 21's vocabulary.

**It says nothing about Section 19's sidebar.** People is where Section 19's `Search`
item lives, and that folding predates this ruling and is untouched by it.

---

Decision 0244, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-11 — The development outbox writes an activation token and withholds a reset one](0243-the-development-outbox-withholds-a-reset-token.md)
