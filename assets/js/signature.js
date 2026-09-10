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
