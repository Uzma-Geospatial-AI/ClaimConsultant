/* =======================================================================
   timesheet.js — grid hari 1..31 yang boleh ditanda (tick)
   ======================================================================= */

const CYCLE = ['', '/', 'PH'];   // kitaran nilai bila kotak diklik

/**
 * Nilai yang dipapar / dieksport bagi satu hari.
 * Tanda manual ('/' atau 'PH') mengatasi label hujung minggu automatik.
 */
function dayValue (ts, act, d) {
  const v = act.days[d];
  if (v) return v;
  const w = dowOf(ts.year, ts.month, d);
  if (w === 6) return 'SAT';
  if (w === 0) return 'SUN';
  return '';
}

function renderTimesheet (S, onChange) {
  const host = document.getElementById('activities');
  const ts = S.timesheet;
  const dim = daysInMonth(ts.year, ts.month);
  host.innerHTML = '';

  ts.activities.forEach((act, ai) => {
    const box = document.createElement('div');
    box.className = 'actrow';

    /* ---- baris atas: nama aktiviti, job id, B, C ---- */
    const top = document.createElement('div');
    top.className = 'top';
    top.innerHTML = `
      <label>Work Activity &amp; Date
        <input data-f="name" placeholder="Developing Platform (${MONTHS[ts.month]} ${ts.year})">
      </label>
      <label>Job ID Number<input data-f="jobId"></label>
      <label>Allocated Projected Days [B]<input type="number" step="0.5" data-f="allocated"></label>
      <label>Past Claim [C]<input type="number" step="0.5" data-f="pastClaim"></label>
      <label>&nbsp;<button class="delrow" title="Padam baris">&times;</button></label>`;

    top.querySelector('[data-f="name"]').value = act.name;
    top.querySelector('[data-f="jobId"]').value = act.jobId;
    top.querySelector('[data-f="allocated"]').value = act.allocated;
    top.querySelector('[data-f="pastClaim"]').value = act.pastClaim;

    top.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        const f = inp.dataset.f;
        act[f] = (f === 'allocated' || f === 'pastClaim') ? (Number(inp.value) || 0) : inp.value;
        updateStats(box, S, act);
        onChange();
      });
    });

    top.querySelector('.delrow').addEventListener('click', () => {
      if (ts.activities.length === 1) { toast('Sekurang-kurangnya satu baris aktiviti diperlukan.', true); return; }
      ts.activities.splice(ai, 1);
      renderTimesheet(S, onChange);
      onChange();
    });
    box.appendChild(top);

    /* ---- grid hari ---- */
    const days = document.createElement('div');
    days.className = 'days';
    for (let d = 1; d <= dim; d++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'day';
      b.innerHTML = `<span class="n">${d}</span><span class="v"></span>`;
      b.addEventListener('click', () => {
        const cur = act.days[d] || '';
        const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
        if (next) act.days[d] = next; else delete act.days[d];
        paintDay(b, ts, act, d);
        updateStats(box, S, act);
        onChange();
      });
      paintDay(b, ts, act, d);
      days.appendChild(b);
    }
    box.appendChild(days);

    /* ---- statistik baris ---- */
    const stats = document.createElement('div');
    stats.className = 'stats';
    box.appendChild(stats);
    updateStats(box, S, act);

    host.appendChild(box);
  });

  renderSummary(S);
}

function paintDay (el, ts, act, d) {
  const manual = act.days[d] || '';
  const shown = dayValue(ts, act, d);
  el.className = 'day';
  if (manual === '/') el.classList.add('work');
  else if (manual === 'PH') el.classList.add('ph');
  else if (shown === 'SAT' || shown === 'SUN') el.classList.add('we');
  el.querySelector('.v').textContent = manual ? manual : (shown || '');
  el.title = `${d} ${MONTHS[ts.month]} ${ts.year}` + (shown ? ` — ${shown}` : '');
}

function updateStats (box, S, act) {
  const a = activityTotal(act);
  const bal = round2((Number(act.allocated) || 0) - (a + (Number(act.pastClaim) || 0)));
  box.querySelector('.stats').innerHTML =
    `Total Days [A]: <b>${a}</b> &nbsp;·&nbsp; Balance [B-(A+C)]: <b>${bal}</b>`;
  renderSummary(S);
}

function renderSummary (S) {
  const t = timesheetTotals(S.timesheet);
  const ts = S.timesheet;
  const ph = new Set();
  ts.activities.forEach(a => Object.keys(a.days).forEach(d => { if (a.days[d] === 'PH') ph.add(Number(d)); }));
  document.getElementById('tsSummary').innerHTML = `
    <div>Bulan<b>${MONTHS[ts.month]} ${ts.year}</b></div>
    <div>Total Days [A]<b>${t.A}</b></div>
    <div>Allocated [B]<b>${t.B}</b></div>
    <div>Past Claim [C]<b>${t.C}</b></div>
    <div>Balance<b>${t.balance}</b></div>
    <div>Public Holiday<b>${ph.size ? [...ph].sort((x, y) => x - y).join(', ') : '—'}</b></div>`;
}
