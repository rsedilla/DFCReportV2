# 2026-10-16 — Only an administrator closes a Cell, and Cells with no meeting in three months are listed

The owner decided on 15 and 16 Oct, from clickable previews, that closing a Cell is an
administrator's act. Bishop Oriel and Pastora Geraldine want an explanation for every
closure, and the administrator talks a closure through with them first. The owner also asked
that the Primaries see which Cells in their branch have stopped meeting, without being able to
act on it and without anything being sent to them.

## The ruling

1. **Only an account holding `cell.manage_lifecycle` at Whole Church closes a Cell**, which is
   how the owner's "only the Admin closes a Cell" (2026-10-16) is built. By default that is Admin alone. Closing is checked against the church, as
   direct creation is (decision 0352), so an account holding the capability over its own
   subtree may not close. A Leader keeps that subtree default, and it now does one job: it is
   the second-object check a handover or a restart makes on the Cell it names (Section 10).
   Taking the default away instead would have stopped every leader requesting a handover or a
   restart and refused every one already pending at approval, which the owner did not ask for.
2. **There is no request to close** (owner, 2026-10-16). A leader who thinks a Cell has ended
   says so to the administrator, who talks to the Senior Pastors and then closes it. The 15 Oct
   flow, in which a leader asked and a Primary passed the request on, is withdrawn before it
   was built.
3. **The reasons a closure may give are** *Merged into another Cell*, *Leader stepped down*,
   *Leader moved away*, *Leader left the church*, *Leader passed away*, *Members stopped
   attending*, *Other*, and *Created in error* (owner, 2026-10-16). `MEMBERS_DISPERSED` is no
   longer accepted for a new closure; a Cell already closed with it keeps it, and it is shown as
   *Members dispersed*. Each reason states a fact about the Cell and none judges the leader
   (Section 1, Principle 7).
4. **Every closure carries a written explanation** (owner, 2026-10-16), in the closure note
   and within the length it already had. It is what the Senior Pastors read. A backdated
   closure explains its date in the same note, as Section 10 provided for *Other* before this ruling. The
   database refuses the change to `CLOSED` without one, or giving `MEMBERS_DISPERSED`; a Cell
   closed before this ruling keeps the note and reason it had.
5. **Members are decided at closure exactly as Section 10 says.** The administrator may move
   every member to one Cell or leave them without a Cell by explicit choice; those left appear on
   *Awaiting CG Assignment*.
6. **Section 15's list of Cells with no meeting held is built**, as the filter *No meeting in 3
   months* on the running Cells of the Cells page, beside *Fewer than 3 members*, carrying no
   count. A Cell is on it when it is `ACTIVE`, was created before the first day of the window,
   and has no meeting held in the window: the last finished Manila
   months, as many as the church-wide attention setting says (three). Each row shows each month
   of the window, with how many meetings were recorded as *Did not meet* and how many are *Not
   recorded*, so a quiet Cell is told from one nobody reports on. The number in the label is the setting's.
   **A meeting moved to another day that happened counts as met** (owner, 2026-10-16): a
   meeting recorded `RESCHEDULED` whose actual date has come. A meeting belongs to the month
   it reports in (Section 13), so one planned for 31 January and held on 2 February counts for
   January. **A meeting with no record whose week is still open to recording** (decision 0335)
   **is not counted among the row's *Not recorded*** (owner, 2026-10-16), and while any
   meeting of the window is in that state the Cell is not listed, so nobody is shown on the list while they still have
   time to record.
7. **Whoever lists a Cell sees it on that filter, and only an account that may close sees a way
   to close.** The list is read under `cell.view_subtree`, as the Cells page is. A Full view
   leader therefore sees their whole branch, read-only. Each row says whether the reader may
   close it, decided by the server.
8. **Nothing closes on its own, and nothing is sent to anybody** (owner, 2026-10-16). The filter
   is a list a person opens; Section 10's rule that no inactivity closes a Cell is unchanged.
9. **The Closed tab shows the reason and the explanation** to whoever lists the closed Cell
   (Section 15's closed view).

Point 1 implements the owner's "only an administrator" as the capability at Whole Church, not as
the `ADMIN` role, as direct creation does; whether that is right is the open question
`CLAUDE.md` already carries for direct creation.

This narrows Section 10's list of who may close, which named the Cell's leader and any leader
upline of them, and amends its reason list and its note rule. It builds Section 15's existing
attention item rather than adding one. The 15 Oct decisions recorded on the owner's checklist
under *Close a Cell* are replaced by this one.

Decision 0355, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-15 — The People tab is named Add People, and its button reads Add](0354-add-people-and-a-plainer-branch-screen.md)
