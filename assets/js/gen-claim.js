/* =======================================================================
   gen-claim.js — jana Personnel Time Sheet (borang Claim Uzma)
                  dalam format PDF (jsPDF, landskap) dan Word (docx)
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

const ROWS_MIN = 8;   // bilangan baris aktiviti minimum seperti templat asal

/** label bulan/tahun ringkas: 'Aug-26' */
function monthLabel (ts) {
  return `${MON3[ts.month]}-${String(ts.year).slice(2)}`;
}

function claimFileBase (S) {
  const nm = safeFile(S.consultant.name);
  const my = `${MON3[S.timesheet.month]} ${S.timesheet.year}`;
  return nm ? `Claim ${my} - ${nm}` : `Claim ${my}`;
}

/** bina matriks jadual (B): 8+ baris aktiviti + baris TOTAL */
function claimMatrix (S) {
  const ts = S.timesheet;
  const dim = daysInMonth(ts.year, ts.month);
  const body = [];

  ts.activities.forEach(act => {
    const days = [];
    for (let d = 1; d <= 31; d++) days.push(d <= dim ? dayValue(ts, act, d) : '');
    const A = activityTotal(act);
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

async function generateClaimPDF (S) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });

  const L = 10, R = 287, W = R - L;
  const C = S.consultant, P = S.project, ts = S.timesheet;
  const GREY = [235, 235, 235], DARK = [35, 31, 32], ORANGE = [242, 101, 34];

  /* ---------- kepala halaman ---------- */
  doc.setFillColor(...ORANGE);
  doc.triangle(L, 12, L, 16.4, L + 3.6, 14.2, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...DARK);
  doc.text('PERSONNEL TIME SHEET', L + 5.5, 15.2);
  doc.setFontSize(6).setTextColor(90, 90, 90);
  doc.text('PEOPLE DIVISION', L + 5.5, 19);

  doc.setFont('helvetica', 'bold').setFontSize(19).setTextColor(...DARK);
  doc.text('UZMA', R, 18, { align: 'right' });
  doc.setFillColor(...ORANGE);
  doc.triangle(R - 6.2, 11.6, R - 6.2, 18.2, R - 1.2, 11.6, 'F');

  /* ---------- Seksyen A ---------- */
  const secTop = 25, secH = 38;
  const leftW = 152, rightX = L + leftW + 4, rightW = R - rightX;

  const sectionHeader = (x, y, w, text) => {
    doc.setDrawColor(60, 60, 60).setLineWidth(0.3);
    doc.setFillColor(255, 255, 255);
    doc.rect(x, y, w, 5.6, 'S');
    doc.setFont('helvetica', 'bold').setFontSize(6.6).setTextColor(...DARK);
    doc.text(text, x + 2, y + 3.8);
  };
  doc.setDrawColor(60, 60, 60).setLineWidth(0.3);
  doc.rect(L, secTop, leftW, secH, 'S');
  doc.rect(rightX, secTop, rightW, secH, 'S');
  sectionHeader(L, secTop, leftW, 'A. PERSONNEL DETAILS');
  sectionHeader(rightX, secTop, rightW, 'PROJECT DETAILS (IF APPLICABLE)');

  /** satu medan bergaris: label : nilai______ */
  const field = (x, y, labelW, lineEnd, lab, val, bold) => {
    doc.setFont('helvetica', bold ? 'bold' : 'bold').setFontSize(5.8).setTextColor(...DARK);
    doc.text(lab, x, y);
    doc.text(':', x + labelW, y);
    doc.setFont('helvetica', 'normal').setFontSize(6.4);
    doc.text(String(val || ''), x + labelW + 3, y - 0.5);
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
      // baris ini berkongsi ruang dengan medan "Project Code"
      field(rightX + 3, y, 62, rightX + 92, f[0], f[1]);
      field(rightX + 97, y, 20, R - 4, 'Project Code', P.code);
    } else {
      field(rightX + 3, y, 62, R - 4, f[0], f[1]);
    }
  });

  /* ---------- Seksyen B ---------- */
  let y = secTop + secH + 4;
  doc.setFont('helvetica', 'bold').setFontSize(6.4).setTextColor(...DARK);
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
    styles: { font: 'helvetica', fontSize: 5.2, cellPadding: { top: 1, bottom: 1, left: 0.6, right: 0.6 },
              lineColor: [80, 80, 80], lineWidth: 0.15, textColor: [20, 20, 20],
              halign: 'center', valign: 'middle', minCellHeight: 5.2, overflow: 'linebreak' },
    headStyles: { fillColor: [255, 255, 255], textColor: [20, 20, 20], fontStyle: 'bold',
                  fontSize: 4.4, lineWidth: 0.2, valign: 'middle', minCellHeight: 12 },
    columnStyles: colStyles,
    didParseCell: d => {
      if (d.section === 'body') {
        if (d.column.index === 0) d.cell.styles.halign = 'left';
        if (d.row.index === body.length - 1) d.cell.styles.fontStyle = 'bold';
      }
    }
  });
  y = doc.lastAutoTable.finalY + 4;

  /* ---------- Seksyen C ---------- */
  doc.setFont('helvetica', 'bold').setFontSize(6.4).setTextColor(...DARK);
  doc.text('(C)', L, y + 3);

  const labW = 26, colW = (W - labW) / 3;
  const cx = i => L + labW + i * colW;
  const rowsC = [
    { h: 6,  type: 'head', cells: ['PREPARED BY', 'APPROVED BY', 'VERIFIED BY'] },
    { h: 6,  type: 'head', cells: ['PERSONNEL', 'HOD', 'GROUP PEOPLE & GROUP FINANCE DIVISIONS'] },
    { h: 18, type: 'sig',  label: 'Signature' },
    { h: 6,  type: 'text', label: 'Name',
      cells: [ts.prepName || C.name || '', ts.apprName || '', ts.verifName || ''], bold: true },
    { h: 6,  type: 'text', label: 'Date',
      cells: [ts.prepDate || '', ts.apprDate || '', ts.verifDate || ''] }
  ];

  const sigs = {
    0: await normalizeSignature(S.sig.personnel),
    1: await normalizeSignature(S.sig.hod),
    2: await normalizeSignature(S.sig.verified)
  };

  let cy = y;
  for (const row of rowsC) {
    doc.setDrawColor(60, 60, 60).setLineWidth(0.25);
    if (row.type !== 'head') {
      doc.rect(L, cy, labW, row.h, 'S');
      doc.setFont('helvetica', 'bold').setFontSize(6).setTextColor(...DARK);
      doc.text(row.label, L + 2, cy + row.h / 2 + 1);
    } else {
      doc.setFillColor(...GREY);
      doc.rect(L, cy, labW, row.h, 'FD');
    }
    for (let i = 0; i < 3; i++) {
      if (row.type === 'head') { doc.setFillColor(...GREY); doc.rect(cx(i), cy, colW, row.h, 'FD'); }
      else doc.rect(cx(i), cy, colW, row.h, 'S');

      if (row.type === 'head') {
        doc.setFont('helvetica', 'bold').setFontSize(6.2).setTextColor(...DARK);
        doc.text(row.cells[i], cx(i) + colW / 2, cy + row.h / 2 + 1, { align: 'center' });
      } else if (row.type === 'text') {
        doc.setFont('helvetica', row.bold ? 'bold' : 'normal').setFontSize(6.2).setTextColor(...DARK);
        doc.text(String(row.cells[i] || ''), cx(i) + colW / 2, cy + row.h / 2 + 1, { align: 'center' });
      } else if (row.type === 'sig' && sigs[i]) {
        const s = sigs[i];
        const maxW = colW - 16, maxH = row.h - 5;
        const sc = Math.min(maxW / s.w, maxH / s.h);
        doc.addImage(s.url, 'PNG', cx(i) + (colW - s.w * sc) / 2, cy + (row.h - s.h * sc) / 2,
                     s.w * sc, s.h * sc);
      }
    }
    cy += row.h;
  }

  /* ---------- NOTA ---------- */
  let ny = cy + 5;
  doc.setFont('helvetica', 'bold').setFontSize(6).setTextColor(...DARK);
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
  doc.setFont('helvetica', 'bold').setFontSize(5.6).setTextColor(...DARK);
  doc.text(UZMA_FOOTER.company, L, fyy);
  doc.text(UZMA_FOOTER.regNo, L, fyy + 3);
  doc.setFont('helvetica', 'normal').setFontSize(5.2).setTextColor(70, 70, 70);
  UZMA_FOOTER.addr.forEach((a, i) => doc.text(a, L + 60, fyy - 3 + i * 3));
  doc.text(UZMA_FOOTER.tel, L + 165, fyy);
  doc.text(UZMA_FOOTER.fax, L + 165, fyy + 3);
  doc.text(UZMA_FOOTER.web, R, fyy + 3, { align: 'right' });

  doc.save(`${claimFileBase(S)}.pdf`);
}

