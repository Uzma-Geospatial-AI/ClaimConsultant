/* Local UI smoke audit. Run with Node 24 and an installed Chromium browser.
 * All data is synthetic; external browser requests are blocked. No npm deps.
 * Screenshots and the JSON report are written to an OS temporary directory.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUTPUT = fs.mkdtempSync(path.join(os.tmpdir(), 'claim-ui-audit-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const option = name => process.argv.find(arg => arg.startsWith('--' + name + '='))?.split('=').slice(1).join('=');
const fixtures = `
window.fetch = async () => { throw new Error('External requests disabled in local UI audit'); };
if (new URLSearchParams(location.search).get('role') !== 'login') {
  const auditRole = new URLSearchParams(location.search).get('role') || 'admin';
  const auditEmail = ['admin', 'consultant'].includes(auditRole) ? 'demo@example.test' : auditRole + '@example.test';
  currentRole = () => auditRole;
  storedUser = () => ({ name: 'Demo ' + auditRole, email: auditEmail });
  Auth.user = storedUser;
  Auth.token = () => 'LOCAL-UI-AUDIT';
  Auth.role = currentRole;
  Auth.email = () => auditEmail;
  Auth.owns = p => auditRole !== 'consultant' || p.consultant.email === 'demo@example.test';
  Auth.start = boot => {
    document.getElementById('authGate').hidden = true;
    document.body.classList.remove('locked');
    const who = document.getElementById('authWho');
    who.textContent = 'Demo ' + Auth.roleName(); who.hidden = false;
    document.getElementById('btnSignOut').hidden = false;
    boot();
  };
  const demo = defaultState();
  Object.assign(demo.consultant, {
    name: 'Aiman Abdullah', email: 'demo@example.test', uniqueId: '01', claimSeq: 1,
    ic: '010203-04-0567', position: 'Geospatial Consultant', position2: 'CONSULTANT',
    addr1: '12 Example Road', addr2: '40000 Shah Alam, Selangor',
    bank: 'Example Bank', accName: 'Aiman Abdullah', accNo: '0000 0000 0000'
  });
  demo.mode = 'both';
  demo.invoice.monthlyRate = 4500;
  demo.project.name = 'Coastal Mapping Programme';
  demo.project.client = 'Example Client';
  demo.timesheet.activities[0].name = 'GIS analysis and project coordination';
  demo.timesheet.month = 8; demo.timesheet.year = 2026;
  const signatureCanvas = document.createElement('canvas');
  signatureCanvas.width = 220; signatureCanvas.height = 65;
  const ink = signatureCanvas.getContext('2d');
  ink.font = 'italic 30px serif'; ink.fillText('Aiman', 18, 43);
  demo.sig.personnel = signatureCanvas.toDataURL();
  Store.clearAll(); Store.saveProfile(demo.consultant.name, demo); Store.saveCurrent(demo);
  const statuses = ['pending_manager', 'pending_boss', 'pending_signature', 'complete', 'returned'];
  const demoSubs = statuses.map((status, index) => {
    const data = structuredClone(demo);
    const name = ['Aiman Abdullah', 'Farah Syahirah', 'Nur Aisyah', 'Muhammad Daniel', 'Aiman Abdullah'][index];
    data.consultant.name = name;
    if (index > 0 && index < 4) data.consultant.email = 'other' + index + '@example.test';
    Store.saveProfile(name, data);
    return {
      id: index + 1, consultant: name, kind: index === 4 ? 'invoice' : 'claim', status,
      consultant_email: data.consultant.email, email: data.consultant.email,
      period_month: 9, period_year: 2026, invoice_no: '2026-01-00' + (index + 1),
      submitted_by: 'demo@example.test', created_by: 'demo@example.test', created_at: '2026-09-12T04:00:00Z',
      updated_at: '2026-09-13T04:00:00Z', total: 4500, amount: 4500,
      note: 'September consulting services', return_note: 'Please confirm the invoice date before resubmitting.',
      history: [{ action: 'return', note: 'Please confirm the invoice date before resubmitting.', at: '2026-09-13T04:00:00Z' }],
      data
    };
  });
  const demoArchive = [{
    id: 1, consultant: 'Muhammad Daniel', period_month: 9, period_year: 2026,
    kind: 'claim', stage: 'pending_signature', invoice_no: '2026-01-004', submission_id: 4,
    created_by: 'pa@example.test',
    created_at: '2026-09-13T04:00:00Z', updated_at: '2026-09-13T04:00:00Z',
    files: [{ name: 'September 2026 - Muhammad Daniel - Signed time sheet.pdf', type: 'application/pdf', content: 'JVBERi0xLjQKJSBsb2NhbCBhdWRpdAo=' }],
    data: demoSubs[3].data
  }];
  demoArchive.push({ ...demoArchive[0], id: 2, kind: 'invoice', files: [{
    ...demoArchive[0].files[0], name: 'September 2026 - Muhammad Daniel - Approved invoice.pdf'
  }] });
  Object.assign(Sync, {
    init: async () => { syncOn = true; probed = true; return { on: true, adopted: false, gained: 0 }; },
    submissions: async status => demoSubs.filter(s => !status || s.status === status),
    submission: async id => demoSubs.find(s => String(s.id) === String(id)),
    stored: async () => demoArchive,
    storedOne: async () => demoArchive[0],
    history: async () => [], me: async () => ({ role: auditRole }),
    pushDraft: () => {}, pushProfile: () => {}, deleteProfile: async () => {},
    recordClaim: async () => {}, submit: async () => { throw new Error('Submission disabled in UI audit'); },
    act: async () => { throw new Error('Approval disabled in UI audit'); },
    store: async () => { throw new Error('Archive writes disabled in UI audit'); }
  });
}
`;

async function main() {
  const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = path.resolve(ROOT, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
    try {
      let content = fs.readFileSync(file);
      if (path.basename(file) === 'index.html') {
        content = content.toString().replace(/(<script src="assets\/js\/app\.js[^>]*>)/,
          '<script>' + fixtures + '</script>$1');
      }
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Content-Security-Policy': "connect-src 'self'; frame-src 'self' blob:; img-src 'self' data: blob:; font-src 'self' data:;" });
      res.end(content);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  console.log('LOCAL_SERVER=' + origin);
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--remote-debugging-port=0', '--user-data-dir=' + path.join(OUTPUT, 'browser-profile'), 'about:blank'
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome CDP startup timed out: ' + stderr)), 15000);
    chrome.on('error', reject);
    chrome.stderr.on('data', chunk => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  console.log('CHROME_READY');
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const callbacks = new Map();
  const runtimeErrors = [];
  socket.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.id) {
      const cb = callbacks.get(data.id);
      if (cb) { callbacks.delete(data.id); data.error ? cb.reject(new Error(data.error.message)) : cb.resolve(data.result || {}); }
    } else if (data.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { callbacks.delete(id); reject(new Error('CDP command timed out: ' + method)); }, 15000);
    callbacks.set(id, { resolve: result => { clearTimeout(timer); resolve(result); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  console.log('TARGET_READY');
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const command = (method, params) => send(method, params, sessionId);
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const pressKey = async (key, code, keyCode) => {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
      ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : key === ' ' ? { text: ' ', unmodifiedText: ' ' } : {}) });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  };
  try {
    await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable');
    await command('Network.setBlockedURLs', { urls: ['https://*', 'http://bdos.*'] });
    const report = { output: OUTPUT, screens: [], interactions: [], runtimeErrors };
    const roles = option('roles')?.split(',') || ['login', 'admin', 'consultant', 'manager', 'boss', 'pa', 'finance'];
    for (const width of [1440, 390]) {
      const height = width === 390 ? 844 : 960;
      await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
      for (const role of roles) {
        await command('Page.navigate', { url: origin + '/?role=' + role });
        for (let i = 0; i < 60; i++) {
          await delay(100);
          if (await evaluate('document.readyState === "complete" && (new URLSearchParams(location.search).get("role") === "login" || document.querySelectorAll("#stepper button").length > 0)')) break;
        }
        let panels = role === 'login' ? ['login'] : await evaluate('activeSteps().map(s => s.id)');
        if (option('panels')) panels = panels.filter(panel => option('panels').split(',').includes(panel));
        if (option('inject-css')) await evaluate('document.head.appendChild(Object.assign(document.createElement("style"), {textContent:' + JSON.stringify(option('inject-css')) + '}))');
        if (role === 'login') {
          const passwordResult = await evaluate(`(() => {
            const input = document.getElementById('authPassword');
            const button = document.getElementById('authPasswordToggle');
            if (!button) return { test: 'Show password', skipped: true };
            input.value = 'synthetic UI test';
            const hidden = input.type === 'password';
            button.click();
            const shown = input.type === 'text';
            button.click();
            const hiddenAgain = input.type === 'password';
            input.value = '';
            return { test: 'Show password', passed: hidden && shown && hiddenAgain };
          })()`);
          report.interactions.push({ width, ...passwordResult });
        }
        for (const panel of panels) {
          if (panel !== 'login') {
            await evaluate('goToStep(activeSteps().findIndex(s => s.id === ' + JSON.stringify(panel) + '), true)');
            await delay(250);
          }
          const result = await evaluate(`(() => {
            const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
            const name = el => el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent.trim();
            const controls = [...document.querySelectorAll('button, input, select, textarea, a[href]')].filter(visible);
            return {
              title: document.querySelector('.panel.active h2')?.textContent || document.querySelector('.auth-card h1')?.textContent,
              viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
              sheetGeometry: [...document.querySelectorAll('.panel.active .sheetwrap, .panel.active .doc-claim, .panel.active .uz-gridwrap, .panel.active .uz-grid, .panel.active .doc-invoice')].map(el => ({ cls: el.className, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, width: Math.round(el.getBoundingClientRect().width), overflowX: getComputedStyle(el).overflowX })),
              unnamedButtons: controls.filter(el => el.tagName === 'BUTTON' && !name(el)).map(el => el.outerHTML.slice(0, 180)),
              unlabeledFields: controls.filter(el => /INPUT|SELECT|TEXTAREA/.test(el.tagName) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.labels?.length).map(el => ({ id: el.id, html: el.outerHTML.slice(0, 180) })),
              tinyControls: controls.filter(el => { const r = el.getBoundingClientRect(); return r.width < 24 || r.height < 24; }).map(el => ({ name: name(el).slice(0, 45), width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height) })).slice(0, 10),
              horizontalOverflow: [...document.querySelectorAll('body *')].filter(visible).filter(el => { const r = el.getBoundingClientRect(); return (r.right > innerWidth + 2 || r.left < -2) && !el.closest('.ts-scroll, .stepper, .table-scroll, .statustable-wrap, .tswrap, .sheetwrap, .uz-gridwrap'); }).slice(0, 12).map(el => ({ tag: el.tagName, id: el.id, cls: el.className, width: Math.round(el.getBoundingClientRect().width) }))
            };
          })()`);
          const filename = width + '-' + role + '-' + panel + '.png';
          await evaluate('document.getElementById("toast").className = "toast"');
          await evaluate('window.scrollTo(0,0)');
          const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
          fs.writeFileSync(path.join(OUTPUT, filename), Buffer.from(screenshot.data, 'base64'));
          report.screens.push({ role, panel, width, screenshot: filename, ...result });
          console.log(JSON.stringify({ role, panel, width, documentWidth: result.documentWidth,
            unnamed: result.unnamedButtons.length, unlabeled: result.unlabeledFields.length, tiny: result.tinyControls.length }));
        }
        if (role === 'admin') {
          const focusResult = await evaluate(`(() => {
            const trigger = document.getElementById('btnProfiles');
            trigger.focus();
            const blob = new jspdf.jsPDF().output('blob');
            openFilePreview('Local audit document', 'audit.pdf', blob);
            const focusedClose = document.activeElement.id === 'pdfViewClose';
            const backgroundInert = document.getElementById('main-content').inert;
            const dialogRole = document.getElementById('pdfView').getAttribute('role');
            const dialog = document.getElementById('pdfView');
            const first = dialog.querySelector('a[href]');
            first.focus();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
            const wrapsFocus = dialog.contains(document.activeElement) && document.activeElement.id === 'pdfViewFrame';
            document.getElementById('pdfViewClose').focus();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return { test: 'PDF dialog focus and Escape', focusedClose, backgroundInert, dialogRole, wrapsFocus,
              focusRestored: document.activeElement === trigger, closed: dialog.hidden,
              backgroundRestored: !document.getElementById('main-content').inert };
          })()`);
          focusResult.passed = focusResult.focusedClose && focusResult.backgroundInert && focusResult.dialogRole === 'dialog' && focusResult.wrapsFocus && focusResult.focusRestored && focusResult.closed && focusResult.backgroundRestored;
          report.interactions.push({ width, ...focusResult });
          await evaluate('goToStep(activeSteps().findIndex(s => s.id === "generate"), true); document.getElementById("btnInvPreview").focus(); document.getElementById("btnInvPreview").click();');
          for (let i = 0; i < 50; i++) {
            await delay(100);
            if (await evaluate('!document.getElementById("pdfView").hidden')) break;
          }
          const generatedPreview = await evaluate(`(() => {
            const opened = !document.getElementById('pdfView').hidden;
            const focusedClose = document.activeElement.id === 'pdfViewClose';
            document.getElementById('pdfViewClose').click();
            return { test: 'Generated PDF restores its preview button', opened, focusedClose,
              restoredElement: document.activeElement.id, passed: opened && focusedClose && document.activeElement.id === 'btnInvPreview' };
          })()`);
          report.interactions.push({ width, ...generatedPreview });

          await evaluate('goToStep(activeSteps().findIndex(s => s.id === "claim"), true); document.querySelector(".day-toggle[data-day=\\"1\\"]").focus();');
          await pressKey('ArrowRight', 'ArrowRight', 39);
          const dayAfterArrow = await evaluate('document.activeElement.dataset.day');
          const beforeMark = await evaluate('document.activeElement.textContent');
          await pressKey('Enter', 'Enter', 13);
          const afterEnter = await evaluate('document.activeElement.textContent');
          await pressKey(' ', 'Space', 32);
          const afterSpace = await evaluate('document.activeElement.textContent');
          await pressKey('End', 'End', 35);
          const dayAfterEnd = await evaluate('document.activeElement.dataset.day');
          await pressKey('Home', 'Home', 36);
          const dayAfterHome = await evaluate('document.activeElement.dataset.day');
          report.interactions.push({ width, test: 'Timesheet native keyboard', dayAfterArrow, beforeMark, afterEnter, afterSpace, dayAfterEnd, dayAfterHome,
            passed: dayAfterArrow === '2' && beforeMark !== afterEnter && afterEnter !== afterSpace && dayAfterEnd === '30' && dayAfterHome === '1' });
        }
      }
    }
    fs.writeFileSync(path.join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log('AUDIT_OUTPUT=' + OUTPUT);
    console.log('RUNTIME_ERRORS=' + JSON.stringify(runtimeErrors));
    console.log('INTERACTIONS=' + JSON.stringify(report.interactions));
    if (runtimeErrors.length || report.interactions.some(r => r.passed === false) || report.screens.some(s => s.documentWidth > s.width + 2 || s.unnamedButtons.length || s.unlabeledFields.length)) process.exitCode = 1;
  } finally {
    try { await send('Browser.close'); } catch {}
    socket.close(); chrome.kill(); server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
