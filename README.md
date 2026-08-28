# Sistem Consultant Claim

[![CI](https://github.com/kymy07/ConsultantClaimSystem/actions/workflows/ci.yml/badge.svg)](https://github.com/kymy07/ConsultantClaimSystem/actions/workflows/ci.yml)

Sistem web untuk consultant key in details sekali, tick hari kerja dalam kalendar, dan auto-generate
dua dokumen dalam empat format.

| Dokumen | Format | Fail keluaran |
|---|---|---|
| 1. Invoice Timesheet | PDF + Excel | `INV-2026-08-026 - Nama.pdf` / `.xlsx` |
| 2. Claim (Personnel Time Sheet Uzma) | PDF + Word | `Claim Aug 2026 - Nama.pdf` / `.docx` |

## Cara guna

Klik dua kali `index.html` — itu sahaja. Tiada pemasangan, tiada server, tiada internet diperlukan
(semua library disimpan dalam folder `vendor/`).

Untuk letak dalam intranet syarikat, salin seluruh folder ke mana-mana web server statik.

## Aliran kerja

1. **Consultant** — nama, IC, alamat, jawatan, maklumat bank.
2. **Bill To** — syarikat yang dibilkan (default: Geospatial AI Sdn Bhd) + project details untuk borang Claim.
3. **Invoice** — no. invois, tarikh, period, dan kaedah kiraan amaun.
4. **Timesheet** — pilih bulan, kemudian klik kotak hari untuk tick.
5. **Signature** — lukis tandatangan guna tetikus/jari, atau muat naik imej.
6. **Generate** — muat turun PDF / Excel / Word.

## Tick kalendar

Klik satu kotak hari untuk kitar melalui tiga keadaan:

```
kosong  →  /  (hari kerja, dikira dalam TOTAL DAYS [A])  →  PH  (cuti umum)  →  kosong
```

Sabtu dan Ahad ditanda `SAT` / `SUN` automatik ikut kalendar sebenar bulan itu — tak perlu tick.
`TOTAL DAYS [A]`, `BALANCE [B-(A+C)]` dan senarai Public Holiday dikira sendiri.

Boleh tambah beberapa baris **Work Activity** (macam borang asal yang ada 8 baris).

## Kiraan amaun invois

Tiga kaedah dalam tab **Invoice**:

| Kaedah | Formula |
|---|---|
| Kadar bulanan (default) | `kadar bulanan ÷ hari dalam bulan × hari kalendar dalam period` |
| Kadar harian | `kadar harian × bilangan hari ditanda "/"` |
| Amaun tetap | key in sendiri dalam jadual item |

Contoh yang menepati invois sebenar: `RM 3,500.00 ÷ 31 hari (August 2026) × 8 hari (24–31 Ogos) = RM 903.23`.

Amaun item pertama dikunci (readonly) selagi kaedah bukan "Amaun tetap", supaya ia sentiasa
selari dengan formula. Tukar ke "Amaun tetap" kalau nak taip sendiri.

## Simpan data

Sistem ini **tiada database dan tiada server**. Semua data duduk dalam `localStorage` browser,
dalam dua kunci sahaja:

| Kunci | Isi |
|---|---|
| `ccs.current` | borang yang sedang dibuka (autosave setiap 250ms) |
| `ccs.profiles` | semua profil yang disimpan melalui "Simpan Profil" |

Butang di bar atas:

- **Simpan Profil** — simpan beberapa consultant berlainan, pilih semula dari dropdown.
- **Export / Import JSON** — backup sebenar, atau pindah data ke komputer lain. Ini satu-satunya
  cara data keluar dari browser, jadi export sekali-sekala.
- **Reset Semua** — padam kedua-dua kunci di atas dan mula semula kosong. Ada dua pengesahan,
  dan tidak boleh dibatalkan. Dokumen yang sudah dimuat turun tidak terjejas.

### Perkara yang perlu tahu

- **Data tak dihantar ke mana-mana** — kekal dalam browser komputer itu sahaja.
- **Data hilang** bila: clear browsing data, tukar browser, tukar PC, atau buka guna Incognito.
- **Had ~5–10 MB.** Yang paling makan ruang ialah tandatangan (PNG base64). Kalau kuota penuh,
  autosave akan tunjuk amaran merah — bila itu berlaku, terus Export JSON.
- **Beberapa consultant guna PC yang sama:** bila dibuka terus dari fail (`file://`), Chrome anggap
  semua fail tempatan sebagai satu origin. Jadi dua salinan folder pada Windows account yang sama
  akan **berkongsi** `localStorage` yang sama. Untuk elak bercampur, guna salah satu daripada:
  Windows account berasingan, browser berlainan, atau ciri "Simpan Profil" (satu profil satu orang).
  Kalau di-host pada web server, masalah ini tak wujud — setiap URL ada origin sendiri.

## Struktur fail

```
index.html                 antara muka (6 tab)
assets/css/style.css
assets/js/state.js         model data, formula, localStorage
assets/js/timesheet.js     grid tick hari 1–31
assets/js/signature.js     pad tandatangan + potong ruang kosong imej
assets/js/gen-invoice.js   Invoice  → PDF (jsPDF) + Excel (ExcelJS)
assets/js/gen-claim.js     Claim    → PDF (jsPDF) + Word (docx)
assets/js/app.js           pendawaian UI, profil, butang generate
vendor/                    library (offline)
```

## Library

jsPDF 2.5.1 + AutoTable 3.8.2 · ExcelJS 4.4.0 · docx 8.5.0 · FileSaver 2.0.5 · signature_pad 4.1.7