/* ============================ WORD (.docx) ============================ */

async function generateClaimDOCX (S) {
  const D = window.docx;
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
          AlignmentType, BorderStyle, ImageRun, PageOrientation, VerticalAlign } = D;

  const C = S.consultant, P = S.project, ts = S.timesheet;
  const { body } = claimMatrix(S);

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

  /* ---------- lebar lajur jadual (B) ---------- */
  const TOTAL_DXA = 15680;
  const wAct = 2500, wJob = 620, wA = 800, wB = 900, wC = 800, wBal = 760;
  const wDay = Math.floor((TOTAL_DXA - (wAct + wJob + wA + wB + wC + wBal)) / 31);
  const colWidths = [wAct, wJob, ...Array(31).fill(wDay), wA, wB, wC, wBal];

  /* ---------- Seksyen A ---------- */
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

  // dua jadual bersebelahan di dalam satu jadual pembalut tanpa sempadan
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

  /* ---------- jadual (B) ---------- */
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

  /* ---------- Seksyen C ---------- */
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

  const cW = Math.floor((TOTAL_DXA - 2200) / 3);
  const sigRowCells = [
    cell(para(txt('Signature', { bold: true, size: 12 })), { width: 2200 }),
    cell(await sigCell('personnel'), { width: cW }),
    cell(await sigCell('hod'), { width: cW }),
    cell(await sigCell('verified'), { width: cW })
  ];

  const cRow = (label, vals, bold, fill) => new TableRow({
    children: [
      cell(para(txt(label, { bold: true, size: 12 })), { width: 2200, fill }),
      ...vals.map(v => cell(para(txt(v, { bold: !!bold, size: 12 }), { align: AlignmentType.CENTER }),
                            { width: cW, fill }))
    ]
  });

  const tableC = new Table({
    width: { size: TOTAL_DXA, type: WidthType.DXA },
    columnWidths: [2200, cW, cW, cW],
    rows: [
      cRow('', ['PREPARED BY', 'APPROVED BY', 'VERIFIED BY'], true, 'EBEBEB'),
      cRow('', ['PERSONNEL', 'HOD', 'GROUP PEOPLE & GROUP FINANCE DIVISIONS'], true, 'EBEBEB'),
      new TableRow({ children: sigRowCells, height: { value: 900, rule: 'atLeast' } }),
      cRow('Name', [ts.prepName || C.name || '', ts.apprName || '', ts.verifName || ''], true),
      cRow('Date', [ts.prepDate || '', ts.apprDate || '', ts.verifDate || ''], false)
    ]
  });

  /* ---------- dokumen ---------- */
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
               txt('UZMA', { bold: true, size: 26, color: 'F26522' }) ]),
        para(txt('PEOPLE DIVISION', { bold: true, size: 11, color: '666666' }), { after: 160 }),
        sectionA,
        para(txt('(B)', { bold: true, size: 12 }), { before: 200, after: 60 }),
        tableB,
        para(txt('(C)', { bold: true, size: 12 }), { before: 240, after: 60 }),
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
