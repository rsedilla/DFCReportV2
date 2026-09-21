# 2026-09-19 — The People screen opens on the searcher's scope, and a Member ID finds a person in it

Decision 0244 made the People screen list only people within the searcher's pastoral scope, and
left it a search: nothing appeared until a name was typed. On 2026-09-19 the owner compared their
Claude Design handoff with the built screen and chose its list, adjusted to the rules: it opens on
everyone the searcher oversees, ten a page, and each row names the person's pastoral leader and
Cell.

## The ruling

**1. `GET /api/v1/people` with no term lists the actor's own scope**, A to Z by surname, paged by
cursor with no total (Section 22). For an actor whose scope is the whole church that is the church,
which Section 8 already says of the screen.

**2. Church-wide mode never lists without a term.** With `church_wide=true` a term is
required, and a term is at least two characters once normalized, in either mode. That minimum
stood in code alone until now.

**3. In the actor's own scope a term also matches a Member ID by prefix.** Never church-wide: a
prefix such as `M-00` there would page the directory the minimum exists to protect.

**4. A search row the actor may read in full carries `direct_leader_name`**, the field a row
outside their scope already carries (Section 8).

**5. A person's own Cell read (`GET /api/v1/cells/people/{id}/membership`) carries each Cell's
category and meeting day as the Cell stands today**, so the list can say "Young Pro · Sat". It is
read under the same `cell.view_subtree` grant on the person as the Cell ID it names.

## Why

**Section 8 already calls the screen a list.** What 0244 left as a search was the route's shape,
not a rule about the screen, and a leader looking after twelve people should not have to know a
name to see them.

**The design's two other columns are not taken.** Each person's journey stage, drawn in red, and
"Last recorded", each person's latest attendance, would each need a ruling of its own: stage is
read one person at a time (decision 0247), and no surface yet lists named attendance across people.

**Whether the list shows archived people is left open**, and `CLAUDE.md` records it.

---

Decision 0259, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-19 — The recording queue has a branch view beside the leader's own](0258-the-recording-queue-has-a-branch-view.md)
