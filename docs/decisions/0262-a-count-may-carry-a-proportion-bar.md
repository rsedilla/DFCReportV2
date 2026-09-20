# 2026-09-20 — A count may carry a proportion bar, and a coverage figure may not

The owner's design draws the journey and frequency figures as bar rows with a Total. Nothing in
the specification permits a bar and nothing forbids one: Sections 13, 17 and 19 enumerate
prohibitions rather than a grammar, and Section 23 contemplates "a chart mark" only to bound its
contrast. This is the application's first graphical magnitude encoding, so the rule that makes it
safe is written down rather than left in the component that draws it.

## The ruling

**1. A list of counts that sums to a total of its own may draw each row's share of that total.**
Classification and the monthly-attendance buckets are the two that qualify — Sections 9 and 12
each define both for their own domain — and they qualify because Section 20 already requires each of them to reconcile to the same
unique-people figure. The bar divides by that total and by nothing else.

**2. Four conditions bound it.** The bar never reorders the rows; it carries no meaning in colour,
so it is one ink; the count is always beside it and the bar is hidden from assistive technology,
because it says nothing the count does not; and it is never drawn against a coverage figure.

**3. The fourth condition is the load-bearing one.** Coverage is two figures that Section 12
forbids dividing into a percentage or a score, and a bar *is* a division — a coverage bar would be
the prohibited ratio, drawn. The distinction is not that one is graphical and the other numeric: it
is that a share of a reconciled total compares a scope with itself, and coverage compares a leader
with an expectation.

## Why

**A bar ranks nobody here.** Taking Section 13's list item by item: no rank position, no composite
score summarising a leader, no ordered leaderboard — the rows keep the order their own lists fix —
no value-laden encoding of meeting status, and no side-by-side comparison of leaders. A Cell of
five VIPs and a Cell of five Regulars are different ministries rather than a better and a worse
one, which is why the rows are not sorted by size either.

**The rule needed a home because the next screen will not read this component.** Decision 0186
settled that a rule living in a docblock is not a rule, and decision 0198 records what that costs:
a scope stated in a comment is one whose violations are undetectable. Nothing else in the
application stops a bar appearing beside a coverage line; this does.

**`aria-hidden` is also what keeps the contrast argument true.** `web/scripts/check-contrast.mjs`
exempts the `line` token as a decorative divider, and the bar's track uses it. That exemption holds
only while the mark is redundant — remove the count beside it and Section 23's 3:1 for a graphical
object required to understand content applies to a pair nothing checks.

---

Decision 0262, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-20 — The Cells list is searched and paged, and each row carries its size](0261-the-cells-list-is-searched-and-paged.md)
