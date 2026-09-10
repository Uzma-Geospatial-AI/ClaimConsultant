/* =======================================================================
   timesheet.js — Section (B) of the Personnel Time Sheet, rendered as the
   same table that gets printed: activity, job id, days 1..31, A, B, C and
   the balance. Day cells are clickable.
   ======================================================================= */

/* Values a day cell cycles through when clicked. Only '/' is a day worked
   and only '/' is counted into [A] — the rest say why a day is not claimed.
   PTO, MC and UL come out of a yearly allowance (see LEAVE_LIMITS); PH does
   not, because a public holiday is the calendar's doing. */
const CYCLE = ['', '/', 'PH', 'PTO', 'MC', 'UL'];
const MARKS = { PH: 'ph', PTO: 'pto', MC: 'mc', UL: 'ul' };      // tick -> cell style
const MARK_NAMES = Object.assign({ PH: 'Public Holiday' }, LEAVE_NAMES);

/**
 * The value shown for one day, and the value exported to the documents.
 * A manual tick ('/', 'PH', 'PTO', 'MC' or 'UL') overrides the weekend label.
 */
function dayValue (ts, act, d) {
  const v = act.days[d];
  if (v) return v;
  const w = dowOf(ts.year, ts.month, d);
  if (w === 6) return 'SAT';
  if (w === 0) return 'SUN';
  return '';
}

/* -----------------------------------------------------------------------
   Filling the month in

   Almost every month is the same month: every working day worked, the
   public holidays marked PH, the weekend already labelled by the calendar.
   Typing that in twenty-two times is twenty-two chances to miss one, so the
   app does it and the consultant corrects it — which is one click per day
   that was not ordinary.

   The moment any cell is clicked the sheet stops being automatic and is
   left alone: changing the month afterwards will not quietly rewrite
   somebody's corrections.
   ----------------------------------------------------------------------- */

/** is the grid still the calendar's work rather than somebody's? */
function timesheetIsAuto (S) {
  return S.timesheet.autoFilled ||
         S.timesheet.activities.every(a => Object.keys(a.days || {}).length === 0);
}

/**
 * Tick every working day of the month on the first activity row, and mark
 * the Selangor public holidays PH. Weekends are left blank because the grid
 * labels them SAT and SUN from the calendar already.
 *
 * @returns {{holidays: Object, known: boolean}} which days were made PH, and
 *          whether the holiday table actually knows this year
 */
function autoFillMonth (S) {
  const ts = S.timesheet;
  if (!ts.activities.length) ts.activities.push(newActivity(''));
  const act = ts.activities[0];
  const dim = daysInMonth(ts.year, ts.month);
  const hol = typeof holidaysInMonth === 'function' ? holidaysInMonth(ts.year, ts.month) : {};

  ts.activities.forEach(a => { a.days = {}; });
  for (let d = 1; d <= dim; d++) {
    if (isWeekend(ts.year, ts.month, d)) continue;
    act.days[d] = hol[d] ? 'PH' : '/';
  }
  ts.autoFilled = true;
  return {
    holidays: hol,
    known: typeof holidaysKnown === 'function' ? holidaysKnown(ts.year) : false
  };
}

/**
 * The next mark a cell takes when it is clicked, skipping any kind of leave
 * whose allowance for the year is already spent. A balance of zero is not a
 * warning after the fact — the sheet simply will not offer the day.
 *
 * @returns {{value: string, skipped: string[]}}
 */
function nextDayMark (S, cur) {
  const at = CYCLE.indexOf(cur);
  const skipped = [];
  for (let step = 1; step <= CYCLE.length; step++) {
    const v = CYCLE[(at + step) % CYCLE.length];
    if (canMarkLeave(S, v, false)) return { value: v, skipped: skipped };
    skipped.push(v);
  }
  return { value: '', skipped: skipped };
}

const B_HEADS = [
  'TOTAL DAYS<br>(current month claim)<br>[A]',
  'ALLOCATED<br>PROJECTED DAYS<br>[B]',
  'PAST CLAIM<br>(excluding current month)<br>[C]',
  'BALANCE<br><br>[B-(A+C)]'
];

