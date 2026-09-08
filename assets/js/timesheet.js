/* =======================================================================
   timesheet.js — Section (B) of the Personnel Time Sheet, rendered as the
   same table that gets printed: activity, job id, days 1..31, A, B, C and
   the balance. Day cells are clickable.
   ======================================================================= */

/* Values a day cell cycles through when clicked. Only '/' is a day worked
   and only '/' is counted into [A] — PH, AL and UL mark the day for whoever
   reads the sheet without adding to the claim. */
const CYCLE = ['', '/', 'PH', 'AL', 'UL'];
const MARKS = { PH: 'ph', AL: 'al', UL: 'ul' };          // tick -> cell style
const MARK_NAMES = { PH: 'Public Holiday', AL: 'Annual Leave', UL: 'Unpaid Leave' };

/**
 * The value shown for one day, and the value exported to the documents.
 * A manual tick ('/', 'PH', 'AL' or 'UL') overrides the weekend label.
 */
function dayValue (ts, act, d) {
  const v = act.days[d];
  if (v) return v;
  const w = dowOf(ts.year, ts.month, d);
  if (w === 6) return 'SAT';
  if (w === 0) return 'SUN';
  return '';
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
          const nextVal = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
          if (nextVal) act.days[d] = nextVal; else delete act.days[d];
          paintDay(td, ts, act, d);
          updateRow(tr, S, act);
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
      act.allocated = Number(e.target.value) || 0; updateRow(tr, S, act); onChange();
    });
    tr.appendChild(tdB);

    const tdC = document.createElement('td');
    tdC.className = 'c-tot';
    tdC.innerHTML = '<input class="dinput" type="number" step="0.5" placeholder="0">';
    tdC.querySelector('input').value = act.pastClaim || '';
    tdC.querySelector('input').addEventListener('input', e => {
      act.pastClaim = Number(e.target.value) || 0; updateRow(tr, S, act); onChange();
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

    updateRow(tr, S, act);
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

function updateRow (tr, S, act) {
  const a = activityTotal(act);
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

  /** the days carrying one mark, across every activity row */
  const marked = mark => {
    const days = new Set();
    ts.activities.forEach(a => Object.keys(a.days).forEach(d => {
      if (a.days[d] === mark) days.add(Number(d));
    }));
    return [...days].sort((x, y) => x - y);
  };

  // PH is always worth a line; leave only earns one when it is on the sheet
  const ph = marked('PH'), al = marked('AL'), ul = marked('UL');
  const line = (label, days, always) =>
    (days.length || always) ? `<div>${label}<b>${days.join(', ') || '—'}</b></div>` : '';

  document.getElementById('tsSummary').innerHTML = `
    <div>Month<b>${MONTHS[ts.month]} ${ts.year}</b></div>
    <div>Total Days [A]<b>${t.A}</b></div>
    <div>Allocated [B]<b>${t.B}</b></div>
    <div>Past Claim [C]<b>${t.C}</b></div>
    <div>Balance<b>${t.balance}</b></div>
    ${line('Public Holiday', ph, true)}${line('Annual Leave', al)}${line('Unpaid Leave', ul)}`;
}
