/* =======================================================================
   approvals.js — a claim on its way through the people who sign it

   A claim is prepared by a consultant, reviewed by the project manager,
   approved by the HOD, and then the HOD's signature is placed on it by
   their PA. Each of those is one account, and this screen is what each of
   them sees: what is waiting on them, and the two things they can do
   about it.

   Nothing here edits a claim. An approver reads the sheet as it will be
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

/* Where each role's signature lands on the sheet, and the name and date
   beside it. The HOD's box is filled by the PA, not by the HOD — placing
   that signature is the PA's whole part in this. */
const ROLE_SIGNS = {
  manager: { sig: 'pm',  name: 'reviewName', date: 'reviewDate' },
  pa:      { sig: 'hod', name: 'apprName',   date: 'apprDate' }
};

const LAST_SIG_KEY = 'ccs.mysignature';      // this approver's own, on this machine

let subs = [];                 // what the last load returned
let openRow = '';              // the submission whose panel is expanded
let busy = false;

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
   The list
   ------------------------------------------------------------------- */

function myRole () { return Auth.role(); }
function myEmail () { return String((Auth.user() || {}).email || '').toLowerCase(); }

/** is this claim waiting on the account that is signed in? */
function waitingOnMe (sub) {
  return STATUS_ROLE[sub.status] === myRole();
}

function periodOf (sub) {
  if (!sub.period_year) return '';
  const m = Number(sub.period_month) || 0;
  return `${MON3[Math.max(0, m - 1)]} ${sub.period_year}`;
}

async function renderApprovals () {
  const host = document.getElementById('approvalList');
  if (!host) return;

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
    subs = await Sync.submissions('', myRole() === 'consultant' ? 0 : 0);
  } catch (err) {
    host.innerHTML = `<p class="emptynote">Could not read the approvals: ${err.message}</p>`;
    return;
  }
  paintApprovals();
}

function paintApprovals () {
  const host = document.getElementById('approvalList');
  if (!host) return;

  const mine = subs.filter(waitingOnMe);
  const rest = subs.filter(s => !waitingOnMe(s));

  host.innerHTML = '';
  if (!subs.length) {
    host.innerHTML = myRole() === 'consultant'
      ? '<p class="emptynote">Nothing submitted yet. Fill the claim in, then send it for approval from the Generate step.</p>'
      : '<p class="emptynote">Nothing has been sent for approval yet.</p>';
    return;
  }

  if (mine.length) {
    host.appendChild(groupHead(`Waiting on you (${mine.length})`));
    mine.forEach(s => host.appendChild(subRow(s, true)));
  }
  if (rest.length) {
    host.appendChild(groupHead(mine.length ? 'Everything else' : 'All claims'));
    rest.forEach(s => host.appendChild(subRow(s, false)));
  }
}

function groupHead (text) {
  const h = document.createElement('h3');
  h.className = 'subgrouphead';
  h.textContent = text;
  return h;
}

function subRow (sub, urgent) {
  const row = document.createElement('div');
  row.className = 'subrow' + (urgent ? ' urgent' : '') + (sub.status === 'complete' ? ' done' : '');

  const top = document.createElement('div');
  top.className = 'subtop';

  const who = document.createElement('div');
  who.className = 'subwho';
  who.innerHTML = '<b></b><span></span>';
  who.querySelector('b').textContent = sub.consultant || '(no name)';
  who.querySelector('span').textContent =
    [periodOf(sub), sub.invoice_no || ''].filter(Boolean).join(' · ');
  top.appendChild(who);

  const pill = document.createElement('span');
  pill.className = 'pill ' + sub.status;
  pill.textContent = STATUS_TEXT[sub.status] || sub.status;
  top.appendChild(pill);

  const acts = document.createElement('div');
  acts.className = 'subacts';

  acts.appendChild(button('Review', 'ghost small', () => reviewSubmission(sub.id)));

  if (waitingOnMe(sub)) {
    const verb = myRole() === 'pa' ? 'Place signature' : 'Approve';
    acts.appendChild(button(verb, 'small', () => toggleDecide(sub.id, 'approve')));
    acts.appendChild(button('Send back', 'ghost small danger', () => toggleDecide(sub.id, 'return')));
  }
  if (sub.status === 'returned' && sub.created_by === myEmail()) {
    acts.appendChild(button('Open in the form', 'ghost small', () => loadIntoForm(sub.id)));
    acts.appendChild(button('Resubmit', 'small', () => toggleDecide(sub.id, 'resubmit')));
  }
  top.appendChild(acts);
  row.appendChild(top);

  // the last thing anybody said about it, which is usually why it came back
  const last = (sub.history || [])[sub.history.length - 1];
  if (last && last.note) {
    const note = document.createElement('p');
    note.className = 'subnote';
    note.innerHTML = '<b></b><span></span>';
    note.querySelector('b').textContent = last.by + ': ';
    note.querySelector('span').textContent = last.note;
    row.appendChild(note);
  }

  const trail = document.createElement('div');
  trail.className = 'subtrail';
  trail.textContent = (sub.history || [])
    .map(h => `${h.action} — ${h.by}${h.at ? ' — ' + new Date(h.at).toLocaleString() : ''}`)
    .join('   ·   ');
  row.appendChild(trail);

  if (openRow === sub.id) row.appendChild(decideBox(sub));
  return row;
}

