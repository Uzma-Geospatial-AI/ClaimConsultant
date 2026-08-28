/* =======================================================================
   generate.test.js — ujian tanpa sebarang dependency npm.
   Memuatkan kod aplikasi ke dalam konteks Node dengan stub pelayar minimum,
   kemudian menjana keempat-empat dokumen dan menyemak kandungannya.

   Jalankan:  node test/generate.test.js
   ======================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-test-'));

let passed = 0;
const failures = [];

function check (label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (ok) { passed++; console.log(`  ok   ${label} = ${actual}`); }
  else { failures.push(`${label}: dapat ${actual}, dijangka ${expected}`); console.log(`  GAGAL ${label}: dapat ${actual}, dijangka ${expected}`); }
}

function checkFile (name, minBytes, magic) {
  const p = path.join(OUT, name);
  if (!fs.existsSync(p)) { failures.push(`${name} tidak dijana`); console.log(`  GAGAL ${name} tidak dijana`); return; }
  const buf = fs.readFileSync(p);
  const head = buf.slice(0, magic.length).toString('binary');
  if (buf.length < minBytes) { failures.push(`${name} terlalu kecil (${buf.length} bait)`); console.log(`  GAGAL ${name} hanya ${buf.length} bait`); return; }
  if (head !== magic) { failures.push(`${name} magic salah (${head})`); console.log(`  GAGAL ${name} magic "${head}"`); return; }
  passed++;
  console.log(`  ok   ${name} — ${buf.length} bait`);
}

/* ---------------- stub pelayar minimum ---------------- */

const ctx = {
  console,
  Blob: class Blob { constructor (parts) { this.parts = parts; } },
  atob: b64 => Buffer.from(b64, 'base64').toString('binary'),
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  Image: class { set src (v) { setTimeout(() => this.onerror && this.onerror(), 0); } },
  document: {
    createElement: () => ({ style: {}, appendChild () {}, removeChild () {}, setAttribute () {},
                            getContext: () => null, contentWindow: null }),
    documentElement: { style: {}, appendChild () {}, removeChild () {} },
    body: { appendChild () {}, removeChild () {}, style: {} },
    addEventListener () {}, createTextNode: () => ({})
  },
  navigator: { userAgent: 'node' },
  Buffer, process, TextEncoder, TextDecoder, URL,
  setTimeout, clearTimeout, Math, Date, JSON,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  saveAs (blob, name) {
    const buf = Buffer.isBuffer(blob)
      ? blob
      : Buffer.concat(blob.parts.map(p => Buffer.isBuffer(p)
          ? p : Buffer.from(p instanceof ArrayBuffer ? new Uint8Array(p) : p)));
    fs.writeFileSync(path.join(OUT, name), buf);
  }
};
ctx.window = ctx;
ctx.self = ctx;
vm.createContext(ctx);

const load = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });

[ 'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js', 'vendor/exceljs.min.js',
  'vendor/docx.umd.js', 'assets/js/state.js', 'assets/js/timesheet.js' ].forEach(load);

// signature.js dan app.js perlukan DOM sebenar — ganti dengan versi ringkas untuk ujian
vm.runInContext(`
  function normalizeSignature () { return Promise.resolve(null); }
  function dataUrlToBytes (u) {
    const b = atob(String(u).split(',')[1] || '');
    const a = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  }
  function toast () {}
`, ctx);

[ 'assets/js/gen-invoice.js', 'assets/js/gen-claim.js' ].forEach(load);

// JSZip tiada sokongan Blob di Node — guna toBuffer untuk ujian sahaja
ctx.docx.Packer.toBlob = ctx.docx.Packer.toBuffer.bind(ctx.docx.Packer);

/* ---------------- data ujian ---------------- */

vm.runInContext(`
  const S = defaultState();
  Object.assign(S.consultant, {
    name: 'Ahmad bin Abdullah', ic: '010203-04-0567',
    addr1: 'No 12, Jalan Contoh 1,', addr2: 'Taman Contoh, 40000 Shah Alam, Selangor',
    position: 'Full Stack Developer', position2: 'FULL STACK DEVELOPER (CONSULTANT)',
    workLoc: 'UZMA TOWER', assignPeriod: 'Aug-26',
    bank: 'RHB BANK Berhad', accName: 'Ahmad bin Abdullah', accNo: '1-23456-0001234-5'
  });
  Object.assign(S.invoice, {
    no: 'INV-2026-08-026', date: '2026-08-26', due: '2026-08-31',
    pStart: '2026-08-24', pEnd: '2026-08-31', mode: 'monthly', monthlyRate: 3500
  });
  S.timesheet.month = 7;           // Ogos
  S.timesheet.year = 2026;
  S.timesheet.activities[0].name = 'Developing Platform (August 2026)';
  [24, 26, 27, 28].forEach(d => S.timesheet.activities[0].days[d] = '/');
  [25, 31].forEach(d => S.timesheet.activities[0].days[d] = 'PH');
  S.timesheet.prepName = 'Ahmad bin Abdullah';
  S.timesheet.prepDate = '26.8.2026';
  S.invoice.items = [];
  globalThis.__S = S;
  globalThis.__calc = computeAmount(S);
  globalThis.__tot = timesheetTotals(S.timesheet);
  globalThis.__sat = dayValue(S.timesheet, S.timesheet.activities[0], 29);
  globalThis.__sun = dayValue(S.timesheet, S.timesheet.activities[0], 30);
`, ctx);

/* ---------------- jalankan ---------------- */

(async () => {
  console.log('\nKiraan');
  // RM 3500 / 31 hari Ogos x 8 hari kalendar (24-31) = RM 903.23
  check('amaun invois (RM)', ctx.__calc.amount, 903.23);
  check('TOTAL DAYS [A]', ctx.__tot.A, 4);
  check('BALANCE [B-(A+C)]', ctx.__tot.balance, -4);
  check('29 Ogos 2026 (auto)', ctx.__sat, 'SAT');
  check('30 Ogos 2026 (auto)', ctx.__sun, 'SUN');

  console.log('\nPenjanaan dokumen');
  const jobs = [
    ['Invoice PDF', ctx.generateInvoicePDF], ['Invoice Excel', ctx.generateInvoiceXLSX],
    ['Claim PDF', ctx.generateClaimPDF],     ['Claim Word', ctx.generateClaimDOCX]
  ];
  for (const [label, fn] of jobs) {
    try { await fn(ctx.__S); }
    catch (e) { failures.push(`${label} melontar ralat: ${e.message}`); console.log(`  GAGAL ${label}: ${e.message}`); }
  }

  const inv = 'INV-2026-08-026 - Ahmad bin Abdullah';
  const clm = 'Claim Aug 2026 - Ahmad bin Abdullah';
  checkFile(`${inv}.pdf`,  8000,  '%PDF');   // PDF
  checkFile(`${inv}.xlsx`, 5000,  'PK');     // OOXML = arkib zip
  checkFile(`${clm}.pdf`,  20000, '%PDF');
  checkFile(`${clm}.docx`, 8000,  'PK');

  fs.rmSync(OUT, { recursive: true, force: true });

  console.log(`\n${passed} lulus, ${failures.length} gagal`);
  if (failures.length) {
    console.log('\nKegagalan:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('Semua ujian lulus.');
})();
