# Storage endpoints for the Consultant Claim System

> **Status — implemented.** These routes live in the BDOS repository
> (`Uzma-Geospatial-AI/bdos`, `backend/app.py`, the *Consultant Claim System storage* section),
> with `backend/test_ccs.py` covering them. This document is now the contract between the two
> repositories rather than a request: change one side and this page says what the other expects.

The Consultant Claim System (CCS) signs its users in against the BDOS auth API and needs somewhere
durable to keep their work. CCS is a static browser app: it has no server of its own and cannot
hold a database credential, so BDOS owns the storage and exposes it over the same authenticated
HTTPS API the sign-in already uses.

This document specifies the six endpoints, the table shapes behind them, and the access rule that
is enforced server-side. It follows the conventions already set by the *BDOS Authentication API
Integration Guide*: `Bearer` tokens, JSON bodies, `{ "detail": "…" }` on error.

- **Base URL** — `https://bdos.uzmadigitalearth.app`
- **Auth** — every endpoint below requires `Authorization: Bearer <token>`; none are public
- **Namespace** — everything is under `/ccs/` so it cannot collide with existing BDOS routes
- **Target database** — the `cradle` PostgreSQL database (credentials supplied separately,
  out of band — they are deliberately not written down in this repository, which is public)

---

## 1 · The access rule (please enforce here)

CCS is used by exactly five accounts, and each has one part in a claim:

| Account | Role | What they do |
|---|---|---|
| `adlishah0821@gmail.com` | `consultant` | Prepares a claim and submits it |
| `nuramilazulfa@gmail.com` | `consultant` | Prepares a claim and submits it |
| `hanis.rashidan@uzmagroup.com` | `manager` | Reviews it first, and signs the REVIEWED BY box |
| `fadhli.jamaluddin@uzmagroup.com` | `boss` | Approves it second — the HOD |
| `fatin.zaini@uzmagroup.com` | `pa` | Places the HOD's signature in the APPROVED BY box |

BDOS reads the list from the `CCS_ROLES` environment variable — `email:role` pairs, comma
separated — and falls back to the table above, so adding somebody or moving them to another role
is an environment change and a restart, not a code edit.

The browser app already checks this list, **but that check cannot be trusted** — it is JavaScript
the user's own browser runs, and anybody can edit it. It is there to explain the door, not to lock
it. Please apply the same allow-list server-side on every `/ccs/*` route and return `403` for any
other valid BDOS token. That is the only place the rule actually holds.

The list also lives in `assets/js/auth.js` in the CCS repository, where it decides what the sign-in
page says. When somebody is added or removed, both change — but only this one is a lock. Being a
BDOS admin does not grant access here: these rows carry an IC number and a bank account, so the
list is the list.

| Situation | Expected response |
|---|---|
| No token, bad token, expired token | `401` — CCS clears the session and asks for a password |
| Valid BDOS token, not on the list above | `403` — CCS shows "not on the list for this app" |
| Valid token, on the list | `200` |

---

## 2 · What is shared, and what is private

This matters for the `WHERE` clauses, so it is worth stating plainly:

| Data | Visibility | Why |
|---|---|---|
| **Profiles** | shared | A consultant's details are reference data all three work from |
| **Claims history** | shared | The point is that everyone can see what has been submitted |
| **Draft** | shared — one row | The three of them work on one claim at a time, and picking it up on another machine is the reason this storage exists |

Everything is one set of rows: whoever signs in, on whichever machine, sees the same work. Nothing
is keyed by `uid`. The caller's email is still recorded on every write — `updated_by` on a profile
and the draft, `created_by` on a claim — so it is always visible who last touched something.

The one thing this costs: two people editing at the same moment overwrite each other, last write
wins. CCS pushes the draft at most once every five seconds and asks before replacing a form on
screen with a newer one from the database, which is enough for three people who are not filling in
the same claim simultaneously. If that ever stops being true, keying the draft by `uid` is a
`WHERE` clause.

---

## 3 · Endpoints

