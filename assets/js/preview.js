/* =======================================================================
   preview.js — look at the PDF before committing it to a download

   The generators hand back a jsPDF document; this turns one into a blob,
   points an iframe at it and lets the browser's own PDF viewer do the
   rendering. Nothing is written to disk until the Download button in the
   viewer is pressed.

   The blob URL is revoked when the viewer closes. Leaving them alive holds
   a whole PDF in memory each time, and somebody checking a claim will open
   this a dozen times before they are happy with it.
   ======================================================================= */

let previewUrl  = null;      // the live blob: URL, or null when closed
let previewBlob = null;
let previewName = '';

function pdfViewerNodes () {
  return {
    box:   document.getElementById('pdfView'),
    frame: document.getElementById('pdfViewFrame'),
    title: document.getElementById('pdfViewTitle'),
    tab:   document.getElementById('pdfViewTab')
  };
}

function closePdfPreview () {
  const { box, frame, tab } = pdfViewerNodes();
  if (!box) return;
  box.hidden = true;
  if (frame) frame.removeAttribute('src');
  if (tab) tab.removeAttribute('href');
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  previewBlob = null;
  previewName = '';
}

/**
 * Show a generated PDF.
 * @param {string} label     what to call it in the viewer's title bar
 * @param {string} filename  the name it takes if downloaded from here
 * @param {object} doc       a jsPDF document
 */
function openPdfPreview (label, filename, doc) {
  const { box, frame, title, tab } = pdfViewerNodes();
  if (!box || !frame) return;

  closePdfPreview();                       // never stack two blobs

  previewBlob = doc.output('blob');
  previewName = filename;
  previewUrl  = URL.createObjectURL(previewBlob);

  if (title) title.textContent = label;
  // #view=FitH opens at page width, which is how somebody checking a form
  // wants to see it — not zoomed to whatever the viewer last remembered.
  frame.src = previewUrl + '#view=FitH';
  if (tab) tab.href = previewUrl;
  box.hidden = false;
}

function mountPdfViewer () {
  const box = document.getElementById('pdfView');
  if (!box) return;

  const close = document.getElementById('pdfViewClose');
  if (close) close.addEventListener('click', closePdfPreview);

  const dl = document.getElementById('pdfViewDownload');
  if (dl) dl.addEventListener('click', () => {
    if (previewBlob) saveAs(previewBlob, previewName);
  });

  // Clicking the surround closes, but only the surround: clicks inside the
  // bar or on the document itself must not.
  box.addEventListener('click', e => { if (e.target === box) closePdfPreview(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !box.hidden) closePdfPreview();
  });
}
