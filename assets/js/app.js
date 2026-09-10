/* =======================================================================
   app.js — the guided step flow, two-way field binding, autosave,
            profiles and the generate buttons
   ======================================================================= */

let S = Store.loadCurrent() || defaultState();

/* -----------------------------------------------------------------------
   Section (C) starting values. These are only defaults — every one of them
   is an ordinary field on the Claim page, so change the approver, blank a
   name out or hand the sheet to somebody else and the documents follow.
   ----------------------------------------------------------------------- */
const SIGN_DEFAULTS = {
  review: 'Muhammad Hanis Rashidan',        // project manager, who reviews first
  hod: 'Gs. Mohammad Fadhli Jamaluddin',    // approver; edit on the Claim page
  verified: ''                              // Group People & Finance sign on paper
};

/** today as the form writes it: 26.8.2026 */
function todayDotted () {
  const n = new Date();
  return `${n.getDate()}.${n.getMonth() + 1}.${n.getFullYear()}`;
}

/* ---------------- toast ---------------- */
let toastTimer = null;
function toast (msg, bad) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

/* =======================================================================
   Step flow — steps without a `modes` list always apply
   ======================================================================= */

const STEPS = [
  { id: 'consultant', label: 'Your Details' },
  { id: 'choose',     label: 'Document' },
  { id: 'invoice',    label: 'Invoice',    modes: ['invoice', 'both'] },
  { id: 'claim',      label: 'Claim Form', modes: ['claim', 'both'] },
  { id: 'generate',   label: 'Generate' },
  { id: 'approvals',  label: 'Approvals' }
];

let stepIndex = 0;
let activeProfile = '';          // the saved profile the form was opened from

function activeSteps () {
  // An approver does not fill a claim in — they read one and sign it. The
  // wizard is the consultant's; theirs is the queue, and it is all they get.
  if (Auth.role() && Auth.role() !== 'consultant') {
    return STEPS.filter(s => s.id === 'approvals');
  }
  const approvals = STEPS.filter(s => s.id === 'approvals');
  if (!S.mode) {
    return STEPS.filter(s => s.id === 'consultant' || s.id === 'choose').concat(approvals);
  }
  return STEPS.filter(s => !s.modes || s.modes.includes(S.mode));
}

function canLeave (id) {
  if (id === 'consultant' && !S.consultant.name.trim()) {
    toast('Enter your Full Name before continuing.', true);
    document.getElementById('c_name').focus();
    return false;
  }
  if (id === 'choose' && !S.mode) {
    toast('Pick which document you need.', true);
    return false;
  }
  return true;
}

function goToStep (i, skipGuard) {
  const list = activeSteps();
  const target = Math.max(0, Math.min(i, list.length - 1));
  if (!skipGuard && target > stepIndex) {
    for (let k = stepIndex; k < target; k++) if (!canLeave(list[k].id)) return;
  }
  stepIndex = target;
  showStep();
}

function showStep () {
  const list = activeSteps();
  const step = list[Math.min(stepIndex, list.length - 1)];

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('p-' + step.id).classList.add('active');

  renderStepper();
  renderNavRows();
  // canvases can only be measured once their panel is visible
  if (step.id === 'claim' || step.id === 'invoice') setTimeout(() => Sig.resizeAll(), 30);
  if (step.id === 'generate') renderGenSummary();
  if (step.id === 'choose') paintChoices();
  if (step.id === 'approvals') renderApprovals();
  if (step.id === 'generate') {
    const card = document.getElementById('card_submit');
    if (card) card.hidden = !(Sync.on && (!Auth.role() || Auth.role() === 'consultant'));
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderStepper () {
  const list = activeSteps();
  const host = document.getElementById('stepper');
  host.innerHTML = '';
  list.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'step' + (i === stepIndex ? ' active' : (i < stepIndex ? ' done' : ''));
    b.innerHTML = `<span class="step-num">${i + 1}</span><span>${s.label}</span>`;
    b.addEventListener('click', () => goToStep(i));
    host.appendChild(b);
  });
}

