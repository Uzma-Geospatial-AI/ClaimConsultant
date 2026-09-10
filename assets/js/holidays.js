/* =======================================================================
   holidays.js — the Selangor public holiday calendar

   The time sheet marks a public holiday "PH", and a PH is not the
   consultant's doing: it comes out of nobody's allowance and it is still
   paid. So the app sets them itself rather than asking somebody to
   remember which Monday in June the Agong's birthday fell on.

   Two kinds of holiday live here, and they are not equally certain:

     · FIXED — the same calendar date every year. These can be worked out
       for any year, and they are.

     · MOVABLE — the Islamic, Chinese and Hindu observances, plus the
       Agong's birthday. These follow lunar calendars or a proclamation,
       are gazetted a year at a time, and cannot be computed here. They
       are written down per year below.

   So a year the table does not know still gets its fixed dates, and the
   Claim page says plainly that the rest were not set. When next year is
   gazetted, add a block below — that is the whole maintenance job.

   Every mark this file makes is an ordinary cell on the grid: click it
   and it changes. Nothing here is final, and a date that turns out to be
   wrong costs one click to fix.
   ======================================================================= */

/** the same date every year, for Selangor */
const PH_FIXED = [
  ['01-01', "New Year's Day"],
  ['05-01', 'Labour Day'],
  ['08-31', 'National Day'],
  ['09-16', 'Malaysia Day'],
  ['12-11', "Sultan of Selangor's Birthday"],
  ['12-25', 'Christmas Day']
];

/**
 * The gazetted movable holidays, per year, for SELANGOR.
 *
 * Check these against the state gazette before relying on a month that
 * contains one. They are dated to the best information available when this
 * was written, and Hari Raya in particular is confirmed only days ahead.
 */
const PH_MOVABLE = {
  2026: [
    ['02-01', 'Thaipusam'],
    ['02-17', 'Chinese New Year'],
    ['02-18', 'Chinese New Year (second day)'],
    ['03-07', 'Nuzul Al-Quran'],
    ['03-20', 'Hari Raya Aidilfitri'],
    ['03-21', 'Hari Raya Aidilfitri (second day)'],
    ['05-27', 'Hari Raya Haji'],
    ['05-31', 'Wesak Day'],
    ['06-01', "Yang di-Pertuan Agong's Birthday"],
    ['06-16', 'Awal Muharram'],
    ['08-25', 'Maulidur Rasul'],
    ['11-08', 'Deepavali']
  ]
};

/** does the table hold the movable dates for this year? */
const holidaysKnown = year => Array.isArray(PH_MOVABLE[Number(year)]);

/**
 * Every Selangor public holiday in one year.
 * @returns {Object} '2026-09-16' -> 'Malaysia Day'
 */
function selangorHolidays (year) {
  const y = Number(year);
  const out = {};
  PH_FIXED.forEach(([md, name]) => { out[`${y}-${md}`] = name; });
  (PH_MOVABLE[y] || []).forEach(([md, name]) => { out[`${y}-${md}`] = name; });
  return out;
}

/** the name of the holiday on this day, or '' */
function holidayName (y, m, d) {
  const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return selangorHolidays(y)[key] || '';
}

/** the holidays that fall in one month, as day numbers -> name */
function holidaysInMonth (y, m) {
  const out = {};
  for (let d = 1, dim = daysInMonth(y, m); d <= dim; d++) {
    const name = holidayName(y, m, d);
    if (name) out[d] = name;
  }
  return out;
}
