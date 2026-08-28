/* =======================================================================
   signature.js — pad tandatangan (lukis) + muat naik imej
   ======================================================================= */

const SIG_DEFS = [
  { key: 'personnel', title: 'PREPARED BY — Personnel',  sub: 'Consultant / personnel sendiri (dipakai dalam Claim &amp; Invoice)' },
  { key: 'hod',       title: 'APPROVED BY — HOD',         sub: 'Ketua Jabatan (opsyenal)' },
  { key: 'verified',  title: 'VERIFIED BY — Group People &amp; Finance', sub: 'Opsyenal' }
];

const Sig = (() => {
  const pads = {};
  let S = null, onChange = () => {};

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
          <button class="btn ghost small" data-a="clear">Padam</button>
          <button class="btn ghost small" data-a="upload">Muat Naik Imej</button>
          <input type="file" accept="image/*" hidden>
        </div>
        <p class="status">Belum ada tandatangan.</p>`;
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
    window.addEventListener('resize', () => resizeAll());
  }

  /** saiz semula canvas ikut DPI skrin, kemudian pulihkan tandatangan sedia ada */
  function resizeAll () {
    Object.keys(pads).forEach(key => {
      const { pad, canvas } = pads[key];
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;                       // panel masih tersembunyi
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      canvas.getContext('2d').scale(ratio, ratio);
      pad.clear();
      if (S && S.sig[key]) drawInto(key, S.sig[key]);
      setStatus(key, !!(S && S.sig[key]));
    });
  }

  /** lukis dataURL ke dalam canvas, muat & berpusat */
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
    el.textContent = on ? '✓ Tandatangan tersedia — akan dimasukkan ke dalam dokumen.' : 'Belum ada tandatangan.';
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

/* ---- utiliti imej dikongsi oleh penjana dokumen ---- */

/** dataURL -> Uint8Array (untuk docx) */
function dataUrlToBytes (dataUrl) {
  const b64 = String(dataUrl).split(',')[1] || '';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/** dapatkan saiz asal imej dari dataURL */
function imageSize (dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.width, h: img.height });
    img.onerror = () => resolve({ w: 300, h: 120 });
    img.src = dataUrl;
  });
}

/**
 * Tukar sebarang dataURL (termasuk JPEG) kepada PNG dengan latar telus dibuang
 * dan dipotong (trim) ruang kosong — supaya tandatangan nampak kemas dalam PDF/Word.
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

      // cari kotak sempadan piksel yang bukan telus dan bukan hampir putih
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
