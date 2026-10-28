# 2026-10-28 — Three spellings, and two adds of one person at once

Owner ruling, 2026-10-28, chosen from screenshots of Add People today beside each proposal, from
the duplicate audit of 25 Oct (its gaps c and e). Gaps b and d were left as they are.

## The ruling

**1. Two leaders adding the same person at the same moment: the second is asked.** Until now an
add checked for duplicates and then wrote, in two steps, so two adds made together each checked
before either had written and both went through, recording one person twice. An add now checks
and writes in one transaction, after taking a lock on the last name as Section 3 compares it. Every
Tier 1 rule needs the last names equal, so two adds that could be one person always meet on that
lock: the second waits for the first, then checks against it and is asked "Is this someone already
recorded?" exactly as it would have been a minute later. Adds with different last names never wait
on each other. The wait is bounded like every other lock wait (Section 24), and a lost wait answers
`RESOURCE_BUSY`, to be retried with the same key.

**2. Three spellings now show as a possible match.** Each was invisible to every rule before:

- `Ma.` written for `Maria`, with the last names equal: *Ma. Teresa Santos* finds *Maria Teresa
  Santos*. `Ma.` is the only abbreviation read, a closed list as the suffixes are.
- The first and last names typed the wrong way round: first name *Reyes*, last name *Ana*, finds
  *Ana Reyes*.
- Two first names against one, the one being the other's first word, with the last names equal:
  *Ana Marie Reyes* finds *Ana Reyes*, either way round.

Each gives its own reason, so the person deciding sees why it was shown.

**3. A spelling is never a stop.** A spelling never raises a candidate to Tier 1, the same
birthday and mobile number included: each is a guess about how a name was written, and a guess is
shown rather than asked about. A candidate a spelling reaches may still be Tier 1 by another rule,
as `Ana M` against `Ana` with the same birthday is by the small edit distance. Each reads the names alone, so a candidate reached outside the encoder's branch
may appear as a possible match, without its tier or reasons (Section 3).

**4. What is unchanged.** The edit path is not serialized by the lock; an edit is checked as
before (decision 0396). Nor is the tree import, whose commit is one Admin run checked against its
own dry run: an add made while an import commits may still record one person twice. The lock comes
before every other lock an add takes, which Section 5 now states. The tree import reads the same rules and so may now show these candidates;
it never stops on them.

Decision 0401, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 3, 5, 20 and 24.

Previous: [2026-10-28 — One Cells total, and your Cells first](0400-one-cells-total-and-your-cells-first.md)
