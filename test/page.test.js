/* =======================================================================
   page.test.js — the checks that are about the page, not the JavaScript.

   A stubbed DOM cannot catch these. Both of the bugs below shipped once:
   the sign-in gate that could never be hidden and sat over the unlocked
   app forever, and the form that fell back to a native GET and put a
   password in the URL. Neither was visible to a unit test, because in a
   fake DOM `el.hidden = true` always works and forms never submit.

   Run:  node test/page.test.js
   ======================================================================= */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const css  = fs.readFileSync(path.join(ROOT, 'assets/css/style.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

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

/* -----------------------------------------------------------------------
   Overlays that JavaScript shows and hides with `el.hidden`.

   Each gives itself a `display` in the stylesheet. That is an author rule,
   so it beats the browser's own [hidden]{display:none} from the UA sheet,
   and `el.hidden = true` quietly does nothing — the overlay stays fixed
   over the app at its z-index with no way to dismiss it. Every one of them
   needs to say so explicitly.
   ----------------------------------------------------------------------- */
console.log('\nOverlays can actually be hidden');

['authgate', 'pdfview', 'profilemenu'].forEach(cls => {
  const setsDisplay = new RegExp('\\.' + cls + '\\s*\\{[^}]*display\\s*:', 'm').test(css);
  const answersHidden = new RegExp('\\.' + cls + '\\[hidden\\]\\s*\\{[^}]*display\\s*:\\s*none').test(css);
  check(`.${cls}`, !setsDisplay || answersHidden, true);
});

/* -----------------------------------------------------------------------
   The profile list. Each row acts on the profile it names, so the row has
   to carry the name as text — profiles arrive from other people over BDOS,
   and a name is not markup.
   ----------------------------------------------------------------------- */
console.log('\nThe profile list');

const appjs = fs.readFileSync(path.join(ROOT, 'assets/js/app.js'), 'utf8');
check('the menu is in the page', /id="profileMenu"/.test(html), true);
check('its rows are built as text, never innerHTML',
  /menu\.innerHTML\s*=\s*['"]{2}/.test(appjs) &&
  !/prow[\s\S]{0,400}innerHTML\s*=\s*`/.test(appjs), true);
check('a row opens and deletes its own profile',
  /editProfile\(name\)/.test(appjs) && /removeProfile\(name\)/.test(appjs), true);
check('the list can start a new profile', /Add new profile/.test(appjs), true);

/* -----------------------------------------------------------------------
   The approvals screen. A claim is read by four people and signed by three
   of them, and the one thing that must never slip is which box each role
   signs — the project manager in the HOD's box would be an approval nobody
   gave, and nothing on the printed sheet would show it.
   ----------------------------------------------------------------------- */
console.log('\nThe approvals screen');

const approvals = fs.readFileSync(path.join(ROOT, 'assets/js/approvals.js'), 'utf8');
check('the panel is in the page', /id="p-approvals"/.test(html), true);
check('the submit card starts hidden', /id="card_submit"[^>]*hidden/.test(html), true);
check('the project manager signs the REVIEWED BY box',
  /manager:\s*\{\s*sig:\s*'pm'/.test(approvals), true);
check("the PA places the HOD's signature, not their own",
  /pa:\s*\{\s*sig:\s*'hod'/.test(approvals), true);
check('the HOD signs nothing themselves', /boss:\s*\{\s*sig:/.test(approvals), false);
check('a claim waits on the manager, then the HOD, then the PA',
  /pending_manager:\s*'manager'[\s\S]{0,160}pending_boss:\s*'boss'[\s\S]{0,160}pending_signature:\s*'pa'/
    .test(approvals), true);

/* -----------------------------------------------------------------------
   Credentials must never be able to leave in a URL. If the script that
   handles the sign-in form ever fails to bind its listener, the browser
   falls back to submitting the form itself — a GET carrying the password
   in the query string, into the address bar, history and the server log.
   ----------------------------------------------------------------------- */
console.log('\nThe sign-in form');

check('cannot submit natively',
  /id="authForm"[^>]*onsubmit="return false"/.test(html), true);
check('the password box is a password box',
  /id="authPassword"[^>]*type="password"|type="password"[^>]*id="authPassword"/.test(html), true);
check('and never remembers a typed password in the URL',
  /<form[^>]*id="authForm"[^>]*method=/.test(html), false);

/* -----------------------------------------------------------------------
   Script order: every file the app leans on has to be parsed before the
   one that calls into it.
   ----------------------------------------------------------------------- */
console.log('\nScript order');

const scripts = [...html.matchAll(/<script src="(assets\/js\/[^"]+)"/g)].map(m => m[1]);
const at = f => scripts.indexOf('assets/js/' + f);

check('every app script is loaded', scripts.length >= 8, true);
check('auth.js comes before app.js',    at('auth.js') < at('app.js'), true);
check('sync.js comes before app.js',    at('sync.js') < at('app.js'), true);
check('state.js comes before sync.js',  at('state.js') < at('sync.js'), true);
check('preview.js comes before app.js', at('preview.js') < at('app.js'), true);
check('the generators come before preview.js',
  at('gen-invoice.js') < at('preview.js') && at('gen-claim.js') < at('preview.js'), true);
// approvals.js rebuilds a submitted claim with the generator and shows it in
// the viewer, so both have to be parsed before it
check('approvals.js comes after the generator and the viewer',
  at('gen-claim.js') < at('approvals.js') && at('preview.js') < at('approvals.js'), true);
check('and before app.js, which calls into it', at('approvals.js') < at('app.js'), true);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('All tests passed.');
