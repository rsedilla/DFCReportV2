# 2026-08-28 — Two engines, and the width argument gets something that can fail


The accessibility suite scanned five widths in **one** engine, and both halves of
that were weaker than they read.

**Blink and WebKit; not Gecko.** iOS permits no engine but WebKit, so Chrome on an
iPhone is WebKit and a Chromium-only suite says nothing about any iPhone — which
is roughly half the device list this application is sized for. Edge needs no
project of its own, being Chromium. Firefox is refused rather than forgotten: no
phone or tablet in use here runs Gecko, so it would buy a desktop-only check at
the price of the one that covers every iPhone.

**WebKit runs two widths rather than five.** The narrowest, where overflow is
hardest, and the widest at which anything changes. A second engine over all five
roughly doubles a job whose own comment says it must stay fast enough that nobody
is tempted to skip it; as built, both engines together finish in under a minute.
The accepted cost is an engine difference appearing at neither end, which is
possible and is stated here rather than discovered later.

The tag lives on the viewport list rather than as a title match in the config,
because a `grep` against describe titles runs **nothing** when somebody rewords
one, and a browser project that quietly scans zero pages reports the same green as
one that scanned everything. A test carrying the tag asserts that the tagged set
holds the narrowest and the widest width, so that state is red rather than silent.

**And the five-width argument was a comment.** §23's coverage rests on one
sentence — that 1024 is the last width at which anything can break, so every
laptop, desktop and 4K panel is covered by that scan rather than by one of its
own. It is true only while no breakpoint above `sm` exists. One `lg:grid-cols-3`
turns the widest scanned width into the *narrowest* width of a layout nothing
scans, and every desktop leaves coverage with no test going red.
`web/scripts/check-breakpoints.mjs` now fails `npm run lint` on any `md:`, `lg:`,
`xl:`, `2xl:` or container-query prefix. Adding one stays permitted; adding one
*silently* does not.

**Turning WebKit on failed sixteen scans immediately, and the defect was in the
harness rather than the UI.** `NEXT_PUBLIC_API_URL` pointed at port 9 — the
discard protocol, on the browsers' blocked-port list. WebKit enforces that
*before* route interception can see the request, so the mock never fired and every
scan needing a signed-in session rendered the signed-out page; Chromium intercepts
earlier and the same configuration worked there. The comment above it said "never
reached: every request is intercepted before it leaves the page", which was true
of the engine it was written against.

That is this project's recurring fault in its cheapest form, and it is the
argument for the second engine restated: a claim about a mechanism, verified
against the part of it being looked at. Nothing about the screens was wrong.

---

Decision 0130, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-28 — Membership and order disclose as loudly as fields did](0129-membership-and-order-disclose-as-loudly-as-fields-did.md) | Next: [2026-08-28 — A pastoral path says which end is a root](0131-a-pastoral-path-says-which-end-is-a-root.md)
