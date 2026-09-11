/* =======================================================================
   archive.js — the signed copies on file

   approvals.js holds a claim as software holds it: a form, a status, a
   trail of who moved it. This is the other half. A month is only really
   finished when somebody has the signed invoice and the signed time sheet
   as files — the ones with real signatures on them, scanned back in — and
   until now those lived in whichever person's Downloads folder happened
   to have them.

   So they are filed here instead, against the person and the month, and
   any month can be produced again a year later without asking anybody to
   go looking. The endpoints are in docs/BDOS-CCS-Endpoints.md.
   ======================================================================= */

/* Big enough for a scan of two pages, small enough that a mis-picked video
   is refused rather than uploaded. Base64 adds about a third on the way. */
const ARCHIVE_MAX_BYTES = 12 * 1024 * 1024;

/* The time sheet first, as everywhere else: it is the evidence, and the
   invoice is the bill that follows from it. */
const ARCHIVE_SLOTS = [
  { key: 'claim',   label: 'Signed time sheet' },
  { key: 'invoice', label: 'Signed invoice' }
];

let archive = [];
let archiveLoaded = false;
let archiveBusy = false;

async function renderArchive (force) {
  const host = document.getElementById('archiveList');
  if (!host) return;

  if (!Sync.on) {
    archiveLoaded = false;
    host.innerHTML =
      '<p class="emptynote"><b>Not connected to the database.</b> ' +
      'Signed copies are kept in the shared database, which this browser cannot ' +
      'reach right now. Nothing has been lost &mdash; the files are still wherever ' +
      'they were downloaded to.</p>';
    return;
  }

  if (force || !archiveLoaded) {
    host.innerHTML = '<p class="emptynote">Loading…</p>';
    archive = await Sync.stored('', '');
    archiveLoaded = true;
  }

  /* The archive is newer than the rest of the storage and may not be
     deployed yet. "Nothing filed" would be a lie in that case, and the kind
     that has somebody hunting for files that were never uploaded. */
  if (!Sync.archiveOn) {
    host.innerHTML =
      '<p class="emptynote"><b>The archive is not switched on yet.</b> ' +
      'BDOS has not shipped the storage for signed copies — see ' +
      'docs/BDOS-CCS-Endpoints.md. Everything else works as it does now; keep ' +
      'the signed files where they are and put them here once it is there.</p>';
    return;
  }
  paintArchive();
}

/**
 * Load the archive once, quietly, for anything that only wants to read it —
 * the status table asks whether a signed copy has come back yet, and that
 * question should not depend on somebody having opened this list first.
 */
async function ensureArchive () {
  if (!Sync.on || archiveLoaded) return;
  archive = await Sync.stored('', '');
  archiveLoaded = true;
}

/**
 * Has the signed copy of one person's document for one month come back?
 *
 * A record written before the archive knew about documents carries no kind
 * and is counted for both — it was filed for that month, and saying "not on
 * file" about a file that is on file is the worse mistake.
 */
/* The stage a record with no stage on it is read as. Everything filed before
   the project manager signed anything was the finished document. */
const ARCHIVE_FINAL = 'pending_signature';
const stageOf = r => r.stage || ARCHIVE_FINAL;

/**
 * One filed record for a person, a month and a document.
 * @param {string} [stage] which signing it came from; the finished one when
 *        left out, because that is what "is it on file" nearly always means
 */
function archiveFor (consultant, year, month, kind, stage) {
  const who = String(consultant || '').trim();
  const want = stage || ARCHIVE_FINAL;
  return archive.filter(r =>
    String(r.consultant || '').trim() === who &&
    Number(r.period_year) === Number(year) &&
    Number(r.period_month) === Number(month) + 1 &&
    (!r.kind || r.kind === kind) &&
    stageOf(r) === want)[0] || null;
}

const archiveHas = (consultant, year, month, kind, stage) =>
  !!archiveFor(consultant, year, month, kind, stage);

