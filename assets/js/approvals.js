/* =======================================================================
   approvals.js — a claim on its way through the people who sign it

   A month is two documents, and they are not the same document. The invoice
   is a bill; the time sheet is the evidence for it. Each goes for approval
   on its own and carries its own status the whole way, so the project
   manager can be happy with the sheet and not with the invoice, and say so,
   without holding up the half that was fine.

   Each document is prepared by a consultant, reviewed by the project
   manager, approved by the HOD, and then the HOD's signature is placed on
   it by their PA. Four people, three stages, and this screen is what each
   of them sees: a table of everything, a light per stage, and the two
   things they can do about the rows that are theirs.

   Nothing here edits a claim. An approver reads the document as it will be
   printed — the PDF is rebuilt from the submitted form and shown in the
   same viewer the consultant used — and then signs their own box or sends
   it back with a reason. BDOS decides whether a move is allowed; this file
   asks, and says plainly when the answer is no.
   ======================================================================= */

const STATUS_TEXT = {
  pending_manager:   'With the project manager',
  pending_boss:      'With the HOD',
  pending_signature: 'Waiting for the HOD signature',
  returned:          'Sent back',
  complete:          'Complete'
};

/** which role a status is waiting on — the client's copy of BDOS's stages */
const STATUS_ROLE = {
  pending_manager:   'manager',
  pending_boss:      'boss',
  pending_signature: 'pa'
};

/* The three stages in order, and what each column of the table is called.
   `role` is who it waits on; `sign` is the box that gets filled there, and
   nothing is signed while a document merely sits with the HOD — they
   approve, and their PA places the signature afterwards. */
const STAGES = [
  { key: 'pending_manager',   head: 'Reviewed', who: 'manager' },
  { key: 'pending_boss',      head: 'Approved', who: 'boss' },
  { key: 'pending_signature', head: 'Signed',   who: 'pa' }
];
const STAGE_KEYS = STAGES.map(s => s.key);

/* Which box gets signed at which stage — by the stage, not by whoever is
   signing, because the admin can stand in at any of them. The HOD's box is
   filled when it reaches the PA: placing that signature is the PA's whole
   part in this, and the HOD signs nothing themselves.

   Only the time sheet has these boxes. An invoice has one signature on it,
   the consultant's, and an approver approving a bill does not sign it. */
const STAGE_SIGNS = {
  pending_manager:   { sig: 'pm',  name: 'reviewName', date: 'reviewDate' },
  pending_signature: { sig: 'hod', name: 'apprName',   date: 'apprDate' }
};

const LAST_SIG_KEY = 'ccs.mysignature';      // this approver's own, on this machine

/* Rows sent before a claim was split in two carry no `kind`, and a list
   endpoint that has not learned the field carries none either. Reading the
   form itself always answers, so up to this many are read — enough for a
   month's worth of open work, and bounded so a year of history cannot turn
   opening this screen into a download. */
const KIND_LOOKUP_MAX = 24;

let subs = [];                 // what the last load returned
let openRow = '';              // the submission whose panel is expanded
let busy = false;
let onlyMine = false;          // the "waiting on me" filter
const kindCache = new Map();   // submission id → 'invoice' | 'claim'

/* -------------------------------------------------------------------
   A signature pad that belongs to nothing else

   The pads in the form are bound to the form's own state. An approver is
   not filling that form in, so this one stands alone: draw or upload, and
   hand back a PNG when asked.
   ------------------------------------------------------------------- */
function makePad (host, initial) {
  host.innerHTML = `
    <div class="sigslot">
      <canvas></canvas>
      <div class="sigbtns">
        <button type="button" data-a="clear">Clear</button>
        <button type="button" data-a="upload">Upload</button>
        <input type="file" accept="image/*" hidden>
      </div>
      <span class="sighint">Draw here, or upload an image</span>
    </div>`;

  const canvas = host.querySelector('canvas');
  const hint = host.querySelector('.sighint');
  const pad = new SignaturePad(canvas, {
    backgroundColor: 'rgba(255,255,255,0)', penColor: '#0b1f4b',
    minWidth: 0.6, maxWidth: 1.9
  });
  let uploaded = '';

  const fit = () => {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const w = canvas.offsetWidth || 260, h = canvas.offsetHeight || 62;
    canvas.width = w * ratio; canvas.height = h * ratio;
    canvas.getContext('2d').scale(ratio, ratio);
    pad.clear();
  };
  setTimeout(fit, 20);

  const say = on => { hint.textContent = on ? '✓ Signed' : 'Draw here, or upload an image'; };

  host.querySelector('[data-a="clear"]').addEventListener('click', () => {
    pad.clear(); uploaded = ''; say(false);
  });
  const file = host.querySelector('input[type=file]');
  host.querySelector('[data-a="upload"]').addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { uploaded = String(r.result || ''); pad.clear(); say(true); };
    r.readAsDataURL(f);
    file.value = '';
  });
  pad.addEventListener('endStroke', () => { uploaded = ''; say(true); });

  if (initial) {
    uploaded = initial;
    say(true);
  }

  return {
    value: () => uploaded || (pad.isEmpty() ? '' : pad.toDataURL('image/png')),
    isEmpty: () => !uploaded && pad.isEmpty()
  };
}

