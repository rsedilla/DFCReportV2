# 2026-11-14 — The Senior Pastors' *People* is Men, Women and Both, and a Primary opens their 12

Owner ruling, 2026-11-14, as Bishop Oriel asked, chosen from screenshots of his *People* on a
phone and a laptop, today beside the change.

## The ruling

**1. The two Senior Pastors' *People* has a *Men* · *Women* · *Both* switch**, under the month.
*Men* shows the Men's Network's total and the Men's root's table of Primaries, *Women* the same
for the Women's Network, and *Both* the whole church and both tables, with *Others*, as before.

**2. The reader's own Network comes first and is chosen when the page opens**: Bishop Oriel sees
*Men* · *Women* · *Both* and opens on *Men*; Pastora Geraldine sees *Women* · *Men* · *Both* and
opens on *Women*. Which Network is theirs is read from which root they are; a reader who is
neither opens on *Both*, and so does a root while the current month's tables cannot be shown
(Section 20 refusing the placement graph), the roots being read from them. The choice is kept in
the address as `network`.

**3. A Primary's name on *People* opens that Primary's 12 on the same page**: their total, one row
per direct disciple counting them and everyone beneath, and their own row, under *[name]'s
Disciples*, with *Back to People*. It is the view a Full view leader has of their own branch
(decision 0380), read at `GET /api/v1/reports/people/branch` under `reports.view_subtree` against a
`LEADER` selector, which a Whole Church holder may name. **A name there with people beneath it
opens that leader's 12 in turn**, keeping the month and the Network chosen, so the Senior Pastors
go down the tree a level at a time; a name counting one, the leader alone, and the opened leader's
own row stay plain text (owner, 2026-11-14, added after seeing the first build). A Full view
leader's names stay plain text (decision 0380). On
*# of Cell Groups* and *# of Cell Leaders* a name still opens the person's page (decision 0364).

**4. `GET /api/v1/reports/church-counts` takes an optional `network`, `MENS` or `WOMENS`.** A
Whole Church reader of `reports.view_subtree` is answered that Network's counts, which the route
already gives a Network Admin (decision 0469): its membership's total (decision 0219) and its
root's table. A Network Admin is answered their own Network whether or not they name it, and
naming the other is refused `SCOPE_DENIED`. Any other value is refused `VALIDATION_FAILED`.

The two Networks add up to *Both* on every figure, Section 20's identity, and a test asserts it.

## Why

The Bishop reads his own Network first, and Pastora hers; the whole church is one tap away. Opening
a Primary's 12 from their name is what the Bishop expected the name to do, and it keeps him on the
figures rather than leaving for a person's record.

## What it does not change

Who may read what: a Whole Church holder could already read either Network's figures and any
leader's branch, and a Network Admin still reads only their own. The Admin's *Counts* and a Full
view leader's *# of People* are unchanged.

---

Decision 0490, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Section 19.

Previous: [2026-11-14 — Conquest is four tabs, one per goal](0489-conquest-is-four-tabs-one-per-goal.md)
