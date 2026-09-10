# 2026-09-11 — The `settings` write moves to its owner, and is audited

Section 26 gives `settings` to `admin`. Section 2 says of a module's tables that "no other
module writes them, **ever**", with no exemption, and rests its *read* exemption on exactly
that asymmetry: "a write is what an invariant guards, so a write has one home."

`DccCalendarService.generate` writes `settings` directly, setting `dcc_calendar_start` on
the run that finds it unset. `AttendanceModule` imports no settings module, so no service
interface was available to it.

**It moves behind `SettingsService`, which is Section 2's ordinary route rather than an
exemption.** Section 2 reserves a port for where the dependency would be a cycle "and only
there", and this is not one: `SettingsModule` owns one table and imports nothing, so
`attendance` may import it and call it like any other module.

## The second half, which is larger than the first

Preparing this ruling turned up something the Stop Condition had not named. Section 7 says
of `settings.manage` that it is "Admin-only, at Whole Church scope, and **every change is
audit logged with its previous and new values**", and names "the first Sunday the DCC
calendar covers" as one of the three settings it governs.

**That write produced no audit entry.** `audit_log.action` has carried `setting.changed`
since the vocabulary was written, and nothing in the repository has ever emitted it — the
one settings write in the system was silent. So the single control Section 7 says must
always be audited was the one control never audited.

**The two halves close together, and that is the argument for this shape over the others.**
Putting the write behind the owning module puts it behind one method, and that method
writes the row and the audit entry or neither. An exemption in Section 2 would have left
the audit gap standing and depending on whoever wrote the next caller.

## A system action writes it, and Section 7 did not say so

Section 7 calls `settings.manage` Admin-only. The calendar command holds no capability and
has no actor: it is invoked by a schedule (decision 0161), and decision 0169 settles that
its first run sets this value.

So the write is legitimate and Section 7's sentence did not describe it. Section 7 now
states the exception rather than leaving a reader to infer it from two other rulings: this
one setting is also set once by the scheduled command, with a null actor, which Section 6
already permits for exactly this case, and it is audit logged as a system action like any
other change.

**The exception is narrow and is stated as narrow.** It covers the first setting of
`dcc_calendar_start` and nothing else. Every other change to every setting, this one
included, remains an Admin action under `settings.manage`.

## What was rejected

**Amending Section 2 to admit a write exemption.** It would be the first, and it would
remove the ground the read exemption stands on — decision 0234 widened that read exemption
one day earlier, on that asymmetry, so this would have hollowed out a ruling while the ink
was wet.

**Making the floor a deliberate Admin action.** It contradicts decision 0169, and it leaves
a fresh installation unable to generate a calendar until somebody sets a date by hand, with
no stated recovery if nobody does.

---

Decision 0237, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-11 — A development email transport writes to an outbox, and refuses in production](0236-a-development-email-transport-writes-to-an-outbox.md)