function myLastSignature () {
  try { return localStorage.getItem(LAST_SIG_KEY) || ''; } catch (e) { return ''; }
}
function rememberSignature (png) {
  try { localStorage.setItem(LAST_SIG_KEY, png); } catch (e) { /* private mode */ }
}

/* -------------------------------------------------------------------
   Reading a row
   ------------------------------------------------------------------- */

function myRole () { return Auth.role(); }
function myEmail () { return String((Auth.user() || {}).email || '').toLowerCase(); }

/** can the account that is signed in move this document on? */
function waitingOnMe (sub) {
  if (!STATUS_ROLE[sub.status]) return false;          // finished, or sent back
  return Auth.isAdmin() || STATUS_ROLE[sub.status] === myRole();
}

/** whose turn it is, said plainly */
function waitingOnWhom (sub) {
  return Auth.roleName(STATUS_ROLE[sub.status]) || '';
}

function periodOf (sub) {
  if (!sub.period_year) return '';
  const m = Number(sub.period_month) || 0;
  return `${MON3[Math.max(0, m - 1)]} ${sub.period_year}`;
}

/** which document a row is, using whatever answered when the list was read */
function kindOf (sub) {
  return Sync.kindOf(sub) || kindCache.get(sub.id) || 'claim';
}

/** and the boxes it gets signed in — an invoice has none */
function signsFor (sub) {
  return kindOf(sub) === 'claim' ? STAGE_SIGNS[sub.status] : null;
}

/**
 * Where one stage stands for one document.
 * @returns {'done'|'waiting'|'returned'|'todo'}
 */
function stageState (sub, stageKey) {
  const at = STAGE_KEYS.indexOf(stageKey);

  if (sub.status === 'complete') return 'done';

  if (sub.status === 'returned') {
    // the stage that sent it back is the one to point at; the ones before it
    // had already said yes, and saying so is the point of the row
    const back = (sub.history || []).slice().reverse()
      .filter(h => h.action === 'return')[0];
    const from = STAGE_KEYS.indexOf((back && back.from) || 'pending_manager');
    if (from < 0) return 'todo';
    if (at === from) return 'returned';
    return at < from ? 'done' : 'todo';
  }

  const now = STAGE_KEYS.indexOf(sub.status);
  if (now < 0) return 'todo';
  if (at < now) return 'done';
  return at === now ? 'waiting' : 'todo';
}

/* -------------------------------------------------------------------
   The list
   ------------------------------------------------------------------- */

async function renderApprovals () {
  const host = document.getElementById('approvalList');
  if (!host) return;

  /* The same table answers two different questions. Somebody who prepares
     claims is asking where theirs got to; an approver is asking what is
     waiting on them. Naming the screen for whoever opened it costs nothing
     and saves them reading it twice. */
  const prepares = !Auth.role() || Auth.prepares();
  const head = document.getElementById('approvalHead');
  const lead = document.getElementById('approvalLead');
  if (head) head.textContent = prepares ? 'Status' : 'Approvals';
  if (lead) {
    lead.textContent = prepares
      ? 'Every document you have sent, and where each one has got to.'
      : 'What is waiting on you, and where everything else has got to.';
  }

  if (!Sync.on) {
    host.innerHTML = `
      <p class="emptynote"><b>Not connected to the database.</b>
      Approvals travel between five people on five machines, so they need the
      shared database — which this browser cannot reach right now. Nothing has
      been lost: the form is still saved here.</p>`;
    return;
  }

  host.innerHTML = '<p class="emptynote">Loading…</p>';
  try {
    subs = await Sync.submissions('');
  } catch (err) {
    host.innerHTML = `<p class="emptynote">Could not read the approvals: ${err.message}</p>`;
    return;
  }
  await learnKinds();
  paintApprovals();
}