/** who uploaded the signed copy back, and when — '' when nobody has */
function archiveBy (consultant, year, month, kind, stage) {
  const rec = archiveFor(consultant, year, month, kind, stage);
  if (!rec) return '';
  const when = rec.created_at ? new Date(rec.created_at).toLocaleDateString() : '';
  return (rec.created_by || 'somebody') + (when ? ' on ' + when : '');
}

/** may the account that is signed in put documents on file? */
function canFileSigned () {
  return !Auth.role() || Auth.prepares() || Auth.places();
}

/**
 * The Status step's list: the month the table above is showing, and nothing
 * else. One month is the question that step asks — the whole record is the
 * History step, which is the administrator's.
 */
function paintArchive () {
  const host = document.getElementById('archiveList');
  if (!host) return;

  const when = (typeof statusMonth === 'object' && statusMonth)
    ? statusMonth : { y: S.timesheet.year, m: S.timesheet.month };

  const head = document.getElementById('archiveHead');
  if (head) head.textContent = `Signed copies on file — ${MONTHS[when.m]} ${when.y}`;

  host.innerHTML = '';

  // whoever is holding the signed paper: the consultant who prepared it, and
  // always the PA at the end, because placing the signature is their part
  if (canFileSigned()) host.appendChild(archiveUploadCard());

  const rows = archive
    .filter(r => Number(r.period_year) === when.y && Number(r.period_month) === when.m + 1)
    // a consultant sees their own filed copies, the way they see their own rows
    .filter(r => Auth.seesEveryone() ||
                 String(r.consultant || '').trim() === String(S.consultant.name || '').trim())
    .slice()
    .sort((a, b) => String(a.consultant || '').localeCompare(String(b.consultant || '')));

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'emptynote';
    empty.textContent = `Nothing on file for ${MONTHS[when.m]} ${when.y} yet. ` +
      'When a document comes back signed, upload it above.';
    host.appendChild(empty);
    return;
  }

  let seen = null;
  rows.forEach(r => {
    const name = String(r.consultant || '').trim() || '(no name)';
    if (name !== seen) {
      seen = name;
      const h = document.createElement('h4');
      h.className = 'archiveperson';
      h.textContent = name;
      host.appendChild(h);
    }
    host.appendChild(archiveRow(r));
  });
}

/* =======================================================================
   The History step — everything, for the administrator

   Status answers "where is this month". Somebody has to be able to answer
   "where is last March" as well, and that is a different screen: no upload,
   no approvals, just every signed copy that has ever been filed, newest
   first, filtered by person and by year.
   ======================================================================= */

let historyWho = '';
let historyYear = '';
/* Which copies the History step is listing. Finished by default: the ones
   the PA put back after the signatures were on them, which is what anybody
   asking for "September" actually means. */
let historyStage = 'final';
let downloading = false;

async function renderHistory (force) {
  const host = document.getElementById('historyList');
  if (!host) return;

  if (!Sync.on) {
    archiveLoaded = false;
    host.innerHTML =
      '<p class="emptynote"><b>Not connected to the database.</b> ' +
      'The history lives in the shared database, which this browser cannot reach ' +
      'right now.</p>';
    return;
  }

  if (force) archiveLoaded = false;
  host.innerHTML = '<p class="emptynote">Loading…</p>';
  await ensureArchive();

  if (!Sync.archiveOn) {
    host.innerHTML =
      '<p class="emptynote"><b>The archive is not switched on yet.</b> ' +
      'BDOS has not shipped the storage for signed copies — see ' +
      'docs/BDOS-CCS-Endpoints.md. Once it is there, every month filed from the ' +
      'Status step appears here.</p>';
    return;
  }
  paintHistory();
}

