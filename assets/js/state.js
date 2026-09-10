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
      /* The pay is worked out from the rate and the days that are paid for.
         Typing over it puts the figure here, so the calculation stops
         overwriting it — a month can be settled at something else, and the
         form should not argue. null means "whatever the sum says". */
      override: null,
      items: [],
      note: 'Invoice submitted with original timesheet signed by Consultant as per Clause 7.1 of the Service Agreement.',
      showSig: false
    },
    timesheet: {
      month: now.getMonth(),           // 0-11
      year: now.getFullYear(),
      activities: [ newActivity('') ],
      prepName: '', prepDate: '',
      reviewName: '', reviewDate: '',   // the project manager, who reviews first
      apprName: '', apprDate: '',
      verifName: '', verifDate: ''
    },
    sig: { personnel: '', pm: '', hod: '', verified: '' },
    /* Leave already taken this year, before the month on the sheet. The form
       has always worked this way for days claimed — PAST CLAIM [C] is typed
       in the same way — and it keeps the balance right without needing every
       earlier month to hand. */
    leave: { year: now.getFullYear(), pto: 0, mc: 0, ul: 0 }
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

/* ---------------- leave ---------------- */

/* What a day off is called on the sheet, and how many of them a year holds.
   Only '/' is a day worked and only '/' is claimed; these three say why a day
   is not, and each is capped. PH is not here: a public holiday is the
   calendar's doing, not the consultant's, so nothing counts down for it. */
const LEAVE_LIMITS = { PTO: 12, MC: 12, UL: 12 };
const LEAVE_NAMES  = { PTO: 'Paid time off', MC: 'Medical leave', UL: 'Unpaid leave' };
const LEAVE_KEYS   = { PTO: 'pto', MC: 'mc', UL: 'ul' };     // mark -> where it is carried

/** the days in this month's grid carrying one mark */
function leaveDaysInMonth (ts, mark) {
  const days = new Set();
  (ts.activities || []).forEach(a => Object.keys(a.days || {}).forEach(d => {
    if (a.days[d] === mark) days.add(Number(d));
  }));
  return [...days].sort((x, y) => x - y);
}

/**
 * Where one kind of leave stands for the year the sheet is in.
 * @returns {{mark, name, days, month, earlier, taken, limit, left, over}}
 */
function leaveStanding (S, mark) {
  const ts = S.timesheet;
  const days = leaveDaysInMonth(ts, mark);
  // a balance carried from another year is not this year's balance
  const carried = (S.leave && S.leave.year === ts.year)
    ? Math.max(0, Number(S.leave[LEAVE_KEYS[mark]]) || 0) : 0;
  const taken = carried + days.length;
  const limit = LEAVE_LIMITS[mark];
  return {
    mark: mark, name: LEAVE_NAMES[mark], days: days,
    month: days.length, earlier: carried, taken: taken,
    limit: limit, left: limit - taken, over: taken > limit
  };
}

/** every kind of leave, in the order they appear on the sheet */
function leaveStandings (S) {
  return Object.keys(LEAVE_LIMITS).map(mark => leaveStanding(S, mark));
}

/* ---------------- timesheet totals ---------------- */

/* Which days are paid. A day is claimed when it was worked, and also when it
   was a day off that is paid: the weekend, a public holiday, paid time off or
   medical leave. Two things are not — unpaid leave, and a working day nobody
   marked at all, which is somebody who was not there and did not say why. */
const PAID_MARKS = { '/': 1, SAT: 1, SUN: 1, PH: 1, PTO: 1, MC: 1 };

/**
 * What one day of the month is, taken across the whole sheet: a mark anybody
 * made, or else what the calendar says. The mark wins — a Saturday worked is
 * a Saturday worked.
 */
function dayMarkOf (ts, d) {
  for (const act of ts.activities || []) {
    if (act.days && act.days[d]) return act.days[d];
  }
  const w = dowOf(ts.year, ts.month, d);
  return w === 6 ? 'SAT' : w === 0 ? 'SUN' : '';
}

/** the days of this month that are paid — this is TOTAL DAYS [A] */
function paidDays (ts) {
  let n = 0;
  for (let d = 1, dim = daysInMonth(ts.year, ts.month); d <= dim; d++) {
    if (PAID_MARKS[dayMarkOf(ts, d)]) n++;
  }
  return n;
}

