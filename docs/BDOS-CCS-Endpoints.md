# Request to the BDOS team — storage endpoints for the Consultant Claim System

The Consultant Claim System (CCS) signs its two users in against the BDOS auth API and now needs
somewhere durable to keep their work. CCS is a static browser app: it has no server of its own and
cannot hold a database credential, so it is asking BDOS to own the storage and expose it over the
same authenticated HTTPS API the sign-in already uses.

This document specifies the six endpoints CCS needs, the table shapes behind them, and the access
rule that has to be enforced server-side. It follows the conventions already set by the *BDOS
Authentication API Integration Guide*: `Bearer` tokens, JSON bodies, `{ "detail": "…" }` on error.

- **Base URL** — `https://bdos.uzmadigitalearth.app`
- **Auth** — every endpoint below requires `Authorization: Bearer <token>`; none are public
- **Namespace** — everything is under `/ccs/` so it cannot collide with existing BDOS routes
- **Target database** — the `cradle` PostgreSQL database (credentials supplied separately,
  out of band — they are deliberately not written down in this repository, which is public)

---

## 1 · The access rule (please enforce here)

CCS is used by exactly two accounts:

```
adlishah0821@gmail.com
hanis.rashidan@uzmagroup.com
```

The browser app already checks this list, **but that check cannot be trusted** — it is JavaScript
the user's own browser runs, and anybody can edit it. It is there to explain the door, not to lock
it. Please apply the same allow-list server-side on every `/ccs/*` route and return `403` for any
other valid BDOS token. That is the only place the rule actually holds.

If a third person is ever added, the list changes in both places: here, and in
`assets/js/auth.js` in the CCS repository.

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
| **Profiles** | shared between the two accounts | A consultant's details are reference data both people work from |
| **Claims history** | shared between the two accounts | The point is that both can see what has been submitted |
| **Draft** | private to each `uid` | It is the half-finished form on somebody's screen, not a record |

The token's `uid` claim identifies the caller; please take it from the verified token rather than
from anything in the request body.

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

One row per user, overwritten as they type. CCS sends it at most once every few seconds, not on
every keystroke.

```
GET /ccs/draft     → { "draft": { "data": {…}, "updated_at": "…" } }  or  { "draft": null }
PUT /ccs/draft     → { "ok": true, "updated_at": "…" }
```

**`PUT /ccs/draft`** body: `{ "data": { … } }`

`GET` must return `{ "draft": null }` (200, not 404) when the user has never saved one — CCS reads
a null draft as "nothing to restore" and keeps what is in the browser.

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

---

## 4 · Suggested schema for `cradle`

Written as it would be applied. Adjust naming to match BDOS house style — CCS depends on the JSON
above, not on these column names.

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

-- Private: one in-progress form per user.
CREATE TABLE ccs.drafts (
  uid         text        PRIMARY KEY,
  data        jsonb       NOT NULL,
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
