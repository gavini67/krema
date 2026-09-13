const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const page = fs.readFileSync(path.resolve(__dirname, '..', 'staff.html'), 'utf8');

class FakeClassList {
  constructor() { this.values = new Set(['hidden']); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  toggle(name, force) {
    if (force === undefined) force = !this.values.has(name);
    if (force) this.add(name); else this.remove(name);
    return force;
  }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.style = {};
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.listeners = new Map();
    this.children = [];
    this.disabled = false;
  }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  click() { const handler = this.listeners.get('click'); return handler && handler({ preventDefault() {} }); }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || null; }
  focus() { this.focused = true; }
}

function idsInPage() {
  return [...page.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
}

function flush() { return new Promise((resolve) => setImmediate(resolve)); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

function makeApp({ hostname = 'localhost', width = 390, turnstileWidth = width - 84, turnstileResults = [], auth = {}, rpc = {}, session = null, turnstile = true, confirm = () => true } = {}) {
  const elements = new Map(idsInPage().map((id) => [id, new FakeElement(id)]));
  elements.get('staff-turnstile').clientWidth = turnstileWidth;
  const calls = { auth: [], rpc: [], turnstile: [], resets: [], confirms: [], createClient: [] };
  const documentListeners = new Map();
  const client = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      signInWithPassword: async (payload) => ({ data: { session: { user: { email: payload.email } } }, error: null }),
      signOut: async () => ({ error: null }),
      ...auth,
    },
    rpc: async (name, payload) => {
      const configured = rpc[name];
      if (typeof configured === 'function') return configured(payload);
      if (Array.isArray(configured)) return configured.shift();
      return { data: name === 'is_staff' ? true : [], error: null, ...(configured || {}) };
    },
  };
  for (const [name, method] of Object.entries(client.auth)) {
    if (typeof method === 'function') {
      client.auth[name] = async (...args) => {
        calls.auth.push([name, ...args]);
        return method(...args);
      };
    }
  }
  const originalRpc = client.rpc;
  client.rpc = async (name, payload) => {
    calls.rpc.push([name, payload]);
    return originalRpc(name, payload);
  };
  const window = {
    location: { hostname },
    innerWidth: width,
    addEventListener() {},
    confirm(message) { calls.confirms.push(message); return confirm(message); },
  };
  if (turnstile) {
    window.turnstile = {
      render(container, options) {
        calls.turnstile.push({ container, options });
        const result = turnstileResults.shift();
        if (result instanceof Error) throw result;
        return result || `widget-${calls.turnstile.length}`;
      },
      reset(widgetId) { calls.resets.push(widgetId); },
    };
  }
  const context = {
    window,
    document: {
      hidden: false,
      getElementById: (id) => elements.get(id) || null,
      createElement: () => new FakeElement(),
      addEventListener(name, handler) { documentListeners.set(name, handler); },
    },
    supabase: { createClient: (...args) => { calls.createClient.push(args); return client; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    setTimeout() { return 1; },
    clearTimeout() {},
    console: { error() {} },
  };
  const script = page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1];
  vm.runInNewContext(script, context, { filename: 'staff-inline.js' });
  documentListeners.get('DOMContentLoaded')();
  return { elements, calls };
}

test('staff login has an explicit Turnstile widget with no secret in the page', () => {
  assert.ok(idsInPage().includes('staff-turnstile'), 'missing staff Turnstile container');
  assert.ok(idsInPage().includes('staff-turnstile-error'), 'missing staff Turnstile feedback');
  assert.match(page, /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.doesNotMatch(page, /turnstile[^\n]{0,80}secret/i);
});

test('staff login uses local and production keys, forwards a token, and resets the widget', async () => {
  const local = makeApp({ hostname: 'localhost' });
  await flush();
  assert.equal(local.calls.turnstile.at(-1).options.sitekey, '1x00000000000000000000AA');

  const loopback = makeApp({ hostname: '127.0.0.1' });
  await flush();
  assert.equal(loopback.calls.turnstile.at(-1).options.sitekey, '1x00000000000000000000AA');

  const production = makeApp({ hostname: 'staff.krema.ph' });
  await flush();
  const captcha = production.calls.turnstile.at(-1).options;
  assert.equal(captcha.sitekey, '0x4AAAAAAEyPyxkgME5XT2-U');
  const mobile = makeApp({ hostname: 'staff.krema.ph', width: 375, turnstileWidth: 291 });
  await flush();
  assert.equal(mobile.calls.turnstile.at(-1).options.size, 'compact');
  assert.equal(captcha.size, 'normal');
  production.elements.get('staff-email').value = 'crew@krema.ph';
  production.elements.get('staff-password').value = 'password';
  production.elements.get('btn-login').click();
  await flush();
  assert.equal(production.calls.auth.filter(([name]) => name === 'signInWithPassword').length, 0);
  assert.match(production.elements.get('login-error').textContent, /security check/i);
  captcha.callback('staff-captcha');
  production.elements.get('btn-login').click();
  await flush(); await flush();
  assert.deepEqual(plain(production.calls.auth.find(([name]) => name === 'signInWithPassword').slice(1)), [
    { email: 'crew@krema.ph', password: 'password', options: { captchaToken: 'staff-captcha' } },
  ]);
  assert.ok(production.calls.resets.length > 0);
  assert.ok(production.calls.rpc.some(([name]) => name === 'is_staff'));
});

test('a restored staff session skips Turnstile while keeping the staff gate and isolated storage', async () => {
  const app = makeApp({ session: { user: { email: 'crew@krema.ph' } } });
  await flush(); await flush();
  assert.equal(app.calls.turnstile.length, 0);
  assert.ok(app.calls.rpc.some(([name]) => name === 'is_staff'));
  assert.ok(app.elements.get('view-login').classList.contains('hidden'));
  assert.ok(!app.elements.get('view-scan').classList.contains('hidden'));
  assert.deepEqual(plain(app.calls.createClient[0].slice(2)), [{ auth: { storageKey: 'krema-staff-auth' } }]);
});

test('logging out from a restored staff session creates a fresh CAPTCHA-required login', async () => {
  const app = makeApp({ session: { user: { email: 'crew@krema.ph' } } });
  await flush(); await flush();
  assert.equal(app.calls.turnstile.length, 0);
  app.elements.get('link-logout-scan').click();
  await flush();
  const captcha = app.calls.turnstile.at(-1).options;
  assert.equal(app.calls.turnstile.length, 1);
  captcha.callback('after-logout-captcha');
  app.elements.get('staff-email').value = 'crew@krema.ph';
  app.elements.get('staff-password').value = 'password';
  app.elements.get('btn-login').click();
  await flush(); await flush();
  assert.deepEqual(plain(app.calls.auth.find(([name]) => name === 'signInWithPassword').slice(1)), [
    { email: 'crew@krema.ph', password: 'password', options: { captchaToken: 'after-logout-captcha' } },
  ]);
});

test('a synchronous Turnstile render failure shows inline feedback and leaves a retryable widget state', async () => {
  const app = makeApp({ turnstileResults: [new Error('blocked'), 'retry-widget'] });
  await flush();
  assert.equal(app.calls.turnstile.length, 1);
  assert.match(app.elements.get('staff-turnstile-error').textContent, /security check.*reload/i);
  app.elements.get('btn-login').click();
  await flush();
  assert.equal(app.calls.turnstile.length, 2);
});

test('a missing Turnstile blocks staff password login with inline feedback', async () => {
  const app = makeApp({ turnstile: false });
  await flush();
  app.elements.get('staff-email').value = 'crew@krema.ph';
  app.elements.get('staff-password').value = 'password';
  app.elements.get('btn-login').click();
  await flush();
  assert.equal(app.calls.auth.filter(([name]) => name === 'signInWithPassword').length, 0);
  assert.match(app.elements.get('staff-turnstile-error').textContent, /security check.*reload/i);
});

test('staff can confirm an unlink, render the returned card, and see a success toast', async () => {
  const initial = { member_code: 'KREMA1', name: 'Bea', stamps: 3, goal: 20, tiers: [6, 10, 16, 20], claimed: [], reward_ready: false };
  const returned = { ...initial, stamps: 4 };
  const app = makeApp({ rpc: { staff_lookup: { data: [initial] }, unlink_card: { data: [returned] } } });
  await flush();
  app.elements.get('staff-phone-lookup').value = '09171234567';
  app.elements.get('btn-find').click();
  await flush();
  app.elements.get('btn-unlink-customer-login').click();
  await flush();
  assert.match(app.calls.confirms[0], /wrong or lost email/i);
  assert.match(app.calls.confirms[0], /does not change stamps or rewards/i);
  assert.deepEqual(plain(app.calls.rpc.find(([name]) => name === 'unlink_card')), ['unlink_card', { p_code: 'KREMA1' }]);
  assert.equal(app.elements.get('result-counter').textContent, '4');
  assert.match(app.elements.get('toast-msg').textContent, /customer login unlinked/i);
});

test('staff sees a clear non-technical message when an unlink target is not linked', async () => {
  const card = { member_code: 'KREMA1', name: 'Bea', stamps: 3, goal: 20, tiers: [6, 10, 16, 20], claimed: [], reward_ready: false };
  const app = makeApp({ rpc: { staff_lookup: { data: [card] }, unlink_card: { data: null, error: { message: 'card is not linked to an account' } } } });
  await flush();
  app.elements.get('staff-phone-lookup').value = '09171234567';
  app.elements.get('btn-find').click();
  await flush();
  app.elements.get('btn-unlink-customer-login').click();
  await flush();
  assert.match(app.elements.get('toast-msg').textContent, /not linked/i);
  assert.doesNotMatch(app.elements.get('toast-msg').textContent, /rpc|postgres|exception/i);
});
