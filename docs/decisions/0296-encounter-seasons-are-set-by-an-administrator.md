# 2026-09-26 — Encounter seasons are set by an administrator

Decision 0295 placed the Encounter in the first week of April, August and December and left
the days open. The owner wanted the SUYNL report to count who is getting ready for the next
Encounter, and ruled on how its dates are kept, each point shown in the running application
first.

## The ruling

**1. The dates are recorded, not derived.** An administrator keeps a list of Encounter
seasons; nothing computes a date from a month, so a retreat that moves is an edit. This
settles which days "the first week" means: whichever days are recorded.

**2. A season has four dates**: a Men's Encounter, for men only, and a Women's Encounter, for
women only, usually a week apart, each the day its weekend starts; and an LC Party before
each, one for men and one for women.

**3. Each LC Party is at least five weeks before its own weekend**: the party, then Life
Class lessons 1 to 4 a week apart, then the Encounter as lesson 5. One left empty is exactly
five weeks before. Nothing limits how early a party may be. The rule is a database
constraint as well as a refusal naming the field.

**4. Only a Whole Church `settings.manage` holder adds or changes a season**, and every
change is audited with its previous and new values (sections 7 and 21). Anyone who reads
SUYNL reads the seasons. Nothing deletes one; a wrong date is an edit, and two seasons may
not hold the same weekend.

**5. Each reader is shown their own Network's weekend.** The Men's Encounter is for men only
and the Women's for women only, so a leader sees the LC Party and Encounter of their own
Network, and an administrator or a Senior Pastor, reading the whole church, sees both. The
API decides which half it sends, not the screen.

**6. The list and its editor are under Growth, on the Training tab**, where records are filed
and the Encounter, a Training graduation, already lives. **The SUYNL report shows the next
season** read only, with a link there. The editor was first placed under Reports, which
section 19 forbids; `architecture-guardian` found it and the owner chose Growth.

## Why

The Encounter is the fixed point Life Class and SUYNL work towards, and a report counting
readiness needs real dates rather than a rule that is wrong the year a weekend moves.

---

Decision 0296, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-26 — The Encounter is Life Class lesson 5](0295-the-encounter-is-life-class-lesson-5.md)
