/* =======================================================================
   app.js — the guided step flow, autosave, profiles and the generate buttons
   ======================================================================= */

let S = Store.loadCurrent() || defaultState();

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
   Step flow
   Steps without a `modes` list are shown whatever the user picked in step 2.
   ======================================================================= */

const STEPS = [
  { id: 'consultant', label: 'Your Details' },
  { id: 'choose',     label: 'Document' },
  { id: 'company',    label: 'Bill To',   modes: ['invoice', 'both'] },
  { id: 'project',    label: 'Project',   modes: ['claim', 'both'] },
  { id: 'invoice',    label: 'Invoice',   modes: ['invoice', 'both'] },
  { id: 'timesheet',  label: 'Timesheet', modes: ['claim', 'both'] },
  { id: 'signature',  label: 'Signature' },
  { id: 'generate',   label: 'Generate' }
];

let stepIndex = 0;

/** the steps that apply to the current choice; before a choice only the first two */
function activeSteps () {
  if (!S.mode) return STEPS.filter(s => s.id === 'consultant' || s.id === 'choose');
  return STEPS.filter(s => !s.modes || s.modes.includes(S.mode));
}

function currentStep () {
  const list = activeSteps();
  return list[Math.min(stepIndex, list.length - 1)];
}

/** guard that runs before leaving a step forward */
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
    // validate every step being passed over
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
  if (step.id === 'signature') setTimeout(() => Sig.resizeAll(), 30);
  if (step.id === 'generate') renderGenSummary();
  if (step.id === 'choose') paintChoices();
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

/** put a Back / Next row at the bottom of the panel currently shown */
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

  const spacer = document.createElement('span');
  spacer.className = 'spacerflex';
  row.appendChild(spacer);

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
  if (changed) toast(`${mode === 'both' ? 'Both documents' : mode === 'invoice' ? 'Invoice Timesheet' : 'Claim form'} selected.`);
  goToStep(stepIndex + 1, true);
}

/* ---------------- field bindings ---------------- */

const FIELDS = [
  // [element id, state section, key, type]
  ['c_name', 'consultant', 'name'], ['c_ic', 'consultant', 'ic'],
  ['c_addr1', 'consultant', 'addr1'], ['c_addr2', 'consultant', 'addr2'],
  ['c_position', 'consultant', 'position'], ['c_position2', 'consultant', 'position2'],
  ['c_workloc', 'consultant', 'workLoc'], ['c_empcode', 'consultant', 'empCode'],
  ['c_assignperiod', 'consultant', 'assignPeriod'],
  ['c_bank', 'consultant', 'bank'], ['c_accname', 'consultant', 'accName'],
  ['c_accno', 'consultant', 'accNo'],

  ['co_name', 'company', 'name'], ['co_regno', 'company', 'regNo'],
  ['co_addr1', 'company', 'addr1'], ['co_addr2', 'company', 'addr2'],

  ['pj_name', 'project', 'name'], ['pj_client', 'project', 'client'],
  ['pj_charge', 'project', 'charge'], ['pj_profit', 'project', 'profit'],
  ['pj_code', 'project', 'code'], ['pj_dept', 'project', 'dept'],
  ['pj_invclient', 'project', 'invClient'],

  ['i_no', 'invoice', 'no'], ['i_date', 'invoice', 'date'], ['i_due', 'invoice', 'due'],
  ['i_pstart', 'invoice', 'pStart'], ['i_pend', 'invoice', 'pEnd'],
  ['i_tax', 'invoice', 'taxPct', 'num'], ['i_mode', 'invoice', 'mode'],
  ['i_monthly', 'invoice', 'monthlyRate', 'num'], ['i_daily', 'invoice', 'dailyRate', 'num'],
  ['i_note', 'invoice', 'note'], ['i_showsig', 'invoice', 'showSig', 'bool'],

  ['ts_year', 'timesheet', 'year', 'num'], ['ts_month', 'timesheet', 'month', 'num'],
  ['s_prepname', 'timesheet', 'prepName'], ['s_prepdate', 'timesheet', 'prepDate'],
  ['s_apprname', 'timesheet', 'apprName'], ['s_apprdate', 'timesheet', 'apprDate'],
  ['s_verifname', 'timesheet', 'verifName'], ['s_verifdate', 'timesheet', 'verifDate']
];

function writeStateToFields () {
  FIELDS.forEach(([id, sec, key, type]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (type === 'bool') el.checked = !!S[sec][key];
    else el.value = S[sec][key] == null ? '' : S[sec][key];
  });
}

/* ---------------- invoice item table ---------------- */

