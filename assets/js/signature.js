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
      if (e !== skip) { e.pad.clear(); paint(e, S.sig[key]); }
      setHint(e, key, !!S.sig[key]);
    });
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
  if (!host) return;
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

  const paintCurrent = () => {
    const have = !!(S.sig && S.sig.personnel);
    img.hidden = !have;
    none.hidden = have;
    if (have) img.src = S.sig.personnel;
    host.classList.toggle('has', have);
  };

  host.querySelector('[data-a="draw"]').addEventListener('click', () => {
    crop.hidden = true;
    draw.hidden = !draw.hidden;
    if (!draw.hidden) {
      Sig.mount(draw, 'personnel');
      setTimeout(() => Sig.resizeAll(), 30);
    }
  });

  host.querySelector('[data-a="file"]').addEventListener('click', () => file.click());
  host.querySelector('[data-a="clear"]').addEventListener('click', () => {
    S.sig.personnel = '';
    draw.hidden = true;
    crop.hidden = true;
    Sig.refresh();
    paintCurrent();
    onChange();
  });

  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    draw.hidden = true;
    crop.hidden = false;
    crop.innerHTML = '<p class="croplead">Reading it…</p>';
    try {
      const canvas = await uploadToCanvas(f);
      buildCropper(crop, canvas, S, () => { paintCurrent(); onChange(); });
    } catch (err) {
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
function buildCropper (host, canvas, S, done) {
  host.innerHTML = `
    <p class="croplead">This is the page as it was read. The box is where the ink is &mdash;
      drag a new one if it caught the wrong thing.</p>
    <div class="cropwrap"><div class="cropbox"></div></div>
    <div class="croppreview"><span>Will be kept as:</span><img alt="Signature preview"></div>
    <div class="btnrow">
      <button type="button" class="btn primary" data-a="use">Use this signature</button>
      <button type="button" class="btn ghost" data-a="cancel">Choose another file</button>
    </div>`;

  const wrap = host.querySelector('.cropwrap');
  const boxEl = host.querySelector('.cropbox');
  const preview = host.querySelector('.croppreview img');
  canvas.classList.add('cropcanvas');
  wrap.insertBefore(canvas, boxEl);

  let box = detectInkBox(canvas) ||
            { x0: 0, y0: 0, x1: canvas.width - 1, y1: canvas.height - 1 };

  const showBox = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const sx = rect.width / canvas.width, sy = rect.height / canvas.height;
    boxEl.style.left = (box.x0 * sx) + 'px';
    boxEl.style.top = (box.y0 * sy) + 'px';
    boxEl.style.width = ((box.x1 - box.x0 + 1) * sx) + 'px';
    boxEl.style.height = ((box.y1 - box.y0 + 1) * sy) + 'px';
  };

  let pending = null;
  const refreshPreview = async () => {
    const url = await cropToSignature(canvas, box);
    pending = url;
    preview.src = url;
  };

  /* Dragging a new box. Pointer events cover mouse, pen and finger with one
     set of handlers, which is the whole reason they exist. */
  let from = null;
  const at = ev => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(canvas.width - 1, Math.max(0, (ev.clientX - rect.left) / rect.width * canvas.width)),
      y: Math.min(canvas.height - 1, Math.max(0, (ev.clientY - rect.top) / rect.height * canvas.height))
    };
  };
  wrap.addEventListener('pointerdown', ev => {
    from = at(ev);
    wrap.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  wrap.addEventListener('pointermove', ev => {
    if (!from) return;
    const to = at(ev);
    box = { x0: Math.min(from.x, to.x), y0: Math.min(from.y, to.y),
            x1: Math.max(from.x, to.x), y1: Math.max(from.y, to.y) };
    showBox();
  });
  wrap.addEventListener('pointerup', () => {
    if (!from) return;
    from = null;
    if (box.x1 - box.x0 < 8 || box.y1 - box.y0 < 8) {
      // a tap rather than a drag: take the whole page back
      box = { x0: 0, y0: 0, x1: canvas.width - 1, y1: canvas.height - 1 };
      showBox();
    }
    refreshPreview();
  });

  host.querySelector('[data-a="use"]').addEventListener('click', () => {
    if (!pending) return;
    S.sig.personnel = pending;
    host.hidden = true;
    Sig.refresh();
    done();
  });
  host.querySelector('[data-a="cancel"]').addEventListener('click', () => {
    host.hidden = true;
    host.innerHTML = '';
  });

  setTimeout(showBox, 20);
  window.addEventListener('resize', showBox);
  refreshPreview();
}
