# 2026-10-07 — Ground reporting: a leader records only what they owe

The owner set the goal in plain words: the reporting is done on the ground, by the leader who
owes it, and the leaders above see whether it is done and follow up rather than file it for
them. Until now every Leader and both Senior Pastors could record and correct Cell meetings, DCC
records and SUYNL lessons for anyone in their branch (section 14), so a coverage figure could
not say who on the ground had reported.

The owner chose, one question at a time and from the screens: the rule covers Cell meetings, DCC
and SUYNL; Training and Conquest stay with the top group; a person's SUYNL lessons are filed by
whoever records their DCC; nobody marks their own DCC; and only an Admin steps in.

## The ruling

**1. By default, a Leader or Senior Pastor records and corrects only the records they owe**: the
meetings of a Cell that resolves through them (sections 7 and 13), the DCC records of the people
on their own checklist (section 9, which includes the people of a leader beneath them who holds
no account), and those same people's SUYNL lessons (point 3). A leader above sees whether it is
done and does not file or correct it.

**2. Recording or correcting a record another leader owes needs the matching on-behalf
capability, and by default only Admin holds one**: `dcc.submit_on_behalf`,
`cell.submit_on_behalf` and `suynl.confirm_on_behalf`, at Whole Church. A Leader and a Senior
Pastor hold none of the three. An Admin may grant one beyond these defaults (section 7).

**3. SUYNL follows DCC.** `suynl.confirm` reaches the people whose DCC the actor records, by
section 9's submitter rule, rather than their direct disciples only. The two Network roots stay
as section 28 places them.

**4. What a leader sees of other leaders' work is unchanged.** *People I oversee* still lists
every Cell meeting and DCC Sunday owed beneath the actor that their viewing capabilities reach;
a row the actor may not record carries See meeting or See checklist, read only, where it
carried Record or was left out (section 19).

**5. Training and Conquest are unchanged**, and so is everything else a leader does: adding
people, Cell membership and requests.

**6. Nobody records their own DCC line, whatever capability they hold, except the two Network
roots** (owner, 2026-10-07). The roots, who have no leader, are recorded as section 9 places
them, which lets a Senior Pastor record their own. Section 9 states it.

**And a consequence, stated rather than left to be found.** A
Cell meeting whose leader cannot sign in, and a checklist whose leader holds an account that is
not active (section 9), can be recorded only by an Admin, decision 0313's screen included.

**7. What the build's tests must show**, at the API, under the role defaults: a Leader and a
Senior Pastor are refused recording, correcting or rescheduling another leader's Cell meeting,
recording or correcting a DCC line for somebody not on their own checklist, and filing or
withdrawing a SUYNL lesson for somebody whose DCC they do not record; each succeeds for their
own; a Senior Pastor records the two roots' DCC; a leader files SUYNL for the people of a leader
beneath them with no account; *People I oversee* still lists a downline leader's outstanding
meeting and Sunday, without Record; an Admin succeeds at all of it; and anybody but a root,
an Admin included, is refused their own DCC line.

---

Decision 0322, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-07 — The current tree may be held in memory, checked on every request](0321-the-current-tree-may-be-held-in-memory.md)
