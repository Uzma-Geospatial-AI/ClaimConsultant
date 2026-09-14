/* =======================================================================
   signature.js — signature pads that live inside the form itself.

   A pad is mounted into whatever container asks for it, so the same
   signature can appear in Section C of the Claim and on the Invoice at
   the same time; drawing in one updates the other.
   ======================================================================= */

const SIG_HINTS = {
  personnel: 'Draw here, or upload an image',
  pm:        'Optional — leave blank for the project manager to sign',
  hod:       'Optional — leave blank for the HOD to sign',
  verified:  'Optional — leave blank for Finance'
};

const Sig = (() => {
  const pads = {};                    // key -> [ {pad, canvas, root} ]
  let S = null, onChange = () => {};
  let resizeBound = false;

  function reset (state, changeCb) {
    S = state;
    onChange = changeCb || onChange;
    Object.keys(pads).forEach(k => delete pads[k]);
  }

  /** build one pad inside `container`, bound to `key` */
  function mount (container, key) {
    if (!container) return;
    // Consultants supply their own signature. Approval signatures are shown
    // from the saved record and edited only by the administrator here.
    const editable = key === 'personnel' || (typeof Auth !== 'undefined' && Auth.isAdmin());
    if (!editable) {
      container.innerHTML = `
        <div class="sigslot readonly">
          <img class="sig-readonly-image" alt="${{ pm: 'Project manager', hod: 'HOD', verified: 'Finance' }[key] || 'Approver'} signature" hidden>
          <span class="sighint"></span>
        </div>`;
      const entry = { root: container, image: container.querySelector('.sig-readonly-image'), readonly: true };
      (pads[key] = pads[key] || []).push(entry);
      paintReadOnly(entry, key);
      return;
    }
    container.innerHTML = `
      <div class="sigslot">
        <canvas></canvas>
        <div class="sigbtns">
          <button type="button" data-a="clear">Clear</button>
          <button type="button" data-a="upload">Upload</button>
          <input type="file" accept="image/*" hidden>
        </div>
        <span class="sighint">${SIG_HINTS[key] || 'Draw here'}</span>
      </div>`;

    const canvas = container.querySelector('canvas');
    const pad = new SignaturePad(canvas, {
      backgroundColor: 'rgba(255,255,255,0)',
      penColor: '#0b1f4b',
      minWidth: 0.6,
      maxWidth: 1.9
    });

    const entry = { pad, canvas, root: container };
    (pads[key] = pads[key] || []).push(entry);

    pad.addEventListener('endStroke', () => {
      S.sig[key] = pad.toDataURL('image/png');
      syncKey(key, entry);
      onChange();
    });

    container.querySelector('[data-a="clear"]').addEventListener('click', () => {
      S.sig[key] = '';
      syncKey(key);
      onChange();
    });

    const file = container.querySelector('input[type=file]');
    container.querySelector('[data-a="upload"]').addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { S.sig[key] = r.result; syncKey(key); onChange(); };
      r.readAsDataURL(f);
      file.value = '';
    });

    sizeCanvas(entry);
    paint(entry, S.sig[key]);
    setHint(entry, key, !!S.sig[key]);

    if (!resizeBound) {
      window.addEventListener('resize', () => resizeAll());
      resizeBound = true;
    }
  }

  /** redraw every pad bound to `key`, optionally skipping the one being drawn in */
  function syncKey (key, skip) {
    (pads[key] || []).forEach(e => {
      if (e.readonly) { paintReadOnly(e, key); return; }
      if (e !== skip) { e.pad.clear(); paint(e, S.sig[key]); }
      setHint(e, key, !!S.sig[key]);
    });
  }

  function paintReadOnly (entry, key) {
    const signature = S && S.sig && S.sig[key];
    entry.image.hidden = !signature;
    if (signature) entry.image.src = signature;
    else entry.image.removeAttribute('src');
    const hint = entry.root.querySelector('.sighint');
    hint.textContent = signature ? 'Signature on record' : ({
      pm: 'Added during project manager review',
      hod: 'Added by the PA after HOD approval',
      verified: 'For Group People & Finance'
    }[key] || 'Added during approval');
  }

  function sizeCanvas (e) {
    const rect = e.canvas.getBoundingClientRect();
    if (!rect.width) return false;                 // still hidden
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    e.canvas.width = rect.width * ratio;
    e.canvas.height = rect.height * ratio;
    e.canvas.getContext('2d').scale(ratio, ratio);
    e.pad.clear();
    return true;
  }

  function paint (e, dataUrl) {
    if (!dataUrl) return;
    const ctx = e.canvas.getContext('2d');
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const w = e.canvas.width / ratio, h = e.canvas.height / ratio;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, w, h);
      const scale = Math.min(w / img.width, h / img.height, 1);
      const dw = img.width * scale, dh = img.height * scale;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    };
    img.src = dataUrl;
  }

  function setHint (e, key, on) {
    const el = e.root.querySelector('.sighint');
    if (el) {
      el.textContent = on ? '✓ Signed — this will be printed' : (SIG_HINTS[key] || 'Draw here');
      el.style.color = on ? 'var(--ok)' : '';
    }
  }

  /** re-measure every canvas (needed when a hidden step becomes visible) */
  function resizeAll () {
    Object.keys(pads).forEach(key => {
      (pads[key] || []).forEach(e => {
        if (e.readonly) { paintReadOnly(e, key); return; }
        if (sizeCanvas(e)) { paint(e, S && S.sig[key]); setHint(e, key, !!(S && S.sig[key])); }
      });
    });
  }

  function refresh () {
    Object.keys(pads).forEach(key => syncKey(key));
  }

  return { reset, mount, resizeAll, refresh };
})();

