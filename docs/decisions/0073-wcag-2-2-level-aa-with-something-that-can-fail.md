# 2026-08-21 — WCAG 2.2 Level AA, with something that can fail

`architecture-guardian` found accessibility asserted in `SKILL.md` §2 with no standard, no test and nothing in the Definition of Done — a rule a reviewer could not apply and a developer could not fail. This settles it.

**Level AA.** Level A omits colour contrast, which is the criterion that decides whether a leader can read an attendance figure on a phone in a hall at fifty. Not AAA: 7:1 contrast and its reading-level requirement are not achievable for this material, and a standard nobody meets is one everybody ignores.

**Made checkable in three parts**, recorded under Definition of Done: the palette is checked deterministically on every build, axe-core runs in CI from the first real screen in Stage 2, and a pull request adding a screen states how it meets the four criteria automation cannot see. The phasing has a terminating condition rather than being open-ended.

**§23 names six criteria, in four groups, because this system's rules bear on them.** 1.4.11 splits the palette into a decorative border and a control border, so reaching for the wrong one on a form field is visible. 2.5.8 exists because Cell attendance is recorded by tapping down a roster on a phone, often standing, where a mis-tap is a wrong attendance record. 3.3.8 is why paste in the password field is never blocked, written into §6 as well: a password is itself a cognitive function test, and the criterion permits one only where a mechanism assists in completing it, which is the password manager. Blocking paste removes the thing conformance rests on. 2.4.11 is what makes the keyboard path usable and cannot be seen in a screenshot.

Conformance is about perceiving and operating the interface, and licenses nothing about meaning: §13, §17 and §19 still forbid encoding meeting status, coverage or a leader in colour at any contrast ratio.

The native clients are deliberately out of scope. Their framework is not chosen, and their equivalent obligation is the platform accessibility API rather than WCAG.

---

Decision 0073, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-21 — UI direction: headless primitives the repository owns, and no design-system framework](0072-ui-direction-headless-primitives-the-repository-owns-and-no.md) | Next: [2026-08-21 — Twelve findings from the Stage 1 verification, and why they existed](0074-twelve-findings-from-the-stage-1-verification-and-why-they.md)
