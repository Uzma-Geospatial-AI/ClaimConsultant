/* =======================================================================
   state.js — data model, defaults, helpers and localStorage persistence
   ======================================================================= */

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function defaultState () {
  const now = new Date();
  return {
    mode: '',                          // '' | 'invoice' | 'claim' | 'both'
    consultant: {
      name: '', ic: '', addr1: '', addr2: '',
      position: '', position2: '', workLoc: 'UZMA TOWER', empCode: '',
      assignPeriod: '',
      bank: '', accName: '', accNo: ''
    },
    company: {
      name: 'Geospatial AI Sdn Bhd',
      regNo: '200901001789 (844716-P)',
      addr1: 'Uzma Tower, No 2, Jalan PJU 8/8A',
      addr2: 'Damansara Perdana, 47820 Petaling Jaya, Selangor'
    },
    project: {
      name: '', client: '', charge: '', profit: '', code: '', dept: '', invClient: ''
    },
    invoice: {
      no: '', date: '', due: '', pStart: '', pEnd: '',
      taxPct: 0, mode: 'monthly', monthlyRate: 3500, dailyRate: 0,
      items: [],
      note: 'Invoice submitted with original timesheet signed by Consultant as per Clause 7.1 of the Service Agreement.',
      showSig: false
    },
    timesheet: {
      month: now.getMonth(),           // 0-11
      year: now.getFullYear(),
      activities: [ newActivity('') ],
      prepName: '', prepDate: '',
      apprName: '', apprDate: '',
      verifName: '', verifDate: ''
    },
    sig: { personnel: '', hod: '', verified: '' }
  };
}

function newActivity (name) {
  return { name: name || '', jobId: '', days: {}, allocated: 0, pastClaim: 0 };
}

/* ---------------- date & number helpers ---------------- */

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

/** 0 = Sunday .. 6 = Saturday */
const dowOf = (y, m, d) => new Date(y, m, d).getDay();

const isWeekend = (y, m, d) => { const w = dowOf(y, m, d); return w === 0 || w === 6; };

/** '2026-08-26' -> '26-Aug-26' */
function fmtDMY (iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  return `${String(d).padStart(2, '0')}-${MON3[m - 1]}-${String(y).slice(2)}`;
}