/* ---- image helpers shared with the document generators ---- */

/** data URL -> Uint8Array (for docx) */
function dataUrlToBytes (dataUrl) {
  const b64 = String(dataUrl).split(',')[1] || '';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/**
 * Convert any data URL (JPEG included) to a PNG with the surrounding blank space
 * trimmed away, so the signature sits tidily in the PDF and Word output.
 */
function normalizeSignature (dataUrl) {
  return new Promise(resolve => {
    if (!dataUrl) return resolve(null);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      let data;
      try { data = ctx.getImageData(0, 0, c.width, c.height).data; }
      catch (e) { return resolve({ url: dataUrl, w: img.width, h: img.height }); }

      // bounding box of pixels that are neither transparent nor near-white
      let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          const a = data[i + 3];
          const light = (data[i] + data[i + 1] + data[i + 2]) / 3;
          if (a > 25 && light < 235) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) return resolve({ url: dataUrl, w: img.width, h: img.height });

      const pad = 6;
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
      x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
      const w = x1 - x0 + 1, h = y1 - y0 + 1;

      const out = document.createElement('canvas');
      out.width = w; out.height = h;
      out.getContext('2d').drawImage(c, x0, y0, w, h, 0, 0, w, h);
      resolve({ url: out.toDataURL('image/png'), w, h });
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}


/* =======================================================================
   The signature on the profile

   Everybody signs their own claim, so everybody keeps one signature and it
   prints itself from then on. It gets here one of two ways, and both are
   ordinary: drawn with a finger or a mouse, or signed on paper and scanned
   — as a PDF, which is what every office scanner produces, or as a photo.

   A scan is a whole page, and the signature is a small part of it. So the
   page is read, the ink is found, and what was found is shown back before
   it is kept: a box over the page that can be dragged if the guess was
   wrong, and a preview at the size it will print. Nothing is stored until
   somebody looks at it and says yes.
   ======================================================================= */

/** the biggest a rendered page is worked on — enough to read fine pen strokes */
const SIG_RENDER_MAX = 1600;
const signatureCropCleanups = new WeakMap();
let signatureCropId = 0;

function disposeSignatureCropper (host) {
  const cleanup = host && signatureCropCleanups.get(host);
  if (cleanup) cleanup();
}

/** where the ink is on a canvas, or null when the page is blank */
function detectInkBox (canvas) {
  const ctx = canvas.getContext('2d');
  let data;
  try { data = ctx.getImageData(0, 0, canvas.width, canvas.height).data; }
  catch (e) { return null; }

  let x0 = canvas.width, y0 = canvas.height, x1 = -1, y1 = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const a = data[i + 3];
      const light = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (a > 25 && light < 200) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = Math.round(Math.min(canvas.width, canvas.height) * 0.01);
  return {
    x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad),
    x1: Math.min(canvas.width - 1, x1 + pad), y1: Math.min(canvas.height - 1, y1 + pad)
  };
}

/**
 * Fetch pdf.js, the first time somebody uploads a PDF and not before.
 *
 * It is a third of a megabyte, and it is used once per person for as long as
 * they work here — while the approvers, who are the ones most likely to be on
 * a phone, never touch it at all. So it is not in the page; it is fetched
 * when the question is actually asked.
 *
 * The cache stamp is lifted off a script that is in the page, so the two
 * cannot drift apart: one find-and-replace in index.html still moves
 * everything, which is the whole point of the stamp.
 */
let pdfLoading = null;

function pdfReady () {
  if (typeof pdfjsLib !== 'undefined') return Promise.resolve(pointWorker());
  if (pdfLoading) return pdfLoading;

  const beside = document.querySelector('script[src*="signature_pad"]');
  const stamp = beside ? (beside.getAttribute('src').split('?')[1] || '') : '';
  const src = 'vendor/pdf.min.js' + (stamp ? '?' + stamp : '');

  pdfLoading = new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = src;
    tag.onload = () => resolve(pointWorker());
    tag.onerror = () => {
      pdfLoading = null;
      reject(new Error('Could not load the PDF reader. Upload a PNG or JPG instead.'));
    };
    document.head.appendChild(tag);
  });
  return pdfLoading;
}

