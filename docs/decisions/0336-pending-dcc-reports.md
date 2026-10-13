# 2026-10-13 — Pending DCC Reports

Owner ruling, 2026-10-13, chosen from drawings, one question at a time. Record gains the DCC
counterpart of *Pending CG Reports* (Section 15, decision 0315), so a leader who oversees a branch
can follow up the leaders whose 12 have not been recorded before the week closes (decision 0335).

## The ruling

**1. Record gains *Pending DCC Reports*, right after *Pending CG Reports*,** for every account
whose Record shows *Pending CG Reports*: a Leader account with Full view and an Admin (decision
0323). The Senior Pastors' Record is unchanged (decision 0325). Record's lists become five, so a
Full view leader's *Recording Status* is its sixth tab and an Admin's comes after its five lists.

**2. A leader is listed for a Sunday they owe a DCC record for** (owner, 2026-10-13): as of the
Sunday they have disciples, and no live record names them as its responsible leader. This is
coverage's unit (decision 0224), so a checklist with anybody on it marked, present or absent, is
not listed; the leader's own checklist still shows who is unmarked. The Sunday has begun, is not
removed, and its week is still open (decision 0335); a Sunday before 26 October 2026 stays until
the old close, the end of the 7th of the next month.

**3. It covers the reader's whole scope, now** (owner, 2026-10-13): the leaders `dcc.view_subtree`
covers. For a Full view leader that is their whole branch, so it does not stop two levels down as
*Update Record*'s *Leaders Under Me* does (decision 0324, which this leaves unchanged). For an
Admin it is the whole church.

**4. One row per leader whose 12 are unrecorded** (owner, 2026-10-13), the reader's own row
included and shown as *You*. A leader holding no account says so, "Has no account", and the row
names who records it, Section 9's submitter, as "Recorded by" and their name only where that
person is covered by the reader's `dcc.view_subtree` now (owner, 2026-10-13); decision 0313 point
14 is otherwise unchanged. Where nobody records it, the row
offers no Record. **Who holds an account is read now** (owner, 2026-10-13), as the recording
screen Record opens already reads it, the walk up the tree staying as of the Sunday (Section 9);
SKILL.md's account of decision 0313, which said "as of the Sunday", is corrected to match.

**5. Each Sunday is a line of its own, oldest first** (owner, 2026-10-13), labelled as *Update
Record* labels a row (decision 0335, point 8): "Due Mon 16 Nov, 12NN", "Late · closes Mon 16 Nov,
12NN", or, before 26 October, "Closes end of Sat 7 Nov". Late is a word, never a colour.

**6. Record where the reader may record for that leader, and See checklist.** Record opens the
oldest Sunday's recording screen for the leader whose checklist holds the row's people, and is
offered where decision 0313 offers it, decided by the API per row; the reader's own row and the
row of a leader whose records fall to the reader carry Record alone. See checklist opens the
listed leader's own checklist for the month of the oldest Sunday, read only (decision 0301). An Admin may
record for every leader (decision 0322), so every row of theirs carries Record wherever a recorder
exists. **The recorder named, Record and See checklist all follow the row's oldest Sunday**
(owner, 2026-10-13); once it is recorded it drops off and the row follows the next. **This is where an Admin steps in on DCC** (owner, 2026-10-13), which was recorded as open.

**7. By surname, then first name, then Member ID, never by how many Sundays or how late**
(decision 0009). Fifty rows at a time, by cursor (Section 22), the tab counting what it has read
and "50+" where there is more. A search narrows it to leaders whose name, normalized, or Member ID
contains the term, two characters at least. A reader whose scope is the whole church also has a
Network filter: All, Men's or Women's, by the leader's Network now.

**8. The route is `GET /api/v1/dcc/pending-leaders`**, guarded by `dcc.view_subtree` against the
actor and narrowed to that scope in the owning module, as *Pending CG Reports*' list is. It
names no period, so it asks about now (Section 7). It returns no total.

**9. What the build's tests must show**, at the API: a leader with a Sunday owed is listed and one
with anybody marked is not; a Full view leader gets a leader three levels down and nobody outside
their scope; an Admin outside the pastoral tree gets leaders of both Networks; the reader's own
row; a leader without an account, its recorder named when in the reader's scope and not
otherwise, one with nobody above holding one, and one given an account after the Sunday; a closed week, a
removed Sunday and one not yet begun are not listed, and a Sunday before 26 October stays until
the 7th; Record is offered per row as decision 0313 decides; the order, the search, the Network
filter, the cursor, and no total.

## Why

*Leaders Under Me* is a list of work to do, cut to two levels so a leader near the top is not
handed a thousand rows (decision 0324). This is a list of leaders to follow up, which is the
question a Primary brings to the Tuesday meeting, so it covers the whole branch and gives each
leader one row. The owner chose the whole church for an Admin because the Admin is the one who
steps in.

## What this amends

Decisions 0290 and 0332 (four lists and four buttons become five), 0334 (the fifth tab becomes
the sixth), and 0313 (point 14, and where SKILL.md read accounts as of the Sunday). Sections 9,
14, 19 and 22 are amended.

Decision 0336, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-12 — A week is due the Monday after it, and closes two Mondays later](0335-a-week-is-due-the-monday-after-it.md)
