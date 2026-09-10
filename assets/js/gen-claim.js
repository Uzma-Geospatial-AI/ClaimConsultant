/* =======================================================================
   gen-claim.js — renders the Uzma Personnel Time Sheet (the Claim form)
               as PDF (jsPDF, landscape) and Word (docx)
   ======================================================================= */

const UZMA_FOOTER = {
  company: 'UZMA BERHAD',
  regNo: '2007010186 (769866-V)',
  addr: ['Uzma Tower,', 'No. 2, Jalan PJU 8/8A, Damansara Perdana,', '47820 Petaling Jaya, Selangor, MALAYSIA'],
  tel: 'Tel : +603 7611 4000',
  fax: 'Fax : +603 7611 4100',
  web: 'www.uzmagroup.com'
};

const NOTES = [
  '1. PERSONNEL TO COMPLETE DETAILS IN SECTION A AND SIGN IN SECTION C.',
  '2. PERSONNEL TO COMPLETE TIME SHEET BY PROVIDING A TICK (/) IN SECTION B AND SIGN IN SECTION C. ' +
  'INCLUDE KEY ACTIVITIES WHEN PERFORMING SERVICE IN AREAS OTHER THAN THE POINT OF ASSIGNMENT.'
];

const ROWS_MIN = 8;   // minimum activity rows, matching the original form

/* Section (C), measured off the workbook the form is printed from rather
   than by eye. That sheet is 1655.25 pt wide, and it prints to a single
   scale, so every length here is carried over as a share of the content
   width and holds on our A4 landscape sheet too.

   C_LABEL the label column, which ends at column K.
   C_ROW   row heights — 34 pt for each heading row, 80.15 pt for the
           signature row, 30 pt for Name and Date.
   C_GAP   the four empty rows (62 pt) standing between the grid and (C).

   The printed form carries three approver columns. Ours carries four: the
   project manager reviews a claim before the HOD approves it, and signs for
   having done so. The label column keeps the width the form gives it and
   the four share what is left, which is the one place this sheet departs
   from the workbook — deliberately, and only here. */
const C_LABEL = 0.152243;
const C_HEADS = [
  ['PREPARED BY', 'PERSONNEL',   'personnel'],
  ['REVIEWED BY', 'PROJECT MANAGER', 'pm'],
  ['APPROVED BY', 'HOD',         'hod'],
  ['VERIFIED BY', 'GROUP PEOPLE & GROUP FINANCE DIVISIONS', 'verified']
];
/** left edge of approver column i, as a share of the content width */
const cEdgeAt = i => C_LABEL + i * (1 - C_LABEL) / C_HEADS.length;
const C_ROW  = { head: 0.020541, sig: 0.048422, text: 0.018124 };
const C_GAP  = 0.037457;

/** compact month/year label: 'Aug-26' */
function monthLabel (ts) {
  return `${MON3[ts.month]}-${String(ts.year).slice(2)}`;
}

function claimFileBase (S) {
  const nm = safeFile(S.consultant.name);
  const my = `${MON3[S.timesheet.month]} ${S.timesheet.year}`;
  return nm ? `Claim ${my} - ${nm}` : `Claim ${my}`;
}

/** build the section (B) matrix: 8+ activity rows plus the TOTAL row */
function claimMatrix (S) {
  const ts = S.timesheet;
  const dim = daysInMonth(ts.year, ts.month);
  const body = [];

  ts.activities.forEach((act, i) => {
    const days = [];
    for (let d = 1; d <= 31; d++) days.push(d <= dim ? dayValue(ts, act, d) : '');
    const A = rowPaidDays(ts, i);
    const B = Number(act.allocated) || 0;
    const Cv = Number(act.pastClaim) || 0;
    body.push([act.name || '', act.jobId || '', ...days, A, B, Cv, round2(B - (A + Cv))]);
  });

  while (body.length < ROWS_MIN) {
    body.push(['', '', ...Array(31).fill(''), 0, 0, 0, 0]);
  }

  const T = timesheetTotals(ts);
  body.push(['TOTAL', '', ...Array(31).fill(''), T.A, T.B, T.C, T.balance]);
  return { body, dim };
}

