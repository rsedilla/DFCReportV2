# 2026-10-13 — Sign in with a username or an email address

Owner ruling, 2026-10-13, chosen one question at a time, the screens from real screenshots. A
leader may sign in with a short username instead of typing their email address on a phone.

## The ruling

**1. An account may carry a username, and sign-in takes the username or the email address,
with the password** (owner, Q1). Everything else about signing in is unchanged: the second
step of `ADMIN` and `SENIOR_PASTOR` accounts (decision 0302) and sign-in's single answer to
every failure. A request sending both or neither is refused as `VALIDATION_FAILED`, and a null
is an omitted key (decision 0199). Forgot password and every email the system sends
still use the address.

**2. Activation asks for a username beside the password,** filled with a suggestion the holder
may change (owner, Q1). The API accepts an activation without one, so a client that predates
this ruling still activates (Section 22). An activation refused for its username sets no
password and leaves the link usable. The suggestion is read with a live activation token and
does not use it up; a token activation would refuse, or a disabled account, is answered as
activation answers it.

**3. An account that already exists may set one, optionally, on its Account page** (owner, Q2),
filled with the suggestion. Nobody is interrupted and nobody is required to have one. The holder
may change it there later, and the old name is free at once. Changing it asks for no password
and ends no session.

**4. The suggestion is the first letter of the first name, the first letter of the middle name
where there is one, and the surname**: lowercase, marks removed (`ñ` is `n`), spaces, hyphens and
apostrophes dropped, and a trailing `Jr`, `Sr`, `II`, `III` or `IV` left out. Raymond Bautista
Sedilla is `rbsedilla`; Juan Santos Dela Cruz `jsdelacruz`. A first name of two words gives its
first letter only, a letter that has no plain form (`æ`, `ø`, `ß`) is dropped, and a name with no
letter a to z to start from starts `user`. **Where it is taken, the next free name is suggested
by adding 2, then 3** (owner, Q3), and the screen says so. A suggestion shorter than three
characters takes a number too, and one longer than 30 is cut to make room for it. A username
stays as it is when the person's name is later edited.

**5. A username is lowercase letters and numbers, 3 to 30 characters, starting with a letter**,
so it never contains `@` and is never mistaken for an address. Capitals are ignored: it is stored
lowercase and compared lowercase. Two accounts never share one, and the database enforces both the shape and that. A
name typed that is taken, or malformed, is refused as `VALIDATION_FAILED`, naming the field. No
name is reserved.

**A taken name shows that an account exists, and that is accepted** (owner, Q4). A username is
built from a name, and names are church-wide (Section 8), so trying one tells whoever tries
whether that person holds an account. Only somebody signed in, or holding their own activation
link, can try, and sign-in and forgot password still never tell. **Setting one's own username
and reading its suggestion are each limited to ten a minute for each account** (owner, Q7), so
that trying names in bulk is slow; at activation, as activation itself is, to ten a minute from
each address.

**A disabled account keeps its username** (owner, Q6), whether an Admin disabled it or its Person
was archived or merged, and it works again if the account is re-enabled. Nobody else can take it
in the meantime, so one name never stands for two people, in the audit log or anywhere else. Only
the holder frees a name, by changing it.

**6. Setting or changing a username is audit logged** (Section 21), as
`account.username_set`, with the old and the new name.

**7. An Admin sees a person's username on their page** (decision 0276), to help somebody who has
forgotten it, and cannot set or change it. Only the holder sets their own.

**8. The routes.** `POST /api/v1/auth/login` takes `username` in place of `email`, one or the
other. `POST /api/v1/auth/activate` takes an optional `username`, and
`POST /api/v1/auth/activate/username-suggestion` answers the suggestion for an activation token,
which is its credential, so it joins activation on Section 7's unauthenticated list.
`GET /api/v1/auth/username-suggestion` and `POST /api/v1/auth/username` act on the caller's own
account, and **Section 7's exemption for the caller's own session names them** (owner, Q5): no
capability guards them. Both suggestion routes read which names other accounts hold, and no
more, which point 4 accepts. `POST /api/v1/auth/username` carries an `Idempotency-Key` like any
signed-in write (Section 22). `GET /api/v1/auth/me` and the person page's account read carry
`username`.

**9. What the build's tests must show**, at the API: sign-in with the username, in any capitals,
and with the email; one answer for a wrong username and a wrong password; both or neither
refused; the second step still asked of an Admin signing in by username; activation with and
without a username, and one refused for a taken name leaving its link usable; the suggestion,
including a taken one moving to 2 and a name with a middle name, a suffix and marks; a taken or
malformed name refused; a change freeing the old name; a disabled account keeping its name; the
audit entry; and that the shape and one name per account hold as database constraints.

## Why

Leaders sign in on phones, and an email address is long to type. A username derived from the
name is short and easy to remember. Usernames built from names are easier to guess than an
address, which the second step for the accounts that read the whole church and the unchanged
password rules answer; the owner accepted that, and that a taken name
shows an account exists. Email stays, because activation and resetting a password reach the
holder through it.

## What this amends

Sections 6, 7 (the unauthenticated list, the exemption for the caller's own session, and what
neither exemption covers), 21 and 22.

Decision 0337, indexed in [CLAUDE.md](../../CLAUDE.md).

Previous: [2026-10-13 — Pending DCC Reports](0336-pending-dcc-reports.md)
