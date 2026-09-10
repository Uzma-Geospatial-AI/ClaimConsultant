/* =======================================================================
   generate.test.js — test suite with zero npm dependencies.

   Loads the application code into a Node VM context behind a minimal
   browser stub, then generates all four documents and checks the results.

   Run:  node test/generate.test.js
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
  if (String(actual) === String(expected)) {
    passed++;
    console.log(`  ok    ${label} = ${actual}`);
  } else {
    failures.push(`${label}: got ${actual}, expected ${expected}`);
    console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`);
  }
}

function checkFile (name, minBytes, magic) {
  const p = path.join(OUT, name);
  if (!fs.existsSync(p)) {
    failures.push(`${name} was not generated`);
    console.log(`  FAIL  ${name} was not generated`);
    return;
  }
  const buf = fs.readFileSync(p);
  const head = buf.slice(0, magic.length).toString('binary');
  if (buf.length < minBytes) {
    failures.push(`${name} too small (${buf.length} bytes)`);
    console.log(`  FAIL  ${name} is only ${buf.length} bytes`);
    return;
  }
  if (head !== magic) {
    failures.push(`${name} wrong magic bytes (${head})`);
    console.log(`  FAIL  ${name} magic bytes "${head}"`);
    return;
  }
  passed++;
  console.log(`  ok    ${name} — ${buf.length} bytes`);
}

/* ---------------- minimal browser stub ---------------- */

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

[ 'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js', 'vendor/carlito.js',
  'vendor/exceljs.min.js',
  'vendor/docx.umd.js', 'assets/js/state.js', 'assets/js/logo.js',
  'assets/js/timesheet.js' ].forEach(load);

// signature.js and app.js need a real DOM — substitute the few helpers they export
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

// JSZip has no Blob support under Node — use toBuffer for tests only
ctx.docx.Packer.toBlob = ctx.docx.Packer.toBuffer.bind(ctx.docx.Packer);

/* ---------------- fixture ---------------- */

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
  S.timesheet.month = 7;           // August
  S.timesheet.year = 2026;
  S.timesheet.activities[0].name = 'Developing Platform (August 2026)';
  [24, 26, 27, 28].forEach(d => S.timesheet.activities[0].days[d] = '/');
  [25, 31].forEach(d => S.timesheet.activities[0].days[d] = 'PH');
  S.timesheet.activities[0].days[20] = 'PTO';   // paid time off
  S.timesheet.activities[0].days[21] = 'MC';    // medical leave
  S.timesheet.activities[0].days[19] = 'UL';    // unpaid leave
  S.timesheet.reviewName = 'Muhammad Hanis Rashidan';
  S.timesheet.reviewDate = '26.8.2026';
  S.leave = { year: 2026, pto: 10, mc: 12, ul: 0 };   // taken earlier in the year
  S.timesheet.prepName = 'Ahmad bin Abdullah';
  S.timesheet.prepDate = '26.8.2026';
  S.invoice.items = [];
  globalThis.__S = S;
  globalThis.__calc = computeAmount(S);
  globalThis.__tot = timesheetTotals(S.timesheet);
  globalThis.__addrFits = splitAddressLines('No 12, Jalan Contoh 1,', 'Taman Contoh');
  globalThis.__addrOver = splitAddressLines(
    'No 5, Lorong Solok Imam Tahir, Kg Solok Duku, 78300 Masjid Tanah', '');
  globalThis.__addrJoin = splitAddressLines(
    'No 5, Lorong Solok Imam Tahir, Kg Solok Duku, 78300', 'Melaka');
  globalThis.__al   = dayValue(S.timesheet, S.timesheet.activities[0], 20);
  globalThis.__pto  = leaveStanding(S, 'PTO');
  globalThis.__mc   = leaveStanding(S, 'MC');
  globalThis.__ul   = leaveStanding(S, 'UL');
  globalThis.__lastYear = leaveStanding(
    Object.assign({}, S, { leave: { year: 2025, pto: 9, mc: 9, ul: 9 } }), 'PTO');
  globalThis.__sat = dayValue(S.timesheet, S.timesheet.activities[0], 29);
  globalThis.__sun = dayValue(S.timesheet, S.timesheet.activities[0], 30);
