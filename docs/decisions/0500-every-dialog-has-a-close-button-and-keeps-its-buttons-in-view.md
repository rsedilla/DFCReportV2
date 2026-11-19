# 2026-11-20 — Every dialog has a close button and keeps its buttons in view

Owner ruling of 2026-11-20, chosen from screenshots of *Register for Life Class* as it was
and as proposed, on a laptop and on a phone, side by side.

## What was wrong

A dialog had no close button: the way out was *Cancel*, at the very bottom. A long dialog put
its buttons below the fold, so *Register* could not be seen without scrolling, on a laptop as
well as a phone. On a phone the sheet stopped at 85% of the screen's height. In *Register for
Life Class* the person's name and Member ID split across three lines on a phone, the birthday
warning read as an ordinary sentence, and *Register and add another* wrapped onto two lines.

## The ruling

**1. Every dialog has a title bar with a close button** (owner, "Every dialog"). The title and
an × at least 44px square stay at the top while the content scrolls. The × closes the dialog
as Escape does, and asks nothing. The first focus is the control a dialog marks as its safe
answer, otherwise the first control below the title bar, and in a dialog with no control below
it the title itself, so the × never takes it. A *Close* button that would only repeat the × is
not kept: *Correct sex*, refused for a Network root or for somebody who
leads anyone or a Cell, had both.

**2. Every dialog keeps its buttons in view.** They sit in a bar fixed at the bottom of the
dialog, above a rule, so the main action is never below the fold. On a phone they stand in a
column, each the full width, and from `lg` in a row. A *Cancel*, *Keep them*, *Keep it* or
*Change* that looked like plain words is a white button like every other one beside a filled
action. The dialog keeps the height of both bars clear when it scrolls a focused control into
view, so no control is ever hidden under either (WCAG 2.2, 2.4.11). From `lg` a dialog is up to
36rem wide, from 32rem, so *Register and add another* fits on one line.

**3. On a phone a dialog may reach the full height of the screen below the status bar**, its
buttons clear of the home line. It is still a sheet from the bottom edge, so a short dialog
stays short.

**4. *Register for Life Class*** (owner, the same screenshots):
- *Term 3, 2026 · fees and the manual are paid outside DREAMS* under the title;
- the person's name on its own line, *M-000036 · Leader …* under it, and *Change* a button;
- *Requirements*, in plain letters rather than the green capitals of a field label, with
  *· 2 of 4 not met*, or *· all met*, beside it, each unmet one saying *Not met* in words beside
  its ✗;
- *Birthday missing.* in a box with a *!*, saying who to ask;
- *Ask …, then tick*, also in plain letters, the two ticks as boxes that answer a tap anywhere
  on them, side by side on a laptop, and a missing tick saying *Both are ticked before
  registering*, where it said *All three* after the third tick was withdrawn (decision 0499);
- on a phone the × is the way out and *Cancel* is not shown.

The research shown beside the proposal: several design systems put a form dialog full screen
on a phone with the content scrolling between a fixed header and footer, and stack its
buttons; the UK government's found that most people tap a tick box itself rather than its
label, which is why the box is large.

## What is not changed

The labels of the boxes typed into (*WHY REGISTER THEM ANYWAY?*, *NOTE*) are every form's, not
this dialog's, and stay in capitals. A requirement's detail is written by the API (*5 meetings,
last on 2026-11-04*) and is unchanged. No dialog loses an action and each gains the ×: a
*Cancel* hidden on a phone in one dialog, and the *Close* of a refused *Correct sex*, are
replaced there by the ×, which does the same.

## Where it lives

`SKILL.md` Section 19, the list of controls under *Each kind of control has one size*, and
Section 29 for *Register for Life Class*.
`web/components/ui/dialog.tsx` (`Dialog`, `DialogActions`), which every dialog uses, and
`web/app/(app)/equipping/registration/page.tsx`.

Previous: [2026-11-17 — Equipping: registration and enrollment for Life Class](0499-equipping-registration-and-enrollment-for-life-class.md)