/**
 * Find out which document each row is, for the rows that did not say.
 *
 * A row carries its kind as a field of its own, which the list endpoint
 * returns and this then needs nothing for. Until BDOS learns that field the
 * answer is inside the stored form, which costs a request each — so they are
 * fetched once per session, in parallel, and only so many.
 */
async function learnKinds () {
  const missing = subs.filter(s => !Sync.kindOf(s) && !kindCache.has(s.id));
  if (!missing.length) return;
  await Promise.all(missing.slice(0, KIND_LOOKUP_MAX).map(async s => {
    try {
      const full = await Sync.submission(s.id);
      kindCache.set(s.id, Sync.kindOf(full) || 'claim');
    } catch (err) {
      kindCache.set(s.id, 'claim');           // unreadable: read it as it always was
    }
  }));
}

function paintApprovals () {
  const host = document.getElementById('approvalList');
  if (!host) return;

  host.innerHTML = '';

  if (!subs.length) {
    host.innerHTML = (!Auth.role() || Auth.prepares())
      ? '<p class="emptynote">Nothing submitted yet. Fill the claim in, then send it from the Submit step.</p>'
      : '<p class="emptynote">Nothing has been sent for approval yet.</p>';
    return;
  }

  const mine = subs.filter(waitingOnMe);
  const rows = onlyMine ? mine : subs;

  host.appendChild(filterBar(mine.length));

  /* The admin stands in at every stage, so they are the one who can end up
     with a pile. Clearing it one row at a time is the same decision made over
     and over, so they can make it once. */
  if (Auth.isAdmin() && mine.length > 1) host.appendChild(bulkBar(mine));

  if (!rows.length) {
    const none = document.createElement('p');
    none.className = 'emptynote';
    none.textContent = 'Nothing is waiting on you.';
    host.appendChild(none);
    return;
  }

  host.appendChild(statusTable(rows));
}

function filterBar (waiting) {
  const bar = document.createElement('div');
  bar.className = 'statusbar';

  const count = document.createElement('span');
  count.className = 'statuscount';
  count.textContent = waiting
    ? `${waiting} document${waiting > 1 ? 's are' : ' is'} waiting on you.`
    : 'Nothing is waiting on you.';
  bar.appendChild(count);

  const toggle = document.createElement('label');
  toggle.className = 'statustoggle';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = onlyMine;
  box.addEventListener('change', () => { onlyMine = box.checked; paintApprovals(); });
  toggle.appendChild(box);
  toggle.appendChild(document.createTextNode(' Only what is waiting on me'));
  bar.appendChild(toggle);

  return bar;
}

/* -------------------------------------------------------------------
   The table

   One row per document, because that is what gets approved. The three
   stage columns are the whole point of the screen: a light each, so
   "where is Amila's September invoice" is answered by looking rather than
   by opening anything.
   ------------------------------------------------------------------- */

function statusTable (rows) {
  const wrap = document.createElement('div');
  wrap.className = 'statuswrap';

  const table = document.createElement('table');
  table.className = 'statustable';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  ['Consultant', 'Month', 'Document', 'Invoice No.']
    .forEach(h => hr.appendChild(th(h)));
  STAGES.forEach(st => {
    const cell = th(st.head);
    cell.className = 'stagecol';
    cell.title = 'Waiting on the ' + Auth.roleName(st.who);
    hr.appendChild(cell);
  });
  hr.appendChild(th(''));
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  sortRows(rows).forEach(sub => {
    tbody.appendChild(statusRow(sub));
    if (openRow === sub.id) tbody.appendChild(decideRow(sub));
  });
  table.appendChild(tbody);

  wrap.appendChild(table);
  wrap.appendChild(legend());
  return wrap;
}

function th (text) {
  const cell = document.createElement('th');
  cell.textContent = text;
  return cell;
}

/** newest month first, then by person, then invoice before time sheet */
function sortRows (rows) {
  const order = { invoice: 0, claim: 1 };
  return rows.slice().sort((a, b) =>
    (b.period_year - a.period_year) ||
    (b.period_month - a.period_month) ||
    String(a.consultant || '').localeCompare(String(b.consultant || '')) ||
    (order[kindOf(a)] - order[kindOf(b)]));
}

