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

/* -----------------------------------------------------------------------
   Downloading the documents and sending the claim away are two different
   decisions, and they used to be one screen. Generating happens several
   times while a month is still being argued about; submitting happens once
   and cannot be taken back — so it has a step of its own, and the Generate
   step no longer offers it.
   ----------------------------------------------------------------------- */
console.log('\nSubmitting is its own step');

check('the submit panel is in the page', /id="p-submit"/.test(html), true);
check('and the step is in the flow', /id: 'submit'/.test(appjs), true);
check('the Generate step no longer submits',
  /id="p-generate"[\s\S]*?<\/section>/.exec(html)[0].includes('btnSubmitClaim'), false);
check('nor offers "Generate All"', /id="btnAll"/.test(html + appjs), false);
// The card is only offered once the database has answered: a claim that
// silently went nowhere is worse than one that was never sent.
check('the card waits for the database', /card.hidden = !canSend/.test(appjs), true);

/* -----------------------------------------------------------------------
   Signed copies. The upload sends bytes somebody chose off their own disk,
   so the size is checked in the browser before any of it is read.
   ----------------------------------------------------------------------- */
console.log('\nThe archive');

const archivejs = fs.readFileSync(path.join(ROOT, 'assets/js/archive.js'), 'utf8');
check('the list is in the page', /id="archiveList"/.test(html), true);
check('a file too big is refused before it is read',
  /f\.size > ARCHIVE_MAX_BYTES/.test(archivejs), true);
check('and rows are built as text, never markup',
  /archiveperson[\s\S]{0,200}innerHTML/.test(archivejs), false);
// Which box is signed follows the stage the claim is at, not the role of
// whoever is looking — the admin stands in at any of them.
check('the REVIEWED BY box is signed when it is with the manager',
  /pending_manager:\s*\{\s*sig:\s*'pm'/.test(approvals), true);
check("the HOD's box is signed at the PA's step, by whoever is there",
  /pending_signature:\s*\{\s*sig:\s*'hod'/.test(approvals), true);
check('nothing is signed while it sits with the HOD',
  /pending_boss:\s*\{\s*sig:/.test(approvals), false);
// The admin fills claims in as well as approving them, so the wizard has to
// be drawn for them — the test is "does this account prepare claims", never
// "is it a consultant", which left the admin with an approvals screen and
// nothing else.
check('the wizard is hidden by what an account prepares, not by its role name',
  /Auth\.role\(\)\s*&&\s*!Auth\.prepares\(\)/.test(appjs), true);
// Every "can this account do X" has to ask what the account does, never what
// it is called. Comparing to a role name is how the admin ended up with less
// access than the people it administers.
check('nothing decides access by comparing to a role name',
  /Auth\.role\(\)\s*===/.test(appjs + approvals), false);
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
/* -----------------------------------------------------------------------
   Cache keys. GitHub Pages serves this page and everything it loads with
   max-age=600. A reload fetches the page again but keeps the old JavaScript
   for up to ten minutes, which is indistinguishable from a fix that did not
   work — so every local file carries a stamp that changes when it does.
   ----------------------------------------------------------------------- */
console.log('\nCache keys');

const localAssets = [...html.matchAll(/(?:src|href)="((?:assets|vendor)\/[^"]+)"/g)]
  .map(m => m[1]);
const unstamped = localAssets.filter(u => !/\?v=/.test(u));
check('every local file carries one', unstamped.length, 0);
check('and they all carry the same one',
  new Set(localAssets.map(u => u.split('?v=')[1])).size, 1);

console.log('\nScript order');

// the ?v= cache key is part of the URL, and not part of which file this is
const scripts = [...html.matchAll(/<script src="(assets\/js\/[^"?]+)/g)].map(m => m[1]);
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
// holidays.js is read by the time sheet when it fills a month in
check('holidays.js comes before timesheet.js', at('holidays.js') < at('timesheet.js'), true);
// archive.js borrows button() from approvals.js and is called from app.js
check('archive.js sits between approvals.js and app.js',
  at('approvals.js') < at('archive.js') && at('archive.js') < at('app.js'), true);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('All tests passed.');