/** '2026-08-24' + '2026-08-31' -> '24 Aug 2026 – 31 Aug 2026' */
function fmtPeriod (a, b) {
  if (!a && !b) return '';
  const one = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${MON3[m - 1]} ${y}`;
  };
  if (a && b) return `${one(a)} – ${one(b)}`;
  return one(a || b);
}

/** '2026-08-24' + '2026-08-31' -> '24 - 31 Aug 2026' (compact, for item rows) */
function fmtPeriodShort (a, b) {
  if (!a || !b) return fmtPeriod(a, b);
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  if (ay === by && am === bm) return `${ad} - ${bd} ${MON3[am - 1]} ${ay}`;
  if (ay === by) return `${ad} ${MON3[am - 1]} - ${bd} ${MON3[bm - 1]} ${ay}`;
  return fmtPeriod(a, b);
}

/** '2026-08-24' -> { y: 2026, m: 7 }; null when the date is missing */
function periodMonth (iso) {
  if (!iso) return null;
  const [y, m] = iso.split('-').map(Number);
  return (y && m) ? { y, m: m - 1 } : null;
}

/** number of calendar days, both ends inclusive */
function calendarDays (a, b) {
  if (!a || !b) return 0;
  const d1 = new Date(a + 'T00:00:00'), d2 = new Date(b + 'T00:00:00');
  return Math.max(0, Math.round((d2 - d1) / 86400000) + 1);
}

const money = n => (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

/** strip characters that are not legal in a file name */
const safeFile = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();

/* ---------------- address lines ---------------- */

/* The invoice gives the address 66 mm before it would run into the column
   beside it, and 66 mm is 46 characters of an ordinary address at the 8.5 pt
   the invoice is set in — measured with the PDF's own metrics, not guessed.
   Past that the line has to carry on somewhere, and line 2 is where. */
const ADDR_LINE_MAX = 46;

/**
 * Keep line 1 inside what the invoice prints and move what does not fit to
 * the front of line 2. The break falls on the last space that still fits, so
 * a word is never cut in half; a single word longer than the whole line has
 * nowhere better to break and breaks at the limit.
 *
 * @returns {{line1: string, line2: string, moved: string}} `moved` is what
 *          crossed over, and is empty when line 1 already fitted.
 */
function splitAddressLines (line1, line2) {
  const one = String(line1 == null ? '' : line1);
  const two = String(line2 == null ? '' : line2);
  if (one.length <= ADDR_LINE_MAX) return { line1: one, line2: two, moved: '' };

  const space = one.lastIndexOf(' ', ADDR_LINE_MAX);
  const at = space > 0 ? space : ADDR_LINE_MAX;
  const head = one.slice(0, at).replace(/\s+$/, '');
  const moved = one.slice(at).trim();
  if (!moved) return { line1: head, line2: two, moved: '' };

  // the address already punctuates itself where it was cut, or it needs a comma
  const join = two ? (/[,;]$/.test(moved) ? ' ' : ', ') : '';
  return { line1: head, line2: moved + join + two, moved };
}

/* ---------------- timesheet totals ---------------- */

/** number of days ticked '/' for one activity */
function activityTotal (act) {
  return Object.values(act.days || {}).filter(v => v === '/').length;
}

/** totals across every activity */
function timesheetTotals (ts) {
  let a = 0, b = 0, c = 0;
  ts.activities.forEach(act => {
    a += activityTotal(act);
    b += Number(act.allocated) || 0;
    c += Number(act.pastClaim) || 0;
  });
  return { A: a, B: b, C: c, balance: round2(b - (a + c)) };
}

/* ---------------- invoice amount ---------------- */

function computeAmount (S) {
  const inv = S.invoice, ts = S.timesheet;
  if (inv.mode === 'daily') {
    const days = timesheetTotals(ts).A;
    return { amount: round2((Number(inv.dailyRate) || 0) * days),
             formula: `RM ${money(inv.dailyRate)} × ${days} days ticked = RM ${money((Number(inv.dailyRate) || 0) * days)}` };
  }
  if (inv.mode === 'monthly') {
    // the period itself decides the month, so an invoice-only run never needs the timesheet tab
    const ref = periodMonth(inv.pStart) || { y: ts.year, m: ts.month };
    const dim = daysInMonth(ref.y, ref.m);
    const cal = calendarDays(inv.pStart, inv.pEnd);
    const amt = round2((Number(inv.monthlyRate) || 0) / dim * cal);
    return { amount: amt,
             formula: `RM ${money(inv.monthlyRate)} ÷ ${dim} days (${MONTHS[ref.m]} ${ref.y}) × ${cal} calendar days = RM ${money(amt)}` };
  }
  return { amount: null, formula: 'Fixed amount — enter it yourself in the item table below.' };
}

function invoiceTotals (S, items) {
  const list = items || S.invoice.items;
  const sub = round2(list.reduce((t, it) => t + (Number(it.amount) || 0), 0));
  const tax = round2(sub * (Number(S.invoice.taxPct) || 0) / 100);
  return { sub, tax, total: round2(sub + tax) };
}

/* ---------------- storage ---------------- */

const STORE_KEY   = 'ccs.current';
const PROFILE_KEY = 'ccs.profiles';

const Store = {
  saveCurrent (S) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); return true; }
    catch (e) { return false; }          // quota exceeded / private mode
  },
  /** erase everything this app stores (current form + every profile) */
  clearAll () {
    try {
      localStorage.removeItem(STORE_KEY);
      localStorage.removeItem(PROFILE_KEY);
      return true;
    } catch (e) { return false; }
  },
  loadCurrent () {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      return mergeDefaults(JSON.parse(raw));
    } catch (e) { return null; }
  },
  profiles () {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}'); } catch (e) { return {}; }
  },
  saveProfile (name, S) {
    const p = Store.profiles();
    p[name] = JSON.parse(JSON.stringify(S));
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); return true; } catch (e) { return false; }
  },
  deleteProfile (name) {
    const p = Store.profiles();
    delete p[name];
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
  }
};

/** merge a stored object over the defaults so newly added fields are never lost */
function mergeDefaults (saved) {
  const d = defaultState();
  const out = JSON.parse(JSON.stringify(d));
  Object.keys(d).forEach(k => {
    if (!saved || saved[k] === undefined) return;
    if (typeof d[k] === 'object' && d[k] !== null) {
      if (typeof saved[k] === 'object' && saved[k] !== null) Object.assign(out[k], saved[k]);
    } else {
      out[k] = saved[k];                      // scalars, e.g. mode
    }
  });
  if (!Array.isArray(out.invoice.items)) out.invoice.items = [];
  if (!Array.isArray(out.timesheet.activities) || !out.timesheet.activities.length) {
    out.timesheet.activities = [ newActivity('') ];
  }
  return out;
}