function button (label, cls, onClick) {
  const b = document.createElement('button');
  b.className = 'btn ' + cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
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

function decideBox (sub) {
  const box = document.createElement('div');
  box.className = 'decidebox';
  const role = myRole();
  const signs = decideAction === 'approve' ? ROLE_SIGNS[role] : null;

  const head = document.createElement('p');
  head.className = 'decidehead';
  head.textContent =
    decideAction === 'return' ? 'Send this claim back — say what needs fixing'
    : decideAction === 'resubmit' ? 'Send this claim back for approval'
    : signs ? 'Sign and approve' : 'Approve this claim';
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
      : decideAction === 'resubmit' ? 'Resubmit' : 'Confirm',
    decideAction === 'return' ? 'danger' : 'primary',
    () => decide(sub, note.value.trim(), pad));
  bar.appendChild(go);
  bar.appendChild(button('Cancel', 'ghost', () => { openRow = ''; paintApprovals(); }));
  box.appendChild(bar);
  return box;
}

async function decide (sub, note, pad) {
  if (busy) return;
  if (decideAction === 'return' && !note) {
    toast('Say what needs fixing — the consultant only sees this note.', true);
    return;
  }
  const signs = decideAction === 'approve' ? ROLE_SIGNS[myRole()] : null;
  if (signs && pad.isEmpty()) {
    toast('Sign the box before approving.', true);
    return;
  }

  busy = true;
  try {
    let data;
    if (signs) {
      // the signature goes onto the sheet itself, so the whole form goes
      // back up with it — BDOS keeps the order, not the shape of the form
      const full = await Sync.submission(sub.id);
      data = mergeDefaults((full && full.data) || {});
      const png = pad.value();
      data.sig[signs.sig] = png;
      data.timesheet[signs.name] = data.timesheet[signs.name] ||
        (Auth.user() || {}).name || '';
      data.timesheet[signs.date] = todayDotted();
      rememberSignature(png);
    }
    await Sync.act(sub.id, decideAction, note, data);
    openRow = '';
    toast(decideAction === 'return' ? 'Sent back to the consultant.'
        : decideAction === 'resubmit' ? 'Sent for approval again.'
        : 'Approved.');
    await renderApprovals();
  } catch (err) {
    // 403 and 409 are the interesting ones: somebody else moved it first,
    // or this account was never the one to move it
    toast(err.message || 'Could not record that.', true);
  } finally {
    busy = false;
  }
}

/* -------------------------------------------------------------------
   Reading a claim
   ------------------------------------------------------------------- */

/** rebuild the sheet exactly as it was submitted, and show it */
async function reviewSubmission (id) {
  try {
    const sub = await Sync.submission(id);
    if (!sub || !sub.data) { toast('That claim could not be read.', true); return; }
    const state = mergeDefaults(sub.data);
    const doc = await buildClaimPDF(state);
    openPdfPreview(`${state.consultant.name || 'Claim'} — ${STATUS_TEXT[sub.status] || sub.status}`,
                   `${claimFileBase(state)}.pdf`, doc);
  } catch (err) {
    toast(err.message || 'Could not open that claim.', true);
  }
}

/** a claim that came back: put it in the form so it can be fixed */
async function loadIntoForm (id) {
  try {
    const sub = await Sync.submission(id);
    if (!sub || !sub.data) { toast('That claim could not be read.', true); return; }
    adoptSubmission(sub);
  } catch (err) {
    toast(err.message || 'Could not open that claim.', true);
  }
}
