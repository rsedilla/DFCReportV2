# 2026-11-02 — The Admin area: who sees it, where it sits, and its Accounts list

Section 19 promised an `Admin` item once the Admin dashboard was built, and left open which
capabilities show it (decision 0245). The owner asked on 2026-11-02 for the order other admin
consoles use, and chose the recommended layout from side-by-side screenshots: Google Workspace,
Microsoft 365, Slack, GitHub and Shopify all keep administration apart from the daily work, open
it on a summary, and order it people first, settings next, the record of changes last.

## The ruling

**1. The Admin area is for an account holding `accounts.manage` at Whole Church**, which by
default is the `ADMIN` role alone: a Senior Pastor never holds it (decision 0110). The screen
follows the capabilities `GET /api/v1/auth/me` names, never the role. The Accounts reads carry
`accounts.manage` at Whole Church, and every other read the area makes is guarded by its own
route as it is elsewhere; the screen guard keeps the area from anybody else, and authorizes
nothing (Section 1, principle 4).

**2. It is set apart from the daily items.** On a laptop it is the last item of the sidebar, below
the others and a rule, under the words *For the administrator*. On a phone it is an *Admin*
button in the top bar beside the account button, not a seventh button in the bottom bar. It is
the landing screen of the accounts it is for, as Section 19 said it would be, which amends
decision 0372's landing on Record for them. Like `Conquest` (decision 0407) it follows one
capability at Whole Church rather than the screens the server names.

**3. It has four tabs, in this order: Home, Accounts, Settings, Audit Log.** Home and Accounts
are built with this ruling; Settings and Audit Log follow with the routes they need. There is
no Security tab: an account's sign-in state is a filter on Accounts.

**4. Home lists what needs the administrator now**, across the whole church: Cells to approve,
No Leader Yet, accounts never activated and sign-ins paused; then Pending CG Records and Pending
DCC Records; then counts of people, accounts and Cells. Each count opens the list it counts.

**5. Accounts lists every account**, searched by name, username or email, and filtered by
*Active*, *Waiting for activation*, *Sign-ins paused*, *Second step not set up* or *Disabled*:
each a chip carrying its count, one on at a time, as the owner chose from the screenshots. A row names the person, the role, the state and what is
ticked, and the name opens the person's page, where the account is managed (decisions 0276,
0307 and 0393). It lists people in first-name order (decision 0359). It reads through
`GET /api/v1/accounts` and its counts through `GET /api/v1/accounts/counts`.

**6. The Audit Log tab, when built, shows the whole log**, newest first, searched and filtered,
and reading it is not itself logged. It is the Admin's alone: it is read under `audit.view`, and
the Senior Pastor role no longer holds that capability by default, which Section 7 gave it
(owner, 2026-11-02). No route read the log, so nothing a Senior Pastor could see changes.

**7. Home carries the date the DCC calendar reaches**, as Section 9 promised the Admin dashboard
would, added with the Settings tab (owner, 2026-11-02). The dashboard's other items in Section 19
already have a home, which that section now names.

Decision 0419, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 7, 19 and 22.

Previous: [2026-11-01 — An administrator records a DCC line where nobody above has an account](0418-an-administrator-records-where-nobody-above-has-an-account.md)
