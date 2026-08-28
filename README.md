<div align="center">

# Consultant Claim System

**Invoice Timesheet &amp; Personnel Time Sheet generator · PDF · Excel · Word**
Fill the form once, tick the calendar, download all four documents.

[![CI](https://github.com/kymy07/ConsultantClaimSystem/actions/workflows/ci.yml/badge.svg)](https://github.com/kymy07/ConsultantClaimSystem/actions/workflows/ci.yml)
[![Build](https://img.shields.io/badge/Build-none%20required-1F3864?style=for-the-badge)]()
[![Offline](https://img.shields.io/badge/Runs-fully%20offline-F26522?style=for-the-badge)]()
[![Dependencies](https://img.shields.io/badge/npm%20install-not%20needed-2F5597?style=for-the-badge&logo=npm&logoColor=white)]()

<img src="assets/img/preview.png" alt="The invoice step — a fillable copy of the invoice itself" width="100%">

</div>

---

## Overview

A static web app for consultants who invoice monthly. Enter your details once, tick the days
you worked on a calendar grid, and the app generates the two documents finance asks for — in
four file formats — straight from the browser.

No server, no build step, no `npm install`, no internet connection. Every library is vendored
into `vendor/`, so the whole thing runs from a single folder on any machine.

---

## Documents Generated

| # | Document | Formats | Output file name |
|---|---|---|---|
| 1 | **Invoice Timesheet** | PDF · Excel | `INV-2026-08-026 - Name.pdf` / `.xlsx` |
| 2 | **Claim** — Uzma Personnel Time Sheet | PDF · Word | `Claim Aug 2026 - Name.pdf` / `.docx` |

Both PDFs are laid out to match the official templates: the invoice in portrait with the navy
header band, the time sheet in landscape with Sections A, B and C, the notes block and the
Uzma footer.

---

## The Flow

```
Step 1  Your details ──▶ Step 2  Pick a document ──┬─▶ A    Invoice ───────────────┐
                                                   ├─▶ B    Claim Form ────────────┤──▶ Generate
                                                   └─▶ A+B  Invoice + Claim Form ──┘
```

| Choice | Steps you see | You get |
|---|---|---|
| **A** Invoice Timesheet | Invoice · Generate | PDF + Excel |
| **B** Claim Form | Claim Form · Generate | PDF + Word |
| **A + B** Both | Invoice · Claim Form · Generate | PDF + Excel + Word |

Step 3 onwards is not a form *about* the document — it **is** the document. The invoice step
draws the invoice with its navy band, BILL TO bar, item table and totals; the Claim step draws
the Uzma time sheet with Section A, the 31-column Section B grid and the Section C approval
block. Every entry sits exactly where it will print, and every empty box carries a hint of what
belongs in it, so nobody has to guess what goes where.

<img src="assets/img/preview-choose.png" alt="Step 2 — choosing which document to produce" width="100%">

Your details from step 1 appear inside both documents and stay in sync: edit the name on the
invoice and step 1 updates too. You cannot leave step 1 without a name or step 2 without a
choice; everything after that is optional, and the stepper stays clickable so you can change
your mind at any time.

Because the invoice period decides its own month, choosing **A** alone never asks you to touch
the timesheet. Choose **A + B** and setting the period pulls the timesheet to the same month —
unless you have already ticked days, in which case your ticks win.

<img src="assets/img/preview-claim.png" alt="The Claim step — the Uzma Personnel Time Sheet, fillable" width="100%">

---

## Features

| | |
|---|---|
| 🧭 **Guided, branching flow** | Fill your details once, then pick **A** (Invoice), **B** (Claim) or **both** — the remaining steps rearrange so you only ever see the document you asked for |
| 📄 **You fill the real document** | Steps 3 and 4 are pixel-shaped copies of the invoice and the Uzma time sheet, so every value is typed exactly where it prints |
| 💡 **A hint in every box** | Each blank carries an example of what belongs in it, and optional fields say so outright |
| 📅 **Tickable day grid** | Section B is the real 31-column table — click a cell to cycle `blank → / → PH`; Saturdays and Sundays label themselves from the calendar |
| 🧮 **Three ways to price a period** | Monthly rate prorated by calendar days, daily rate × days ticked, or a fixed amount you type yourself — the live formula shows its working |
| ✍️ **Sign in the signature box** | The three pads (Personnel, HOD, Verified By) sit inside Section C where the pen would go; blank space around the stroke is trimmed before it is embedded |
| 🖋️ **Approval block starts filled** | Section C opens with the usual names and today's date already in place — every one is a normal field, so type over it when somebody else signs |
| 🏷️ **Official artwork, placed to the millimetre** | The Uzma wordmark ships with the app and is positioned from proportions measured off the printed form, not eyeballed |
| 🗂️ **Multiple activity rows** | Eight rows like the original form, each with its own Job ID, allocated days and past claim |
| 📊 **Totals that add up** | `TOTAL DAYS [A]`, `ALLOCATED [B]`, `PAST CLAIM [C]` and `BALANCE [B-(A+C)]` are computed per row and in aggregate |
| 💾 **Autosave + profiles** | Everything persists to `localStorage`; save one profile per consultant and switch between them |
| 📤 **Export / Import JSON** | Real backups you can move between machines — the only way data leaves the browser |
| 🧨 **Reset All** | Two-step confirmation, then every stored key is wiped and the app is empty again |
| 📱 **Responsive** | Collapses to a single column below 840px; the day grid wraps instead of scrolling |

---

## Tech Stack

**Frontend** — HTML5 · CSS3 (custom properties, grid, flexbox) · vanilla JavaScript (ES6+)
**PDF** — jsPDF 2.5.1 + jsPDF-AutoTable 3.8.2
**Excel** — ExcelJS 4.4.0
**Word** — docx 8.5.0
**Signatures** — signature_pad 4.1.7 · Canvas 2D
**Downloads** — FileSaver.js 2.0.5
**CI** — GitHub Actions (Node 20 · 22)

No bundler, no framework, no dependencies to audit at runtime.

---

## Project Structure

```
ConsultantClaimSystem/
├── index.html                    # the whole UI — the document replicas live here
├── assets/
│   ├── css/style.css             # design tokens + every component
│   ├── img/                      # logo-uzma.png + README screenshots
│   └── js/
│       ├── state.js              # data model, formulas, localStorage
│       ├── logo.js               # brand artwork loading + vector fallbacks
│       ├── timesheet.js          # Section B — the 31-column day grid
│       ├── signature.js          # in-form signature pads + image trimming
│       ├── gen-invoice.js        # Invoice → PDF (jsPDF) + Excel (ExcelJS)
│       ├── gen-claim.js          # Claim   → PDF (jsPDF) + Word (docx)
│       └── app.js                # step flow, profiles, generate buttons
├── test/generate.test.js         # generates all four docs and checks them
├── vendor/                       # pinned libraries, committed for offline use
└── .github/workflows/ci.yml      # lint + tests on Node 20 & 22
```

---

## Getting Started

```bash
git clone https://github.com/kymy07/ConsultantClaimSystem.git
cd ConsultantClaimSystem
```

Then just double-click `index.html`. That is the whole setup.

To serve it over HTTP instead:

```bash
python -m http.server 8000
```

Then open <http://127.0.0.1:8000/>.

> **Serving over HTTP matters when more than one person shares a computer.** Opened from
> `file://`, Chrome treats every local file as one origin, so two copies of this folder under
> the same Windows account share the same `localStorage`. Over HTTP each URL gets its own
> origin and the data stays separate.

---

## How the Amount Is Calculated

Pick a method on the **Invoice** step; the formula line updates as you type.

| Method | Formula |
|---|---|
| **Monthly rate** (default) | `monthly rate ÷ days in month × calendar days in period` |
| **Daily rate** | `daily rate × days ticked "/"` |
| **Fixed amount** | whatever you type in the item table |

Worked example, matching a real invoice:

```
RM 3,500.00 ÷ 31 days (August 2026) × 8 calendar days (24–31 Aug) = RM 903.23
```

While the method is not *Fixed amount*, the first item's amount is read-only so it can never
drift out of step with the formula. Switch to **Fixed amount** to type your own.

Long values wrap rather than collide: an address wider than its column continues on the next
line and pushes the block down, instead of running into the Period column beside it.

---

## Branding & Logos

The site header, the footer and the Claim PDF all read their artwork from `assets/img/`:

| File | Used by | Status |
|---|---|---|
| `logo-uzma.png` (or `.jpg` / `.svg`) | top-right of the Claim page, PDF and Word file | **ships with the app** |
| `logo-geospatial.png` (or `.jpg` / `.svg`) | site header + footer | drop yours in |

Drop a file in and it is picked up on the next reload — no code change. Where one is missing the
app falls back to a **typographic recreation** of that wordmark, so nothing renders blank. The
fallbacks are approximations; use the official artwork for anything you actually submit.

### Placing the Uzma mark

Supplied artwork carries its own padding — the Uzma PNG is a 270 × 92 canvas around a wordmark
that is only 228 × 41, and the margin is not symmetric. Sized by that canvas, the mark prints at
roughly half scale and sits off-centre. So `loadLogo()` crops the transparent margin before
handing the image on, and every caller measures the mark itself.

The header then places it from proportions taken off the printed time sheet rather than from
guesswork:

| | Reference form (Letter landscape) | This app (A4 landscape) |
|---|---|---|
| Mark width | 58.57 pt — **8.583 %** of the content width | 8.583 % |
| Right edge | **0.725 %** of that width inside the margin | 0.725 % |
| Vertical | a shade below the centre of the orange arrow | same |

Because both are fractions of the content width, the header lands in the same place on A4 as it
does on the original Letter-size form, and the PDF, the Word file and the on-screen Claim page
all size the mark identically.

Site colours come from the Geospatial AI wordmark and live as CSS custom properties in
`assets/css/style.css`:

```css
--navy:#2c3e50;   --navy-deep:#223140;   --orange:#f1662a;
```

The generated documents keep the colours of the official templates instead, so re-theming the
site never changes what finance receives.

---

## Data Storage

There is **no database and no server**. Everything lives in two `localStorage` keys:

| Key | Contents |
|---|---|
| `ccs.current` | the form currently open, autosaved every 250 ms |
| `ccs.profiles` | every profile saved via **Save Profile** |

Worth knowing:

- Data never leaves the browser on that computer.
- It is lost if you clear browsing data, switch browser or machine, or use a private window.
- The quota is roughly 5–10 MB; signatures (base64 PNG) take the most room. If the quota is
  exceeded the app raises a red warning instead of failing silently — export a JSON backup then.
- **Export JSON** is the only real backup. Use it before anything irreversible.

---

## Testing & CI

```bash
node test/generate.test.js
```

No `npm install`. The suite loads the application code into a Node VM behind a small browser
stub, generates all four documents, and asserts nine things — the invoice amount (RM 903.23),
`TOTAL DAYS [A]`, `BALANCE`, the automatic SAT/SUN labels, and the size plus magic bytes of
every generated file.

GitHub Actions runs it on every push across Node 20 and 22, alongside a JavaScript syntax
check, a vendored-library check, and a scan that fails the build if a real IC number or bank
account number ever lands in the repository.

---

## Editing Guide

<details>
<summary><b>Changing the theme</b></summary>

Every colour is a CSS custom property in the `:root` block at the top of `assets/css/style.css`:

```css
--navy:#1f3864;   --orange:#f26522;   --blue:#2e5c99;
--ink:#1b2330;    --muted:#6b7686;    --line:#dde3ec;
```

The PDF generators keep their own copies as RGB triples (`NAVY`, `BAR`, `LBL` in
`gen-invoice.js`), because jsPDF cannot read CSS. Change both if you re-brand.

</details>

<details>
<summary><b>Changing the Bill To company</b></summary>

The defaults live in `defaultState()` in `assets/js/state.js`:

```js
company: {
  name:  'Geospatial AI Sdn Bhd',
  regNo: '200901001789 (844716-P)',
  addr1: 'Uzma Tower, No 2, Jalan PJU 8/8A',
  addr2: 'Damansara Perdana, 47820 Petaling Jaya, Selangor'
}
```

Anything typed in the **Bill To** tab overrides them for the current form.

</details>

<details>
<summary><b>Adding a field to the form</b></summary>

Three places, in order:

1. `index.html` — add the `<label><input id="..."></label>`
2. `state.js` — add the key to `defaultState()` so it survives a reload
3. `app.js` — add `['element_id', 'section', 'key']` to the `FIELDS` array

`mergeDefaults()` backfills the new key for anyone with older saved data, so nothing breaks.

</details>

<details>
<summary><b>Changing who approves Section C</b></summary>

Section C opens pre-filled so the common case needs no typing. The starting values live in
`SIGN_DEFAULTS` at the top of `assets/js/app.js`, and `fillDefaultsForMonth()` applies them
**only to fields that are still empty** — so nothing you have already typed is ever overwritten:

```js
const SIGN_DEFAULTS = {
  hod:      '…',   // the approver whose name appears under APPROVED BY
  verified: ''     // Group People & Finance sign on paper, so this stays blank
};
```

`PREPARED BY` follows your name from step 1, and both dates default to today. All six are
ordinary fields on the Claim page: type over any of them when a different person signs.

</details>

<details>
<summary><b>Adjusting the Claim form layout</b></summary>

`gen-claim.js` draws the time sheet with an explicit `y` cursor in millimetres on A4 landscape
(297 × 210). The vertical budget is tight — Section A, the day table, Section C, the notes and
the footer all have to fit on one page. If you add a row, take the height from `secH` or the
signature row rather than pushing the footer down.

</details>

<details>
<summary><b>Updating a vendored library</b></summary>

Drop the new UMD build into `vendor/` under the same file name and run the tests. The CI job
checks each expected file exists and is non-empty, so a rename will fail the build loudly
rather than silently break a download button.

</details>

---

## Contact

[![Email](https://img.shields.io/badge/Email-adlishah0821%40gmail.com-F26522?style=flat-square&logo=gmail&logoColor=white)](mailto:adlishah0821@gmail.com)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-adlishah--hakimi-1F3864?style=flat-square&logo=linkedin)](https://www.linkedin.com/in/adlishah-hakimi-56325223a/)
[![GitHub](https://img.shields.io/badge/GitHub-kymy07-1F3864?style=flat-square&logo=github)](https://github.com/kymy07)

---

<div align="center">

**Adlishah Hakimi bin Sharilfuddin** · Malaysia

</div>
