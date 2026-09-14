/* =======================================================================
   zip.test.js — the archive Download all builds

   A zip nobody can open is worse than no zip: the files were fetched, the
   browser saved something, and the person finds out when they double-click
   it a week later. So the bytes are checked here rather than trusted —
   every signature in the format, the CRC of the content, the offsets the
   central directory points at, and the rule that two files cannot share a
   name inside one archive.

   Run:  node test/zip.test.js
   ======================================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

let passed = 0;
const failures = [];

function check (label, actual, expected) {
  if (String(actual) === String(expected)) {
    passed++;
    console.log(`  ok    ${label} = ${actual}`);
  } else {
    failures.push(`${label}: got ${actual}, expected ${expected}`);
    console.log(`  FAIL  ${label}: got ${actual}, expected ${expected}`);
  }
}

/* Blob is only asked for its bytes, so it can be the bytes. */
class FakeBlob {
  constructor (parts, opts) {
    this.parts = parts;
    this.type = (opts || {}).type || '';
  }
  bytes () { return this.parts[0]; }
}

const ctx = vm.createContext({ Blob: FakeBlob, TextEncoder, Date, console });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/zip.js'), 'utf8'), ctx,
                { filename: 'zip.js' });

const enc = new TextEncoder();
const hello = enc.encode('hello');
const world = enc.encode('a signed time sheet');

console.log('\nThe archive');

const blob = ctx.zipFiles([
  { name: 'Sep 2026 - Somebody - Time sheet.pdf', bytes: hello },
  { name: 'Sep 2026 - Somebody - Invoice.pdf', bytes: world }
]);
check('it is a zip, as far as the browser is told', blob.type, 'application/zip');

const buf = Buffer.from(blob.bytes());
check('it starts with a local file header', buf.readUInt32LE(0).toString(16), '4034b50');

/* The end record is the only fixed landmark: it is the last 22 bytes when
   there is no comment, and everything else is found through it. */
const end = buf.length - 22;
check('and ends with the end-of-central-directory record',
  buf.readUInt32LE(end).toString(16), '6054b50');
check('which counts both files', buf.readUInt16LE(end + 10), 2);

const dirAt = buf.readUInt32LE(end + 16);
const dirSize = buf.readUInt32LE(end + 12);
check('the directory is where it says it is',
  buf.readUInt32LE(dirAt).toString(16), '2014b50');
check('and as long as it says it is', dirAt + dirSize, end);

/* Walk the directory the way a reader does: each entry says where its local
   header starts, and that header has to be there. */
let at = dirAt;
const found = [];
for (let i = 0; i < 2; i++) {
  const nameLen = buf.readUInt16LE(at + 28);
  const name = buf.slice(at + 46, at + 46 + nameLen).toString('utf8');
  const crc = buf.readUInt32LE(at + 16);
  const size = buf.readUInt32LE(at + 24);
  const offset = buf.readUInt32LE(at + 42);
  found.push({ name, crc, size, offset });
  at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
}

check('the first entry is the time sheet', found[0].name,
      'Sep 2026 - Somebody - Time sheet.pdf');
check('the second is the invoice', found[1].name, 'Sep 2026 - Somebody - Invoice.pdf');
check('each entry points at a real local header',
  found.every(e => buf.readUInt32LE(e.offset) === 0x04034B50), true);
check('the sizes are the bytes that went in',
  found.map(e => e.size).join(','), [hello.length, world.length].join(','));

/* The CRC is the one thing a reader will refuse the file over, and it is
   the one thing easiest to get subtly wrong. Node's zlib knows the answer. */
check('the checksums are the real ones',
  found.map(e => e.crc >>> 0).join(','),
  [zlib.crc32 ? zlib.crc32(hello) : crcOf(hello),
   zlib.crc32 ? zlib.crc32(world) : crcOf(world)].map(n => n >>> 0).join(','));

/* And the bytes themselves are where the header says, after the name. */
const firstNameLen = buf.readUInt16LE(found[0].offset + 26);
const firstData = buf.slice(found[0].offset + 30 + firstNameLen,
                            found[0].offset + 30 + firstNameLen + found[0].size);
check('and the content is stored whole, not compressed',
  firstData.toString('utf8'), 'hello');
check('which is what the method field says', buf.readUInt16LE(found[0].offset + 8), 0);
// bit 11: the name is UTF-8, not the reader's local code page
check('and the name is flagged UTF-8',
  (buf.readUInt16LE(found[0].offset + 6) & 0x0800) !== 0, true);

/* Two documents can honestly end up with the same name — the same person,
   the same month, two scans. Some readers keep the first and some the last,
   and somebody is short a file either way. */
console.log('\nTwo files, one name');
const clash = Buffer.from(ctx.zipFiles([
  { name: 'Sep 2026 - Somebody - Invoice.pdf', bytes: hello },
  { name: 'Sep 2026 - Somebody - Invoice.pdf', bytes: world }
]).bytes());
const clashEnd = clash.length - 22;
let cAt = clash.readUInt32LE(clashEnd + 16);
const names = [];
for (let i = 0; i < 2; i++) {
  const nameLen = clash.readUInt16LE(cAt + 28);
  names.push(clash.slice(cAt + 46, cAt + 46 + nameLen).toString('utf8'));
  cAt += 46 + nameLen;
}
check('the second one is numbered, not overwritten',
  names.join(' | '),
  'Sep 2026 - Somebody - Invoice.pdf | Sep 2026 - Somebody - Invoice (2).pdf');

console.log('\nAn empty archive');
const none = Buffer.from(ctx.zipFiles([]).bytes());
check('is still a readable zip', none.readUInt32LE(0).toString(16), '6054b50');
check('holding nothing', none.readUInt16LE(10), 0);

/** only used when the Node version has no zlib.crc32 */
function crcOf (bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('All tests passed.');