### Profiles

A profile is a saved set of consultant details, keyed by its name. Saving under an existing name
overwrites it — that is what CCS's **Save Profile** button already does locally.

```
GET    /ccs/profiles              → { "profiles": [ Profile, … ] }
POST   /ccs/profiles              → { "profile": Profile }
DELETE /ccs/profiles/{id}         → { "ok": true }
```

**`POST /ccs/profiles`** — upsert by `name`:

```json
{
  "name": "Ahmad bin Abdullah",
  "data": { "consultant": { "...": "..." }, "company": { "...": "..." } }
}
```

**`Profile`** as returned:

```json
{
  "id": 12,
  "name": "Ahmad bin Abdullah",
  "data": { "...": "the CCS state object, verbatim" },
  "updated_by": "adlishah0821@gmail.com",
  "updated_at": "2026-09-09T02:11:04Z"
}
```

`data` is opaque to BDOS — CCS owns its shape and will change it over time. Storing it as `jsonb`
and handing it back unaltered is all that is needed.

Errors: `400` if `name` is empty or `data` is not an object · `404` on delete of an unknown id.

### Draft — the form currently open

One row, shared, overwritten as anybody types. CCS sends it at most once every few seconds, not on
every keystroke.

```
GET /ccs/draft     → { "draft": { "data": {…}, "updated_at": "…" } }  or  { "draft": null }
PUT /ccs/draft     → { "ok": true, "updated_at": "…" }
```

**`PUT /ccs/draft`** body: `{ "data": { … } }`

`GET` must return `{ "draft": null }` (200, not 404) when nothing has been saved yet — CCS reads a
null draft as "nothing to restore" and keeps what is in the browser. A 404 reads as "the endpoint
is missing" and switches syncing off for the session, which is the opposite of what an empty
database should do.

The draft also carries `updated_by`, the email of whoever last saved it, so the app can say whose
work it is about to load.

### Claims history

Written once, when the user generates their documents. Rows are not edited afterwards.

```
POST /ccs/claims          → { "claim": Claim }
GET  /ccs/claims?limit=&before=  → { "claims": [ Claim, … ] }
```

**`POST /ccs/claims`** body:

```json
{
  "consultant":   "Ahmad bin Abdullah",
  "period_month": 8,
  "period_year":  2026,
  "invoice_no":   "INV-2026-08-026",
  "amount":       903.23,
  "documents":    ["invoice.pdf", "invoice.xlsx", "claim.pdf", "claim.docx"],
  "data":         { "...": "the full CCS state at the moment of generation" }
}
```

