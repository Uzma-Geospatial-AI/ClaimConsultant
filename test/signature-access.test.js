/* Signature controls must follow the account's role, while saved approval
   signatures still appear on the claim. Run: node test/signature-access.test.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

// A small DOM for mounting the real component. Markup is parsed into nodes,
// so assertions inspect the controls it renders rather than its source code.
class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.listeners = {};
    this.hidden = false;
    this.value = '';
    this.files = [];
    this.clicks = 0;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  get className() { return this.attributes.class || ''; }
  set className(value) { this.attributes.class = value; }
  get src() { return this.attributes.src || ''; }
  set src(value) { this.attributes.src = value; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.text = String(value); this.children = []; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  dispatch(name) { (this.listeners[name] || []).forEach(handler => handler({ target: this })); }
  click() { this.clicks++; this.dispatch('click'); }
  getBoundingClientRect() { return { width: 200, height: 80 }; }
  getContext() { return { scale() {}, clearRect() {}, drawImage() {} }; }
  matches(selector) {
    const tag = selector.match(/^[a-z]+/i);
    if (tag && this.tagName !== tag[0].toUpperCase()) return false;
    for (const match of selector.matchAll(/\.([\w-]+)/g)) {
      if (!this.className.split(/\s+/).includes(match[1])) return false;
    }
    for (const match of selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
      if (this.getAttribute(match[1]) === null) return false;
      if (match[2] !== undefined && this.getAttribute(match[1]) !== match[2]) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = node => node.children.forEach(child => {
      if (selector.split(',').some(part => child.matches(part.trim()))) found.push(child);
      visit(child);
    });
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  set innerHTML(markup) {
    this.children = [];
    this.text = '';
    const stack = [this];
    for (const token of String(markup).match(/<[^>]+>|[^<]+/g) || []) {
      if (token.startsWith('</')) { stack.pop(); continue; }
      if (!token.startsWith('<')) {
        stack[stack.length - 1].appendChild(Object.assign(new Element('#text'), { text: token }));
        continue;
      }
      const tag = /^<([\w-]+)/.exec(token)[1];
      const node = new Element(tag);
      const attrs = token.slice(tag.length + 1, -1);
      for (const match of attrs.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        node.setAttribute(match[1], match[2] ?? match[3] ?? match[4] ?? '');
        if (match[1] === 'hidden') node.hidden = true;
      }
      stack[stack.length - 1].appendChild(node);
      if (!['input', 'img', 'br', 'hr'].includes(tag)) stack.push(node);
    }
  }
}

function harness(role) {
  const instances = [];
  let changes = 0;
  const state = { sig: { personnel: '', pm: '', hod: '', verified: '' } };
  const context = vm.createContext({
    console,
    document: { createElement: tag => new Element(tag) },
    window: { devicePixelRatio: 1, addEventListener() {} },
    Auth: { isAdmin: () => role === 'admin', role: () => role },
    SignaturePad: class {
      constructor(canvas) { this.canvas = canvas; this.listeners = {}; instances.push(this); }
      addEventListener(name, handler) { this.listeners[name] = handler; }
      clear() {}
      toDataURL() { return 'data:image/png;base64,ZHJhd24='; }
    },
    Image: class {
      constructor() { this.width = 200; this.height = 80; }
      set src(value) { this.url = value; if (this.onload) this.onload(); }
    },
    FileReader: class {
      readAsDataURL(file) { this.result = file.data; this.onload(); }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js/signature.js'), 'utf8'), context);
  const Sig = vm.runInContext('Sig', context);
  Sig.reset(state, () => changes++);
  return { Sig, state, instances, changes: () => changes };
}

for (const role of ['consultant', 'staff']) {
  const h = harness(role);
  const slots = ['pm', 'hod', 'verified'].map(key => {
    const host = new Element('div');
    h.Sig.mount(host, key);
    assert.ok(host.querySelector('.sigslot.readonly'), `${role}: ${key} is read-only`);
    assert.equal(host.querySelectorAll('button,input,canvas').length, 0, `${role}: ${key} has no signature editor`);
    assert.ok(host.querySelector('.sighint').textContent.trim(), `${role}: ${key} explains who signs`);
    assert.equal(host.querySelector('.sig-readonly-image').hidden, true, `${role}: empty signature is hidden`);
    return { key, host };
  });
  assert.equal(h.instances.length, 0, `${role}: no drawing handlers are installed for approval signatures`);
  for (const { key } of slots) h.state.sig[key] = 'data:image/png;base64,' + Buffer.from(key).toString('base64');
  h.Sig.refresh();
  h.Sig.resizeAll();
  for (const { key, host } of slots) {
    const image = host.querySelector('.sig-readonly-image');
    assert.equal(image.src, h.state.sig[key], `${role}: ${key} displays the saved signature`);
    assert.equal(image.hidden, false, `${role}: ${key} becomes visible after signing`);
  }
  for (const { key } of slots) h.state.sig[key] = '';
  h.Sig.refresh();
  for (const { key, host } of slots) {
    assert.equal(host.querySelector('.sig-readonly-image').hidden, true, `${role}: clearing saved ${key} removes its image`);
  }
  assert.equal(h.changes(), 0, `${role}: rendering does not mutate or autosave a signature`);
}

for (const role of ['consultant', 'admin']) {
  const h = harness(role);
  const keys = role === 'admin' ? ['personnel', 'pm', 'hod', 'verified'] : ['personnel'];
  for (const key of keys) {
    const host = new Element('div');
    const count = h.instances.length;
    h.Sig.mount(host, key);
    assert.equal(h.instances.length, count + 1, `${role}: ${key} has a drawing pad`);
    assert.ok(host.querySelector('canvas'), `${role}: ${key} renders its canvas`);
    const pad = h.instances[count];
    pad.listeners.endStroke();
    assert.equal(h.state.sig[key], pad.toDataURL(), `${role}: drawing saves ${key}`);
    host.querySelector('[data-a="clear"]').click();
    assert.equal(h.state.sig[key], '', `${role}: clearing updates ${key}`);
    const file = host.querySelector('input[type=file]');
    host.querySelector('[data-a="upload"]').click();
    assert.equal(file.clicks, 1, `${role}: upload opens the ${key} file picker`);
    file.files = [{ data: 'data:image/png;base64,dXBsb2Fk' }];
    file.dispatch('change');
    assert.equal(h.state.sig[key], file.files[0].data, `${role}: upload saves ${key}`);
  }
  assert.equal(h.changes(), keys.length * 3, `${role}: each draw, clear and upload notifies autosave once`);
}

console.log('Signature role controls, read-only refresh, personnel editing and administrator editing passed.');