/* ============================ PDF ============================ */

/* The form is an Excel document set in Calibri. Carlito is metrically
   identical to it and open-licensed — see vendor/carlito.js. */
const FONT = 'Carlito';

async function buildClaimPDF (S) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  addCarlito(doc);                      // Calibri metrics — see vendor/carlito.js

  const L = 10, R = 287, W = R - L;
  const C = S.consultant, P = S.project, ts = S.timesheet;
  /* Taken from the reference sheet itself, not matched by eye: its fills
     read #F2F2F2 and #ED7D31 (Office's "Orange, Accent 2"). */
  const GREY = [242, 242, 242], DARK = [35, 31, 32], ORANGE = [237, 125, 49];

  /* ---------- page header ---------- */
  /* The arrow, measured off the reference sheet rather than eyeballed: three
     segments spanning 6.137 x 6.200 pt on a 682.32 pt content width, which
     is 0.899% x 0.909% of it. Ours was nearly twice that size. */
  const triW = W * 0.008994, triH = W * 0.009086, triCentre = 14.2;
  doc.setFillColor(...ORANGE);
  doc.triangle(L, triCentre - triH / 2, L, triCentre + triH / 2, L + triW, triCentre, 'F');
  doc.setFont(FONT, 'bold').setFontSize(9.5).setTextColor(...DARK);
  doc.text('PERSONNEL TIME SHEET', L + 5.5, 15.2);
  doc.setFontSize(6).setTextColor(...DARK);      // black on the printed form, not grey
  doc.text('PEOPLE DIVISION', L + 5.5, 19);

  /* The wordmark is placed off the printed form's own geometry. Measured
     from the reference sheet (Letter landscape, 682.32pt content width):
     the mark is 58.57pt wide — 8.583% of the content width — its right edge
     sits 0.725% of that width inside the right margin, and its centre line
     falls a touch below the centre of the orange arrow. Expressing it as a
     fraction of W keeps the header identical on our A4 sheet. */
  const uzma = await loadLogo('uzma');
  if (uzma) {
    const lw = W * 0.08583;
    const lh = lw / (uzma.w / uzma.h);
    doc.addImage(uzma.url, 'PNG', R - W * 0.00725 - lw, triCentre + W * 0.00298 - lh / 2, lw, lh);
  } else {
    drawUzmaFallback(doc, R, 11.5, 7);
  }

  /* ---------- Section A ---------- */
  const secTop = 25, secH = 38;
  const leftW = 152, rightX = L + leftW + 4, rightW = R - rightX;

  const sectionHeader = (x, y, w, text) => {
    doc.setDrawColor(60, 60, 60).setLineWidth(0.3);
    doc.setFillColor(...GREY);
    doc.rect(x, y, w, 5.6, 'FD');
    doc.setFont(FONT, 'bold').setFontSize(6.6).setTextColor(...DARK);
    doc.text(text, x + 2, y + 3.8);
  };
  // Only the title bar is boxed. On the printed form the fields below it
  // carry nothing but their own underlines.
  sectionHeader(L, secTop, leftW, 'A. PERSONNEL DETAILS');
  sectionHeader(rightX, secTop, rightW, 'PROJECT DETAILS (IF APPLICABLE)');

  /** one underlined field: label : value______ (rule omitted when bare) */
  const field = (x, y, labelW, lineEnd, lab, val, bare) => {
    doc.setFont(FONT, 'bold').setFontSize(5.8).setTextColor(...DARK);
    doc.text(lab, x, y);
    doc.text(':', x + labelW, y);
    doc.setFont(FONT, 'normal').setFontSize(6.4);
    doc.text(String(val || ''), x + labelW + 3, y - 0.5);
    if (bare) return;
    doc.setDrawColor(120, 120, 120).setLineWidth(0.2);
    doc.line(x + labelW + 3, y + 1, lineEnd, y + 1);
  };

  const fy = secTop + 10, gap = 4.9;
  const leftFields = [
    ['Employee or BP Code No. (SAP usage only)', C.empCode],
    ['Name of Personnel', (C.name || '').toUpperCase()],
    ['Position', (C.position2 || C.position || '').toUpperCase()],
    ['Work Location', (C.workLoc || '').toUpperCase()],
    ['Assignment Period', C.assignPeriod || monthLabel(ts)],
    ['Month / Year', monthLabel(ts)]
  ];
  leftFields.forEach((f, i) => field(L + 3, fy + i * gap, 62, L + leftW - 4, f[0], f[1]));

  const rightFields = [
    ['Project Name', P.name],
    ['Client Name', P.client],
    ['Charge to Client', P.charge],
    ['      If YES, please provide the Profit Centres', P.profit],
    ['      If NO, please provide the Department Code', P.dept],
    ['INVOICE TO CLIENT', P.invClient]
  ];
  rightFields.forEach((f, i) => {
    const y = fy + i * gap;
    if (i === 3) {
      // This row shares its space with the "Project Code" field. That one
      // carries no rule: its cell on the form (AY15:BB15 in the workbook)
      // has no bottom border, unlike every other field here.
      field(rightX + 3, y, 62, rightX + 80, f[0], f[1]);
      field(rightX + 84, y, 18, 0, 'Project Code', P.code, true);
    } else {
      field(rightX + 3, y, 62, R - 4, f[0], f[1]);
    }
  });

  /* ---------- Section B ---------- */
  let y = secTop + secH + 4;
  doc.setFont(FONT, 'bold').setFontSize(6.4).setTextColor(...DARK);
  doc.text('(B)', L, y);
  y += 2;

  const { body } = claimMatrix(S);
  const dayHeads = [];
  for (let d = 1; d <= 31; d++) dayHeads.push(String(d));
  const head = [['WORK ACTIVITY & DATE', 'JOB ID\nNUMBER', ...dayHeads,
                 'TOTAL DAYS\n(current month claim)\n[A]',
                 'ALLOCATED\nPROJECTED DAYS\n[B]',
                 'PAST CLAIM\n(excluding current month)\n[C]',
                 'BALANCE\n\n[B-(A+C)]']];

  const dayW = (W - (48 + 13 + 15 + 18 + 16 + 16)) / 31;
  const colStyles = { 0: { cellWidth: 48, halign: 'left' }, 1: { cellWidth: 13 } };
  for (let i = 2; i <= 32; i++) colStyles[i] = { cellWidth: dayW, fontSize: 4.2 };
  colStyles[33] = { cellWidth: 15 };
  colStyles[34] = { cellWidth: 18 };
  colStyles[35] = { cellWidth: 16 };
  colStyles[36] = { cellWidth: 16 };

  doc.autoTable({
    startY: y,
    head, body,
    theme: 'grid',
    margin: { left: L, right: 297 - R },
    tableWidth: W,
    styles: { font: FONT, fontSize: 5.2, cellPadding: { top: 1, bottom: 1, left: 0.6, right: 0.6 },
              lineColor: [80, 80, 80], lineWidth: 0.15, textColor: [20, 20, 20],
              halign: 'center', valign: 'middle', minCellHeight: 5.2, overflow: 'linebreak' },
    headStyles: { fillColor: GREY, textColor: [20, 20, 20], fontStyle: 'bold',
                  fontSize: 4.4, lineWidth: 0.2, valign: 'middle', minCellHeight: 12 },
    columnStyles: colStyles,
    didParseCell: d => {
      if (d.section === 'body') {
        if (d.column.index === 0) d.cell.styles.halign = 'left';
        if (d.row.index === body.length - 1) d.cell.styles.fontStyle = 'bold';
      }
    }
  });
  /* Section (C) does not sit tight under the grid: four empty rows stand
     between them on the form — 62 pt of a sheet 1655.25 pt wide. Everything
     below is taken the same way, as a share of the content width, since the
     sheet prints to one scale in both directions. */
  y = doc.lastAutoTable.finalY + W * C_GAP;

  /* ---------- Section C ---------- */
  const labW = W * C_LABEL, colW = W * (1 - C_LABEL) / C_HEADS.length;
  const cx = i => L + W * cEdgeAt(i);
  const rowsC = [
    { h: W * C_ROW.head, type: 'head', cells: C_HEADS.map(h => h[0]) },
    { h: W * C_ROW.head, type: 'head', cells: C_HEADS.map(h => h[1]) },
    { h: W * C_ROW.sig,  type: 'sig',  label: 'Signature' },
    { h: W * C_ROW.text, type: 'text', label: 'Name',
      cells: [ts.prepName || C.name || '', ts.reviewName || '',
              ts.apprName || '', ts.verifName || ''], bold: true },
    { h: W * C_ROW.text, type: 'text', label: 'Date',
      cells: [ts.prepDate || '', ts.reviewDate || '', ts.apprDate || '', ts.verifDate || ''] }
  ];

  const sigs = {};
  for (let i = 0; i < C_HEADS.length; i++) sigs[i] = await normalizeSignature(S.sig[C_HEADS[i][2]]);

  let cy = y;
  for (const row of rowsC) {
    doc.setDrawColor(60, 60, 60).setLineWidth(0.25);
    if (row.type === 'head') {
      /* The label column is left open beside the two heading rows — the box
         on the form starts at the PREPARED BY column, and the space to its
         left is where the "(C)" marker sits. */
      if (row === rowsC[0]) {
        doc.setFont(FONT, 'bold').setFontSize(6.4).setTextColor(...DARK);
        doc.text('(C)', L, cy + row.h / 2 + 1);
      }
    } else {
      doc.rect(L, cy, labW, row.h, 'S');
      doc.setFont(FONT, 'bold').setFontSize(6).setTextColor(...DARK);
      doc.text(row.label, L + 2, cy + row.h / 2 + 1);
    }
    for (let i = 0; i < C_HEADS.length; i++) {
      const w = colW;
      if (row.type === 'head') { doc.setFillColor(...GREY); doc.rect(cx(i), cy, w, row.h, 'FD'); }
      else doc.rect(cx(i), cy, w, row.h, 'S');

      if (row.type === 'head') {
        doc.setFont(FONT, 'bold').setFontSize(6.2).setTextColor(...DARK);
        // the Finance heading is the long one; it wraps rather than run out
        // of its column now that four of them share the width
        const lines = doc.splitTextToSize(row.cells[i], w - 3);
        doc.text(lines, cx(i) + w / 2, cy + row.h / 2 + 1 - (lines.length - 1) * 1.2,
                 { align: 'center' });
      } else if (row.type === 'text') {
        doc.setFont(FONT, row.bold ? 'bold' : 'normal').setFontSize(6.2).setTextColor(...DARK);
        doc.text(String(row.cells[i] || ''), cx(i) + w / 2, cy + row.h / 2 + 1, { align: 'center' });
      } else if (row.type === 'sig' && sigs[i]) {
        const s = sigs[i];
        const maxW = w - 16, maxH = row.h - 3.5;
        const sc = Math.min(maxW / s.w, maxH / s.h);
        doc.addImage(s.url, 'PNG', cx(i) + (w - s.w * sc) / 2, cy + (row.h - s.h * sc) / 2,
                     s.w * sc, s.h * sc);
      }
    }
    cy += row.h;
  }

  /* ---------- NOTES ---------- */
  let ny = cy + 5;
  doc.setFont(FONT, 'bold').setFontSize(6).setTextColor(...DARK);
  doc.text('NOTES:', L, ny);
  ny += 4;
  doc.setFontSize(5.2);
  NOTES.forEach(n => {
    const lines = doc.splitTextToSize(n, W);
    doc.text(lines, L, ny);
    ny += lines.length * 2.6 + 1.6;
  });

  /* ---------- footer ---------- */
  const fyy = 198;
  doc.setFont(FONT, 'bold').setFontSize(5.6).setTextColor(...DARK);
  doc.text(UZMA_FOOTER.company, L, fyy);
  doc.text(UZMA_FOOTER.regNo, L, fyy + 3);
  doc.setFont(FONT, 'normal').setFontSize(5.2).setTextColor(70, 70, 70);
  /* The orange rule beside the address. On the reference it is a hairline —
     0.585 pt wide, 18.13 pt tall, or 2.657% of the content width — not the
     bar we had, which was three times too heavy. */
  doc.setDrawColor(...ORANGE).setLineWidth(0.206);
  const ruleH = W * 0.026572, ruleMid = fyy - 0.4;
  doc.line(L + 57.9, ruleMid - ruleH / 2, L + 57.9, ruleMid + ruleH / 2);
  UZMA_FOOTER.addr.forEach((a, i) => doc.text(a, L + 60, fyy - 3 + i * 3));
  doc.text(UZMA_FOOTER.tel, L + 165, fyy);
  doc.text(UZMA_FOOTER.fax, L + 165, fyy + 3);
  doc.text(UZMA_FOOTER.web, R, fyy + 3, { align: 'right' });

  return doc;
}

