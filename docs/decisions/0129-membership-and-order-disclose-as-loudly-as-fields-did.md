# 2026-08-28 — Membership and order disclose as loudly as fields did


The fourth door into one oracle, and the first three were each closed by a ruling
of their own: the reasons were withheld (2026-08-22), then the tier (2026-08-22),
then membership was scoped to what a publishable rule would have matched
(2026-08-23). This settles the two channels those left, and states the rule at a
level that covers the next one.

**A filter that narrows the candidate list is a membership decision, and is taken
on the match the viewer is entitled to** — the full match in scope, the publishable
one otherwise. The creation refusal narrows to the candidates it is refusing on,
which is a filter on the tier; it was applied to the match scored against the
*full* subject, so an out-of-scope candidate appeared in the refusal payload
exactly when their birthday equalled the one submitted. Every Tier 1 rule reads a
birthday or a mobile number, which is what makes that filter a protected field
wearing a different name.

It follows that no publishable match is ever Tier 1, so an out-of-scope candidate
never appears in a refusal at all. **That is a new rule and not the 2026-08-23 one
restated**, and getting this wrong twice in writing is what made it worth saying:
the *gate* has always been in-scope-only, because the creation path pairs its tier
test with `canSeeReasons`, and the 2026-08-23 ruling is argued entirely on the
status varying between 409 and 201. What leaked was the payload of a refusal that
had already fired correctly.

**The predicate is handed the tier and the identifier and nothing else.** A `Match`
carries the whole candidate — the publishable run strips the protected fields from
the *subject*, never from the candidate — so a predicate taking one could read a
birthday directly, with nothing to fail on it. The narrowed parameter makes the
one mistake available at that call site a compile error, which is the standard §2
sets for the capability guard and §22 for `completeWithin`'s transaction argument.

**Withheld candidates are ordered by full name, then Member ID.** Position is the
same disclosure as the tier: the matcher returns strongest first, so a withheld
candidate sitting above one whose tier *is* shown reads its withheld tier back,
and with an equal name a tier is the birthday.

**The tie-break is the rule, not a detail of it**, and the first implementation did
not have one — which reopened the channel exactly where it is most reachable. A
withheld candidate is one a publishable rule matched, and that needs an equal
first *and* last name, so withheld candidates already share a name by
construction; two with no middle name share all of it, and a comparator returning
zero there leaves sort stability to restore tier order. Suffix stripping is a
second generator nobody would guess at: `Pedro Cruz Jr` and `Pedro Cruz Sr` are
distinct published names that collide on the key. Member ID is total, encodes
nothing (§3), and is already among the five fields §8 publishes out of scope, so
it costs no disclosure to break a tie with.

The name is compared in §3's normalized form rather than by the host's collation,
because `localeCompare` with no locale resolves against the runtime's default and
§22 makes this ordering client-visible on an API that is additive-only. And the
sort key is composed by the same function that composes the `full_name` the viewer
is shown, because the argument for ordering on the name rests on their being the
same string.

**What is worth carrying forward is the pattern rather than the rule.** Each of the
four was found only after the one before it was closed, and every time by
reasoning about what the response *contained* rather than what the response was a
*function of*. §3 now says so in terms, and asks that any new decision the list is
subjected to — a narrowing, a sort, a page boundary, a count — be treated as a
disclosure until it is shown to be a function of what the viewer may already know.
The one page boundary that exists is `limit`, and nothing has shown it; it is
listed as open below rather than settled here.

Three `architecture-guardian` passes, and the shape of what they found is itself
the argument for the last paragraph: the first found the mechanism sound and the
ordering half still open at a tie; the second and third found nothing further
wrong with the mechanism and eleven other things, of which nine were statements
false of the code or of the specification, one was a miscount, and one was this
ruling's own absence. Written to `SKILL.md`
§3, and verified by grep rather than asserted.

---

Decision 0129 of 155, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-08-27 — A re-presentation whose replacement was never used is a retry](0128-a-re-presentation-whose-replacement-was-never-used-is-a.md) | Next: [2026-08-28 — Two engines, and the width argument gets something that can fail](0130-two-engines-and-the-width-argument-gets-something-that-can.md)
