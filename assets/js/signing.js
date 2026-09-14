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
               a scan on a card is not sending it: it can be looked at and
               swapped until it is right. One Submit at the bottom sends
               every one of them, closes those months and hands them to
               Group People & Finance. A month already sent can be given a
               newer copy the same way, and the newest is what everybody
               reads from then on.

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

   Two acts, not one. Putting the scan on the card is the PA saying "this is
   the signed one" — it can be looked at, and swapped for a better scan.
   Submitting is the PA saying "these months are done", and that one cannot
   be taken back: it files the scans, closes the claims and hands the months
   to Group People & Finance. So the button that does it is by itself, at the
   bottom, after everything it is going to send.
   ------------------------------------------------------------------- */

/* The scans put on cards and not yet sent: submission id → File. */
const attached = new Map();

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

  /* A scan is held in this browser until Submit sends it, so one put on a
     card that is no longer in the list has nowhere to go. */
  const live = new Set(waiting.concat(done).map(s => s.id));
  [...attached.keys()].forEach(id => { if (!live.has(id)) attached.delete(id); });

  const h1 = document.createElement('h3');
  h1.textContent = 'Waiting for the signed copy';
  host.appendChild(h1);

  if (!waiting.length) {
    const empty = document.createElement('p');
    empty.className = 'emptynote';
    empty.textContent = 'Nothing is waiting. Every time sheet the HOD approved has been ' +
      'signed and sent on.';
    host.appendChild(empty);
  } else {
    monthGroups(host, waiting, sub => uploadCard(sub, false));
  }

  if (done.length) {
    const h2 = document.createElement('h3');
    h2.textContent = 'Already sent — upload a newer copy';
    host.appendChild(h2);
    const lead = document.createElement('p');
    lead.className = 'archlead';
    lead.textContent = 'These have been through. Put a newer scan on one if a better copy ' +
      'turns up, or the wrong file went in: once it is submitted, that is the copy ' +
      'everybody sees from then on.';
    host.appendChild(lead);
    monthGroups(host, done, sub => uploadCard(sub, true));
  }

  host.appendChild(submitBar());
}

/**
 * One time sheet, and whatever has been put on it.
 * @param {boolean} again  it has been through already: a newer scan replaces
 *        the copy on file rather than closing the month
 */