function statusRow (sub) {
  const tr = document.createElement('tr');
  tr.className = 'statusrow'
    + (waitingOnMe(sub) ? ' urgent' : '')
    + (sub.status === 'complete' ? ' done' : '')
    + (sub.status === 'returned' ? ' back' : '');

  tr.appendChild(td(sub.consultant || '(no name)', 'who'));
  tr.appendChild(td(periodOf(sub), 'when'));

  const doc = td('', 'doc');
  const tag = document.createElement('span');
  tag.className = 'doctag ' + kindOf(sub);
  tag.textContent = kindLabel(kindOf(sub));
  doc.appendChild(tag);
  tr.appendChild(doc);

  tr.appendChild(td(sub.invoice_no || '—', 'invno'));

  STAGES.forEach(st => {
    const state = stageState(sub, st.key);
    const cell = document.createElement('td');
    cell.className = 'stagecell';
    const lamp = document.createElement('span');
    lamp.className = 'lamp ' + state;
    lamp.textContent = state === 'done' ? '✓'
      : state === 'returned' ? '✕'
      : state === 'waiting' ? '●' : '';
    lamp.title = `${st.head} — ` + (
      state === 'done' ? 'done'
      : state === 'waiting' ? 'waiting on the ' + Auth.roleName(st.who)
      : state === 'returned' ? 'sent back by the ' + Auth.roleName(st.who)
      : 'not reached yet');
    cell.appendChild(lamp);
    tr.appendChild(cell);
  });

  const acts = document.createElement('td');
  acts.className = 'statusacts';
  acts.appendChild(button('Read', 'ghost small', () => reviewSubmission(sub.id)));

  if (waitingOnMe(sub)) {
    const verb = sub.status === 'pending_signature' ? 'Sign' : 'Approve';
    acts.appendChild(button(verb, 'small', () => toggleDecide(sub.id, 'approve')));
    acts.appendChild(button('Reject', 'ghost small danger', () => toggleDecide(sub.id, 'return')));
  }
  if (sub.status === 'returned' && (sub.created_by === myEmail() || Auth.isAdmin())) {
    acts.appendChild(button('Open', 'ghost small', () => loadIntoForm(sub.id)));
    acts.appendChild(button('Resubmit', 'small', () => toggleDecide(sub.id, 'resubmit')));
  }
  tr.appendChild(acts);
  return tr;
}

function td (text, cls) {
  const cell = document.createElement('td');
  if (cls) cell.className = cls;
  cell.textContent = text;                 // names arrive from other people
  return cell;
}

function legend () {
  const box = document.createElement('div');
  box.className = 'statuslegend';
  [['done', '✓', 'done'],
   ['waiting', '●', 'waiting here now'],
   ['returned', '✕', 'sent back from here'],
   ['todo', '', 'not reached yet']
  ].forEach(([cls, mark, text]) => {
    const item = document.createElement('span');
    const lamp = document.createElement('i');
    lamp.className = 'lamp ' + cls;
    lamp.textContent = mark;
    item.appendChild(lamp);
    item.appendChild(document.createTextNode(' ' + text));
    box.appendChild(item);
  });
  return box;
}

/* -------------------------------------------------------------------
   Bulk decisions, for the account that stands in everywhere
   ------------------------------------------------------------------- */

function bulkBar (waiting) {
  const bar = document.createElement('div');
  bar.className = 'bulkbar';

  const said = document.createElement('span');
  said.textContent = 'Clear them in one go:';
  bar.appendChild(said);

  const note = document.createElement('input');
  note.className = 'dinput';
  note.placeholder = 'Reason — needed to reject';
  bar.appendChild(note);

  bar.appendChild(button('Approve all', 'small', () => bulk(waiting, 'approve', note.value.trim())));
  bar.appendChild(button('Reject all', 'ghost small danger',
                         () => bulk(waiting, 'return', note.value.trim())));
  return bar;
}