function renderNavRows () {
  const list = activeSteps();
  const step = list[Math.min(stepIndex, list.length - 1)];
  const panel = document.getElementById('p-' + step.id);

  document.querySelectorAll('.navrow').forEach(n => n.remove());

  const row = document.createElement('div');
  row.className = 'navrow';

  const back = document.createElement('button');
  back.className = 'btn ghost';
  back.textContent = '← Back';
  back.disabled = stepIndex === 0;
  back.addEventListener('click', () => goToStep(stepIndex - 1, true));
  row.appendChild(back);

  const note = document.createElement('span');
  note.className = 'stepnote';
  note.textContent = `Step ${stepIndex + 1} of ${list.length}`;
  row.appendChild(note);

  row.appendChild(Object.assign(document.createElement('span'), { className: 'spacerflex' }));

  if (stepIndex < list.length - 1) {
    const next = document.createElement('button');
    next.className = 'btn';
    next.textContent = 'Next →';
    next.addEventListener('click', () => goToStep(stepIndex + 1));
    row.appendChild(next);
  }
  panel.appendChild(row);
}

/* ---------------- step 2: the choice cards ---------------- */

function paintChoices () {
  document.querySelectorAll('.choice').forEach(c => {
    c.classList.toggle('selected', c.dataset.mode === S.mode);
  });
}

function chooseMode (mode) {
  const changed = S.mode !== mode;
  S.mode = mode;
  paintChoices();
  persist();
  syncAutoAmount();
  if (changed) {
    toast(mode === 'both' ? 'Both documents selected.'
        : mode === 'invoice' ? 'Invoice Timesheet selected.' : 'Claim form selected.');
  }
  goToStep(stepIndex + 1, true);
}

/* =======================================================================
   Two-way binding via data-bind="section.key"
   Several elements may share one path; editing any of them updates the rest.
   ======================================================================= */

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath (o, p, v) {
  const ks = p.split('.');
  const last = ks.pop();
  const host = ks.reduce((a, k) => a[k], o);
  host[last] = v;
}

function elValue (el) {
  if (el.dataset.type === 'bool') return el.checked;
  if (el.dataset.type === 'num') return Number(el.value) || 0;
  return el.value;
}

function applyToEl (el, v) {
  if (el.dataset.type === 'bool') el.checked = !!v;
  else el.value = v == null ? '' : v;
}

/** push the whole state out to every bound element */
function writeBindings () {
  document.querySelectorAll('[data-bind]').forEach(el => applyToEl(el, getPath(S, el.dataset.bind)));
}

/** mirror one path to every other element bound to it */
function mirror (path, source) {
  const v = getPath(S, path);
  document.querySelectorAll(`[data-bind="${path}"]`).forEach(el => {
    if (el !== source) applyToEl(el, v);
  });
}

/**
 * Keep the consultant's address line 1 inside what the invoice prints. What
 * will not fit moves to the front of line 2, and the caret goes with it, so
 * typing simply carries on where the words went.
 */
function flowAddressOverflow (el) {
  const split = splitAddressLines(S.consultant.addr1, S.consultant.addr2);
  if (!split.moved) return;

  S.consultant.addr1 = split.line1;
  S.consultant.addr2 = split.line2;
  mirror('consultant.addr1');
  mirror('consultant.addr2');

  // the address is on the details page and again on the invoice: follow the
  // words into the line 2 belonging to whichever copy is being typed in
  const next = (el.closest('section') || document)
    .querySelector('[data-bind="consultant.addr2"]');
  if (next && document.activeElement === el) {
    next.focus();
    next.setSelectionRange(split.moved.length, split.moved.length);
  }
}