function renderTimesheet (S, onChange) {
  const host = document.getElementById('activities');
  const ts = S.timesheet;
  const dim = daysInMonth(ts.year, ts.month);

  const table = document.createElement('table');
  table.className = 'uz-grid';

  /* ---- header ---- */
  let days = '';
  for (let d = 1; d <= 31; d++) days += `<th class="c-day">${d}</th>`;
  table.innerHTML = `
    <thead><tr>
      <th class="c-act">WORK ACTIVITY &amp; DATE</th>
      <th class="c-job">JOB ID<br>NUMBER</th>
      ${days}
      ${B_HEADS.map(h => `<th class="c-tot">${h}</th>`).join('')}
      <th class="c-del"></th>
    </tr></thead>
    <tbody></tbody>`;
  const tbody = table.querySelector('tbody');

  /* ---- one row per activity ---- */
  ts.activities.forEach((act, ai) => {
    const tr = document.createElement('tr');

    const tdAct = document.createElement('td');
    tdAct.className = 'c-act';
    tdAct.innerHTML = `<input class="dinput" placeholder="e.g. Developing Platform (${MONTHS[ts.month]} ${ts.year})">`;
    tdAct.querySelector('input').value = act.name;
    tdAct.querySelector('input').addEventListener('input', e => { act.name = e.target.value; onChange(); });
    tr.appendChild(tdAct);

    const tdJob = document.createElement('td');
    tdJob.className = 'c-job';
    tdJob.innerHTML = '<input class="dinput" placeholder="if any">';
    tdJob.querySelector('input').value = act.jobId;
    tdJob.querySelector('input').addEventListener('input', e => { act.jobId = e.target.value; onChange(); });
    tr.appendChild(tdJob);

    for (let d = 1; d <= 31; d++) {
      const td = document.createElement('td');
      td.className = 'c-day dcell';
      if (d > dim) {
        td.className = 'c-day';
        td.style.background = '#f0f2f4';
        td.title = `${MONTHS[ts.month]} ${ts.year} has only ${dim} days`;
      } else {
        td.addEventListener('click', () => {
          const cur = act.days[d] || '';
          const step = nextDayMark(S, cur);
          if (step.value) act.days[d] = step.value; else delete act.days[d];
          // the consultant has had a say now, so the month is theirs
          ts.autoFilled = false;
          paintDay(td, ts, act, d);
          updateRow(tr, S, act, ai);
          if (step.skipped.length) {
            const names = step.skipped.map(k => `${k} (${LEAVE_NAMES[k]})`).join(' and ');
            toast(`No ${names} left for ${ts.year} — skipped.`, true);
          }
          onChange();
        });
        paintDay(td, ts, act, d);
      }
      tr.appendChild(td);
    }

    const tdA = document.createElement('td');
    tdA.className = 'c-tot cellA';
    tr.appendChild(tdA);

    const tdB = document.createElement('td');
    tdB.className = 'c-tot';
    tdB.innerHTML = '<input class="dinput" type="number" step="0.5" placeholder="0">';
    tdB.querySelector('input').value = act.allocated || '';
    tdB.querySelector('input').addEventListener('input', e => {
      act.allocated = Number(e.target.value) || 0; updateRow(tr, S, act, ai); onChange();
    });
    tr.appendChild(tdB);

    const tdC = document.createElement('td');
    tdC.className = 'c-tot';
    tdC.innerHTML = '<input class="dinput" type="number" step="0.5" placeholder="0">';
    tdC.querySelector('input').value = act.pastClaim || '';
    tdC.querySelector('input').addEventListener('input', e => {
      act.pastClaim = Number(e.target.value) || 0; updateRow(tr, S, act, ai); onChange();
    });
    tr.appendChild(tdC);

    const tdBal = document.createElement('td');
    tdBal.className = 'c-tot cellBal';
    tr.appendChild(tdBal);

    const tdDel = document.createElement('td');
    tdDel.className = 'c-del';
    tdDel.innerHTML = '<button class="rowdel" title="Delete this row">&times;</button>';
    tdDel.querySelector('button').addEventListener('click', () => {
      if (ts.activities.length === 1) { toast('At least one activity row is required.', true); return; }
      ts.activities.splice(ai, 1);
      renderTimesheet(S, onChange);
      onChange();
    });
    tr.appendChild(tdDel);

    updateRow(tr, S, act, ai);
    tbody.appendChild(tr);
  });

  /* ---- TOTAL row ---- */
  const t = timesheetTotals(ts);
  const total = document.createElement('tr');
  total.className = 'totalrow';
  total.innerHTML =
    `<td class="c-act" style="text-align:left;padding-left:4px">TOTAL</td><td class="c-job"></td>` +
    Array(31).fill('<td class="c-day"></td>').join('') +
    `<td class="c-tot">${t.A}</td><td class="c-tot">${t.B}</td>` +
    `<td class="c-tot">${t.C}</td><td class="c-tot">${t.balance}</td><td class="c-del"></td>`;
  tbody.appendChild(total);

  host.innerHTML = '';
  host.appendChild(table);
  renderSummary(S);
}