function paintHistory () {
  const host = document.getElementById('historyList');
  const who = document.getElementById('historyWho');
  const year = document.getElementById('historyYear');
  if (!host) return;

  if (who) {
    const names = [...new Set(archive.map(r => String(r.consultant || '').trim()))]
      .filter(Boolean).sort();
    fillSelect(who, 'everybody', names, names.map(n => n));
    who.value = names.indexOf(historyWho) >= 0 ? historyWho : '';
    historyWho = who.value;
    who.onchange = () => { historyWho = who.value; paintHistory(); };
  }
  if (year) {
    const years = [...new Set(archive.map(r => Number(r.period_year)).filter(Boolean))]
      .sort((a, b) => b - a);
    fillSelect(year, 'every year', years.map(String), years.map(String));
    year.value = years.map(String).indexOf(historyYear) >= 0 ? historyYear : '';
    historyYear = year.value;
    year.onchange = () => { historyYear = year.value; paintHistory(); };
  }

  const stage = document.getElementById('historyStage');
  if (stage) {
    stage.value = historyStage;
    stage.onchange = () => { historyStage = stage.value; paintHistory(); };
  }

  const rows = historyRows();
  host.innerHTML = '';
  const count = document.createElement('p');
  count.className = 'historycount';
  const files = rows.reduce((n, r) => n + ((r.files || []).length), 0);
  count.textContent = rows.length
    ? `${rows.length} record${rows.length > 1 ? 's' : ''}, ${files} file${files > 1 ? 's' : ''}.`
    : '';
  if (rows.length) host.appendChild(count);

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'emptynote';
    empty.textContent = (historyWho || historyYear)
      ? 'Nothing on file for that.'
      : 'Nothing has been filed yet.';
    host.appendChild(empty);
    return;
  }

  // grouped by month, because that is how anybody asks for one
  let seen = null;
  rows.forEach(r => {
    const m = Number(r.period_month) || 0;
    const label = `${MONTHS[Math.max(0, m - 1)]} ${r.period_year || ''}`.trim();
    if (label !== seen) {
      seen = label;
      const h = document.createElement('h4');
      h.className = 'archiveperson';
      h.textContent = label;
      host.appendChild(h);
    }
    host.appendChild(archiveRow(r, true));
  });
}

/** what the History step is showing, after its three filters */
function historyRows () {
  return archive
    .filter(r => !historyWho || String(r.consultant || '').trim() === historyWho)
    .filter(r => !historyYear || String(r.period_year) === historyYear)
    .filter(r => historyStage !== 'final' || stageOf(r) === ARCHIVE_FINAL)
    .slice()
    .sort((a, b) =>
      (b.period_year - a.period_year) || (b.period_month - a.period_month) ||
      String(a.consultant || '').localeCompare(String(b.consultant || '')));
}

/**
 * Take a copy of everything listed.
 *
 * Whoever keeps the records needs the whole month, not a file at a time —
 * so this walks what the filters are showing and saves every file in it,
 * named for the person and the month rather than for whatever the scanner
 * called it. The browser asks once whether it may save several files; say
 * yes and it stops asking.
 */
async function downloadAllHistory (btn) {
  if (downloading) return;
  const rows = historyRows();
  const note = document.getElementById('downloadNote');
  const say = (text, bad) => {
    if (!note) return;
    note.hidden = false;
    note.className = 'keynote' + (bad ? ' warn' : '');
    note.textContent = text;
  };

  if (!rows.length) { say('There is nothing listed to download.', true); return; }

  downloading = true;
  const was = btn.textContent;
  btn.disabled = true;
  let saved = 0;
  const failed = [];

  try {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      btn.textContent = `Downloading ${i + 1} of ${rows.length}…`;
      say(`${saved} file${saved === 1 ? '' : 's'} saved so far. Leave this step open until it finishes.`);
      try {
        const rec = await Sync.storedOne(r.id);
        const files = (rec && rec.files) || [];
        for (const f of files) {
          const type = f.type || 'application/octet-stream';
          const bytes = dataUrlToBytes('data:' + type + ';base64,' + (f.content || ''));
          saveAs(new Blob([bytes], { type: type }), archiveFileName(r, f));
          saved++;
          // the browser needs a breath between saves, or it drops some
          await new Promise(res => setTimeout(res, 250));
        }
      } catch (err) {
        failed.push(`${r.consultant || r.id}: ${err.message}`);
      }
    }
  } finally {
    downloading = false;
    btn.disabled = false;
    btn.textContent = was;
  }

  say(failed.length
    ? `${saved} file${saved === 1 ? '' : 's'} saved. ${failed.length} could not be: ${failed[0]}`
    : `${saved} file${saved === 1 ? '' : 's'} saved to your Downloads folder.`, !!failed.length);
}

