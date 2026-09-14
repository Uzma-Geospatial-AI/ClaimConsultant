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
let previewTrigger = null;
let previewBackground = [];
let previewScroll = '';

function pdfViewerNodes () {
  return {
    box:   document.getElementById('pdfView'),
    frame: document.getElementById('pdfViewFrame'),
    title: document.getElementById('pdfViewTitle'),
    tab:   document.getElementById('pdfViewTab')
  };
}

function closePdfPreview (restoreFocus = true) {
  const { box, frame, tab } = pdfViewerNodes();
  if (!box) return;
  box.hidden = true;
  if (frame) frame.removeAttribute('src');
  if (tab) tab.removeAttribute('href');
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  previewBlob = null;
  previewName = '';
  previewBackground.forEach(([el, wasInert]) => { el.inert = wasInert; });
  previewBackground = [];
  document.body.style.overflow = previewScroll;
  if (restoreFocus && previewTrigger && previewTrigger.isConnected) previewTrigger.focus();
  previewTrigger = null;
}

/**
 * Show a generated PDF.
 * @param {string} label     what to call it in the viewer's title bar
 * @param {string} filename  the name it takes if downloaded from here
 * @param {object} doc       a jsPDF document
 */
function openPdfPreview (label, filename, doc, trigger) {
  openFilePreview(label, filename, doc.output('blob'), trigger);
}

/**
 * Show a file that already exists, rather than one just generated.
 *
 * A signed scan comes back as bytes — from the person's disk before it is
 * sent, or out of the archive after. Looking at one is the same act as
 * looking at a generated claim, so it is the same viewer: the browser's own,
 * pointed at a blob, with Download and Open in new tab where they always are.
 *
 * @param {Blob} blob  the file itself; a PDF or an image
 */
function openFilePreview (label, filename, blob, returnTo) {
  const { box, frame, title, tab } = pdfViewerNodes();
  if (!box || !frame) return;

  const trigger = returnTo || previewTrigger || document.activeElement;
  if (previewUrl) closePdfPreview(false);  // never stack two blobs
  previewTrigger = trigger;
  previewScroll = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  previewBackground = Array.from(document.body.children)
    .filter(el => el !== box && el.tagName !== 'SCRIPT' && el.id !== 'toast')
    .map(el => { const wasInert = el.inert; el.inert = true; return [el, wasInert]; });

  previewBlob = blob;
  previewName = filename;
  previewUrl  = URL.createObjectURL(previewBlob);

  if (title) title.textContent = label;
  // #view=FitH opens at page width, which is how somebody checking a form
  // wants to see it — not zoomed to whatever the viewer last remembered.
  // An image ignores it, which is the right thing to do with it.
  frame.src = previewUrl + '#view=FitH';
  if (tab) tab.href = previewUrl;
  box.hidden = false;
  const close = document.getElementById('pdfViewClose');
  if (close) close.focus();
}

function mountPdfViewer () {
  const box = document.getElementById('pdfView');
  if (!box) return;

  const close = document.getElementById('pdfViewClose');
  if (close) close.addEventListener('click', () => closePdfPreview());

  const dl = document.getElementById('pdfViewDownload');
  if (dl) dl.addEventListener('click', () => {
    if (previewBlob) saveAs(previewBlob, previewName);
  });

  // Clicking the surround closes, but only the surround: clicks inside the
  // bar or on the document itself must not.
  box.addEventListener('click', e => { if (e.target === box) closePdfPreview(); });

  document.addEventListener('keydown', e => {
    if (box.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closePdfPreview(); }
    if (e.key === 'Tab') {
      const controls = Array.from(box.querySelectorAll('a[href], button:not(:disabled), iframe'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}
