# 2026-10-08 — Full view, and the screens of a leader who records

Decision 0322 put recording on the ground: each leader records what they owe. About a thousand
Cell leaders will sign in, most of whom only record. The owner chose, one question at a time and
from screens shown in the running application, that an administrator marks who sees the whole of
today's screens, and that everybody else sees only what recording needs.

## The ruling

**1. An administrator ticks *Full view* on a Leader account** (owner, 2026-10-07). It is set and
cleared only by an account holding `roles.manage`, on the person's page, and each change is
audit logged with its previous and new value (Section 21). There is no limit on how many accounts
hold it. It changes only what the Leader role gives: an account that also holds `SENIOR_PASTOR`
or `ADMIN` keeps that role's defaults whatever it says. A new account starts without it.

**2. A Leader account without Full view holds no `reports.view_subtree` and no Training or
Conquest capability** (owner, 2026-10-07): none of `training.view_subtree`, `training.confirm`,
`training.confirm_on_behalf`, `conquest.view_subtree`, `conquest.confirm` or
`conquest.confirm_on_behalf`. The API refuses those routes to it, so hiding them is not what keeps
them closed. Section 7's role catalog states both Leader default sets. Everything else of the
Leader defaults is unchanged, and ground reporting (decision
0322) applies with or without Full view.

**3. Its screens are the recording ones** (owner, 2026-10-07):

- The sidebar is `Record · People · My Cell · SUYNL`, and it lands on `Record`.
- `Record` shows Awaiting a record, Cell meetings and DCC, and no other list and no month
  figures. Its *People I oversee* switch shows only while a leader holding an account sits
  directly beneath the reader, and then lists the reader's direct leaders only.
- `People` is the People tab alone, without `Branch`.
- `My Cell` is the reader's own Cells: members, this month's meetings, and asking for a new Cell.
  It adds members and offers no removal.
- `SUYNL` is the Growth SUYNL tab as a sidebar item of its own.

What these screens leave out the reader may still be allowed to read: the Cells list beyond their
own, the Branch tab and their whole branch. Those are left out to keep the screens short, and only
point 2's routes are refused.

**4. A Leader account with Full view keeps today's screens**, `Record · Reports · People · Cells ·
Growth`, over its own branch.

**5. The API tells the client which screens an account has**, and the client never works it out
from a role or from the capabilities.

**6. On the day this is built, the two Network roots and their direct leaders start with Full
view, and every other Leader account starts without it** (owner, 2026-10-07). The set is taken
once from the tree as it stands that day and is not kept up afterwards: a leader who joins a root's
direct leaders later is ticked by an administrator. **An administrator ticks the launch set by hand on that day** (owner, 2026-10-08), so each tick is logged under their name like any other; nothing ticks it as a system action.

**7. This replaces decision 0277's one sidebar for every account.** Where an account lands is
unchanged (decision 0245).

**8. What the build's tests must show**, at the API: a Leader without Full view is refused every
route guarded by a point 2 capability, and the same account with Full view is admitted; ticking
and clearing are refused to a Leader and to a Senior Pastor and admitted to an Admin, and each is
audit logged; a new Leader account starts without Full view; Full view changes nothing for a
Senior Pastor or an Admin.

---

Decision 0323, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-07 — Ground reporting: a leader records only what they owe](0322-ground-reporting.md)