`, ctx);

/* ---------------- run ---------------- */

(async () => {
  console.log('\nCalculations');
  // RM 3500 / 31 days in August x 8 calendar days (24-31) = RM 903.23
  check('invoice amount (RM)', ctx.__calc.amount, 903.23);
  // 20 and 21 August are marked AL and UL: leave says why a day is not
  // claimed, so it must stay out of [A] the way PH does
  check('TOTAL DAYS [A] counts only the ticks', ctx.__tot.A, 4);
  check('20 Aug 2026 leave mark', ctx.__al, 'PTO');

  /* Leave comes out of a yearly allowance: what the grid holds this month
     plus what was taken earlier, against the 12 days each kind gets. */
  console.log('\nLeave against the year');
  check('this month counted from the grid', ctx.__pto.month, 1);
  check('added to what went before',        ctx.__pto.taken, 11);
  check('leaving the rest of the twelve',   ctx.__pto.left, 1);
  check('inside the allowance is not over', ctx.__pto.over, false);
  check('the twelfth day is still allowed', ctx.__mc.taken, 13);
  check('the thirteenth is over',           ctx.__mc.over, true);
  check('and says by how much',             ctx.__mc.left, -1);
  check('leave never taken starts at zero', ctx.__ul.earlier, 0);
  check('a balance from another year is not this one', ctx.__lastYear.earlier, 0);
  check('BALANCE [B-(A+C)]', ctx.__tot.balance, -4);
  check('29 Aug 2026 auto-label', ctx.__sat, 'SAT');
  check('30 Aug 2026 auto-label', ctx.__sun, 'SUN');

  // Line 1 is only as long as the invoice can print (66 mm, 46 characters):
  // an address longer than that carries on into line 2 instead of running
  // into the column beside it, and it breaks between words, never inside one
  check('a line that fits is left alone', ctx.__addrFits.moved, '');
  check('a line that fits keeps line 2', ctx.__addrFits.line2, 'Taman Contoh');
  check('the overflow breaks between words',
        ctx.__addrOver.line1, 'No 5, Lorong Solok Imam Tahir, Kg Solok Duku,');
  check('the overflow lands on line 2', ctx.__addrOver.line2, '78300 Masjid Tanah');
  check('the overflow joins what line 2 held', ctx.__addrJoin.line2, '78300, Melaka');

  console.log('\nDocument generation');
  const jobs = [
    ['Invoice PDF', ctx.generateInvoicePDF], ['Invoice Excel', ctx.generateInvoiceXLSX],
    ['Claim PDF', ctx.generateClaimPDF],     ['Claim Word', ctx.generateClaimDOCX]
  ];
  for (const [label, fn] of jobs) {
    try { await fn(ctx.__S); }
    catch (e) {
      failures.push(`${label} threw: ${e.message}`);
      console.log(`  FAIL  ${label}: ${e.message}`);
    }
  }

  /* -----------------------------------------------------------------------
     Fidelity to the printed Uzma sheet. These are not taste: every value is
     lifted out of the reference PDF's own font table and drawing operators,
     so a change here means the generated form has stopped matching the one
     finance receives.
     ----------------------------------------------------------------------- */
  console.log('\nMatching the printed form');
  const claimSrc = fs.readFileSync(path.join(ROOT, 'assets/js/gen-claim.js'), 'utf8');
  // Section C carries four approvers now — the project manager reviews before
  // the HOD approves — and the order on the sheet is the order of the flow.
  // `const` inside a vm script is lexical, not a property of the context —
  // these have to be evaluated in there rather than read off the object
  const inApp = expr => vm.runInContext(expr, ctx);
  check('section C has four approver columns', inApp('C_HEADS.length'), 4);
  check('the project manager reviews second', inApp('C_HEADS[1][0]'), 'REVIEWED BY');
  check('and signs in their own box',         inApp('C_HEADS[1][2]'), 'pm');
  check('the label column keeps the workbook width', inApp('C_LABEL'), 0.152243);
  check('the sheet is set in Calibri metrics', /const FONT = 'Carlito'/.test(claimSrc), true);
  check('the fills are the template grey',     /GREY = \[242, 242, 242\]/.test(claimSrc), true);
  check('the orange is the template orange',   /ORANGE = \[237, 125, 49\]/.test(claimSrc), true);
  check('no Helvetica is left in the sheet',   /helvetica/i.test(claimSrc), false);

  const inv = 'INV-2026-08-026 - Ahmad bin Abdullah';
  const clm = 'Claim Aug 2026 - Ahmad bin Abdullah';
  checkFile(`${inv}.pdf`,  8000,  '%PDF');   // PDF
  checkFile(`${inv}.xlsx`, 5000,  'PK');     // OOXML = zip archive
  checkFile(`${clm}.pdf`,  20000, '%PDF');
  // The font has to actually reach the file, not merely be asked for —
  // and only that file: the invoice is not set in Calibri and should not be
  // paying for a face it never draws with.
  check('the Claim PDF embeds the font',
    fs.readFileSync(path.join(OUT, `${clm}.pdf`)).includes('Carlito'), true);
  check('the Invoice PDF does not',
    fs.readFileSync(path.join(OUT, `${inv}.pdf`)).includes('Carlito'), false);
  checkFile(`${clm}.docx`, 8000,  'PK');

  fs.rmSync(OUT, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('All tests passed.');
})();