/** the days actually worked — what a daily rate multiplies */
function workedDays (ts) {
  const days = new Set();
  (ts.activities || []).forEach(a => Object.keys(a.days || {}).forEach(d => {
    if (a.days[d] === '/') days.add(Number(d));
  }));
  return days.size;
}

/** working days nobody marked at all: not worked, and no reason given */
function unmarkedDays (ts) {
  const out = [];
  for (let d = 1, dim = daysInMonth(ts.year, ts.month); d <= dim; d++) {
    if (dayMarkOf(ts, d) === '') out.push(d);
  }
  return out;
}

/** the paid days one activity row carries in its own cells */
function activityTotal (act) {
  return Object.values(act.days || {}).filter(v => PAID_MARKS[v]).length;
}

/**
 * The days a row is worth on the printed sheet. Weekends belong to the month
 * rather than to any one activity, so they are counted once, against the
 * first row — which keeps the rows adding up to the TOTAL beneath them.
 */
function rowPaidDays (ts, index) {
  const own = activityTotal(ts.activities[index] || {});
  if (index !== 0) return own;
  let weekends = 0;
  for (let d = 1, dim = daysInMonth(ts.year, ts.month); d <= dim; d++) {
    const m = dayMarkOf(ts, d);
    if (m === 'SAT' || m === 'SUN') weekends++;
  }
  return own + weekends;
}

/** totals across every activity */
function timesheetTotals (ts) {
  let b = 0, c = 0;
  ts.activities.forEach(act => {
    b += Number(act.allocated) || 0;
    c += Number(act.pastClaim) || 0;
  });
  const a = paidDays(ts);
  return { A: a, B: b, C: c, balance: round2(b - (a + c)) };
}

/* ---------------- invoice amount ---------------- */

/** has anybody marked anything on the sheet? then it is the sheet that decides */
function timesheetMarked (ts) {
  return (ts.activities || []).some(a => Object.keys(a.days || {}).length > 0);
}

function computeAmount (S) {
  const inv = S.invoice, ts = S.timesheet;
  if (inv.mode === 'daily') {
    // a daily rate buys days of work, so it is the ticks it multiplies —
    // not the weekend, which nobody worked
    const days = workedDays(ts);
    return { amount: round2((Number(inv.dailyRate) || 0) * days),
             formula: `RM ${money(inv.dailyRate)} × ${days} days worked = RM ${money((Number(inv.dailyRate) || 0) * days)}` };
  }
  if (inv.mode === 'monthly') {
    const rate = Number(inv.monthlyRate) || 0;
    /* A month's pay is the month, less the days that are not paid. The sheet
       already says which those are, so when it has been filled in it decides
       the figure — that is what makes unpaid leave show up in the money
       without anybody working it out by hand. */
    if (timesheetMarked(ts)) {
      const dim = daysInMonth(ts.year, ts.month);
      const paid = paidDays(ts);
      const amt = round2(rate / dim * paid);
      return { amount: amt,
               formula: `RM ${money(rate)} ÷ ${dim} days (${MONTHS[ts.month]} ${ts.year}) × ${paid} paid days = RM ${money(amt)}` };
    }
    // nothing ticked — an invoice on its own, where the period is all there is
    const ref = periodMonth(inv.pStart) || { y: ts.year, m: ts.month };
    const dim = daysInMonth(ref.y, ref.m);
    const cal = calendarDays(inv.pStart, inv.pEnd);
    const amt = round2(rate / dim * cal);
    return { amount: amt,
             formula: `RM ${money(rate)} ÷ ${dim} days (${MONTHS[ref.m]} ${ref.y}) × ${cal} calendar days = RM ${money(amt)}` };
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

  /* An address longer than the invoice can print is reflowed here as well as
     while it is typed. Everything saved before that rule existed — every
     profile, every stored draft — still holds a line 1 that runs off the end
     of the page, and nobody is going to retype them. Splitting on the way in
     costs nothing and is safe to repeat: a line that already fits is left
     exactly as it is. */
  const addr = splitAddressLines(out.consultant.addr1, out.consultant.addr2);
  out.consultant.addr1 = addr.line1;
  out.consultant.addr2 = addr.line2;

  return out;
}
