/* =======================================================================
   signature.js — drawable signature pads with image upload
   ======================================================================= */

const SIG_DEFS = [
  { key: 'personnel', title: 'PREPARED BY — Personnel', sub: 'The consultant themselves (used on both the Claim and the Invoice)' },
  { key: 'hod',       title: 'APPROVED BY — HOD',        sub: 'Head of department (optional)' },
  { key: 'verified',  title: 'VERIFIED BY — Group People &amp; Finance', sub: 'Optional' }
];

const Sig = (() => {
  const pads = {};
  let S = null, onChange = () => {};
  let resizeBound = false;

  function init (state, changeCb) {
    S = state; onChange = changeCb;
    const host = document.getElementById('sigwrap');
    host.innerHTML = '';

    SIG_DEFS.forEach(def => {
      const card = document.createElement('div');
      card.className = 'sigcard';
      card.innerHTML = `
        <h4>${def.title}</h4>
        <p class="sub">${def.sub}</p>
        <canvas></canvas>
        <div class="btnrow">
          <button class="btn ghost small" data-a="clear">Clear</button>
          <button class="btn ghost small" data-a="upload">Upload Image</button>
          <input type="file" accept="image/*" hidden>
        </div>
        <p class="status">No signature yet.</p>`;
      host.appendChild(card);

      const canvas = card.querySelector('canvas');
      const pad = new SignaturePad(canvas, {
        backgroundColor: 'rgba(255,255,255,0)',
        penColor: '#0b1f4b',
        minWidth: 0.7,
        maxWidth: 2.2
      });
      pads[def.key] = { pad, canvas, card };

      pad.addEventListener('endStroke', () => {
        S.sig[def.key] = pad.toDataURL('image/png');
        setStatus(def.key, true);
        onChange();
      });

      card.querySelector('[data-a="clear"]').addEventListener('click', () => {
        pad.clear();
        S.sig[def.key] = '';
        setStatus(def.key, false);
        onChange();
      });

      const file = card.querySelector('input[type=file]');
      card.querySelector('[data-a="upload"]').addEventListener('click', () => file.click());
      file.addEventListener('change', () => {
        const f = file.files && file.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => {
          S.sig[def.key] = r.result;
          drawInto(def.key, r.result);
          setStatus(def.key, true);
          onChange();
        };
        r.readAsDataURL(f);
        file.value = '';
      });
    });

    resizeAll();
    if (!resizeBound) {                       // bind once, even if init runs again
      window.addEventListener('resize', () => resizeAll());
      resizeBound = true;
    }
  }

  /** resize each canvas for the display DPI, then restore the existing signature */
  function resizeAll () {
    Object.keys(pads).forEach(key => {
      const { pad, canvas } = pads[key];
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;                       // panel still hidden
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      canvas.getContext('2d').scale(ratio, ratio);
      pad.clear();
      if (S && S.sig[key]) drawInto(key, S.sig[key]);
      setStatus(key, !!(S && S.sig[key]));
    });
  }

  /** draw a data URL into the canvas, scaled to fit and centred */
  function drawInto (key, dataUrl) {
    const { canvas } = pads[key];
    const ctx = canvas.getContext('2d');
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const w = canvas.width / ratio, h = canvas.height / ratio;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, w, h);
      const scale = Math.min(w / img.width, h / img.height, 1);
      const dw = img.width * scale, dh = img.height * scale;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    };
    img.src = dataUrl;
  }

  function setStatus (key, on) {
    const el = pads[key].card.querySelector('.status');
    el.textContent = on ? '✓ Signature ready — it will be embedded in the documents.' : 'No signature yet.';
    el.className = 'status' + (on ? ' on' : '');
  }

  function refresh () {
    Object.keys(pads).forEach(key => {
      const { pad } = pads[key];
      pad.clear();
      if (S.sig[key]) drawInto(key, S.sig[key]);
      setStatus(key, !!S.sig[key]);
    });
  }

  return { init, resizeAll, refresh };
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

/** natural size of an image given as a data URL */
function imageSize (dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.width, h: img.height });
    img.onerror = () => resolve({ w: 300, h: 120 });
    img.src = dataUrl;
  });
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

      // find the bounding box of pixels that are neither transparent nor near-white
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