async function generateClaimPDF (S) {
  const doc = await buildClaimPDF(S);
  doc.save(`${claimFileBase(S)}.pdf`);
}

/* ============================ WORD (.docx) ============================ */

async function generateClaimDOCX (S) {
  const D = window.docx;
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
          AlignmentType, BorderStyle, ImageRun, PageOrientation, VerticalAlign } = D;

  const C = S.consultant, P = S.project, ts = S.timesheet;
  const { body } = claimMatrix(S);

  const TOTAL_DXA = 15680;                                     // full content width, twips

  /* Same 8.583%-of-content-width rule the PDF header uses. The section (B)
     table spans TOTAL_DXA twips, and Word measures images in px at 96 dpi. */
  const uzmaLogo = await loadLogo('uzma');
  const contentPx = (TOTAL_DXA / 1440) * 96;
  const uzmaLogoW = Math.round(contentPx * 0.08583);
  const uzmaLogoH = uzmaLogo ? Math.round(uzmaLogoW / (uzmaLogo.w / uzmaLogo.h)) : 0;

  const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const THIN = { style: BorderStyle.SINGLE, size: 4, color: '555555' };
  const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE };
  const allBorders = { top: THIN, bottom: THIN, left: THIN, right: THIN };

  const txt = (text, opt = {}) => new TextRun({
    text: String(text == null ? '' : text),
    bold: !!opt.bold, italics: !!opt.italics,
    size: opt.size || 12, color: opt.color || '231F20',
    font: 'Arial'
  });
  const para = (runs, opt = {}) => new Paragraph({
    children: Array.isArray(runs) ? runs : [runs],
    alignment: opt.align || AlignmentType.LEFT,
    spacing: { before: opt.before || 0, after: opt.after == null ? 0 : opt.after }
  });
  const cell = (children, opt = {}) => new TableCell({
    children: Array.isArray(children) ? children : [children],
    width: opt.width ? { size: opt.width, type: WidthType.DXA } : undefined,
    columnSpan: opt.span,
    verticalAlign: VerticalAlign.CENTER,
    borders: opt.borders || allBorders,
    shading: opt.fill ? { type: D.ShadingType.CLEAR, color: 'auto', fill: opt.fill } : undefined,
    margins: { top: 20, bottom: 20, left: 30, right: 30 }
  });

  /* ---------- section (B) column widths ---------- */
  const wAct = 2500, wJob = 620, wA = 800, wB = 900, wC = 800, wBal = 760;
  const wDay = Math.floor((TOTAL_DXA - (wAct + wJob + wA + wB + wC + wBal)) / 31);
  const colWidths = [wAct, wJob, ...Array(31).fill(wDay), wA, wB, wC, wBal];

  /* ---------- Section A ---------- */
  const fieldRow = (lab, val) => new TableRow({
    children: [
      cell(para(txt(lab, { bold: true, size: 12 })), { width: 3400, borders: noBorders }),
      cell(para(txt(':', { bold: true, size: 12 })), { width: 200, borders: noBorders }),
      cell(para(txt(val, { size: 13 })), {
        width: 3600,
        borders: { top: NONE, left: NONE, right: NONE, bottom: { style: BorderStyle.SINGLE, size: 4, color: '888888' } }
      })
    ]
  });

  const leftTable = new Table({
    width: { size: 7200, type: WidthType.DXA },
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows: [
      new TableRow({ children: [ cell(para(txt('A. PERSONNEL DETAILS', { bold: true, size: 13 })), { span: 3, fill: 'F2F2F2' }) ] }),
      fieldRow('Employee or BP Code No. (SAP usage only)', C.empCode),
      fieldRow('Name of Personnel', (C.name || '').toUpperCase()),
      fieldRow('Position', (C.position2 || C.position || '').toUpperCase()),
      fieldRow('Work Location', (C.workLoc || '').toUpperCase()),
      fieldRow('Assignment Period', C.assignPeriod || monthLabel(ts)),
      fieldRow('Month / Year', monthLabel(ts))
    ]
  });

  const rightTable = new Table({
    width: { size: 8000, type: WidthType.DXA },
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows: [
      new TableRow({ children: [ cell(para(txt('PROJECT DETAILS (IF APPLICABLE)', { bold: true, size: 13 })), { span: 3, fill: 'F2F2F2' }) ] }),
      fieldRow('Project Name', P.name),
      fieldRow('Client Name', P.client),
      fieldRow('Charge to Client', P.charge),
      fieldRow('        If YES, please provide the Profit Centres', P.profit),
      fieldRow('        If NO, please provide the Department Code', P.dept),
      fieldRow('INVOICE TO CLIENT', P.invClient)
    ]
  });

  // two tables side by side inside one borderless wrapper table
  const sectionA = new Table({
    width: { size: TOTAL_DXA, type: WidthType.DXA },
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows: [ new TableRow({ children: [
      cell(leftTable, { width: 7500, borders: noBorders }),
      cell(para(txt('')), { width: 400, borders: noBorders }),
      cell([rightTable, para(txt('Project Code : ' + (P.code || ''), { size: 12, bold: true }), { before: 40 })],
           { width: 7780, borders: noBorders })
    ] }) ]
  });

  /* ---------- section (B) table ---------- */
  const headTexts = ['WORK ACTIVITY & DATE', 'JOB ID NUMBER'];
  for (let d = 1; d <= 31; d++) headTexts.push(String(d));
  headTexts.push('TOTAL DAYS (current month claim) [A]',
                 'ALLOCATED PROJECTED DAYS [B]',
                 'PAST CLAIM (excluding current month) [C]',
                 'BALANCE [B-(A+C)]');

  const headRow = new TableRow({
    tableHeader: true,
    children: headTexts.map((t, i) => cell(
      para(txt(t, { bold: true, size: i >= 2 && i <= 32 ? 10 : 9 }), { align: AlignmentType.CENTER }),
      { width: colWidths[i] }
    ))
  });

  const bodyRows = body.map((r, ri) => new TableRow({
    children: r.map((v, ci) => cell(
      para(txt(v === 0 && ci >= 2 && ci <= 32 ? '' : v,
               { size: ci >= 2 && ci <= 32 ? 10 : 11, bold: ri === body.length - 1 }),
           { align: ci === 0 ? AlignmentType.LEFT : AlignmentType.CENTER }),
      { width: colWidths[ci] }
    ))
  }));

  const tableB = new Table({
    width: { size: TOTAL_DXA, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headRow, ...bodyRows]
  });

  /* ---------- Section C ---------- */
  const sigCell = async key => {
    const s = await normalizeSignature(S.sig[key]);
    if (!s) return para(txt(''));
    const scale = Math.min(150 / s.w, 55 / s.h);
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [ new ImageRun({
        data: dataUrlToBytes(s.url),
        transformation: { width: Math.round(s.w * scale), height: Math.round(s.h * scale) }
      }) ]
    });
  };

  /* Same columns the PDF draws: the label column at the width the workbook
     gives it, and the four approvers sharing what is left. */
  const labDxa = Math.round(C_LABEL * TOTAL_DXA);
  const colDxa = Math.round((TOTAL_DXA - labDxa) / C_HEADS.length);
  const cwC = [labDxa].concat(C_HEADS.map(() => colDxa));

  const sigRowCells = [cell(para(txt('Signature', { bold: true, size: 12 })), { width: labDxa })];
  for (const head of C_HEADS) sigRowCells.push(cell(await sigCell(head[2]), { width: colDxa }));

  const cRow = (label, vals, bold) => new TableRow({
    children: [
      cell(para(txt(label, { bold: true, size: 12 })), { width: labDxa }),
      ...vals.map(v => cell(para(txt(v, { bold: !!bold, size: 12 }), { align: AlignmentType.CENTER }),
                            { width: colDxa }))
    ]
  });

  /* The heading rows carry no label cell on the form — the box starts at
     PREPARED BY, and "(C)" stands in the open space to its left. */
  const cHead = (marker, vals) => new TableRow({
    children: [
      cell(para(txt(marker, { bold: true, size: 12 })), { width: labDxa, borders: noBorders }),
      ...vals.map(v => cell(para(txt(v, { bold: true, size: 12 }), { align: AlignmentType.CENTER }),
                            { width: colDxa, fill: 'EBEBEB' }))
    ]
  });

  const tableC = new Table({
    width: { size: TOTAL_DXA, type: WidthType.DXA },
    columnWidths: cwC,
    rows: [
      cHead('(C)', C_HEADS.map(h => h[0])),
      cHead('', C_HEADS.map(h => h[1])),
      new TableRow({ children: sigRowCells, height: { value: 900, rule: 'atLeast' } }),
      cRow('Name', [ts.prepName || C.name || '', ts.reviewName || '',
                    ts.apprName || '', ts.verifName || ''], true),
      cRow('Date', [ts.prepDate || '', ts.reviewDate || '', ts.apprDate || '', ts.verifDate || ''], false)
    ]
  });

  /* ---------- document ---------- */
  const doc = new Document({
    creator: 'Sistem Consultant Claim',
    title: claimFileBase(S),
    styles: { default: { document: { run: { font: 'Arial', size: 16 } } } },
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.LANDSCAPE },
          margin: { top: 400, right: 500, bottom: 400, left: 500 }
        }
      },
      children: [
        para([ txt('PERSONNEL TIME SHEET', { bold: true, size: 20 }),
               txt('                                                                                             '),
               ...(uzmaLogo
                   ? [ new ImageRun({ data: dataUrlToBytes(uzmaLogo.url),
                                      transformation: { width: uzmaLogoW, height: uzmaLogoH } }) ]
                   : [ txt('UZMA', { bold: true, size: 26, color: 'F26522' }) ]) ]),
        para(txt('PEOPLE DIVISION', { bold: true, size: 11, color: '666666' }), { after: 160 }),
        sectionA,
        para(txt('(B)', { bold: true, size: 12 }), { before: 200, after: 60 }),
        tableB,
        para(txt(''), { before: 340 }),      // the four empty rows before (C)
        tableC,
        para(txt('NOTES:', { bold: true, size: 11 }), { before: 240, after: 40 }),
        ...NOTES.map(n => para(txt(n, { size: 10 }), { after: 40 })),
        para(txt(''), { before: 240 }),
        para([ txt(UZMA_FOOTER.company + '  ' + UZMA_FOOTER.regNo, { bold: true, size: 10 }),
               txt('      ' + UZMA_FOOTER.addr.join(' ') + '      ' +
                   UZMA_FOOTER.tel + '   ' + UZMA_FOOTER.fax + '   ' + UZMA_FOOTER.web,
                   { size: 10, color: '666666' }) ])
      ]
    }]
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${claimFileBase(S)}.docx`);
}
