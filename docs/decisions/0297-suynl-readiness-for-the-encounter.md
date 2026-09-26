# 2026-09-26 — Reports counts who is getting ready for the Encounter

The SUYNL tab under Reports showed the Growth tab's three counts and the next Encounter season
(decision 0296). The owner wanted it to show who is getting ready for that season's LC Party,
leader by leader, saw it running on sample data, and settled two questions one at a time.

## The ruling

**1. Who is counted.** A current person with at least one current SUYNL lesson and no current
Encounter or Life Class graduation, as things stand now. Somebody at the Encounter or through
Life Class is past the LC Party whatever their lessons, so they are left out of every column,
not only the first.

**2. The columns.** Completed (ten of ten), 7–9 lessons, 1–6 lessons, and People, which is the
three added up.

**3. The rows.** The reader's direct disciples, or those of a leader they opened, each counting
their branch now, themselves included; then the reader, or the opened leader, alone; then the
total. A whole-church reader's rows are the two roots' branches, named by the pastor with
their Network beside, as decision 0294 names them, then a line for anybody counted in neither.
The rows, that line and the total add up. Rows are in surname order, or a whole-church reader's
in Network order, and never by a figure (section 13). A name shows the people behind its row,
and "their 12" opens that leader's table.

**4. Read under `suynl.view_subtree`, as of now** (decision 0278), on
`GET /api/v1/suynl/readiness`, and `/readiness/{id}` for an opened leader, whose target is that
person. Who is left out is read from `training` through its service (section 2), and is a
derived fact read under the capability guarding the route that returns it (section 7).

**5. The Encounter box shows the next season only** (decision 0296), as four steps: from ten
weeks before the weekend, the LC Party, Life Class lessons 1 to 4 from the week after the party
(decision 0295), and the Encounter. The ten weeks are a reminder on the screen and refuse
nothing.

## Why

The Encounter is the date a leader works towards, and the question before it is who has done
enough SUYNL to be invited to the LC Party. Counting only people with a lesson keeps the table
to those in progress; the Growth counts below it still cover everyone.

---

Decision 0297, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-26 — Encounter seasons are set by an administrator](0296-encounter-seasons-are-set-by-an-administrator.md)