/** the worker sits beside the library, and carries the same stamp */
function pointWorker () {
  if (typeof pdfjsLib === 'undefined') throw new Error('The PDF reader did not load.');
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    const tag = document.querySelector('script[src*="pdf.min.js"]');
    pdfjsLib.GlobalWorkerOptions.workerSrc = tag
      ? tag.getAttribute('src').replace('pdf.min.js', 'pdf.worker.min.js')
      : 'vendor/pdf.worker.min.js';
  }
  return true;
}

/** read whatever was uploaded onto a canvas: page one of a PDF, or the image */
async function uploadToCanvas (file) {
  const isPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name);
  if (isPdf) {
    await pdfReady();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(SIG_RENDER_MAX / base.width, SIG_RENDER_MAX / base.height, 3);
    const viewport = page.getViewport({ scale: Math.max(scale, 1) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    // a PDF page is transparent where it is blank, and a signature on a
    // transparent background reads as a signature on black
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    return canvas;
  }

  const url = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.onload = () => resolve(String(r.result || ''));
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('That file is not an image this browser can open.'));
    i.src = url;
  });
  const scale = Math.min(SIG_RENDER_MAX / img.width, SIG_RENDER_MAX / img.height, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** cut one rectangle out of a canvas and trim the blank off what is left */
async function cropToSignature (canvas, box) {
  const w = Math.max(1, Math.round(box.x1 - box.x0 + 1));
  const h = Math.max(1, Math.round(box.y1 - box.y0 + 1));
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  out.getContext('2d').drawImage(canvas, Math.round(box.x0), Math.round(box.y0), w, h, 0, 0, w, h);
  const trimmed = await normalizeSignature(out.toDataURL('image/png'));
  return (trimmed && trimmed.url) || out.toDataURL('image/png');
}

/**
 * The signature block on the Profile step.
 *
 * @param {Element} host        where to build it
 * @param {object}  S           the state, whose sig.personnel this is
 * @param {function} onChange   called whenever the signature changes
 */
function mountProfileSignature (host, S, onChange) {
  return mountSignaturePicker(host, {
    get: () => S.sig && S.sig.personnel,
    set: url => { S.sig.personnel = url; },
    refresh: () => Sig.refresh(),
    drawKey: 'personnel'
  }, onChange);
}

/**
 * The same block, keeping its signature wherever it is told to.
 *
 * Signing is one act wherever it happens, so it is one control: the Profile
 * step, and an approver putting their name to a sheet, both show what is
 * on record, offer to draw it or read it off a scan, and put a scanned page
 * through the same box-over-the-ink and preview before anything is kept.
 * An approver was getting a bare canvas and an image picker instead, which
 * could not read a PDF and kept a whole photographed page as a signature.
 *
 * @param {Element}  host
 * @param {object}   store     { get(), set(url), refresh?(), drawKey? } —
 *        drawKey binds drawing to a form pad; without it the pad is loose
 * @param {function} onChange  called whenever the signature changes
 */
function mountSignaturePicker (host, store, onChange) {
  if (!host) return;
  onChange = onChange || (() => {});
  disposeSignatureCropper(host.querySelector('.sigcrop'));
  host.innerHTML = `
    <div class="sigshow">
      <img alt="Your signature" hidden>
      <span class="signone">No signature yet &mdash; draw one, or upload a scan.</span>
    </div>
    <div class="btnrow sigactions">
      <button type="button" class="btn ghost small" data-a="draw">Draw it</button>
      <button type="button" class="btn ghost small" data-a="file">Upload a scan</button>
      <button type="button" class="btn ghost small danger" data-a="clear">Remove</button>
      <input type="file" accept=".pdf,.png,.jpg,.jpeg,image/*,application/pdf" hidden>
    </div>
    <div class="sigdraw" hidden></div>
    <div class="sigcrop" hidden></div>`;

  const img   = host.querySelector('.sigshow img');
  const none  = host.querySelector('.signone');
  const draw  = host.querySelector('.sigdraw');
  const crop  = host.querySelector('.sigcrop');
  const file  = host.querySelector('input[type=file]');
  let uploadVersion = 0;

  const paintCurrent = () => {
    const current = store.get();
    const have = !!current;
    img.hidden = !have;
    none.hidden = have;
    if (have) img.src = current;
    host.classList.toggle('has', have);
  };

  host.querySelector('[data-a="draw"]').addEventListener('click', () => {
    uploadVersion++;
    disposeSignatureCropper(crop);
    crop.hidden = true;
    draw.hidden = !draw.hidden;
    if (!draw.hidden) {
      if (store.drawKey) {
        Sig.mount(draw, store.drawKey);
        setTimeout(() => Sig.resizeAll(), 30);
      } else {
        mountLoosePad(draw, url => { store.set(url); paintCurrent(); onChange(); });
      }
    }
  });

  host.querySelector('[data-a="file"]').addEventListener('click', () => file.click());
  host.querySelector('[data-a="clear"]').addEventListener('click', () => {
    uploadVersion++;
    disposeSignatureCropper(crop);
    store.set('');
    draw.hidden = true;
    crop.hidden = true;
    if (store.refresh) store.refresh();
    paintCurrent();
    onChange();
  });

  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    const version = ++uploadVersion;
    disposeSignatureCropper(crop);
    draw.hidden = true;
    crop.hidden = false;
    crop.innerHTML = '<p class="croplead">Reading it…</p>';
    try {
      const canvas = await uploadToCanvas(f);
      if (version !== uploadVersion || !crop.isConnected || !host.contains(crop)) return;
      buildCropper(crop, canvas,
        url => { store.set(url); if (store.refresh) store.refresh(); },
        () => { paintCurrent(); onChange(); });
    } catch (err) {
      if (version !== uploadVersion || !crop.isConnected || !host.contains(crop)) return;
      crop.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'warn';
      p.textContent = err.message || 'That file could not be read.';
      crop.appendChild(p);
    }
  });

  // the pad writes straight into S.sig.personnel, so the card above it has
  // to be told when that happens
  host.addEventListener('sig:changed', paintCurrent);
  paintCurrent();
  return paintCurrent;
}