**`Claim`** adds `id`, `created_by` (the caller's email, from the token) and `created_at`.

**`GET /ccs/claims`** returns newest first. `limit` defaults to 50, caps at 200; `before` is an
`id` for paging. CCS only ever shows a recent list, so cursor paging is enough — no total count
needed.

Errors: `400` on a missing `consultant` or a non-numeric `amount`.

### Submissions — a claim on its way through the approvals

A claim is prepared, reviewed, approved and then signed, in that order. The order is kept here:
the client may ask for any move, and only the account whose turn it is can make it.

```
POST /ccs/submissions              → { "submission": Submission }
GET  /ccs/submissions?status=&mine= → { "submissions": [ Submission, … ] }   (no `data`)
GET  /ccs/submissions/{id}         → { "submission": Submission }            (with `data`)
POST /ccs/submissions/{id}/action  → { "submission": { id, status, history, updated_at } }
GET  /ccs/me                       → { "email", "name", "role", "acts_on" }
```

| Status | Waiting on | Approving takes it to |
|---|---|---|
| `pending_manager` | `manager` | `pending_boss` |
| `pending_boss` | `boss` | `pending_signature` |
| `pending_signature` | `pa` | `complete` |
| `returned` | the consultant who sent it | `pending_manager`, by `resubmit` |

**`POST /ccs/submissions/{id}/action`** body: `{ "action": "approve" | "return" | "resubmit",
"note": "…", "data": { … } }`.

`data` is optional and is the whole form again — a step that signs sends the sheet back with the
signature in it, so BDOS never has to know where inside that object a signature lives. `note` is
required by CCS on a `return`, since it is the only thing the consultant is told.

Refusals are the point of this endpoint, so they are specific: `403` when the claim is waiting on
somebody else, `409` when it is not waiting on anybody (already finished, or already moved on by
whoever got there first), `404` when there is no such claim. The row is locked `FOR UPDATE` for
the length of a decision, so two approvers pressing at the same moment cannot both move it.

`history` is every move anybody made — `{ at, by, role, action, note, from, to }` — appended and
never rewritten. It is what makes an approval something you can point at afterwards.

Everyone can read every claim: five people working one process, and an approver who cannot see
what they approved last month is not much use. `mine=1` narrows to the claims this account sent;
`status=open` to everything unfinished.

---

## 4 · Suggested schema for `cradle`

Written as it would be applied. BDOS keeps to its own house style instead — flat `ccs_*` tables
that self-create on boot, `TEXT` ids from its own id generator, and epoch-millisecond `BIGINT`
timestamps rendered as the ISO strings below on the way out. CCS depends on the JSON above, not on
these column names.

```sql
CREATE SCHEMA IF NOT EXISTS ccs;

-- Shared: saved consultant details.
CREATE TABLE ccs.profiles (
  id          bigserial PRIMARY KEY,
  name        text        NOT NULL UNIQUE,
  data        jsonb       NOT NULL,
  created_by  text        NOT NULL,
  updated_by  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Shared: the one in-progress form.
CREATE TABLE ccs.drafts (
  id          text        PRIMARY KEY,   -- always 'shared'
  data        jsonb       NOT NULL,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Shared: what has actually been generated.
CREATE TABLE ccs.claims (
  id            bigserial   PRIMARY KEY,
  uid           text        NOT NULL,
  created_by    text        NOT NULL,
  consultant    text        NOT NULL,
  period_month  smallint    CHECK (period_month BETWEEN 1 AND 12),
  period_year   smallint,
  invoice_no    text,
  amount        numeric(12,2),
  documents     text[]      NOT NULL DEFAULT '{}',
  data          jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON ccs.claims (created_at DESC);
CREATE INDEX ON ccs.claims (period_year DESC, period_month DESC);

-- Shared: claims travelling through the approvals.
CREATE TABLE ccs.submissions (
  id            text        PRIMARY KEY,
  consultant    text        NOT NULL,
  period_month  smallint,
  period_year   smallint,
  invoice_no    text,
  status        text        NOT NULL,   -- pending_manager | pending_boss |
                                        -- pending_signature | returned | complete
  data          jsonb       NOT NULL,   -- the form, signatures and all
  history       jsonb       NOT NULL DEFAULT '[]',
  created_by    text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON ccs.submissions (status);
```

A note on what lands in `data`: it is the consultant's own name, address, IC number and bank
account, because those are what the invoice prints. The `cradle` rows are therefore personal data
and should sit behind the same handling as the rest of BDOS — this is exactly why CCS is asking
BDOS to hold them rather than trying to hold them itself.

---

## 5 · CORS

CCS is served from GitHub Pages, so the browser sends a cross-origin request:

```
Origin: https://kymy07.github.io
```

The existing auth routes already answer with `access-control-allow-origin: *` and allow the
`authorization` and `content-type` headers, which is exactly what is needed. Please make sure the
`/ccs/*` routes inherit the same CORS handling, including the `OPTIONS` preflight — a missing
preflight response fails silently in the browser with no error message worth reading.

---

## 6 · Until these exist

CCS ships with the client half already written. On sign-in it calls `GET /ccs/draft` once; a `404`
or a network failure simply turns syncing off for that session and the app carries on saving to
the browser's own `localStorage`, exactly as it does today. So these endpoints can appear whenever
it suits BDOS — nothing breaks in the meantime, and nothing needs redeploying on the CCS side when
they do.
