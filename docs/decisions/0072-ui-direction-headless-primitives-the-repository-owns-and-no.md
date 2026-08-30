# 2026-08-21 — UI direction: headless primitives the repository owns, and no design-system framework

Settled in `SKILL.md` §2 (Chosen stack). The firm half and the expected half are separated below, because only one of them is a ruling.

**Firm — the rule.** In the web application, components are headless primitives, vendored into the repository rather than arriving as a dependency with a look attached, and **no component framework carrying its own design system is used**: MUI, Ant Design, Chakra, Mantine and Bootstrap are refused. It says nothing about the native clients, whose framework is not chosen.

The ordinary objection is that each brings a second styling engine to fight Tailwind. The objection that makes it a rule is that they express state as `error`, `success`, `warning` and `severity` and hand that vocabulary to every developer as the default, which makes the prohibited use the easy one. §13 forbids value-laden encoding of meeting status; §17 forbids leaders being colour-coded by `NOT_HELD`, coverage, or any figure derived from them; §19 forbids a dashboard colour-grading leaders. `NOT_HELD` exists to obtain honest reporting, and a framework whose idiom paints that row red produces a month of `HELD` instead. Colour itself is not forbidden and is not a ranking — the palette uses it for structure and legibility, which is the distinction the rule turns on.

**Firm — the current implementation.** Radix, vendored through `shadcn/ui`. The rule is what is settled and what `SKILL.md` §2 carries; the vendor is how it is met today and may be replaced by anything satisfying it, without amending the specification.

**Checked, not remembered.** `web/scripts/check-ui-dependencies.mjs` fails `npm run lint` if a refused package appears in `web/package.json`, and `web/scripts/check-contrast.mjs` refuses a palette token named `success`, `danger` or `warning` — the rule now written into `SKILL.md` §23, since a gate in CI may not depend on a rule that exists only here. Both sit beside the check that holds the pure-client boundary. The rule's own argument is that a framework's defaults get applied by whoever writes the newest screen, which is an argument that review will not catch it, and the same is true of a colour named for a verdict.

The dependency list is illustrative of the rule, never a definition of it: a package absent from it is not thereby approved. It names no headless package, including headless packages published by the refused projects, because those are what the rule prescribes.

**Expected, and confirmed against a real screen rather than now.** TanStack Query for server state, since cursor pagination, retry and cache invalidation are where `VERSION_CONFLICT` and `Idempotency-Key` retries actually get handled (§14, §22, §23). TanStack Table, headless, for rosters and attendance grids — §22 fixes the sort and filter contract as named query parameters and forbids ordering leaders against one another, so the table's job is column definition and virtualization rather than inventing its own query language. A chart library with no built-in colour semantics. `lucide-react` and `next/font`.

**Nothing is installed yet, deliberately.** Stage 1 has no screens, and generating a component library before there is anything to build with it is scaffolding for nothing. The direction is recorded so it is not re-litigated; the first install happens with the first real screen in Stage 2.

Recorded also because elegance in this application is mostly not a dependency. One typographic scale, consistent spacing, restraint with colour, and real empty and loading states decide how it feels, and the two screens that will decide it — the arbitrary-depth pastoral tree (§5) and the attendance grid (§13) — are not solved by any library.

---

Decision 0072 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-21 — Tailwind CSS, chosen while there is one page to convert](0071-tailwind-css-chosen-while-there-is-one-page-to-convert.md) | Next: [2026-08-21 — WCAG 2.2 Level AA, with something that can fail](0073-wcag-2-2-level-aa-with-something-that-can-fail.md)
