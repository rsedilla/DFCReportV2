# 2026-11-02 — The website is the phone app

Since it was first written, the specification planned Android and iOS apps beside the web
application, and several rules were shaped for them: a frozen API version for builds that
cannot be updated, a third client surface, and an accessibility obligation left open until
their framework was chosen. On 2026-11-01 the owner decided there will be no App Store or
Play Store app.

## The ruling

**1. No Android or iOS app is built.** DREAMS is not published to the App Store or the Play
Store.

**2. The web application is the phone app.** On a phone a leader adds it to the home screen,
where it opens full screen with the DREAMS icon. It keeps no offline copy of itself, so it
opens the version on the server every time. There are two client surfaces, desktop web and
mobile web, both this one application.

**3. `/api/v1` may be narrowed where the web application ships the matching change in the
same deployment**: a field removed or renamed, a type narrowed, or a value's meaning changed.
No `/api/v2` is needed while the web application is the only client. Decision 0328 allowed
this until a native client was released; with none planned it is the standing rule. A tab or phone app left open on the previous page is refused
until it reloads, the cost decision 0328 already accepted.

**4. WCAG 2.2 AA on the web application covers the phone.** The separate obligation for
native clients, which Section 23 left open, no longer has a client to bind.

**5. The API stays separate and holds every rule.** The web application keeps no API routes
and no business logic, as Section 2 requires, and the API and the web application are still
deployed apart.

A native client would need the API version to stay unchanged while an installed build calls
it, because a store release cannot be forced on anyone. Adding one is a new ruling that
restores that rule before its first release.

**6. Working offline, which Section 23 keeps possible, also takes a ruling first** (owner,
2026-11-02). It would keep a copy of the application on the phone, which ends point 3 exactly
as a native client would. Attendance marks kept on the device (decision 0345) are data, not a
copy of the application.

## Why

One application on every device is one thing to build, test and deploy, and an update
reaches every leader the moment it is deployed, with no store review in between. The owner
weighed that against a store app's presence on a phone and chose the website.

## What it closes

Two items open in `CLAUDE.md` since the specification was written: which framework the
native clients use, and what they owe on accessibility.

---

Decision 0424, indexed in [CLAUDE.md](../../CLAUDE.md) and amended into [SKILL.md](../../SKILL.md)
Sections 2, 6, 8, 22 and 23 and its closing rules, the README and the roadmap.

Previous: [2026-11-02 — One softer look on every screen](0423-one-softer-look.md)
