/* =======================================================================
   app.js — pengikat UI, autosimpan, profil & butang generate
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

/* ---------------- pengikatan medan ---------------- */

const FIELDS = [
  // [id, bahagian, kunci, jenis]
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

/* ---------------- jadual item invois ---------------- */

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
      <td><button class="delrow" title="Padam">&times;</button></td>`;
    tr.querySelector('[data-f="desc"]').value = it.desc || '';
    tr.querySelector('[data-f="position"]').value = it.position || '';
    tr.querySelector('[data-f="period"]').value = it.period || '';
    const amtEl = tr.querySelector('[data-f="amount"]');
    amtEl.value = it.amount === '' || it.amount == null ? '' : it.amount;
    if (autoManaged && i === 0) {
      amtEl.readOnly = true;
      amtEl.title = 'Dikira automatik. Tukar "Kaedah Kiraan" ke "Amaun tetap" untuk key in sendiri.';
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

/** kemas kini item pertama apabila kaedah kiraan bukan "fixed" */
function syncAutoAmount () {
  const calc = computeAmount(S);
  document.getElementById('calcFormula').innerHTML = calc.formula || '&nbsp;';
  document.getElementById('wrapMonthly').classList.toggle('hidden', S.invoice.mode !== 'monthly');
  document.getElementById('wrapDaily').classList.toggle('hidden', S.invoice.mode !== 'daily');

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

/* ---------------- ringkasan tab Generate ---------------- */

function renderGenSummary () {
  const T = invoiceTotals(S);
  const t = timesheetTotals(S.timesheet);
  document.getElementById('gsum_inv').innerHTML =
    `<b>${S.invoice.no || '(tiada no. invois)'}</b> &middot; ${fmtPeriod(S.invoice.pStart, S.invoice.pEnd) || '(tiada period)'}<br>
     Total Due: <b>RM ${money(T.total)}</b>`;
  document.getElementById('gsum_claim').innerHTML =
    `${MONTHS[S.timesheet.month]} ${S.timesheet.year} &middot; ${S.consultant.name || '(tiada nama)'}<br>
     Total Days [A]: <b>${t.A}</b> &middot; Balance: <b>${t.balance}</b>`;
}

/* ---------------- persist ---------------- */

let saveTimer = null;
let saveWarned = false;
function persist () {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (Store.saveCurrent(S)) { saveWarned = false; return; }
    if (!saveWarned) {                       // elak toast berulang setiap 250ms
      saveWarned = true;
      toast('Autosave gagal — storan browser penuh. Guna "Export JSON" untuk backup.', true);
    }
  }, 250);
  renderGenSummary();
}

/* ---------------- isian lalai automatik ---------------- */

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

/* ---------------- muat semula seluruh UI ---------------- */

function renderAll () {
  writeStateToFields();
  document.getElementById('ts_month').value = S.timesheet.month;
  renderTimesheet(S, () => { persist(); syncAutoAmount(); });
  syncAutoAmount();
  Sig.refresh();
  renderGenSummary();
}

/* ---------------- pemasangan awal ---------------- */

function boot () {
  // pilihan bulan
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
  renderGenSummary();

  /* --- tab --- */
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('p-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'signature') setTimeout(() => Sig.resizeAll(), 30);
      if (btn.dataset.tab === 'generate') renderGenSummary();
    });
  });

  /* --- medan biasa --- */
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
      if (id === 'ts_month' || id === 'ts_year') {
        renderTimesheet(S, () => { persist(); syncAutoAmount(); });
      }
      if (id === 'i_mode') renderItems();
      syncAutoAmount();
      persist();
    });
  });

  /* --- butang timesheet --- */
  document.getElementById('btnAddActivity').addEventListener('click', () => {
    S.timesheet.activities.push(newActivity(''));
    renderTimesheet(S, () => { persist(); syncAutoAmount(); });
    persist();
  });
  document.getElementById('btnResetDays').addEventListener('click', () => {
    if (!confirm('Padam semua tanda hari untuk semua aktiviti?')) return;
    S.timesheet.activities.forEach(a => { a.days = {}; });
    renderTimesheet(S, () => { persist(); syncAutoAmount(); });
    syncAutoAmount(); persist();
    toast('Semua tanda telah dipadam.');
  });

  /* --- butang item invois --- */
  document.getElementById('btnAddItem').addEventListener('click', () => {
    S.invoice.items.push({ desc: '', position: S.consultant.position, period: '', amount: 0 });
    renderItems(); refreshTotals(); persist();
  });

  /* --- profil --- */
  refreshProfileList();
  document.getElementById('btnSaveProfile').addEventListener('click', () => {
    const suggested = S.consultant.name || 'Profil 1';
    const name = prompt('Nama profil:', suggested);
    if (!name) return;
    if (Store.saveProfile(name.trim(), S)) {
      refreshProfileList();
      document.getElementById('profileSelect').value = name.trim();
      toast(`Profil "${name.trim()}" disimpan.`);
    } else toast('Gagal simpan profil (storan penuh?).', true);
  });
  document.getElementById('btnDeleteProfile').addEventListener('click', () => {
    const sel = document.getElementById('profileSelect').value;
    if (!sel) { toast('Pilih profil dahulu.', true); return; }
    if (!confirm(`Padam profil "${sel}"?`)) return;
    Store.deleteProfile(sel);
    refreshProfileList();
    toast('Profil dipadam.');
  });
  document.getElementById('profileSelect').addEventListener('change', e => {
    const name = e.target.value;
    if (!name) return;
    const p = Store.profiles()[name];
    if (!p) return;
    S = mergeDefaults(p);
    Sig.init(S, persist);
    renderAll();
    persist();
    toast(`Profil "${name}" dimuatkan.`);
  });

  /* --- reset semua data --- */
  document.getElementById('btnReset').addEventListener('click', () => {
    const n = Object.keys(Store.profiles()).length;
    if (!confirm(
      [ 'Padam SEMUA data sistem ini?',
        '',
        '• borang yang sedang dibuka',
        `• ${n} profil tersimpan`,
        '• semua tandatangan',
        '',
        'Dokumen PDF/Excel/Word yang sudah dimuat turun TIDAK terjejas.' ].join('\n')
    )) return;
    if (!confirm('Pasti? Tindakan ini tidak boleh dibatalkan.')) return;

    Store.clearAll();
    S = defaultState();
    fillDefaultsForMonth();
    refreshProfileList();
    Sig.init(S, persist);
    renderAll();
    Store.saveCurrent(S);
    toast('Semua data telah dipadam — sistem kembali kosong.');
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
        Sig.init(S, persist);
        renderAll();
        persist();
        toast('Data berjaya diimport.');
      } catch (err) { toast('Fail JSON tidak sah.', true); }
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
    const jobs = [
      ['Invoice PDF', generateInvoicePDF], ['Invoice Excel', generateInvoiceXLSX],
      ['Claim PDF', generateClaimPDF],     ['Claim Word', generateClaimDOCX]
    ];
    for (const [label, fn] of jobs) {
      try { await fn(S); log(`✓ ${label} dijana.`, 'ok'); }
      catch (err) { log(`✗ ${label} gagal: ${err.message}`, 'err'); console.error(err); }
      await new Promise(res => setTimeout(res, 350));   // elak sekatan muat turun berganda
    }
    toast('Selesai — semak folder Downloads.');
  });
}

function wire (id, fn, label) {
  document.getElementById(id).addEventListener('click', async () => {
    if (!validate()) return;
    try { await fn(S); log(`✓ ${label} dijana.`, 'ok'); toast(`${label} dimuat turun.`); }
    catch (err) { log(`✗ ${label} gagal: ${err.message}`, 'err'); toast(`${label} gagal dijana.`, true); console.error(err); }
  });
}

function validate () {
  if (!S.consultant.name.trim()) {
    toast('Sila isi Nama Penuh consultant dahulu (tab 1).', true);
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
  sel.innerHTML = '<option value="">— Pilih profil —</option>';
  Object.keys(Store.profiles()).sort().forEach(n => {
    const o = document.createElement('option');
    o.value = n; o.textContent = n;
    sel.appendChild(o);
  });
  sel.value = cur;
}

document.addEventListener('DOMContentLoaded', boot);
