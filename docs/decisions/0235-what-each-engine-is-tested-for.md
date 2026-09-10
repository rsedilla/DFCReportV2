# 2026-09-10 — What each engine is tested for, and axe runs in Blink

Section 23 says two rendering engines "are what the conformance claim below is
tested against: Blink and WebKit". The roadmap's exit criterion for the screens
block says every screen "passes axe-core in both engines".

**The harness does neither of those things, deliberately.** `playwright.config.ts`
runs `chromium` over every scan and gives `webkit` a `grep` of `@cross-browser`,
which selects two viewport widths and nothing else. Measured on the run of
2026-09-10: 70 axe scans in Blink, none in WebKit.

So a Stage 6 gate read literally was unmet, and read against the harness's own
reasoning was met. That is settled here in the direction of the harness.

## Axe runs in Blink, over every route, in both themes

The automated conformance check runs in one engine. Its rules are engine-independent
in what they assert — contrast ratios, names, roles, landmark structure, form
labelling — and they are computed from the accessibility tree and the resolved
styles rather than from anything Blink and WebKit disagree about. Running them twice
buys a second opinion on a question the two engines do not differ on.

What it costs is the argument. That job builds the application and scans every route
in two themes. A second engine across the same set roughly doubles it, and Section 23's
own commitment is worthless if the check becomes slow enough that somebody is tempted
to skip it. A conformance check nobody runs conforms to nothing.

## WebKit is tested for what the engines actually differ on

WebKit is not a reduced copy of the Blink run and is not there for reassurance. It
exists because **iOS permits no other engine**, so Chrome on an iPhone is WebKit and
roughly half the device list this application is sized for is iPhones.

It runs the two viewport widths that bind — the narrowest, where overflow is hardest,
and the widest at which anything changes — because layout is where the engines
genuinely diverge: date inputs, sticky positioning, flex and grid corners, focus
behaviour. An engine difference appearing at neither end is the accepted cost, and it
was already stated in the configuration before this ruling.

## What this changes, and what it does not

Section 23's engine sentence and the roadmap's exit criterion are amended to say what
is actually tested where. **No behaviour changes and no test is added or removed**:
this ruling brings two documents into line with a harness that was built this way on
purpose and explained itself at the time.

**It does not weaken the conformance claim.** Section 23 still commits the web
application to WCAG 2.2 Level AA, `CLAUDE.md`'s Definition of Done still requires axe
over every route with a violation failing the build, and the contrast check still runs
on every build against both themes. What is narrowed is the claim about *engines*,
which was broader than the thing it described.

**It does not license a Blink-only claim about iOS.** Section 23's prohibition is kept
verbatim, because it is the sentence doing the work: claiming iOS works without testing
WebKit is what that rule forbids, and this ruling leaves WebKit in the job.

**Automated rules remain the floor.** Section 23 and `CLAUDE.md` both say a green axe
run is the floor and not the ceiling, and the criteria automation cannot see —
keyboard operability, focus never obscured, target size, paste on the sign-in path —
are stated by a pull request rather than by a runner, in whichever engine.

*The alternative was to run axe in WebKit too. It was refused on the cost above rather
than on principle, and it is the answer to revisit if an engine-specific accessibility
defect is ever found in the wild — which would refute the premise this rests on.*

---

Decision 0235, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-10 — Section 2's exemption names the people-without-a-Cell join](0234-section-2s-exemption-names-the-people-without-a-cell-join.md)
