/* =======================================================================
   signing.js — the PA's two pages: Download, and Upload

   The PA's whole part in a claim is the HOD's signature. Some months it is
   drawn in the app; most months it is a piece of paper on a desk, and the
   app's job is to hand that paper over and take it back. So the PA does not
   get the status table with its five columns and its month picker — they
   get two pages, named for the two things they do:

     Download — every time sheet the HOD has approved and not yet signed.
               Print it, put it in front of him.
     Upload   — the same list, each with a box for the signed scan. Putting
               a file in it files the scan and marks the month signed, in
               that order, for everybody. A month already signed can be
               uploaded again, and the newest copy is the one the whole
               office sees from then on.

   The administrator keeps the full flow and gets these two as well, because
   the admin stands in everywhere.
   ======================================================================= */

let signingSubs = [];          // everything the last load returned
let signingBusy = false;

/* The status a time sheet has when it is sitting with the PA. */
const SIGNING_STATUS = 'pending_signature';

/** the time sheets waiting on the HOD's signature, newest month first */
function waitingSignature () {
  return signingSubs
    .filter(s => s.status === SIGNING_STATUS && kindOf(s) === 'claim')
    .slice()
    .sort(byMonthThenName);
}

/** the time sheets already signed and closed — the ones a newer scan can replace */
function signedAlready () {
  return signingSubs
    .filter(s => s.status === 'complete' && kindOf(s) === 'claim')
    .slice()
    .sort(byMonthThenName);
}

function byMonthThenName (a, b) {
  return (b.period_year - a.period_year) || (b.period_month - a.period_month) ||
    String(a.consultant || '').localeCompare(String(b.consultant || ''));
}

/** read what is with the PA, and what has been through them */
async function loadSigning (host) {
  if (!Sync.on) {
    host.innerHTML = Sync.offlineNote(
      'The claims live in the shared database, which this browser cannot reach right now.');
    return false;
  }
  host.innerHTML = '<p class="emptynote">Loading…</p>';
  try {
    signingSubs = await Sync.submissions('');
  } catch (err) {
    host.innerHTML = `<p class="emptynote">Could not read the claims: ${err.message}</p>`;
    return false;
  }
  if (typeof ensureArchive === 'function') await ensureArchive();
  return true;
}

/* learnKinds() in approvals.js reads the table's own list; here the same
   rows are looked up so a row without a kind is not read as the wrong one */
async function learnSigningKinds () {
  const missing = signingSubs.filter(s => !Sync.kindOf(s) && !kindCache.has(s.id));
  await Promise.all(missing.slice(0, KIND_LOOKUP_MAX).map(async s => {
    try {
      const full = await Sync.submission(s.id);
      kindCache.set(s.id, Sync.kindOf(full) || 'claim');
    } catch (err) {
      kindCache.set(s.id, 'claim');
    }
  }));
}

/** the heading a card carries: person, month, invoice number */
function signingHead (sub) {
  const head = document.createElement('div');
  head.className = 'archhead';
  const who = document.createElement('b');
  who.textContent = sub.consultant || '(no name)';
  head.appendChild(who);
  const tag = document.createElement('span');
  tag.className = 'doctag claim';
  tag.textContent = kindLabel('claim');
  head.appendChild(tag);
  const meta = document.createElement('span');
  meta.textContent = [periodOf(sub), sub.invoice_no || ''].filter(Boolean).join(' · ');
  head.appendChild(meta);
  return head;
}

/** group cards under the month they belong to */
function monthGroups (host, rows, card) {
  let seen = null;
  rows.forEach(sub => {
    const label = periodOf(sub);
    if (label !== seen) {
      seen = label;
      const h = document.createElement('h4');
      h.className = 'archiveperson';
      h.textContent = label;
      host.appendChild(h);
    }
    host.appendChild(card(sub));
  });
}

/* -------------------------------------------------------------------
   Download
   ------------------------------------------------------------------- */

async function renderSignDownload () {
  const host = document.getElementById('signDownloadList');
  if (!host) return;
  if (!(await loadSigning(host))) return;
  await learnSigningKinds();

  host.innerHTML = '';
  const rows = waitingSignature();

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'emptynote';
    empty.textContent = 'Nothing is waiting for the HOD’s signature. When the HOD approves a ' +
      'time sheet it appears here, ready to download.';
    host.appendChild(empty);
    return;
  }

  const bar = document.createElement('div');
  bar.className = 'btnrow';
  const all = button(`Download all (${rows.length})`, 'small',
                     () => downloadAllForSigning(rows, all));
  bar.appendChild(all);
  host.appendChild(bar);

  monthGroups(host, rows, sub => {
    const card = document.createElement('div');
    card.className = 'archrow';
    card.appendChild(signingHead(sub));
    const acts = document.createElement('div');
    acts.className = 'archfiles';
    const dl = button('Download', 'primary small', () => downloadForSigning(sub, dl));
    acts.appendChild(dl);
    acts.appendChild(button('Read', 'ghost small', () => reviewSubmission(sub.id)));
    card.appendChild(acts);
    return card;
  });
}

/** the time sheet as it was approved, as a PDF for the printer */
async function signingPdf (sub) {
  const full = await Sync.submission(sub.id);
  if (!full || !full.data) throw new Error('That document could not be read.');
  const state = mergeDefaults(full.data);
  return { blob: (await buildClaimPDF(state)).output('blob'), name: claimFileBase(state) + '.pdf' };
}

async function downloadForSigning (sub, btn) {
  if (signingBusy) return;
  signingBusy = true;
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  try {
    const pdf = await signingPdf(sub);
    saveAs(pdf.blob, pdf.name);
  } catch (err) {
    toast(err.message || 'Could not download that.', true);
  } finally {
    signingBusy = false;
    btn.disabled = false;
    btn.textContent = was;
  }
}

