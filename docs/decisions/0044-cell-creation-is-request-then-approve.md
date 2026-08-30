# 2026-08-20 — Cell creation is request then approve

**Amended** by "Cell creation workflow, hardened" below. Two details here are superseded: `cell.request_creation` is scoped subtree-excluding-self rather than own/subtree, and the claim that this is the only action carrying a second party is wrong — archival and Person Merge share the shape.
The prospective leader's own upline requests the Cell, naming the leader, category, day and time (`cell.request_creation`, own/subtree). Admin approves (`cell.approve_creation`, Admin only), and approval creates the Cell, the leadership assignment, and proceeds to the account step in one transaction.

Admin holds approval because approving a new Cell Leader means provisioning their account, and §6 requires one actor to hold both `cell.manage_leadership` and `accounts.manage`. Admin is the only role holding the latter, so the choice falls out of the role catalog rather than being arbitrary.

Two steps because creating a Cell mints a Cell Leader, which moves the requester's own progress toward Leaders with 12+ Direct Leaders. It is the only routine action where the actor benefits from the outcome, and the only one carrying a second party.

Communicating a new Cell Leader to the Senior Pastors' direct leaders happens outside the application, in conversation. The system deliberately does not model it. Written to `SKILL.md` §10 and §7.

---

Decision 0044, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-20 — Recorded scale and initial data load](0043-recorded-scale-and-initial-data-load.md) | Next: [2026-08-20 — Admin creates the initial Cells](0045-admin-creates-the-initial-cells.md)