/** named for the person and the month, not for whatever the scanner called it */
function archiveFileName (r, f) {
  const m = Number(r.period_month) || 0;
  const when = `${MON3[Math.max(0, m - 1)]} ${r.period_year || ''}`.trim();
  const who = safeFile(r.consultant) || 'Consultant';
  const dot = String(f.name || '').lastIndexOf('.');
  const ext = dot > 0 ? String(f.name).slice(dot) : '.pdf';
  const what = safeFile(kindLabel(r.kind || 'claim'));
  return `${when} - ${who} - ${what}${ext}`;
}

/** rebuild a <select> without losing the caller's placeholder */
function fillSelect (el, placeholder, values, labels) {
  el.innerHTML = '';
  const first = document.createElement('option');
  first.value = '';
  first.textContent = placeholder;
  el.appendChild(first);
  values.forEach((v, i) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = labels[i];        // names are typed by people, never markup
    el.appendChild(o);
  });
}

/**
 * One filed record.
 * @param {boolean} [namePerson] head it with the consultant rather than the
 *        month — History groups by month, so the month is already above it
 */
function archiveRow (r, namePerson) {
  const row = document.createElement('div');
  row.className = 'archrow';

  const head = document.createElement('div');
  head.className = 'archhead';
  const when = document.createElement('b');
  const m = Number(r.period_month) || 0;
  when.textContent = namePerson
    ? (String(r.consultant || '').trim() || '(no name)')
    : (MONTHS[Math.max(0, m - 1)] + ' ' + (r.period_year || '')).trim();
  head.appendChild(when);

  if (r.kind && typeof kindLabel === 'function') {
    const tag = document.createElement('span');
    tag.className = 'doctag ' + r.kind;
    tag.textContent = kindLabel(r.kind);
    head.appendChild(tag);
  }
  // a copy signed by the project manager on the way through is not the
  // finished article, and a list that did not say so would be misleading
  if (stageOf(r) !== ARCHIVE_FINAL) {
    const stage = document.createElement('span');
    stage.className = 'stagetag';
    stage.textContent = 'reviewed copy';
    head.appendChild(stage);
  }

  const meta = document.createElement('span');
  meta.textContent = [
    r.invoice_no || '',
    r.created_by ? 'filed by ' + r.created_by : '',
    r.created_at ? new Date(r.created_at).toLocaleDateString() : ''
  ].filter(Boolean).join(' · ');
  head.appendChild(meta);
  row.appendChild(head);

  if (r.note) {
    const note = document.createElement('p');
    note.className = 'subnote';
    note.textContent = r.note;
    row.appendChild(note);
  }

  const files = document.createElement('div');
  files.className = 'archfiles';
  (r.files || []).forEach((f, i) => {
    const b = button(f.name || ('Document ' + (i + 1)), 'ghost small',
                     () => downloadStored(r.id, i, f.name));
    b.title = f.size ? Math.round(f.size / 1024) + ' KB' : '';
    files.appendChild(b);
  });
  if (!(r.files || []).length) {
    const none = document.createElement('span');
    none.className = 'archnone';
    none.textContent = 'no files on this record';
    files.appendChild(none);
  }
  row.appendChild(files);
  return row;
}

/** pull one filed document back down and hand it to the browser to save */
async function downloadStored (id, index, name) {
  try {
    const rec = await Sync.storedOne(id);
    const f = rec && (rec.files || [])[index];
    if (!f || !f.content) { toast('That file is not on the record.', true); return; }
    const type = f.type || 'application/octet-stream';
    const bytes = dataUrlToBytes('data:' + type + ';base64,' + f.content);
    saveAs(new Blob([bytes], { type: type }), name || f.name || 'document');
  } catch (err) {
    toast(err.message || 'Could not fetch that file.', true);
  }
}

