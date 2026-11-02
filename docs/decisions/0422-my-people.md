# 2026-11-02 — My People: a leader's people two levels down, as a plain list

A leader without Full view had no way to see who is under them except by searching for each
name, and a Primary saw them only through Family Tree, one level at a time. The owner asked that
leaders know how many people they have and who they are, in a plain table with no links, read in
as few requests as possible. They chose this from side-by-side screenshots on laptop and phone,
named the column *Leader*, and chose two levels.

## The ruling

**1. A leader's people are listed two levels down**: the people they disciple directly, and the
people those disciple, as the pastoral tree stands now (Section 5). Above the list, how many in
all, and how many directly and how many beneath them. Each row gives the person's name, their
*Leader* (who disciples them, *You* for the reader's own) and the Cell Group they belong to or
lead, or *No Cell yet*. Nothing in it is a link or an action. It lists people in first-name
order (decision 0359). The two levels match how far *Leaders Under Me* reaches for a Full view
leader (decision 0324).

**2. A leader without Full view reads it on a second tab of People, *My People***, after *Add
People*. **A Full view leader reads it inside Family Tree**, behind a *Tree* / *List* switch,
rather than on a fifth tab. A reader holding no pastoral assignment, such as the Admin, is
offered the tree alone, the list having nobody under them to show.

**3. It is one read**, `GET /api/v1/cells/people/mine`, with its counts at
`GET /api/v1/cells/people/mine/counts`, under `people.view_subtree` against the reader. A
person's Cell is given only where the reader also holds `cell.view_subtree` over them, as
`GET /api/v1/cells/people/membership` does (decision 0308). The route belongs to `cells`, which
already composes people with their Cells there.

**4. It is not kept on the phone.** Keeping a copy for slow or no signal was considered and left
for later: it would hold names, minors' among them, on a device that may be shared, and the
server's load does not need it.

Decision 0422, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 19 and 22.

Previous: [2026-11-02 — Account is as wide as a list, and lists no permissions](0421-account-full-width.md)
