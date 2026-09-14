/* =======================================================================
   zip.js — put a month's files in one archive

   Download all used to hand the browser one file at a time, a quarter of a
   second apart, and the browser asked whether it could save several. Say no
   by accident and half a year of signed claims goes nowhere; say yes and
   they land loose in Downloads among everything else. One archive is the
   thing somebody actually wanted.

   Written here rather than vendored. A zip that stores rather than
   compresses is a header, the bytes, and a table at the end saying where
   each one started — a page of code against another library in vendor/,
   and there is nothing to gain by compressing these: a scanned PDF and a
   JPEG are already compressed, and squeezing them again buys a percent or
   two for a dependency and a worker thread.

   No zip64: the format's four-byte sizes cap an archive at 4 GB, and the
   app refuses a single file over 12 MB.
   ======================================================================= */

/* The standard CRC-32 table, built once on the first archive rather than
   sitting in the source as 256 constants nobody will ever read. */
let crcTable = null;

function crc32Table () {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/** CRC-32 of some bytes, as the zip format wants it */
function crc32 (bytes) {
  const table = crc32Table();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * MS-DOS date and time, which is what a zip carries.
 *
 * It counts years from 1980 and seconds in twos. Nothing reads it but a
 * file manager showing a column, so the only thing that matters is that it
 * is a real date rather than 1980-00-00.
 */
function dosStamp (d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

/**
 * Two files cannot share a name inside one archive — some readers take the
 * first, some the last, and somebody is short a document either way. The
 * second one through gets a number, the way a browser numbers a download.
 */
function uniqueNames (entries) {
  const seen = new Map();
  return entries.map(e => {
    const name = String(e.name || 'document');
    if (!seen.has(name)) { seen.set(name, 1); return Object.assign({}, e, { name: name }); }
    const n = seen.get(name) + 1;
    seen.set(name, n);
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    return Object.assign({}, e, { name: `${stem} (${n})${ext}` });
  });
}

/**
 * Build the archive.
 *
 * @param {Array<{name: string, bytes: Uint8Array}>} files
 * @returns {Blob} the archive, ready for saveAs
 */
function zipFiles (files) {
  const entries = uniqueNames(files || []).map(f => ({
    nameBytes: new TextEncoder().encode(f.name),
    bytes: f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes || 0)
  }));

  const stamp = dosStamp(new Date());
  const LOCAL = 30, CENTRAL = 46, END = 22;
  let size = END;
  entries.forEach(e => {
    size += LOCAL + e.nameBytes.length + e.bytes.length + CENTRAL + e.nameBytes.length;
  });

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const u32 = v => { view.setUint32(at, v >>> 0, true); at += 4; };
  const u16 = v => { view.setUint16(at, v & 0xFFFF, true); at += 2; };
  const raw = b => { out.set(b, at); at += b.length; };

  /* Bit 11 says the name is UTF-8. Without it a reader is entitled to read
     the bytes as the code page of whatever machine it is on, and a name
     with a dash in it comes out as mojibake. */
  const FLAG_UTF8 = 0x0800;

  entries.forEach(e => {
    e.crc = crc32(e.bytes);
    e.offset = at;
    u32(0x04034B50);                 // local file header
    u16(20); u16(FLAG_UTF8); u16(0); // version needed, flags, stored
    u16(stamp.time); u16(stamp.date);
    u32(e.crc); u32(e.bytes.length); u32(e.bytes.length);
    u16(e.nameBytes.length); u16(0);
    raw(e.nameBytes);
    raw(e.bytes);
  });

  const dirAt = at;
  entries.forEach(e => {
    u32(0x02014B50);                 // central directory header
    u16(20); u16(20); u16(FLAG_UTF8); u16(0);
    u16(stamp.time); u16(stamp.date);
    u32(e.crc); u32(e.bytes.length); u32(e.bytes.length);
    u16(e.nameBytes.length); u16(0); u16(0);
    u16(0); u16(0); u32(0);          // disk, internal and external attributes
    u32(e.offset);
    raw(e.nameBytes);
  });

  /* How long the directory is, measured before anything else is written:
     `at` is a moving target, and reading it inside the end record — after
     twelve bytes of that record have already gone down — is how the
     directory came out twelve bytes longer than it is. */
  const dirSize = at - dirAt;

  u32(0x06054B50);                   // end of central directory
  u16(0); u16(0);
  u16(entries.length); u16(entries.length);
  u32(dirSize); u32(dirAt);
  u16(0);

  return new Blob([out], { type: 'application/zip' });
}