/* -------------------------------------------------------------------
   Filing a month

   The card files whatever the earlier steps say this claim is: the
   profile that is open, the month on the sheet, the invoice number it
   carries. That is deliberate — there is no second place to type a name
   and a month, and so no second place to get them wrong.
   ------------------------------------------------------------------- */

function archiveUploadCard () {
  const card = document.createElement('div');
  card.className = 'archupload';

  const head = document.createElement('h4');
  head.textContent = 'File the signed copies';
  card.appendChild(head);

  const lead = document.createElement('p');
  lead.className = 'archlead';
  lead.textContent =
    'They are filed under ' +
    (String(S.consultant.name || '').trim() || '(no name — pick a profile first)') +
    ' for ' + MONTHS[S.timesheet.month] + ' ' + S.timesheet.year +
    (S.invoice.no ? ', invoice ' + S.invoice.no : '') +
    '. Change the profile or the month on the earlier steps to file another one.';
  card.appendChild(lead);

  const pickers = document.createElement('div');
  pickers.className = 'archpickers';
  const inputs = ARCHIVE_SLOTS.map(slot => {
    const label = document.createElement('label');
    label.className = 'archslot';
    const cap = document.createElement('span');
    cap.textContent = slot.label;
    label.appendChild(cap);
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.pdf,.png,.jpg,.jpeg,image/*,application/pdf';
    label.appendChild(inp);
    pickers.appendChild(label);
    return inp;
  });
  card.appendChild(pickers);

  const note = document.createElement('input');
  note.className = 'dinput archnote';
  note.placeholder = 'Anything worth saying about this month (optional)';
  card.appendChild(note);

  const bar = document.createElement('div');
  bar.className = 'btnrow';
  const go = button('File them', 'primary', () => fileSigned(inputs, note, go));
  bar.appendChild(go);
  card.appendChild(bar);
  return card;
}

async function fileSigned (inputs, note, go) {
  if (archiveBusy) return;

  /* Which slot a file was put in is which document it is, and that is the
     whole of it — there is nothing to type and nothing to get wrong. Two
     files means two records, one per document, so the status table can say
     "the time sheet is back, the invoice is not". */
  const chosen = ARCHIVE_SLOTS
    .map((slot, i) => ({ kind: slot.key, file: inputs[i].files && inputs[i].files[0] }))
    .filter(x => x.file);

  if (!chosen.length) {
    toast('Choose the signed documents first.', true);
    return;
  }
  if (!String(S.consultant.name || '').trim()) {
    toast('Pick a profile first — the copies are filed against a person.', true);
    return;
  }
  const tooBig = chosen.filter(x => x.file.size > ARCHIVE_MAX_BYTES)[0];
  if (tooBig) {
    toast(tooBig.file.name + ' is ' + Math.round(tooBig.file.size / 1048576) + ' MB — ' +
          Math.round(ARCHIVE_MAX_BYTES / 1048576) + ' MB is the limit.', true);
    return;
  }

  archiveBusy = true;
  go.disabled = true;
  const was = go.textContent;
  go.textContent = 'Filing…';
  try {
    for (const one of chosen) {
      const payload = await Sync.readFile(one.file);
      payload.name = kindLabel(one.kind) + ' (signed) — ' + payload.name;
      await Sync.store(S, [payload], note.value.trim(), one.kind, ARCHIVE_FINAL);
    }
    toast(chosen.map(x => kindLabel(x.kind)).join(' and ') + ' filed for ' +
          MONTHS[S.timesheet.month] + ' ' + S.timesheet.year + '.');
    await renderArchive(true);
    if (typeof renderApprovals === 'function') await renderApprovals();
  } catch (err) {
    toast(err.message || 'Could not file them.', true);
  } finally {
    archiveBusy = false;
    go.disabled = false;
    go.textContent = was;
  }
}