function paintDay (td, ts, act, d) {
  const manual = act.days[d] || '';
  const shown = dayValue(ts, act, d);
  td.className = 'c-day dcell';
  if (manual === '/') td.classList.add('work');
  else if (MARKS[manual]) td.classList.add(MARKS[manual]);
  else if (shown === 'SAT' || shown === 'SUN') td.classList.add('we');
  td.textContent = manual || shown || '';
  const what = MARK_NAMES[manual] || (manual === '/' ? 'worked' : shown);
  td.title = `${d} ${MONTHS[ts.month]} ${ts.year}` + (what ? ` — ${what}` : '') + '  (click to change)';
}

function updateRow (tr, S, act, index) {
  const a = rowPaidDays(S.timesheet, index == null ? S.timesheet.activities.indexOf(act) : index);
  const bal = round2((Number(act.allocated) || 0) - (a + (Number(act.pastClaim) || 0)));
  tr.querySelector('.cellA').textContent = a;
  tr.querySelector('.cellBal').textContent = bal;

  // keep the printed TOTAL row and the summary bar in step
  const totalRow = tr.parentNode && tr.parentNode.querySelector('.totalrow');
  if (totalRow) {
    const t = timesheetTotals(S.timesheet);
    const cells = totalRow.querySelectorAll('.c-tot');
    if (cells.length === 4) {
      cells[0].textContent = t.A; cells[1].textContent = t.B;
      cells[2].textContent = t.C; cells[3].textContent = t.balance;
    }
  }
  renderSummary(S);
}

function renderSummary (S) {
  const t = timesheetTotals(S.timesheet);
  const ts = S.timesheet;

  /* Every day of the month is either paid for or not, so the bar says which:
     what is claimed, what was worked inside that, and what is not being paid
     — separating the days somebody accounted for from the ones nobody did. */
  const dim = daysInMonth(ts.year, ts.month);
  const blank = unmarkedDays(ts);
  document.getElementById('tsSummary').innerHTML = `
    <div>Month<b>${MONTHS[ts.month]} ${ts.year}</b></div>
    <div>Paid days [A]<b>${t.A} <small>of ${dim}</small></b></div>
    <div>Worked<b>${workedDays(ts)}</b></div>
    <div>Not paid<b>${dim - t.A}</b></div>
    <div>Allocated [B]<b>${t.B}</b></div>
    <div>Balance<b>${t.balance}</b></div>`;

  /* Which days the calendar put a PH on, and — more usefully — when it could
     not, because the movable holidays for that year have not been added yet.
     Silence there would read as "there are none". */
  const holNote = document.getElementById('tsHolidays');
  if (holNote && typeof holidaysInMonth === 'function') {
    const hol = holidaysInMonth(ts.year, ts.month);
    const listed = Object.keys(hol).map(d => `${d} ${MON3[ts.month]} — ${hol[d]}`);
    const known = typeof holidaysKnown === 'function' ? holidaysKnown(ts.year) : false;
    holNote.hidden = false;
    holNote.className = 'holnote' + (known ? '' : ' unsure');
    holNote.textContent = (listed.length
        ? `Selangor public holidays this month: ${listed.join(' · ')}.`
        : 'No Selangor public holiday falls in this month.') +
      (known ? '' :
        ` The movable holidays for ${ts.year} are not in the calendar yet, so only the ` +
        'fixed dates were set — check the others and mark them PH yourself.');
  }

  const warn = document.getElementById('tsWarn');
  if (warn) {
    // an unmarked working day is not paid, and that is almost never what
    // somebody meant — it is a day they forgot to account for
    warn.hidden = !blank.length;
    if (blank.length) {
      warn.textContent =
        `${blank.length} working day${blank.length > 1 ? 's are' : ' is'} unmarked ` +
        `(${blank.join(', ')}) — unmarked days are not paid. Tick “/” for a day worked, ` +
        `or say why it was not.`;
    }
  }

  renderLeave(S);
}

