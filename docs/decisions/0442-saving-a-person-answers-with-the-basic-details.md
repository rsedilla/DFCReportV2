# 2026-11-05 — Saving or moving a person answers with the basic details, and a save that changes nothing writes nothing

The security audit of 2026-11-02 found that `PATCH /api/v1/people/{id}` answered with the whole
record, birthday, civil status and mobile number included, and kept no read of it. Decision 0414
keeps who opened a person's record and emails the Admin when one person opens more than a hundred
in an hour, and takes the birthday, civil status and mobile number off every list for that reason.
A save reached the same details with neither noticing: a leader could save each person in their
branch, changing nothing, and read the three details from each answer. The owner chose the fix on
2026-11-05 from a drawing of the answer today and as proposed.

`architecture-guardian`'s review of the first build found two things the owner then ruled on the
same day. The first build refused a save that changed nothing, and that refusal confirmed a guess:
sending a birthday, mobile number or civil status and being told "Nothing to save" meant it was
the one recorded, with nothing kept. And two other answers still carried the three details with
no read kept: moving a person to another leader, and correcting a person's sex.

## The ruling

**1. A save answers with the basic details only**: the record without the birthday, civil status
and mobile number, as a list row carries it (decision 0414). Those three come only with reading
the one record, `GET /api/v1/people/{id}`, which is kept.

**2. A save that changes nothing writes nothing and answers as a save does**: `200` with the
basic details, no row written and no audit entry. It changes nothing where every field it sends
equals what is recorded, a title sent by somebody who may not set one being compared as decision
0374 compares it. Answered as a save rather than refused, a right guess and a wrong one look the
same to whoever sent them. A wrong guess is still a real edit, written and audited.

**3. Moving a person to another leader (`PUT /people/{id}/pastoral-leader`) and correcting a
person's sex (`PUT /people/{id}/sex`) answer with the basic details too**, beside what each adds
about the move. Neither screen reads those three details from the answer.

**4. The web application sends nothing when nothing was changed**, and returns to the person's
page. After a save it drops its copy of the record, so the person's page reads it again, and that
read is kept like any other.

## Why

Decision 0414's log and alert are worth what the routes that hand over the same details let
through, and the save was one of them, as were the two answers in point 3. Answering with the basic
details closes all three while each change is still recorded in the audit log. A save that changes
nothing writes nothing because Sections 4 and 5 already refuse an audited operation whose before and
after are the same, which misleads whoever reads the log; it is answered rather than refused because
a refusal is itself an answer about the hidden value. The cost is one more read when the person's
page opens after a save, which is the read the page would make anyway.

---

Decision 0442, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 7 and 8.

Previous: [2026-11-05 — Ten wrong codes pause an account's second step](0441-ten-wrong-codes-pause-the-second-step.md)