async function bulk (waiting, action, note) {
  if (busy) return;
  if (action === 'return' && !note) {
    toast('Say why — every one of them gets sent back with this note.', true);
    return;
  }
  const signing = action === 'approve' && waiting.some(s => signsFor(s));
  if (signing && !myLastSignature()) {
    toast('Approve one time sheet on its own first, so the app has your signature to place.', true);
    return;
  }
  if (!confirm(`${action === 'approve' ? 'Approve' : 'Reject'} all ${waiting.length} documents?`)) return;

  busy = true;
  let done = 0;
  const failed = [];
  for (const sub of waiting) {
    try {
      const signs = action === 'approve' ? signsFor(sub) : null;
      let data;
      if (signs) {
        const full = await Sync.submission(sub.id);
        data = mergeDefaults((full && full.data) || {});
        data.sig[signs.sig] = myLastSignature();
        data.timesheet[signs.name] = (Auth.user() || {}).name || data.timesheet[signs.name] || '';
        data.timesheet[signs.date] = todayDotted();
      }
      await Sync.act(sub.id, action, note, data);
      done++;
    } catch (err) {
      // one that somebody else moved first must not stop the rest
      failed.push(`${sub.consultant || sub.id}: ${err.message}`);
    }
  }
  busy = false;
  toast(failed.length
    ? `${done} done, ${failed.length} could not be: ${failed[0]}`
    : `${done} documents ${action === 'approve' ? 'approved' : 'sent back'}.`, !!failed.length);
  await renderApprovals();
}

/* -------------------------------------------------------------------
   Deciding
   ------------------------------------------------------------------- */

let decideAction = 'approve';

function toggleDecide (id, action) {
  openRow = (openRow === id && decideAction === action) ? '' : id;
  decideAction = action;
  paintApprovals();
}

/** the expanded panel, as a row of its own under the row it belongs to */
function decideRow (sub) {
  const tr = document.createElement('tr');
  tr.className = 'decidetr';
  const cell = document.createElement('td');
  cell.colSpan = 8;
  cell.appendChild(decideBox(sub));
  tr.appendChild(cell);
  return tr;
}

function decideBox (sub) {
  const box = document.createElement('div');
  box.className = 'decidebox';
  const signs = decideAction === 'approve' ? signsFor(sub) : null;
  const placing = decideAction === 'approve' && sub.status === 'pending_signature';

  const head = document.createElement('p');
  head.className = 'decidehead';
  head.textContent =
    decideAction === 'return' ? 'Send this document back — say what needs fixing'
    : decideAction === 'resubmit' ? 'Send this document back for approval'
    : signs ? 'Sign and approve'
    : placing ? 'Finish this document'
    : `Approve the ${kindLabel(kindOf(sub)).toLowerCase()}`;
  box.appendChild(head);

  let pad = null;
  if (signs) {
    const padHost = document.createElement('div');
    padHost.className = 'decidepad';
    box.appendChild(padHost);
    // an approver signs the same way every month; theirs is remembered on
    // this machine so it does not have to be drawn again each time
    pad = makePad(padHost, myLastSignature());
  }

  /* The last stage is the PA's, and their whole job is the signature. Some
     months that happens in the app; some months it happens on paper, in a
     room, with a pen. Either way the finished document is what anybody will
     be asked for a year later, so this is where it is put on file. */
  let filed = null;
  if (placing) {
    const drop = document.createElement('div');
    drop.className = 'decidefile';
    const cap = document.createElement('span');
    cap.textContent = signs
      ? 'Or, if it was signed on paper, put the finished document on file:'
      : 'Put the finished signed document on file:';
    drop.appendChild(cap);
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.pdf,.png,.jpg,.jpeg,image/*,application/pdf';
    drop.appendChild(inp);
    const why = document.createElement('small');
    why.textContent = signs
      ? 'Either is enough. A file filed here is what the Signed copies list shows.'
      : 'An invoice carries no approver signature, so a file is the only thing to place.';
    drop.appendChild(why);
    box.appendChild(drop);
    filed = inp;
  }

  const note = document.createElement('textarea');
  note.className = 'decidenote';
  note.rows = 2;
  note.placeholder = decideAction === 'return'
    ? 'What needs to change? The consultant sees this.'
    : 'Anything to add (optional)';
  box.appendChild(note);

  const bar = document.createElement('div');
  bar.className = 'btnrow';
  const go = button(
    decideAction === 'return' ? 'Send it back'
      : decideAction === 'resubmit' ? 'Resubmit'
      : placing ? 'Mark it signed' : 'Confirm',
    decideAction === 'return' ? 'danger' : 'primary',
    () => decide(sub, note.value.trim(), pad, filed, go));
  bar.appendChild(go);
  bar.appendChild(button('Cancel', 'ghost', () => { openRow = ''; paintApprovals(); }));
  box.appendChild(bar);
  return box;
}

async function decide (sub, note, pad, filed, go) {
  if (busy) return;
  if (decideAction === 'return' && !note) {
    toast('Say what needs fixing — the consultant only sees this note.', true);
    return;
  }
  const signs = decideAction === 'approve' ? signsFor(sub) : null;
  const file = filed && filed.files && filed.files[0];

  // the signature is the point of this stage, so one of the two has to exist
  if (signs && pad.isEmpty() && !file) {
    toast('Sign the box, or put the signed document on file.', true);
    return;
  }
  if (!signs && sub.status === 'pending_signature' && decideAction === 'approve' && !file) {
    toast('Put the signed document on file before marking it signed.', true);
    return;
  }
  if (file && file.size > ARCHIVE_MAX_BYTES) {
    toast(`${file.name} is over the ${Math.round(ARCHIVE_MAX_BYTES / 1048576)} MB limit.`, true);
    return;
  }

  busy = true;
  if (go) { go.disabled = true; go.textContent = 'Working…'; }
  try {
    let data;
    if (signs && !pad.isEmpty()) {
      // the signature goes onto the sheet itself, so the whole form goes
      // back up with it — BDOS keeps the order, not the shape of the form
      const full = await Sync.submission(sub.id);
      data = mergeDefaults((full && full.data) || {});
      const png = pad.value();
      data.sig[signs.sig] = png;
      // whoever actually signed is the name that goes beside the signature,
      // even when it is the admin standing in for somebody away
      data.timesheet[signs.name] = (Auth.user() || {}).name || data.timesheet[signs.name] || '';
      data.timesheet[signs.date] = todayDotted();
      rememberSignature(png);
    }

    /* File first, then move the document on. A file that is on record for a
       document still waiting is a small oddity; a document marked complete
       with the file lost to a failed upload is a month nobody can produce. */
    if (file) await fileFinished(sub, file, note);

    await Sync.act(sub.id, decideAction, note, data);
    openRow = '';
    toast(decideAction === 'return' ? 'Sent back to the consultant.'
        : decideAction === 'resubmit' ? 'Sent for approval again.'
        : sub.status === 'pending_signature' ? 'Signed and filed.'
        : 'Approved.');
    await renderApprovals();
    if (typeof renderArchive === 'function' && file) await renderArchive(true);
  } catch (err) {
    // 403 and 409 are the interesting ones: somebody else moved it first,
    // or this account was never the one to move it
    toast(err.message || 'Could not record that.', true);
  } finally {
    busy = false;
    if (go) { go.disabled = false; }
  }
}