/**
 * The year's leave, one row per kind: what this month's grid holds, and what
 * is left of the allowance.
 *
 * Nothing here is typed any more. What earlier months used up is added up
 * from the months that have actually been sent for approval, so the balance
 * carries itself forward and the column that used to ask somebody to
 * remember it is gone.
 */
function renderLeave (S, hostId) {
  // the same table appears twice: under the grid, and on the profile step
  // where somebody is choosing whose claim this is
  const host = document.getElementById(hostId || 'leaveBox');
  if (!host) return;
  const ts = S.timesheet;

  const carried = LEAVE_KINDS
    .map(mark => ({ mark: mark, n: carriedLeave(S, mark) }))
    .filter(x => x.n > 0);

  host.innerHTML = `
    <div class="leavehead">
      <b>Leave in ${ts.year}</b>
      <span><b>PTO</b> and <b>MC</b> are ${LEAVE_LIMITS.PTO} days each a year, are paid,
        and count into [A]; a day cannot be marked once its allowance is spent.
        <b>UL</b> has no allowance &mdash; nobody is paid for it, so there is nothing
        to ration &mdash; and it does not count into [A].</span>
    </div>
    <table class="leavetable">
      <thead><tr>
        <th>Leave</th><th>${MONTHS[ts.month]}</th>
        <th>Taken in ${ts.year}</th><th>Left</th><th>Days this month</th>
      </tr></thead>
      <tbody></tbody>
    </table>
    <p class="leavefoot"></p>`;

  const foot = host.querySelector('.leavefoot');
  foot.textContent = carried.length
    ? 'Carried forward from months already submitted: ' +
      carried.map(x => `${x.n} ${x.mark}`).join(', ') + '.'
    : `Nothing carried forward — ${ts.year} starts here.`;

  const tbody = host.querySelector('tbody');
  leaveStandings(S).forEach(L => tbody.appendChild(leaveRow(S, L.mark)));
}

/** one leave row: this month, the year so far, and what is left of it */
function leaveRow (S, mark) {
  const L = leaveStanding(S, mark);
  const tr = document.createElement('tr');
  if (L.over) tr.className = 'over';

  const name = document.createElement('td');
  name.innerHTML = `<span class="lmark ${MARKS[mark]}"></span>`;
  name.querySelector('.lmark').textContent = mark;
  name.appendChild(document.createTextNode(' ' + LEAVE_NAMES[mark]));
  tr.appendChild(name);

  const cell = (text, cls) => {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  };

  tr.appendChild(cell(String(L.month)));
  tr.appendChild(cell(L.limit == null ? String(L.taken) : `${L.taken} of ${L.limit}`));
  tr.appendChild(cell(
    L.limit == null ? 'no limit'
      : L.over ? `${L.left} — over by ${L.taken - L.limit}`
      : String(L.left),
    L.limit == null ? 'nolimit' : (L.over || L.left === 0) ? 'bad' : (L.left <= 2 ? 'low' : '')
  ));
  tr.appendChild(cell(L.days.join(', ') || '—', 'daylist'));

  return tr;
}
