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

const ARCHIVE_SLOTS = [
  { key: 'invoice', label: 'Signed invoice' },
  { key: 'claim',   label: 'Signed time sheet' }
];

let archive = [];
let archiveLoaded = false;
let archiveWho = '';
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

/** the names anybody has filed something under, plus whoever is in the form */
function archiveNames () {
  const names = new Set(archive.map(r => String(r.consultant || '').trim()).filter(Boolean));
  const here = String(S.consultant.name || '').trim();
  if (here) names.add(here);
  return [...names].sort();
}

function paintArchive () {
  const host = document.getElementById('archiveList');
  const who  = document.getElementById('archiveWho');
  if (!host) return;

  if (who) {
    const names = archiveNames();
    who.innerHTML = '<option value="">everybody</option>';
    names.forEach(n => {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n;              // names are typed by people, never markup
      who.appendChild(o);
    });
    who.value = names.indexOf(archiveWho) >= 0 ? archiveWho : '';
    archiveWho = who.value;
    who.onchange = () => { archiveWho = who.value; paintArchive(); };
  }

  host.innerHTML = '';

  // whoever prepares claims is the one holding the signed paper
  if (!Auth.role() || Auth.prepares()) host.appendChild(archiveUploadCard());

  const rows = archive
    .filter(r => !archiveWho || String(r.consultant || '').trim() === archiveWho)
    .slice()
    .sort((a, b) =>
      (b.period_year - a.period_year) || (b.period_month - a.period_month) ||
      String(a.consultant || '').localeCompare(String(b.consultant || '')));

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'emptynote';
    empty.textContent = archiveWho
      ? 'Nothing filed for ' + archiveWho + ' yet.'
      : 'Nothing filed yet. When a claim comes back signed, put the two documents here.';
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

function archiveRow (r) {
  const row = document.createElement('div');
  row.className = 'archrow';

  const head = document.createElement('div');
  head.className = 'archhead';
  const when = document.createElement('b');
  const m = Number(r.period_month) || 0;
  when.textContent = (MONTHS[Math.max(0, m - 1)] + ' ' + (r.period_year || '')).trim();
  head.appendChild(when);

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
  const chosen = inputs.map(i => i.files && i.files[0]).filter(Boolean);
  if (!chosen.length) {
    toast('Choose the signed documents first.', true);
    return;
  }
  if (!String(S.consultant.name || '').trim()) {
    toast('Pick a profile first — the copies are filed against a person.', true);
    return;
  }
  const tooBig = chosen.filter(f => f.size > ARCHIVE_MAX_BYTES)[0];
  if (tooBig) {
    toast(tooBig.name + ' is ' + Math.round(tooBig.size / 1048576) + ' MB — ' +
          Math.round(ARCHIVE_MAX_BYTES / 1048576) + ' MB is the limit.', true);
    return;
  }

  archiveBusy = true;
  go.disabled = true;
  const was = go.textContent;
  go.textContent = 'Filing…';
  try {
    const files = [];
    for (const f of chosen) files.push(await Sync.readFile(f));
    await Sync.store(S, files, note.value.trim());
    toast(files.length + ' document' + (files.length > 1 ? 's' : '') + ' filed for ' +
          MONTHS[S.timesheet.month] + ' ' + S.timesheet.year + '.');
    await renderArchive(true);
  } catch (err) {
    toast(err.message || 'Could not file them.', true);
  } finally {
    archiveBusy = false;
    go.disabled = false;
    go.textContent = was;
  }
}
