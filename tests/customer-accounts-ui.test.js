const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const page = fs.readFileSync(path.resolve(__dirname, '..', 'rewards.html'), 'utf8');

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

function makeApp({ hostname = 'localhost', auth = {}, rpc = {}, savedCode = null } = {}) {
  const elements = new Map(idsInPage().map((id) => [id, new FakeElement(id)]));
  const storage = new Map();
  if (savedCode) storage.set('krema_member_code', savedCode);
  const calls = { auth: [], rpc: [], turnstile: [], resets: [], storage: [] };
  const documentListeners = new Map();
  const client = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async (payload) => ({ data: { session: { user: { email: payload.email } } }, error: null }),
      signUp: async () => ({ data: { user: { identities: [{}] }, session: null }, error: null }),
      verifyOtp: async () => ({ data: {}, error: null }),
      resend: async () => ({ data: {}, error: null }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      updateUser: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      ...auth,
    },
    rpc: async (name, payload) => ({ data: [], error: null, ...(rpc[name] || {}) }),
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
    location: { hostname, search: '' },
    addEventListener() {},
    removeEventListener() {},
    QRCode: { toCanvas() {} },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => { calls.storage.push(['set', key, value]); storage.set(key, value); },
      removeItem: (key) => { calls.storage.push(['remove', key]); storage.delete(key); },
    },
    turnstile: {
      render(container, options) { calls.turnstile.push({ container, options }); return `widget-${calls.turnstile.length}`; },
      reset(widgetId) { calls.resets.push(widgetId); },
    },
  };
  const context = {
    window,
    document: {
      hidden: false,
      getElementById: (id) => elements.get(id) || null,
      createElement: () => new FakeElement(),
      addEventListener(name, handler) { documentListeners.set(name, handler); },
      removeEventListener() {},
    },
    supabase: { createClient: () => client },
    QRCode: window.QRCode,
    localStorage: window.localStorage,
    setInterval: () => 1,
    clearInterval() {},
    console: { error() {} },
  };
  vm.runInNewContext(page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1], context, { filename: 'rewards-inline.js' });
  documentListeners.get('DOMContentLoaded')();
  return { elements, calls, storage };
}

function showSignIn(app) {
  app.elements.get('link-sign-in').click();
  return app.calls.turnstile.at(-1).options;
}

test('customer account forms are present with readable labels and live feedback', () => {
  const required = [
    'view-signin', 'view-secure-card', 'view-verify-signup', 'view-forgot-pin', 'view-reset-pin',
    'signin-email', 'signin-pin', 'secure-email', 'secure-pin', 'secure-confirm-pin', 'secure-phone',
    'verify-signup-token', 'forgot-email', 'reset-token', 'reset-pin', 'reset-confirm-pin',
    'card-account-row', 'lookup-name',
  ];
  for (const id of required) assert.ok(idsInPage().includes(id), `missing ${id}`);
  assert.match(page, /aria-live="polite"/);
});

test('PIN policy rejects weak values and accepts a six-digit customer PIN', async () => {
  const app = makeApp();
  showSignIn(app);
  app.elements.get('signin-email').value = 'bestie@krema.ph';
  for (const pin of ['000000', '123456', '777777', '12345', 'abcdef']) {
    app.elements.get('signin-pin').value = pin;
    app.elements.get('btn-signin').click();
    await flush();
    assert.equal(app.calls.auth.filter(([name]) => name === 'signInWithPassword').length, 0, `${pin} must not reach Auth`);
  }
  app.elements.get('signin-pin').value = '183726';
  app.calls.turnstile.at(-1).options.callback('captcha-token');
  app.elements.get('btn-signin').click();
  await flush();
  assert.equal(app.calls.auth.filter(([name]) => name === 'signInWithPassword').length, 1);
});

test('verification codes accept six through eight numeric digits only', async () => {
  const app = makeApp();
  app.elements.get('link-forgot-pin').click();
  app.elements.get('forgot-email').value = 'bestie@krema.ph';
  app.calls.turnstile.at(-1).options.callback('captcha-token');
  app.elements.get('btn-forgot-email').click();
  await flush();
  for (const token of ['12345', '123456789', 'abc123']) {
    app.elements.get('reset-token').value = token;
    app.elements.get('reset-pin').value = '183726';
    app.elements.get('reset-confirm-pin').value = '183726';
    app.elements.get('btn-reset-pin').click();
    await flush();
  }
  assert.equal(app.calls.auth.filter(([name]) => name === 'verifyOtp').length, 0);
  app.elements.get('reset-token').value = '12345678';
  app.elements.get('btn-reset-pin').click();
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls.auth.find(([name]) => name === 'verifyOtp').slice(1))), [{ email: 'bestie@krema.ph', token: '12345678', type: 'recovery' }]);
});

