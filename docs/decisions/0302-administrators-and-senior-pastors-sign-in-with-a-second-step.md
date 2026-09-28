# 2026-09-28 — Administrators and Senior Pastors sign in with a second step

Section 6 said "Do not require 2-step verification/MFA in V1." An `ADMIN` or
`SENIOR_PASTOR` account reads the whole church, minors' records included, so one leaked or
phished password opened every record. The owner reversed that line on 2026-09-28, choosing
an authenticator-app code over an emailed one, and approved the points below.

## The ruling

**1. An account holding `ADMIN` or `SENIOR_PASTOR` must pass a second step to sign in:** a
six-digit code from an authenticator app (TOTP, RFC 6238). `LEADER` accounts sign in with a
password alone, as before.

**2. The code is asked at password sign-in and nowhere else.** Refreshing a session asks for
nothing, so a signed-in device keeps its usual 30 days. A password reset or an activation
does not pass the step: the next sign-in still asks for the code.

**3. An account that owes the step and has not set it up is walked through setup at sign-in**
(scan a QR code, confirm one code) and receives no session until it has. When this ruling
takes effect, every existing session of those accounts is ended.

**4. Recovery.** Setup issues ten single-use recovery codes, each accepted once in place of a
code. An administrator holding `accounts.manage` may reset a Senior Pastor's second step from
the person page. An administrator's own second step is reset only by a command run on the
server, never through the product, so no administrator can remove another's. A reset ends
the account's sessions, and the next sign-in sets the step up again.

**5. A code is accepted once, and guessing is bounded.** A code already used is refused, a
sign-in that has passed the password allows five wrong codes before it must start again, and
Section 24's authentication rate limiting applies to both steps.

**6. It binds every client.** The step is part of sign-in at the API, so the Android and iOS
apps meet it as the web does; setup there offers the key as text beside the QR code.

**7. The authenticator secret is stored encrypted** (AES-256-GCM), under a key held in the
environment and never in the database or the repository. The server must read it back, so
it cannot be hashed; a copy of the database or a backup yields no usable secret. The API
refuses to start without the key.

**8. The step is a stated exception to criterion 3.3.8.** The code field accepts paste and
autofill, so an authenticator on the same device fills it. Typed from another device it is a
transcription task, which Section 6 otherwise forbids at sign-in. `architecture-guardian`
found the conflict, and the owner accepted it for these accounts alone rather than add a
passkey or drop the step.

## Why

A second factor that is not the mailbox is the only option considered that still
protects when the password and the inbox are both taken, and the password reset already runs
through the inbox. It is tied to the `ADMIN` and `SENIOR_PASTOR` roles, so no `LEADER`
account's sign-in changes.

---

Decision 0302, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-09-28 — The branch view lists DCC too](0301-the-branch-view-lists-dcc-too.md)