function uploadCard (sub, again) {
  const card = document.createElement('div');
  card.className = 'archrow signcard';
  card.appendChild(signingHead(sub));

  /* What is already on file, if anything. Whoever is about to replace a copy
     should be able to look at the copy they are replacing. */
  const filed = typeof archiveFor === 'function'
    ? archiveFor(sub.consultant, sub.period_year, Number(sub.period_month) - 1, 'claim') : null;
  if (filed) {
    const on = document.createElement('p');
    on.className = 'subnote';
    on.textContent = 'On file — uploaded by ' + (filed.created_by || 'somebody') +
      (filed.created_at ? ' on ' + new Date(filed.created_at).toLocaleDateString() : '') + '.';
    card.appendChild(on);
    const bar = document.createElement('div');
    bar.className = 'archfiles';
    bar.appendChild(button('View the copy on file', 'ghost small', () => viewFiled(filed, sub)));
    card.appendChild(bar);
  }

  const file = attached.get(sub.id);
  const row = document.createElement('div');
  row.className = 'signrow';

  if (file) {
    /* Put on, not sent. The card names the file it is holding, offers it to
       be looked at, and offers to let it go again — all three, because the
       only thing worse than the wrong scan is the wrong scan nobody read. */
    const ready = document.createElement('span');
    ready.className = 'signready';
    ready.textContent = file.name;
    row.appendChild(ready);
    row.appendChild(button('View', 'ghost small', () =>
      openFilePreview(sub.consultant + ' — ' + periodOf(sub), file.name, file)));
    row.appendChild(button('Remove', 'ghost small', () => {
      attached.delete(sub.id);
      renderSignUpload();
    }));
  } else {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.pdf,.png,.jpg,.jpeg,image/*,application/pdf';
    inp.addEventListener('change', () => {
      const picked = inp.files && inp.files[0];
      if (!picked) return;
      if (picked.size > ARCHIVE_MAX_BYTES) {
        toast(picked.name + ' is over the ' +
              Math.round(ARCHIVE_MAX_BYTES / 1048576) + ' MB limit.', true);
        inp.value = '';
        return;
      }
      attached.set(sub.id, picked);
      renderSignUpload();
    });
    row.appendChild(inp);
    const hint = document.createElement('small');
    hint.className = 'signhint';
    hint.textContent = again
      ? 'Choose a newer scan to replace the one on file.'
      : 'Choose the signed time sheet.';
    row.appendChild(hint);
  }
  card.appendChild(row);
  return card;
}

/** look at the copy already on file, without downloading it first */
async function viewFiled (rec, sub) {
  try {
    const full = await Sync.storedOne(rec.id);
    const f = full && (full.files || [])[0];
    if (!f || !f.content) { toast('That file is not on the record.', true); return; }
    const type = f.type || 'application/pdf';
    const bytes = dataUrlToBytes('data:' + type + ';base64,' + f.content);
    openFilePreview((sub.consultant || '') + ' — ' + periodOf(sub) + ' — on file',
                    f.name || 'signed.pdf', new Blob([bytes], { type: type }));
  } catch (err) {
    toast(err.message || 'Could not open that file.', true);
  }
}

/* -------------------------------------------------------------------
   Submitting
   ------------------------------------------------------------------- */

/* Whoever collects the finished paper. Two names for two jobs: the button
   says what the office calls her, because a button is read once and pressed;
   the sentence above it says the whole name, because that is where somebody
   who does not know who Jiha is finds out. */
const collectorShort = () => Auth.shortFor('finance') || 'Group People & Finance';
const collectorFull = () => Auth.personFor('finance') ||
                            Auth.roleName('finance') || 'Group People & Finance';

function submitBar () {
  const bar = document.createElement('div');
  bar.className = 'signsubmit';

  const ready = attached.size;
  const who = collectorFull();

  const said = document.createElement('p');
  said.className = 'signsaid';
  said.textContent = ready
    ? ready + ' signed cop' + (ready === 1 ? 'y is' : 'ies are') + ' ready. Nothing has gone ' +
      'anywhere yet — Submit files ' + (ready === 1 ? 'it' : 'them') + ', closes the month and ' +
      'hands it to ' + who + '.'
    : 'Put the signed copies on the cards above. Nothing reaches ' + who +
      ' until you press Submit.';
  bar.appendChild(said);

  const row = document.createElement('div');
  row.className = 'btnrow';
  const go = button('Submit to ' + collectorShort(), 'primary', () => submitSigned(go));
  go.disabled = !ready;
  row.appendChild(go);
  bar.appendChild(row);
  return bar;
}

/**
 * Send everything that has been put on a card.
 *
 * The scan is filed first and the month closed second. A scan on record for
 * a month still open is a small oddity; a month closed with the scan lost to
 * a failed upload is a month nobody can produce. A month that has already
 * been through is only refiled — there is nothing left to close, and the
 * newer copy is simply the one everybody reads from then on.
 */
async function submitSigned (go) {
  if (signingBusy) return;
  const jobs = [...attached.entries()]
    .map(([id, file]) => ({ sub: signingSubs.filter(s => s.id === id)[0], file }))
    .filter(j => j.sub);
  if (!jobs.length) { toast('Nothing has been put on a card yet.', true); return; }

  const who = collectorFull();
  if (!confirm(
    'Submit ' + jobs.length + ' signed cop' + (jobs.length === 1 ? 'y' : 'ies') +
    ' to ' + who + '?\n\n' +
    jobs.map(j => j.sub.consultant + ' · ' + periodOf(j.sub)).join('\n') +
    '\n\nThe months are closed and cannot be taken back.')) return;

  signingBusy = true;
  const was = go.textContent;
  go.disabled = true;
  let done = 0;
  const failed = [];
  const by = (Auth.user() || {}).name || myEmail();

  try {
    for (let i = 0; i < jobs.length; i++) {
      const sub = jobs[i].sub;
      go.textContent = 'Sending ' + (i + 1) + ' of ' + jobs.length + '…';
      try {
        const full = await Sync.submission(sub.id);
        const state = mergeDefaults((full && full.data) || {});
        const payload = await Sync.readFile(jobs[i].file);
        payload.name = kindLabel('claim') + ' (signed) — ' + payload.name;
        const again = sub.status !== SIGNING_STATUS;
        await Sync.store(state, [payload],
          kindLabel('claim') + ' signed by ' + by +
          (again ? ' · replaces the earlier copy' : ''), 'claim', SIGNING_STATUS);
        if (!again) await Sync.act(sub.id, 'approve', '');
        attached.delete(sub.id);
        done++;
      } catch (err) {
        failed.push((sub.consultant || sub.id) + ': ' + err.message);
      }
    }
  } finally {
    signingBusy = false;
    go.disabled = false;
    go.textContent = was;
  }

  archiveLoaded = false;            // everybody else reads the newest copy
  toast(failed.length
    ? done + ' sent. ' + failed.length + ' could not be: ' + failed[0]
    : done + ' signed cop' + (done === 1 ? 'y' : 'ies') + ' sent to ' + who + '.',
    !!failed.length);
  await renderSignUpload();
}

/* -------------------------------------------------------------------
   Filed — what this account has sent on

   Download and Upload are the job in front of you. This is the job
   behind: every signed time sheet that has gone through here, a row
   each, so somebody asked "did September go?" can answer without
   opening a queue that no longer holds it.

   It carries the leave as well. A signed sheet is the month's evidence,
   and the first thing anybody asks about a month after it is closed is
   how many days of it were not worked. That answer is inside the form
   the copy was filed against, so it is read from there rather than
   typed anywhere: nobody can get it wrong, and nobody has to.
   ------------------------------------------------------------------- */

const leaveByMonth = new Map();      // submission id → { pto, mc, ul } | null

/** the submission a filed copy belongs to, so its form can be read */
function submissionForRecord (r) {
  const who = String(r.consultant || '').trim();
  return signingSubs.filter(s =>
    String(s.consultant || '').trim() === who &&
    Number(s.period_year) === Number(r.period_year) &&
    Number(s.period_month) === Number(r.period_month) &&
    kindOf(s) === 'claim')[0] || null;
}

/**
 * Read the leave off the forms these copies were filed against.
 *
 * One request each, so it is bounded the way the status table bounds its
 * own lookups — a year of history must not turn opening a tab into a
 * download. A month that was not read says so rather than saying zero.
 */
async function learnLeave (ids) {
  const want = [...new Set(ids.filter(id => id && !leaveByMonth.has(id)))];
  await Promise.all(want.slice(0, KIND_LOOKUP_MAX).map(async id => {
    try {
      const full = await Sync.submission(id);
      const state = mergeDefaults((full && full.data) || {});
      leaveByMonth.set(id, monthLeaveCounts(state.timesheet));
    } catch (err) {
      leaveByMonth.set(id, null);
    }
  }));
}

/** the leave of one month, said in words — '' when it was never read */
function leaveWords (counts) {
  if (!counts) return '';
  const said = LEAVE_KINDS
    .map(mark => ({ mark: mark, days: Number(counts[LEAVE_KEYS[mark]]) || 0 }))
    .filter(x => x.days > 0)
    .map(x => `${x.days} ${x.mark}`);
  return said.length ? said.join(' · ') : 'None';
}

/** the copies this account filed — everything, for the account that stands in */
function filedRecords () {
  const mine = myEmail();
  return latestCopies(archive)
    .filter(r => (r.kind || 'claim') === 'claim' && stageOf(r) === ARCHIVE_FINAL)
    .filter(r => Auth.isAdmin() ||
                 String(r.created_by || '').toLowerCase() === mine)
    .sort((a, b) => (b.period_year - a.period_year) ||
                    (b.period_month - a.period_month) ||
                    String(a.consultant || '').localeCompare(String(b.consultant || '')));
}

async function renderFiled () {
  const host = document.getElementById('filedList');
  if (!host) return;
  if (!(await loadSigning(host))) return;
  await learnSigningKinds();

  if (!Sync.archiveOn) {
    host.innerHTML =
      '<p class="emptynote"><b>The archive is not switched on yet.</b> ' +
      'BDOS has not shipped the storage for signed copies — see ' +
      'docs/BDOS-CCS-Endpoints.md.</p>';
    return;
  }

  const rows = filedRecords();
  if (!rows.length) {
    host.innerHTML = '<p class="emptynote">Nothing has gone through here yet. ' +
      'A signed time sheet appears in this list once it is submitted on the Upload page.</p>';
    return;
  }

  host.innerHTML = '<p class="emptynote">Reading the sheets…</p>';
  const pairs = rows.map(r => ({ rec: r, sub: submissionForRecord(r) }));
  await learnLeave(pairs.map(p => p.sub && p.sub.id));

  host.innerHTML = '';
  const count = document.createElement('p');
  count.className = 'historycount';
  count.textContent = `${rows.length} month${rows.length > 1 ? 's' : ''} sent on.`;
  host.appendChild(count);
  host.appendChild(filedTable(pairs));
}

function filedTable (pairs) {
  const wrap = document.createElement('div');
  wrap.className = 'history-table-wrap';
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', 'Time sheets sent on');

  const table = document.createElement('table');
  table.className = 'history-table filedtable';

  const head = document.createElement('thead');
  const titles = document.createElement('tr');
  ['Month', 'Consultant', 'Leave that month', 'Signed copy'].forEach(label => {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    titles.appendChild(cell);
  });
  head.appendChild(titles);
  table.appendChild(head);

  const body = document.createElement('tbody');
  pairs.forEach(({ rec, sub }) => {
    const row = document.createElement('tr');

    const when = document.createElement('th');
    when.scope = 'row';
    const m = Number(rec.period_month) || 0;
    when.textContent = `${MONTHS[Math.max(0, m - 1)]} ${rec.period_year || ''}`.trim();
    row.appendChild(when);

    const who = document.createElement('td');
    who.textContent = String(rec.consultant || '').trim() || '(no name)';
    row.appendChild(who);

    const leave = document.createElement('td');
    const words = leaveWords(sub ? leaveByMonth.get(sub.id) : null);
    if (words) {
      leave.textContent = words;
      if (words === 'None') leave.className = 'history-missing';
    } else {
      leave.className = 'history-missing';
      leave.textContent = 'Not read';
      leave.title = 'The sheet this copy was filed against could not be read.';
    }
    row.appendChild(leave);

    const copy = document.createElement('td');
    const item = document.createElement('div');
    item.className = 'history-document';
    const words2 = document.createElement('div');
    words2.className = 'history-document-words';
    const name = document.createElement('span');
    name.className = 'history-document-name';
    name.textContent = (rec.files || [])[0] && rec.files[0].name || 'Signed time sheet';
    words2.appendChild(name);
    const meta = document.createElement('span');
    meta.className = 'history-document-meta';
    meta.textContent = [rec.invoice_no || '',
      rec.created_at ? 'sent ' + new Date(rec.created_at).toLocaleDateString() : '']
      .filter(Boolean).join(' · ');
    words2.appendChild(meta);
    item.appendChild(words2);

    const acts = document.createElement('div');
    acts.className = 'history-document-actions';
    const label = `${rec.consultant || ''} — ${when.textContent}`;
    acts.appendChild(iconButton('view', 'View the signed copy for ' + label,
      'ghost small history-icon', () => viewStored(rec, when.textContent)));
    acts.appendChild(iconButton('download', 'Download the signed copy for ' + label,
      'ghost small history-icon', control => saveStored(rec, control)));
    item.appendChild(acts);
    copy.appendChild(item);
    row.appendChild(copy);

    body.appendChild(row);
  });
  table.appendChild(body);
  wrap.appendChild(table);
  return wrap;
}

/** open the filed copy in the viewer the claims use */
async function viewStored (rec, label) {
  try {
    const full = await Sync.storedOne(rec.id);
    const f = full && (full.files || [])[0];
    if (!f || !f.content) { toast('That file is not on the record.', true); return; }
    const type = f.type || 'application/pdf';
    const bytes = dataUrlToBytes('data:' + type + ';base64,' + f.content);
    openFilePreview(`${rec.consultant || ''} — ${label}`,
                    f.name || 'signed.pdf', new Blob([bytes], { type: type }));
  } catch (err) {
    toast(err.message || 'Could not open that file.', true);
  }
}

/** and save a copy of it */
async function saveStored (rec, control) {
  if (control) control.disabled = true;
  try {
    const full = await Sync.storedOne(rec.id);
    const f = full && (full.files || [])[0];
    if (!f || !f.content) { toast('That file is not on the record.', true); return; }
    const type = f.type || 'application/octet-stream';
    const bytes = dataUrlToBytes('data:' + type + ';base64,' + f.content);
    saveAs(new Blob([bytes], { type: type }), archiveFileName(rec, f));
  } catch (err) {
    toast(err.message || 'Could not fetch that file.', true);
  } finally {
    if (control) control.disabled = false;
  }
}