function bindInputs () {
  document.querySelectorAll('[data-bind]').forEach(el => {
    const path = el.dataset.bind;
    const ev = (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date') ? 'change' : 'input';
    el.addEventListener(ev, () => {
      setPath(S, path, elValue(el));
      mirror(path, el);

      // line 1 only holds so much of an address; the rest flows to line 2
      if (path === 'consultant.addr1') flowAddressOverflow(el);

      if (path === 'consultant.name') {
        if (!S.timesheet.prepName.trim() || S.timesheet.prepName === lastName) {
          S.timesheet.prepName = el.value;
          mirror('timesheet.prepName');
        }
        lastName = el.value;
        updateInvSigName();
      }
      // move the timesheet to the invoice period, but never over existing ticks
      if (path === 'invoice.pStart' && timesheetUntouched()) {
        const ref = periodMonth(el.value);
        if (ref && (ref.y !== S.timesheet.year || ref.m !== S.timesheet.month)) {
          S.timesheet.year = ref.y;
          S.timesheet.month = ref.m;
          mirror('timesheet.year'); mirror('timesheet.month');
          renderTimesheet(S, afterTimesheetChange);
        }
      }
      if (path === 'timesheet.month' || path === 'timesheet.year') {
        renderTimesheet(S, afterTimesheetChange);
      }
      if (path === 'invoice.mode') renderItems();
      syncAutoAmount();
      persist();
    });
  });
}

let lastName = '';
const afterTimesheetChange = () => { persist(); syncAutoAmount(); };

/* ---------------- invoice item rows ---------------- */

function renderItems () {
  const tb = document.querySelector('#itemTable tbody');
  tb.innerHTML = '';
  const autoManaged = S.invoice.mode !== 'fixed';

  S.invoice.items.forEach((it, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="idx">${i + 1}</td>
      <td><input class="dinput" data-f="desc" placeholder="e.g. Consultancy Service Fee"></td>
      <td><input class="dinput ta-c" data-f="position" placeholder="e.g. Full Stack Developer"></td>
      <td><input class="dinput" data-f="period" placeholder="e.g. 1 - 31 Aug 2026"></td>
      <td><input class="dinput ta-r" data-f="amount" type="number" step="0.01" placeholder="0.00"></td>
      <td><button class="rowdel" title="Delete this item">&times;</button></td>`;
    tr.querySelector('[data-f="desc"]').value = it.desc || '';
    tr.querySelector('[data-f="position"]').value = it.position || '';
    tr.querySelector('[data-f="period"]').value = it.period || '';
    const amtEl = tr.querySelector('[data-f="amount"]');
    amtEl.value = it.amount === '' || it.amount == null ? '' : it.amount;
    if (autoManaged && i === 0) {
      amtEl.readOnly = true;
      amtEl.title = 'Worked out automatically — switch the method to "Fixed amount" to type your own.';
    }

    tr.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
      const f = inp.dataset.f;
      it[f] = f === 'amount' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
      refreshTotals();
      persist();
    }));
    tr.querySelector('.rowdel').addEventListener('click', () => {
      S.invoice.items.splice(i, 1);
      renderItems(); refreshTotals(); persist();
    });
    tb.appendChild(tr);
  });

  // keep four rows on screen, exactly like the printed template
  for (let i = S.invoice.items.length; i < 4; i++) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="idx"></td><td></td><td></td><td></td><td></td><td></td>';
    tb.appendChild(tr);
  }
}

function refreshTotals () {
  const T = invoiceTotals(S);
  document.getElementById('t_sub').textContent = money(T.sub);
  document.getElementById('t_tax').textContent = money(T.tax);
  document.getElementById('t_total').textContent = money(T.total);
  renderGenSummary();
}

function syncAutoAmount () {
  const calc = computeAmount(S);
  document.getElementById('calcFormula').innerHTML = calc.formula || '&nbsp;';
  document.getElementById('wrapMonthly').classList.toggle('hidden', S.invoice.mode !== 'monthly');
  document.getElementById('wrapDaily').classList.toggle('hidden', S.invoice.mode !== 'daily');
  document.getElementById('dailyWarn')
    .classList.toggle('hidden', !(S.invoice.mode === 'daily' && S.mode === 'invoice'));

  if (!S.invoice.items.length) {
    S.invoice.items.push({ desc: 'Consultancy Service Fee', position: S.consultant.position, period: '', amount: 0 });
  }
  if (S.invoice.mode !== 'fixed') {
    const it = S.invoice.items[0];
    it.amount = calc.amount || 0;
    if (!it.desc) it.desc = 'Consultancy Service Fee';
    if (!it.position) it.position = S.consultant.position;
    it.period = fmtPeriodShort(S.invoice.pStart, S.invoice.pEnd);
  }
  renderItems();
  refreshTotals();
}

/* ---------------- Generate step ---------------- */

function renderGenSummary () {
  const wantInv   = S.mode === 'invoice' || S.mode === 'both';
  const wantClaim = S.mode === 'claim'   || S.mode === 'both';

  const cInv = document.getElementById('card_inv');
  const cClm = document.getElementById('card_claim');
  const cAll = document.getElementById('card_all');
  if (cInv) cInv.classList.toggle('hidden', !wantInv);
  if (cClm) cClm.classList.toggle('hidden', !wantClaim);
  if (cAll) cAll.classList.toggle('hidden', S.mode !== 'both');

  const T = invoiceTotals(S);
  const t = timesheetTotals(S.timesheet);
  document.getElementById('gsum_inv').innerHTML =
    `<b>${S.invoice.no || '(no invoice number)'}</b> &middot; ${fmtPeriod(S.invoice.pStart, S.invoice.pEnd) || '(no period)'}<br>
     Total Due: <b>RM ${money(T.total)}</b>`;
  document.getElementById('gsum_claim').innerHTML =
    `${MONTHS[S.timesheet.month]} ${S.timesheet.year} &middot; ${S.consultant.name || '(no name)'}<br>
     Total Days [A]: <b>${t.A}</b> &middot; Balance: <b>${t.balance}</b>`;
  const all = document.getElementById('gsum_all');
  if (all) all.textContent = 'Generate all four files in one go (2 PDF + 1 Excel + 1 Word).';
}

/* ---------------- persistence ---------------- */

let saveTimer = null;
let saveWarned = false;
function persist () {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    Sync.pushDraft(S);                       // lazy, silent, never blocking
    if (Store.saveCurrent(S)) { saveWarned = false; return; }
    if (!saveWarned) {
      saveWarned = true;
      toast('Autosave failed — browser storage is full. Use "Export JSON" to back up.', true);
    }
  }, 250);
}

/* ---------------- automatic defaults ---------------- */

function fillDefaultsForMonth () {
  const ts = S.timesheet;
  const dim = daysInMonth(ts.year, ts.month);
  const pad = n => String(n).padStart(2, '0');

  if (!S.invoice.pStart) S.invoice.pStart = `${ts.year}-${pad(ts.month + 1)}-01`;
  if (!S.invoice.pEnd)   S.invoice.pEnd   = `${ts.year}-${pad(ts.month + 1)}-${pad(dim)}`;
  if (!S.invoice.due)    S.invoice.due    = S.invoice.pEnd;
  if (!S.invoice.date) {
    const now = new Date();
    S.invoice.date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  if (!S.invoice.no) S.invoice.no = `INV-${ts.year}-${pad(ts.month + 1)}-001`;
  if (!S.consultant.assignPeriod) S.consultant.assignPeriod = monthLabel(ts);
  if (!S.timesheet.prepName) S.timesheet.prepName = S.consultant.name;
  if (!S.timesheet.reviewName) S.timesheet.reviewName = SIGN_DEFAULTS.review;
  if (!S.timesheet.apprName)  S.timesheet.apprName  = SIGN_DEFAULTS.hod;
  if (!S.timesheet.verifName) S.timesheet.verifName = SIGN_DEFAULTS.verified;
  if (!S.timesheet.prepDate)  S.timesheet.prepDate  = todayDotted();
  // the reviewer and the approver date their own boxes when they sign, so
  // these only start filled the way the printed form starts filled
  if (!S.timesheet.reviewDate) S.timesheet.reviewDate = S.timesheet.prepDate;
  if (!S.timesheet.apprDate)  S.timesheet.apprDate  = S.timesheet.prepDate;
  // a year turned over: this year's leave starts from nothing
  if (!S.leave || S.leave.year !== ts.year) S.leave = { year: ts.year, pto: 0, mc: 0, ul: 0 };
  lastName = S.consultant.name;
}

/**
 * Put a submitted claim back into the form. Used when one is sent back: the
 * consultant gets exactly what the approver saw, fixes it, and resubmits.
 */
function adoptSubmission (sub) {
  S = mergeDefaults(sub.data);
  activeProfile = '';
  stepIndex = Math.max(0, activeSteps().findIndex(s => s.id === 'claim'));
  renderAll();
  persist();
  toast('Opened in the form. Fix it, then resubmit from the Approvals step.');
}

function timesheetUntouched () {
  return S.timesheet.activities.every(a => Object.keys(a.days || {}).length === 0);
}

/* ---------------- signatures inside the form ---------------- */

function mountSignatures () {
  Sig.reset(S, persist);

  document.querySelectorAll('[data-sig]').forEach(td => Sig.mount(td, td.dataset.sig));

  const slot = document.getElementById('invSigSlot');
  if (slot) {
    slot.innerHTML = '<div class="sigslot-host"></div><div class="signame"></div>';
    Sig.mount(slot.querySelector('.sigslot-host'), 'personnel');
    updateInvSigName();
  }
}

function updateInvSigName () {
  const el = document.querySelector('#invSigSlot .signame');
  if (el) el.innerHTML = `${S.consultant.name || '&nbsp;'}<small>Consultant</small>`;
}

/* ---------------- full UI refresh ---------------- */

function renderAll () {
  writeBindings();
  renderTimesheet(S, afterTimesheetChange);
  mountSignatures();
  syncAutoAmount();
  paintChoices();
  showStep();
}

/* ---------------- start-up ---------------- */

function boot () {
  mountBrandLogo();
  mountFootLogo();
  mountClaimLogo();

  const msel = document.getElementById('ts_month');
  msel.innerHTML = '';
  MONTHS.forEach((m, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = m;
    msel.appendChild(o);
  });

  fillDefaultsForMonth();
  writeBindings();
  bindInputs();

  renderTimesheet(S, afterTimesheetChange);
  mountSignatures();
  syncAutoAmount();
  paintChoices();
  showStep();

  document.querySelectorAll('.choice').forEach(c => {
    c.addEventListener('click', () => chooseMode(c.dataset.mode));
  });

  /* --- timesheet buttons --- */
  document.getElementById('btnAddActivity').addEventListener('click', () => {
    S.timesheet.activities.push(newActivity(''));
    renderTimesheet(S, afterTimesheetChange);
    persist();
  });
  document.getElementById('btnResetDays').addEventListener('click', () => {
    if (!confirm('Clear every day tick on every activity row?')) return;
    S.timesheet.activities.forEach(a => { a.days = {}; });
    renderTimesheet(S, afterTimesheetChange);
    syncAutoAmount(); persist();
    toast('All ticks cleared.');
  });

  document.getElementById('btnAddItem').addEventListener('click', () => {
    S.invoice.items.push({ desc: '', position: S.consultant.position, period: '', amount: 0 });
    renderItems(); refreshTotals(); persist();
  });

  /* --- profiles --- */
  refreshProfileList();
  document.getElementById('btnSaveProfile').addEventListener('click', () => {
    const name = prompt('Profile name:', activeProfile || S.consultant.name || 'Profile 1');
    if (!name) return;
    if (Store.saveProfile(name.trim(), S)) {
      activeProfile = name.trim();
      refreshProfileList();
      Sync.pushProfile(name.trim(), S);
      toast(`Profile "${name.trim()}" saved.`);
    } else toast('Could not save the profile (storage full?).', true);
  });
  document.getElementById('btnProfiles').addEventListener('click', e => {
    e.stopPropagation();
    openProfiles(document.getElementById('profileMenu').hidden);
  });
  // anywhere else, and the list closes — including Escape, as a menu should
  document.addEventListener('click', e => {
    const box = document.getElementById('profileBox');
    if (box && !box.contains(e.target)) openProfiles(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') openProfiles(false); });

  /* --- reset everything --- */
  document.getElementById('btnReset').addEventListener('click', () => {
    const n = Object.keys(Store.profiles()).length;
    if (!confirm(
      [ 'Erase ALL data stored by this app?',
        '',
        '• the form currently open',
        `• ${n} saved profile(s)`,
        '• every signature',
        '',
        'PDF/Excel/Word files you have already downloaded are NOT affected.' ].join('\n')
    )) return;
    if (!confirm('Are you sure? This cannot be undone.')) return;

    Store.clearAll();
    Sync.forget();
    S = defaultState();
    activeProfile = '';
    fillDefaultsForMonth();
    stepIndex = 0;
    refreshProfileList();
    renderAll();
    Store.saveCurrent(S);
    toast('All data erased — the app is back to empty.');
  });

  /* --- import / export --- */
  document.getElementById('btnExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    saveAs(blob, `${safeFile(S.consultant.name) || 'consultant-claim'}.json`);
  });
  document.getElementById('btnImport').addEventListener('click', () => document.getElementById('fileImport').click());
  document.getElementById('fileImport').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        S = mergeDefaults(JSON.parse(r.result));
        stepIndex = 0;
        renderAll();
        persist();
        toast('Data imported successfully.');
      } catch (err) { toast('That is not a valid JSON file.', true); }
    };
    r.readAsText(f);
    e.target.value = '';
  });

  /* --- look before you download --- */
  mountPdfViewer();
  wireView('btnInvPreview',   buildInvoicePDF, invoiceFileBase, 'Invoice Timesheet');
  wireView('btnClaimPreview', buildClaimPDF,   claimFileBase,   'Claim / Personnel Time Sheet');

  /* --- generate --- */
  wire('btnInvPdf',    generateInvoicePDF,  'Invoice PDF');
  wire('btnInvXlsx',   generateInvoiceXLSX, 'Invoice Excel');
  wire('btnClaimPdf',  generateClaimPDF,    'Claim PDF');
  wire('btnClaimDocx', generateClaimDOCX,   'Claim Word');

  document.getElementById('btnAll').addEventListener('click', async () => {
    if (!validate()) return;
    const jobs = [];
    if (S.mode === 'invoice' || S.mode === 'both') {
      jobs.push(['Invoice PDF', generateInvoicePDF], ['Invoice Excel', generateInvoiceXLSX]);
    }
    if (S.mode === 'claim' || S.mode === 'both') {
      jobs.push(['Claim PDF', generateClaimPDF], ['Claim Word', generateClaimDOCX]);
    }
    const made = [];
    for (const [label, fn] of jobs) {
      try { await fn(S); made.push(label); log(`✓ ${label} generated.`, 'ok'); }
      catch (err) { log(`✗ ${label} failed: ${err.message}`, 'err'); console.error(err); }
      await new Promise(res => setTimeout(res, 350));
    }
    // One row per submission, not per button: this is the claim going out.
    if (made.length) Sync.recordClaim(S, made);
    toast('Done — check your Downloads folder.');
  });

  /* --- sending the claim off to be approved --- */
  document.getElementById('btnRefreshApprovals').addEventListener('click', renderApprovals);
  document.getElementById('btnSubmitClaim').addEventListener('click', async () => {
    if (!validate()) return;
    if (!Sync.on) {
      toast('The shared database is not reachable, so there is nowhere to send it yet.', true);
      return;
    }
    const btn = document.getElementById('btnSubmitClaim');
    const note = document.getElementById('submitNote');
    btn.disabled = true;
    try {
      await Sync.submit(S, note.value.trim());
      note.value = '';
      toast('Sent to the project manager.');
      goToStep(activeSteps().findIndex(st => st.id === 'approvals'), true);
    } catch (err) {
      toast(err.message || 'Could not send it.', true);
    } finally {
      btn.disabled = false;
    }
  });

  /* -----------------------------------------------------------------------
     Last, and never blocking: ask BDOS whether the shared database is on
     offer. If it is not — not deployed, offline, not permitted — nothing
     above notices and the app stays exactly as it was.
     ----------------------------------------------------------------------- */
  Sync.init(S, adopted => {
    S = adopted;
    stepIndex = 0;
    renderAll();
    Store.saveCurrent(S);
  }).then(r => {
    if (!r.on) return;
    if (r.adopted)     toast('Loaded the draft saved from your other device.');
    else if (r.gained) toast(`${r.gained} shared profile(s) loaded.`);
    refreshProfileList();
  });
}

function mountFootLogo () {
  const host = document.getElementById('footLogo');
  if (!host) return;
  host.innerHTML = geospatialFallbackMarkup();
  loadLogo('geospatial').then(l => { if (l) host.innerHTML = `<img src="${l.url}" alt="Geospatial AI" class="brand-img">`; });
}

function mountClaimLogo () {
  const host = document.getElementById('claimLogo');
  if (!host) return;
  host.innerHTML = '<span class="uz-fallback">UZM<i>A</i></span>';
  loadLogo('uzma').then(l => { if (l) host.innerHTML = `<img src="${l.url}" alt="UZMA">`; });
}

/** Wire a "View PDF" button: build the document, then show it on screen. */
function wireView (id, build, nameOf, label) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!validate()) return;
    const was = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing…';
    try {
      openPdfPreview(label, `${nameOf(S)}.pdf`, await build(S));
    } catch (err) {
      toast(`${label} could not be rendered.`, true);
      console.error(err);
    } finally {
      btn.disabled = false;
      btn.textContent = was;
    }
  });
}

function wire (id, fn, label) {
  document.getElementById(id).addEventListener('click', async () => {
    if (!validate()) return;
    try { await fn(S); log(`✓ ${label} generated.`, 'ok'); toast(`${label} downloaded.`); }
    catch (err) { log(`✗ ${label} failed: ${err.message}`, 'err'); toast(`${label} could not be generated.`, true); console.error(err); }
  });
}

function validate () {
  if (!S.consultant.name.trim()) {
    toast('Enter your Full Name first (step 1).', true);
    return false;
  }
  return true;
}

function log (msg, cls) {
  const box = document.getElementById('genlog');
  box.classList.add('on');
  const d = document.createElement('div');
  d.className = cls || '';
  d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

/* =======================================================================
   Saved profiles

   A dropdown could only ever load a profile; renaming one meant saving it
   again under the new name and deleting the old, and deleting one meant
   selecting it first. So the list is a menu of rows instead, and each row
   carries the two things you can do to that profile.
   ======================================================================= */

function openProfiles (open) {
  const menu = document.getElementById('profileMenu');
  const btn  = document.getElementById('btnProfiles');
  if (!menu || !btn) return;
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(!!open));
}

/**
 * Open a profile into the form, at Your Details. This is what editing one
 * means: its details are the form, so they are edited by filling the form
 * in, and Save Profile puts them back under the same name.
 */
function editProfile (name) {
  const p = Store.profiles()[name];
  if (!p) { toast(`Profile "${name}" is no longer there.`, true); refreshProfileList(); return; }
  S = mergeDefaults(p);
  activeProfile = name;
  stepIndex = 0;                       // Your Details, which is what is being edited
  renderAll();
  persist();
  openProfiles(false);
  refreshProfileList();
  toast(`Editing "${name}" — press Save changes when you are done.`);
}

/**
 * Start a fresh set of details. The profile itself appears in the list once
 * it is saved a name, which is also when it stops being able to be
 * abandoned by mistake — an empty profile is never left lying in the list.
 */
function newProfile () {
  if (!confirm('Start a new profile?\n\nThe form open right now is cleared. Saved profiles are not touched.')) return;
  S = defaultState();
  fillDefaultsForMonth();
  activeProfile = '';
  stepIndex = 0;
  renderAll();
  persist();
  openProfiles(false);
  refreshProfileList();
  toast('New profile — fill in the details, then press Save Profile.');
}

function removeProfile (name) {
  if (!confirm(`Delete the profile "${name}"?

The form open right now is not touched.`)) return;
  Store.deleteProfile(name);
  Sync.deleteProfile(name);
  if (activeProfile === name) activeProfile = '';
  refreshProfileList();
  toast(`Profile "${name}" deleted.`);
}

function refreshProfileList () {
  const menu  = document.getElementById('profileMenu');
  const label = document.getElementById('profileCurrent');
  const names = Object.keys(Store.profiles()).sort();

  if (label) label.textContent = activeProfile || '— Select a profile —';

  /* With a profile open, saving goes back to it — the button says so, and
     keeps its ellipsis because it still asks for the name, which is the one
     chance to save the changes as a separate profile instead. */
  const save = document.getElementById('btnSaveProfile');
  if (save) {
    save.textContent = activeProfile ? 'Save changes…' : 'Save Profile';
    save.title = activeProfile
      ? `Save what is in the form back to "${activeProfile}"`
      : 'Save what is in the form as a profile';
  }

  if (!menu) return;
  menu.innerHTML = '';

  if (!names.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No profiles saved yet.';
    menu.appendChild(empty);
  }

  names.forEach(name => {
    const row = document.createElement('div');
    row.className = 'prow' + (name === activeProfile ? ' on' : '');

    // names are typed by people and arrive from other people over BDOS, so
    // they go in as text and never as markup
    const open = document.createElement('button');
    open.className = 'pload';
    open.textContent = name;
    open.title = `Open "${name}" and edit its details`;
    open.addEventListener('click', () => editProfile(name));

    const del = document.createElement('button');
    del.className = 'picon pdel';
    del.textContent = 'Delete';
    del.title = `Delete "${name}"`;
    del.addEventListener('click', () => removeProfile(name));

    row.append(open, del);
    menu.appendChild(row);
  });

  const add = document.createElement('button');
  add.className = 'padd' + (names.length ? ' sep' : '');
  add.textContent = '+  Add new profile';
  add.title = 'Clear the form and start another set of details';
  add.addEventListener('click', newProfile);
  menu.appendChild(add);
}

/* The app lives behind the BDOS sign-in gate — boot() runs once it opens. */
document.addEventListener('DOMContentLoaded', () => Auth.start(boot));