test('sign-in forwards its CAPTCHA token and loads the signed-in card', async () => {
  const card = { member_code: 'KREMA1', name: 'Bea', stamps: 3, goal: 20, tiers: [6, 10, 16, 20], claimed: [], reward_ready: false };
  const app = makeApp({ rpc: { get_my_card: { data: [card] } } });
  const captcha = showSignIn(app);
  app.elements.get('signin-email').value = ' bestie@krema.ph ';
  app.elements.get('signin-pin').value = '183726';
  captcha.callback('signin-captcha');
  app.elements.get('btn-signin').click();
  await flush(); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls.auth.find(([name]) => name === 'signInWithPassword').slice(1))), [{ email: 'bestie@krema.ph', password: '183726', options: { captchaToken: 'signin-captcha' } }]);
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls.rpc.find(([name]) => name === 'get_my_card'))), ['get_my_card', null]);
  assert.equal(app.storage.get('krema_member_code'), 'KREMA1');
  assert.ok(app.calls.resets.length > 0);
});

test('secure-card signup claims the open card after Auth returns a session', async () => {
  const card = { member_code: 'KREMA1', name: 'Bea', stamps: 0, goal: 20, tiers: [6, 10, 16, 20], claimed: [], reward_ready: false };
  const app = makeApp({ savedCode: 'KREMA1', auth: { signUp: async () => ({ data: { user: { identities: [{}] }, session: { user: { email: 'bea@krema.ph' } } }, error: null }) }, rpc: { get_card: { data: [card] }, claim_card: { data: [card] } } });
  await flush();
  app.elements.get('btn-secure-card').click();
  const captcha = app.calls.turnstile.at(-1).options;
  app.elements.get('secure-email').value = 'bea@krema.ph';
  app.elements.get('secure-phone').value = '09171234567';
  app.elements.get('secure-pin').value = '183726';
  app.elements.get('secure-confirm-pin').value = '183726';
  captcha.callback('signup-captcha');
  app.elements.get('btn-secure-submit').click();
  await flush(); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls.auth.find(([name]) => name === 'signUp').slice(1))), [{ email: 'bea@krema.ph', password: '183726', options: { captchaToken: 'signup-captcha' } }]);
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls.rpc.find(([name]) => name === 'claim_card').slice(1))), [{ p_code: 'KREMA1', p_phone: '09171234567' }]);
});

test('lookup uses both customer phone and exact name without exposing secured cards', async () => {
  const app = makeApp({ rpc: { customer_lookup: { data: [] } } });
  app.elements.get('lookup-phone').value = '09171234567';
  app.elements.get('lookup-name').value = 'Bea Santos';
  app.elements.get('btn-lookup').click();
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls.rpc[0])), ['customer_lookup', { p_phone: '09171234567', p_name: 'Bea Santos' }]);
  assert.match(app.elements.get('lookup-error').textContent, /exact name|sign in/i);
});

test('Turnstile uses the visible local test key only on localhost and never ships a secret key', () => {
  const local = makeApp({ hostname: 'localhost' });
  assert.equal(showSignIn(local).sitekey, '1x00000000000000000000AA');
  const production = makeApp({ hostname: 'rewards.krema.ph' });
  assert.equal(showSignIn(production).sitekey, '0x4AAAAAAEyPyxkgME5XT2-U');
  assert.match(page, /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.doesNotMatch(page, /turnstile[^\n]{0,60}secret/i);
});

test('customer storage never receives PIN or verification-token values', async () => {
  const app = makeApp();
  const captcha = showSignIn(app);
  app.elements.get('signin-email').value = 'bestie@krema.ph';
  app.elements.get('signin-pin').value = '183726';
  captcha.callback('captcha-token');
  app.elements.get('btn-signin').click();
  await flush();
  assert.ok(app.calls.storage.every((call) => !['183726', 'captcha-token', '12345678'].includes(call.at(-1))));
});
