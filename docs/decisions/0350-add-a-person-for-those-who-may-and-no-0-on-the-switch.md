# 2026-10-14 — Add a person for those who may, and no 0 on Record's switch

Two small follow-ups to decisions 0348 and 0349. The owner chose both on 14 Oct from real
screenshots.

## The ruling

**The People tab offers *Add a person* only to an account holding `people.create`.** A Senior
Pastor holds none (decision 0326), so the button led them to a form whose save is refused.
With the button gone, so is the sentence suggesting they add the person when a search finds
nobody. What an account holds is the server's answer, read from `GET /auth/me`; the API
still refuses the save to anybody without the capability.

**The Cell Group and DCC buttons under *Update Record* show no box for a count of 0**, as
the Record tabs above them do since decision 0349. A count above 0 keeps its box.

## Why

A control that can only ever be refused is not worth offering, and a switch that showed 0
under tabs that do not would read as two rules for one kind of count. Rejected: keeping the
button and explaining the refusal on the next page, which costs a Senior Pastor a click
for nothing.

Decision 0350, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-14 — A Record tab with nothing in it shows no count](0349-a-record-tab-with-nothing-in-it-shows-no-count.md)
