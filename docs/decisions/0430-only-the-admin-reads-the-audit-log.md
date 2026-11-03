# 2026-11-03 — Only the Admin reads the audit log

An audit entry keeps the values it changed: a person's whole record before and after an edit,
birthday and mobile number included, the terms of church-wide searches, and the names a duplicate
check was typed with. `architecture-guardian`'s review of decision 0428 raised it as a Stop
Condition: Section 7 let an Admin grant `audit.view` to another account, and that account would
have read every Person's birthday and mobile number through the log, beyond what Section 8 lets
anybody see outside their own scope. The owner was shown what other systems do and chose on
2026-11-03 to keep the log the Admin's alone.

## The ruling

**1. `audit.view` is Whole Church only.** It joins Section 7's capabilities for which a grant at
any narrower scope covers nothing.

**2. Reading the log needs the `ADMIN` role as well.** `GET /api/v1/audit-log` refuses an
account holding `audit.view` at Whole Church without that role with `CAPABILITY_DENIED` naming
the role, so even a Whole Church grant to a Leader or a Senior Pastor reads nothing.

**3. The log keeps storing the values.** It cannot be edited, and it is the one place that
answers "what was it before?" when a record is questioned. If anybody besides the Admin is ever
to read it, a later ruling decides what they see, such as which field changed without its value.

**4. The open question of what period a read of the log asks about is retired.** It waited for
a read serving a grant narrower than Whole Church, which points 1 and 2 make impossible, so its
answer could change nobody's view of an entry. The owner retired it on 2026-11-03. A later ruling
that lets anybody besides the Admin read the log must answer it again.

## Why

Logging guidance generally says to keep sensitive personal data out of logs or to mask it, and
where old and new values must be kept, to let as few people as possible read them. The Admin
already sees every person's current record; anybody else would be shown what Section 8 keeps
from them.

---

Decision 0430, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 7, 19, 21 and 22.

Previous: [2026-11-03 — The Audit Log's name search says when it is cut](0429-the-audit-log-search-says-when-it-is-cut.md)
