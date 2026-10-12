# 2026-10-12 — A Full view leader has Recording Status

Owner ruling, 2026-10-11, confirmed on 2026-10-12 from screenshots of the running app. It amends
Section 19 and extends decision 0325, which gave *Recording Status* to the Senior Pastors.

## The ruling

**1. A Full view leader's Record gains a fifth tab, *Recording Status*, after the four lists.**
Record still opens on *Update Record*: the leader records first, then sees the status.

**2. It is the Senior Pastors' tab one level down.** Two boxes, *Recorded their Cell group* and
*Recorded their DCC checklist*, count everyone beneath the reader, with the period before. Then
one row per leader of the reader's 12, each counting that leader and everyone beneath them, with
the same Status column. Week and Month, as the Senior Pastors have. The reader is not counted in
their own boxes, and the rows, with any *Others* line, add up to the boxes. **The boxes carry the percentage and
*Completed* the pale-red label**, the two exceptions decision 0325 made for the Senior Pastors'
screen, chosen by the owner on 2026-10-12 over plain counts and words; Sections 19 and 20 name
this tab beside that screen.

**3. It is read through `GET /api/v1/reports/recording-status/leader`**, guarded by
`reports.view_subtree` over the leader as a My 12 table is. A row is named only where the
reader may open that leader (decision 0254); any other is counted in an *Others* line. The Senior Pastors'
whole-church route is unchanged.

**4. It is offered to an account holding `reports.view_subtree` over its own subtree**, which
is a Leader with Full view; the screen keys on that capability, never on a role. A line under the tabs reads "How your 12 are recording this week".

## Why

The owner wanted the Primaries, and any leader an Admin gives Full view, to follow up their 12
the way the Senior Pastors follow up theirs. It was placed last so the four lists of work stay
together and a leader's own recording comes first.

Decision 0334, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-11 — Record's Whose switch is renamed](0333-the-whose-switch-is-renamed.md)