async function downloadAllForSigning (rows, btn) {
  if (signingBusy) return;
  signingBusy = true;
  const was = btn.textContent;
  btn.disabled = true;
  let saved = 0;
  const failed = [];
  try {
    for (let i = 0; i < rows.length; i++) {
      btn.textContent = `Downloading ${i + 1} of ${rows.length}…`;
      try {
        const pdf = await signingPdf(rows[i]);
        saveAs(pdf.blob, pdf.name);
        saved++;
        // the browser needs a breath between saves, or it drops some
        await new Promise(res => setTimeout(res, 250));
      } catch (err) {
        failed.push(`${rows[i].consultant || rows[i].id}: ${err.message}`);
      }
    }
  } finally {
    signingBusy = false;
    btn.disabled = false;
    btn.textContent = was;
  }
  toast(failed.length
    ? `${saved} saved. ${failed.length} could not be: ${failed[0]}`
    : `${saved} file${saved === 1 ? '' : 's'} saved to your Downloads folder.`, !!failed.length);
}

/* -------------------------------------------------------------------
   Upload
   ------------------------------------------------------------------- */

async function renderSignUpload () {
  const host = document.getElementById('signUploadList');
  if (!host) return;
  if (!(await loadSigning(host))) return;
  await learnSigningKinds();

  host.innerHTML = '';

  if (!Sync.archiveOn) {
    host.innerHTML =
      '<p class="emptynote"><b>The archive is not switched on yet.</b> ' +
      'BDOS has not shipped the storage for signed copies — see ' +
      'docs/BDOS-CCS-Endpoints.md. Keep the signed files where they are and put them ' +
      'here once it is there.</p>';
    return;
  }

  const waiting = waitingSignature();
  const done = signedAlready();

  const h1 = document.createElement('h3');
  h1.textContent = 'Waiting for the signed copy';
  host.appendChild(h1);

  if (!waiting.length) {
    const empty = document.createElement('p');
    empty.className = 'emptynote';
    empty.textContent = 'Nothing is waiting. Every time sheet the HOD approved has its signed ' +
      'copy on file.';
    host.appendChild(empty);
  } else {
    monthGroups(host, waiting, sub => uploadCard(sub, false));
  }

  if (done.length) {
    const h2 = document.createElement('h3');
    h2.textContent = 'Already signed — upload a newer copy';
    host.appendChild(h2);
    const lead = document.createElement('p');
    lead.className = 'archlead';
    lead.textContent = 'These are on file. Upload again if a better scan turns up, or the ' +
      'wrong file went in: the newest copy is the one everybody sees from then on.';
    host.appendChild(lead);
    monthGroups(host, done, sub => uploadCard(sub, true));
  }
}

/**
 * One time sheet and the box its signed scan goes in.
 * @param {boolean} again  it is already signed: this replaces the copy on file
 */
function uploadCard (sub, again) {
  const card = document.createElement('div');
  card.className = 'archrow signcard';
  card.appendChild(signingHead(sub));

  const filedBy = typeof archiveBy === 'function'
    ? archiveBy(sub.consultant, sub.period_year, Number(sub.period_month) - 1, 'claim') : '';
  if (filedBy) {
    const on = document.createElement('p');
    on.className = 'subnote';
    on.textContent = 'On file — uploaded by ' + filedBy + '.';
    card.appendChild(on);
  }

  const row = document.createElement('div');
  row.className = 'signrow';
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.pdf,.png,.jpg,.jpeg,image/*,application/pdf';
  row.appendChild(inp);
  const go = button(again ? 'Replace the copy on file' : 'Upload the signed copy',
                    again ? 'small' : 'primary small',
                    () => uploadSigned(sub, inp, again, go));
  row.appendChild(go);
  card.appendChild(row);
  return card;
}

/**
 * File the scan, then — for a month still waiting — mark it signed.
 *
 * File first. A scan on record for a month still waiting is a small oddity;
 * a month marked signed with the scan lost to a failed upload is a month
 * nobody can produce. Once the record is written it is the newest one for
 * that person and month, which is what every other screen reads.
 */
async function uploadSigned (sub, inp, again, go) {
  if (signingBusy) return;
  const file = inp.files && inp.files[0];
  if (!file) { toast('Choose the signed time sheet first.', true); return; }
  if (file.size > ARCHIVE_MAX_BYTES) {
    toast(`${file.name} is over the ${Math.round(ARCHIVE_MAX_BYTES / 1048576)} MB limit.`, true);
    return;
  }

  signingBusy = true;
  const was = go.textContent;
  go.disabled = true;
  go.textContent = 'Uploading…';
  try {
    const full = await Sync.submission(sub.id);
    const state = mergeDefaults((full && full.data) || {});
    const payload = await Sync.readFile(file);
    payload.name = `${kindLabel('claim')} (signed) — ${payload.name}`;
    const by = (Auth.user() || {}).name || myEmail();
    await Sync.store(state, [payload],
      `${kindLabel('claim')} signed by ${by}` + (again ? ' · replaces the earlier copy' : ''),
      'claim', SIGNING_STATUS);

    if (!again) await Sync.act(sub.id, 'approve', '');

    archiveLoaded = false;          // everybody else reads the newest copy
    toast(again
      ? `Replaced the signed copy for ${sub.consultant}, ${periodOf(sub)}.`
      : `Signed and filed — ${sub.consultant}, ${periodOf(sub)}.`);
    await renderSignUpload();
  } catch (err) {
    toast(err.message || 'Could not upload that.', true);
    go.disabled = false;
    go.textContent = was;
  } finally {
    signingBusy = false;
  }
}