function renderItems () {
  const tb = document.querySelector('#itemTable tbody');
  tb.innerHTML = '';
  const autoManaged = S.invoice.mode !== 'fixed';

  S.invoice.items.forEach((it, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="idx">${i + 1}</td>
      <td><input data-f="desc"></td>
      <td><input data-f="position"></td>
      <td><input data-f="period"></td>
      <td class="amt"><input data-f="amount" type="number" step="0.01"></td>
      <td><button class="delrow" title="Delete">&times;</button></td>`;
    tr.querySelector('[data-f="desc"]').value = it.desc || '';
    tr.querySelector('[data-f="position"]').value = it.position || '';
    tr.querySelector('[data-f="period"]').value = it.period || '';
    const amtEl = tr.querySelector('[data-f="amount"]');
    amtEl.value = it.amount === '' || it.amount == null ? '' : it.amount;
    if (autoManaged && i === 0) {
      amtEl.readOnly = true;
      amtEl.title = 'Calculated automatically. Switch "Calculation Method" to "Fixed amount" to type your own.';
    }

    tr.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
      const f = inp.dataset.f;
      it[f] = f === 'amount' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
      refreshTotals();
      persist();
    }));
    tr.querySelector('.delrow').addEventListener('click', () => {
      S.invoice.items.splice(i, 1);
      renderItems(); refreshTotals(); persist();
    });
    tb.appendChild(tr);
  });
}

function refreshTotals () {
  const T = invoiceTotals(S);
  document.getElementById('t_sub').textContent = money(T.sub);
  document.getElementById('t_tax').textContent = money(T.tax);
  document.getElementById('t_total').textContent = money(T.total);
  renderGenSummary();
}

/** keep the first item in step with the formula whenever the mode is not "fixed" */
function syncAutoAmount () {
  const calc = computeAmount(S);
  document.getElementById('calcFormula').innerHTML = calc.formula || '&nbsp;';
  document.getElementById('wrapMonthly').classList.toggle('hidden', S.invoice.mode !== 'monthly');
  document.getElementById('wrapDaily').classList.toggle('hidden', S.invoice.mode !== 'daily');

  // the daily rate counts ticks, which only exist when the Claim form is in play
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
    if (Store.saveCurrent(S)) { saveWarned = false; return; }
    if (!saveWarned) {                       // avoid repeating the toast every 250ms
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
  const first = `${ts.year}-${pad(ts.month + 1)}-01`;
  const last  = `${ts.year}-${pad(ts.month + 1)}-${pad(dim)}`;

  if (!S.invoice.pStart) S.invoice.pStart = first;
  if (!S.invoice.pEnd)   S.invoice.pEnd   = last;
  if (!S.invoice.due)    S.invoice.due    = S.invoice.pEnd;
  if (!S.invoice.date) {
    const now = new Date();
    S.invoice.date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  if (!S.invoice.no) S.invoice.no = `INV-${ts.year}-${pad(ts.month + 1)}-001`;
  if (!S.consultant.assignPeriod) S.consultant.assignPeriod = monthLabel(ts);
  if (!S.timesheet.activities[0].name) {
    S.timesheet.activities[0].name = `Developing Platform (${MONTHS[ts.month]} ${ts.year})`;
  }
  if (!S.timesheet.prepName) S.timesheet.prepName = S.consultant.name;
}

/** true when nothing has been ticked yet, so the month can still move freely */
function timesheetUntouched () {
  return S.timesheet.activities.every(a => Object.keys(a.days || {}).length === 0);
}

/* ---------------- full UI refresh ---------------- */

function renderAll () {
  writeStateToFields();
  document.getElementById('ts_month').value = S.timesheet.month;
  renderTimesheet(S, () => { persist(); syncAutoAmount(); });
  syncAutoAmount();
  Sig.refresh();
  paintChoices();
  showStep();
}

/* ---------------- start-up ---------------- */

function boot () {
  mountBrandLogo();
  mountFootLogo();

  const msel = document.getElementById('ts_month');
  msel.innerHTML = '';
  MONTHS.forEach((m, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = m;
    msel.appendChild(o);
  });

  fillDefaultsForMonth();
  writeStateToFields();
  msel.value = S.timesheet.month;

  Sig.init(S, persist);
  renderTimesheet(S, () => { persist(); syncAutoAmount(); });
  syncAutoAmount();
  paintChoices();
  showStep();

  /* --- choice cards --- */
  document.querySelectorAll('.choice').forEach(c => {
    c.addEventListener('click', () => chooseMode(c.dataset.mode));
  });

  /* --- plain fields --- */
  FIELDS.forEach(([id, sec, key, type]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const ev = (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date') ? 'change' : 'input';
    el.addEventListener(ev, () => {
      if (type === 'bool') S[sec][key] = el.checked;
      else if (type === 'num') S[sec][key] = Number(el.value) || 0;
      else S[sec][key] = el.value;

      if (id === 'c_name' && !S.timesheet.prepName.trim()) {
        S.timesheet.prepName = el.value;
        document.getElementById('s_prepname').value = el.value;
      }
      // move the timesheet to match the invoice period, but never over existing ticks
      if (id === 'i_pstart' && timesheetUntouched()) {
        const ref = periodMonth(el.value);
        if (ref && (ref.y !== S.timesheet.year || ref.m !== S.timesheet.month)) {
          S.timesheet.year = ref.y;
          S.timesheet.month = ref.m;
          document.getElementById('ts_year').value = ref.y;
          document.getElementById('ts_month').value = ref.m;
          renderTimesheet(S, () => { persist(); syncAutoAmount(); });
        }
      }
      if (id === 'ts_month' || id === 'ts_year') {
        renderTimesheet(S, () => { persist(); syncAutoAmount(); });
      }
      if (id === 'i_mode') renderItems();
      syncAutoAmount();
      persist();
    });
  });

  /* --- timesheet buttons --- */
  document.getElementById('btnAddActivity').addEventListener('click', () => {
    S.timesheet.activities.push(newActivity(''));
    renderTimesheet(S, () => { persist(); syncAutoAmount(); });
    persist();
  });
  document.getElementById('btnResetDays').addEventListener('click', () => {
    if (!confirm('Clear every day tick on every activity row?')) return;
    S.timesheet.activities.forEach(a => { a.days = {}; });
    renderTimesheet(S, () => { persist(); syncAutoAmount(); });
    syncAutoAmount(); persist();
    toast('All ticks cleared.');
  });

  /* --- invoice item button --- */
  document.getElementById('btnAddItem').addEventListener('click', () => {
    S.invoice.items.push({ desc: '', position: S.consultant.position, period: '', amount: 0 });
    renderItems(); refreshTotals(); persist();
  });

  /* --- profiles --- */
  refreshProfileList();
  document.getElementById('btnSaveProfile').addEventListener('click', () => {
    const suggested = S.consultant.name || 'Profile 1';
    const name = prompt('Profile name:', suggested);
    if (!name) return;
    if (Store.saveProfile(name.trim(), S)) {
      refreshProfileList();
      document.getElementById('profileSelect').value = name.trim();
      toast(`Profile "${name.trim()}" saved.`);
    } else toast('Could not save the profile (storage full?).', true);
  });
  document.getElementById('btnDeleteProfile').addEventListener('click', () => {
    const sel = document.getElementById('profileSelect').value;
    if (!sel) { toast('Select a profile first.', true); return; }
    if (!confirm(`Delete the profile "${sel}"?`)) return;
    Store.deleteProfile(sel);
    refreshProfileList();
    toast('Profile deleted.');
  });
  document.getElementById('profileSelect').addEventListener('change', e => {
    const name = e.target.value;
    if (!name) return;
    const p = Store.profiles()[name];
    if (!p) return;
    S = mergeDefaults(p);
    stepIndex = 0;
    Sig.init(S, persist);
    renderAll();
    persist();
    toast(`Profile "${name}" loaded.`);
  });

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
    S = defaultState();
    fillDefaultsForMonth();
    stepIndex = 0;
    refreshProfileList();
    Sig.init(S, persist);
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
        Sig.init(S, persist);
        renderAll();
        persist();
        toast('Data imported successfully.');
      } catch (err) { toast('That is not a valid JSON file.', true); }
    };
    r.readAsText(f);
    e.target.value = '';
  });

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
    for (const [label, fn] of jobs) {
      try { await fn(S); log(`✓ ${label} generated.`, 'ok'); }
      catch (err) { log(`✗ ${label} failed: ${err.message}`, 'err'); console.error(err); }
      await new Promise(res => setTimeout(res, 350));   // avoid the multi-download block
    }
    toast('Done — check your Downloads folder.');
  });
}

function mountFootLogo () {
  const host = document.getElementById('footLogo');
  if (!host) return;
  host.innerHTML = geospatialFallbackMarkup();
  loadLogo('geospatial').then(logo => {
    if (logo) host.innerHTML = `<img src="${logo.src}" alt="Geospatial AI" class="brand-img">`;
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

function refreshProfileList () {
  const sel = document.getElementById('profileSelect');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select a profile —</option>';
  Object.keys(Store.profiles()).sort().forEach(n => {
    const o = document.createElement('option');
    o.value = n; o.textContent = n;
    sel.appendChild(o);
  });
  sel.value = cur;
}

document.addEventListener('DOMContentLoaded', boot);