/** put the finished, signed document into the archive against its month */
async function fileFinished (sub, file, note) {
  const full = await Sync.submission(sub.id);
  const state = mergeDefaults((full && full.data) || {});
  const payload = await Sync.readFile(file);
  payload.name = `${kindLabel(kindOf(sub))} (signed) — ${payload.name}`;
  await Sync.store(state, [payload],
    [note, `${kindLabel(kindOf(sub))} signed by ${(Auth.user() || {}).name || myEmail()}`]
      .filter(Boolean).join(' · '));
}

/* -------------------------------------------------------------------
   Reading a document
   ------------------------------------------------------------------- */

function button (label, cls, onClick) {
  const b = document.createElement('button');
  b.className = 'btn ' + cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/** rebuild the document exactly as it was submitted, and show it */
async function reviewSubmission (id) {
  try {
    const sub = await Sync.submission(id);
    if (!sub || !sub.data) { toast('That document could not be read.', true); return; }
    const state = mergeDefaults(sub.data);
    const kind = Sync.kindOf(sub) || kindCache.get(id) || 'claim';
    // read the document that was sent, not the other one
    const doc = kind === 'invoice' ? await buildInvoicePDF(state) : await buildClaimPDF(state);
    const base = kind === 'invoice' ? invoiceFileBase(state) : claimFileBase(state);
    openPdfPreview(
      `${state.consultant.name || 'Claim'} — ${kindLabel(kind)} — ${STATUS_TEXT[sub.status] || sub.status}`,
      `${base}.pdf`, doc);
  } catch (err) {
    toast(err.message || 'Could not open that document.', true);
  }
}

/** a document that came back: put it in the form so it can be fixed */
async function loadIntoForm (id) {
  try {
    const sub = await Sync.submission(id);
    if (!sub || !sub.data) { toast('That document could not be read.', true); return; }
    adoptSubmission(sub);
  } catch (err) {
    toast(err.message || 'Could not open that document.', true);
  }
}