/**
 * The confirmation step: the page as it was read, a box over what looks like
 * the signature, and a preview of exactly what will be kept.
 */
function buildCropper (host, canvas, target, done) {
  /* A function is told what was chosen. A state object has its signature
     written, which is what every caller did before the block learned to
     keep its value elsewhere, and what the browser audit still does. */
  const keep = typeof target === 'function'
    ? target
    : url => { target.sig.personnel = url; Sig.refresh(); };
  disposeSignatureCropper(host);
  const helpId = 'signatureCropHelp' + (++signatureCropId);
  const handles = {
    nw: 'top left corner', n: 'top edge', ne: 'top right corner', e: 'right edge',
    se: 'bottom right corner', s: 'bottom edge', sw: 'bottom left corner', w: 'left edge'
  };
  host.innerHTML = `
    <p class="croplead" id="${helpId}"><b>Drag inside the box to move it.</b> Drag a corner or edge to resize it, or drag outside to select a different signature.
      <span class="cropkeys">Arrow keys move the box. Shift + arrow keys resize it. Press Escape to cancel a drag.</span></p>
    <div class="cropwrap"><div class="cropbox" tabindex="0" role="group" aria-label="Signature selection" aria-describedby="${helpId}">
      ${Object.entries(handles).map(([key, label]) => `<button type="button" class="crophandle" data-resize="${key}" aria-label="Resize ${label}" title="Resize ${label}"></button>`).join('')}
    </div></div>
    <div class="croppreview"><span>Will be kept as:</span><img alt="Signature preview"></div>
    <p class="warn croperror" role="alert" hidden></p>
    <div class="btnrow">
      <button type="button" class="btn primary" data-a="use" disabled>Use this signature</button>
      <button type="button" class="btn ghost" data-a="cancel">Choose another file</button>
    </div>`;

  const wrap = host.querySelector('.cropwrap');
  const boxEl = host.querySelector('.cropbox');
  const preview = host.querySelector('.croppreview img');
  const previewArea = host.querySelector('.croppreview');
  const error = host.querySelector('.croperror');
  const use = host.querySelector('[data-a="use"]');
  canvas.classList.add('cropcanvas');
  wrap.insertBefore(canvas, boxEl);

  let box = detectInkBox(canvas) ||
            { x0: 0, y0: 0, x1: canvas.width - 1, y1: canvas.height - 1 };
  let gesture = null;
  let disposed = false;
  const events = new AbortController();
  const listen = (target, name, fn) => target.addEventListener(name, fn, { signal: events.signal });
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const minWidth = Math.min(8, canvas.width), minHeight = Math.min(8, canvas.height);
  box.x1 = Math.min(canvas.width - 1, Math.max(box.x1, box.x0 + minWidth - 1));
  box.y1 = Math.min(canvas.height - 1, Math.max(box.y1, box.y0 + minHeight - 1));
  box.x0 = Math.min(box.x0, box.x1 - minWidth + 1);
  box.y0 = Math.min(box.y0, box.y1 - minHeight + 1);

  // Coordinates remain in source pixels even when the uploaded page scales
  // down on a phone. Moving preserves its size; resizing anchors the far edge.
  const adjust = (start, mode, dx, dy) => {
    const next = { ...start };
    dx = Math.round(dx); dy = Math.round(dy);
    if (mode === 'move') {
      dx = clamp(dx, -start.x0, canvas.width - 1 - start.x1);
      dy = clamp(dy, -start.y0, canvas.height - 1 - start.y1);
      return { x0: start.x0 + dx, y0: start.y0 + dy, x1: start.x1 + dx, y1: start.y1 + dy };
    }
    if (mode.includes('w')) next.x0 = clamp(start.x0 + dx, 0, start.x1 - minWidth + 1);
    if (mode.includes('e')) next.x1 = clamp(start.x1 + dx, start.x0 + minWidth - 1, canvas.width - 1);
    if (mode.includes('n')) next.y0 = clamp(start.y0 + dy, 0, start.y1 - minHeight + 1);
    if (mode.includes('s')) next.y1 = clamp(start.y1 + dy, start.y0 + minHeight - 1, canvas.height - 1);
    return next;
  };

  const showBox = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const outer = wrap.getBoundingClientRect();
    const sx = rect.width / canvas.width, sy = rect.height / canvas.height;
    boxEl.style.left = (rect.left - outer.left - wrap.clientLeft + box.x0 * sx) + 'px';
    boxEl.style.top = (rect.top - outer.top - wrap.clientTop + box.y0 * sy) + 'px';
    boxEl.style.width = ((box.x1 - box.x0 + 1) * sx) + 'px';
    boxEl.style.height = ((box.y1 - box.y0 + 1) * sy) + 'px';
  };

  let pending = null;
  let previewVersion = 0, previewFrame = null, previewRunning = false;
  const schedulePreview = () => {
    if (disposed || previewFrame !== null || previewRunning) return;
    previewFrame = requestAnimationFrame(async () => {
      previewFrame = null;
      previewRunning = true;
      const version = previewVersion;
      try {
        const url = await cropToSignature(canvas, { ...box });
        if (disposed || version !== previewVersion) return;
        pending = url;
        preview.src = url;
        previewArea.removeAttribute('aria-busy');
        use.disabled = !!gesture;
      } catch (err) {
        if (disposed || version !== previewVersion) return;
        error.textContent = 'Could not preview this selection. Adjust the box or choose another file.';
        error.hidden = false;
        previewArea.removeAttribute('aria-busy');
      } finally {
        previewRunning = false;
        if (!disposed && version !== previewVersion) schedulePreview();
      }
    });
  };
  const refreshPreview = () => {
    previewVersion++;
    pending = null;
    use.disabled = true;
    error.hidden = true;
    previewArea.setAttribute('aria-busy', 'true');
    schedulePreview();
  };

  const at = ev => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp(Math.round((ev.clientX - rect.left) / rect.width * canvas.width), 0, canvas.width - 1),
      y: clamp(Math.round((ev.clientY - rect.top) / rect.height * canvas.height), 0, canvas.height - 1)
    };
  };
  listen(wrap, 'pointerdown', ev => {
    if (gesture || ev.button !== 0 || ev.isPrimary === false) return;
    // Touch browsers may retarget a press in the middle to a nearby button.
    // Use the element under the finger so the middle still moves a small box.
    const target = document.elementFromPoint(ev.clientX, ev.clientY) || ev.target;
    const rect = boxEl.getBoundingClientRect();
    const insetX = Math.min(14, rect.width / 4), insetY = Math.min(14, rect.height / 4);
    const inMiddle = ev.clientX > rect.left + insetX && ev.clientX < rect.right - insetX &&
      ev.clientY > rect.top + insetY && ev.clientY < rect.bottom - insetY;
    // Keep a move area even when the handles overlap on a thin signature.
    const handle = inMiddle ? null : target.closest('[data-resize]');
    const mode = handle ? handle.dataset.resize : boxEl.contains(target) ? 'move' : 'draw';
    gesture = { id: ev.pointerId, mode, from: at(ev), start: { ...box },
      clientX: ev.clientX, clientY: ev.clientY, changed: false };
    (handle || boxEl).focus({ preventScroll: true });
    use.disabled = true;
    wrap.classList.add('dragging');
    wrap.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  const movePointer = ev => {
    if (!gesture || ev.pointerId !== gesture.id) return;
    if (!gesture.changed && Math.hypot(ev.clientX - gesture.clientX, ev.clientY - gesture.clientY) < 3) return;
    const to = at(ev);
    const { from, start, mode } = gesture;
    gesture.changed = true;
    box = mode === 'draw'
      ? { x0: Math.min(from.x, to.x), y0: Math.min(from.y, to.y), x1: Math.max(from.x, to.x), y1: Math.max(from.y, to.y) }
      : adjust(start, mode, to.x - from.x, to.y - from.y);
    showBox();
    refreshPreview();
  };
  listen(wrap, 'pointermove', movePointer);
  const finishGesture = cancel => {
    if (!gesture) return;
    const { id, start, changed } = gesture;
    if (cancel || !changed || box.x1 - box.x0 + 1 < minWidth || box.y1 - box.y0 + 1 < minHeight) box = start;
    gesture = null;
    wrap.classList.remove('dragging');
    if (wrap.hasPointerCapture(id)) wrap.releasePointerCapture(id);
    showBox();
    if (changed) refreshPreview();
    else use.disabled = !pending;
  };
  listen(wrap, 'pointerup', ev => {
    if (!gesture || ev.pointerId !== gesture.id) return;
    movePointer(ev);
    finishGesture(false);
  });
  listen(wrap, 'pointercancel', ev => { if (gesture && ev.pointerId === gesture.id) finishGesture(true); });
  listen(wrap, 'lostpointercapture', ev => {
    if (gesture && ev.pointerId === gesture.id && !wrap.hasPointerCapture(ev.pointerId)) finishGesture(true);
  });
  listen(wrap, 'keydown', ev => {
    if (ev.key === 'Escape' && gesture) { ev.preventDefault(); finishGesture(true); return; }
    if (gesture || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
    if (!delta) return;
    ev.preventDefault();
    const handle = ev.target.closest('[data-resize]');
    const mode = handle ? handle.dataset.resize : ev.shiftKey ? 'se' : 'move';
    const step = ev.shiftKey ? 10 : 1;
    box = adjust(box, mode, delta[0] * step, delta[1] * step);
    showBox();
    refreshPreview();
  });

  let observer = null;
  const cleanup = () => {
    disposed = true;
    previewVersion++;
    if (previewFrame !== null) cancelAnimationFrame(previewFrame);
    events.abort();
    if (observer) observer.disconnect();
    if (gesture && wrap.hasPointerCapture(gesture.id)) wrap.releasePointerCapture(gesture.id);
    signatureCropCleanups.delete(host);
  };
  signatureCropCleanups.set(host, cleanup);

  listen(use, 'click', () => {
    if (!pending || use.disabled || gesture) return;
    keep(pending);
    cleanup();
    host.hidden = true;
    done();
  });
  listen(host.querySelector('[data-a="cancel"]'), 'click', () => {
    cleanup();
    host.hidden = true;
    host.innerHTML = '';
  });

  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(showBox);
    observer.observe(canvas);
  }
  showBox();
  listen(window, 'resize', showBox);
  refreshPreview();
}

/**
 * A drawing pad bound to nothing but the callback it is given.
 *
 * The form's pads write into the claim's own state, which is right for the
 * person filling it in and wrong for an approver, who is not.
 */
function mountLoosePad (container, onDrawn) {
  container.innerHTML = `
    <div class="sigslot">
      <canvas role="img" aria-label="Draw your signature here"></canvas>
      <div class="sigbtns"><button type="button" data-a="clear">Clear</button></div>
      <span class="sighint">Draw here</span>
    </div>`;
  const canvas = container.querySelector('canvas');
  const hint = container.querySelector('.sighint');
  const pad = new SignaturePad(canvas, {
    backgroundColor: 'rgba(255,255,255,0)', penColor: '#0b1f4b', minWidth: 0.6, maxWidth: 1.9
  });
  const fit = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    canvas.getContext('2d').scale(ratio, ratio);
    pad.clear();
  };
  setTimeout(fit, 30);
  pad.addEventListener('endStroke', () => {
    hint.textContent = '✓ Drawn';
    onDrawn(pad.toDataURL('image/png'));
  });
  container.querySelector('[data-a="clear"]').addEventListener('click', () => {
    pad.clear();
    hint.textContent = 'Draw here';
  });
}
