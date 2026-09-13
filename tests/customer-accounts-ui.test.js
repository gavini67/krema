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
  submit() { const handler = this.listeners.get('submit'); return handler && handler({ preventDefault() {} }); }
  click() {
    if (this.disabled) return;
    const handler = this.listeners.get('click');
    if (handler) handler({ preventDefault() {} });
    if (this.submitForm) this.submitForm.submit();
  }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || null; }
  focus() { this.focused = true; }
}

function idsInPage() {
  return [...page.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
}

function flush() { return new Promise((resolve) => setImmediate(resolve)); }

function makeApp({ hostname = 'localhost', auth = {}, rpc = {}, savedCode = null, locationSearch = '', exposeTestHooks = false, turnstileWidth = 340, turnstileResults = [], turnstile = true } = {}) {
  const elements = new Map(idsInPage().map((id) => [id, new FakeElement(id)]));
  for (const form of page.matchAll(/<form\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)) {
    for (const button of form[2].matchAll(/<button\b[^>]*>/g)) {
      const id = button[0].match(/id="([^"]+)"/)[1];
      if (!/type="button"/.test(button[0])) elements.get(id).submitForm = elements.get(form[1]);
    }
  }
  elements.forEach((el) => { el.clientWidth = turnstileWidth; });
  const storage = new Map();
  if (savedCode) storage.set('krema_member_code', savedCode);
  const calls = { auth: [], rpc: [], turnstile: [], resets: [], storage: [], createClient: [], intervals: 0, intervalCallbacks: [], activeIntervals: new Set(), windowListeners: [] };
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
    rpc: async (name, payload) => {
      const configured = rpc[name];
      if (typeof configured === 'function') return configured(payload);
      if (Array.isArray(configured)) return configured.shift();
      return { data: [], error: null, ...(configured || {}) };
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
    location: { hostname, search: locationSearch },
    addEventListener(name, handler) { calls.windowListeners.push(['add', name, handler]); },
    removeEventListener(name, handler) { calls.windowListeners.push(['remove', name, handler]); },
    QRCode: { toCanvas() {} },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => { calls.storage.push(['set', key, value]); storage.set(key, value); },
      removeItem: (key) => { calls.storage.push(['remove', key]); storage.delete(key); },
    },
    turnstile: turnstile && {
      render(container, options) {
        calls.turnstile.push({ container, options });
        const result = turnstileResults.shift();
        if (result instanceof Error) throw result;
        return result || `widget-${calls.turnstile.length}`;
      },
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
    supabase: { createClient: (...args) => { calls.createClient.push(args); return client; } },
    QRCode: window.QRCode,
    localStorage: window.localStorage,
    setInterval: (callback) => { calls.intervals += 1; calls.intervalCallbacks.push(callback); calls.activeIntervals.add(calls.intervals); return calls.intervals; },
    clearInterval(id) { calls.activeIntervals.delete(id); },
    console: { error() {} },
  };
  let script = page.match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1];
  if (exposeTestHooks) {
    script = script.replace(
      "document.addEventListener('DOMContentLoaded', init);",
      "window.__accountTestHooks = { setCustomerEmail: function (email) { customerEmail = email; }, setAccountContext: function (context) { accountContext = context; }, showAccountView: showAccountView }; document.addEventListener('DOMContentLoaded', init);",
    );
  }
  vm.runInNewContext(script, context, { filename: 'rewards-inline.js' });
  documentListeners.get('DOMContentLoaded')();
  return { elements, calls, storage, hooks: window.__accountTestHooks };
}

function showSignIn(app) {
  app.elements.get('link-sign-in').click();
  return app.calls.turnstile.at(-1).options;
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

test('customer account forms are present with readable labels and live feedback', () => {
  const required = [
    'view-signin', 'view-secure-card', 'view-verify-signup', 'view-forgot-pin', 'view-reset-pin',
    'signin-email', 'signin-pin', 'secure-email', 'secure-pin', 'secure-confirm-pin', 'secure-phone',
    'verify-signup-token', 'forgot-email', 'reset-token', 'reset-pin', 'reset-confirm-pin',
    'card-account-row',
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

test('existing-card guidance offers sign-in or saved-card/staff access without phone lookup', async () => {
  const app = makeApp();
  await flush();
  assert.ok(!app.elements.has('lookup-phone'));
  assert.ok(!app.elements.has('lookup-name'));
  assert.match(page, /saved card|bookmark/i);
  assert.match(page, /ask staff/i);
  app.elements.get('link-sign-in').click();
  await flush();
  assert.ok(!app.elements.get('view-signin').classList.contains('hidden'));
  assert.ok(!app.calls.rpc.some(([name]) => name === 'customer_lookup'));
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

test('a signed-in customer can claim a newly created card without another Auth signup', async () => {
  const card = { member_code: 'NEW123', name: 'Bea', stamps: 0, goal: 20, tiers: [6, 10, 16, 20], claimed: [], reward_ready: false };
  const app = makeApp({
    auth: { getSession: async () => ({ data: { session: { user: { email: 'bea@krema.ph' } } }, error: null }) },
    rpc: { get_my_card: { data: [] }, signup_customer: { data: [card] }, claim_card: { data: [card] } },
  });
  await flush(); await flush();
  app.elements.get('cust-name').value = 'Bea';
  app.elements.get('cust-phone').value = '09171234567';
  app.elements.get('btn-join').click();
  await flush(); await flush();
  assert.ok(!app.elements.get('btn-secure-card').classList.contains('hidden'));
  app.elements.get('btn-secure-card').click();
  app.elements.get('claim-phone').value = '09171234567';
  app.elements.get('btn-claim-card').click();
  await flush(); await flush();
  assert.equal(app.calls.auth.filter(([name]) => name === 'signUp').length, 0);
  assert.deepEqual(plain(app.calls.rpc.find(([name]) => name === 'claim_card')), ['claim_card', { p_code: 'NEW123', p_phone: '09171234567' }]);
});

test('initialization checks session and falls back from invalid URL to saved code before the signed-in card', async () => {
  const sessionCard = { member_code: 'SESSION', name: 'Bea', stamps: 2, goal: 20, tiers: [6, 10, 16, 20], claimed: [], reward_ready: false };
  const app = makeApp({
    savedCode: 'SAVED',
    locationSearch: '?c=BAD',
    auth: { getSession: async () => ({ data: { session: { user: { email: 'bea@krema.ph' } } }, error: null }) },
    rpc: { get_card: [{ data: [] }, { data: [] }], get_my_card: { data: [sessionCard] } },
  });
  await flush(); await flush(); await flush(); await flush();
  assert.equal(app.calls.auth.filter(([name]) => name === 'getSession').length, 1);
  assert.deepEqual(plain(app.calls.rpc.filter(([name]) => name === 'get_card')), [
    ['get_card', { p_code: 'BAD' }],
    ['get_card', { p_code: 'SAVED' }],
  ]);
  assert.ok(app.calls.rpc.some(([name]) => name === 'get_my_card'));
  assert.equal(app.storage.get('krema_member_code'), 'SESSION');
});

test('a post-auth card load failure keeps sign-in state honest', async () => {
  const app = makeApp({ rpc: { get_my_card: { data: null, error: { message: 'offline' } } } });
  const captcha = showSignIn(app);
  app.elements.get('signin-email').value = 'bea@krema.ph';
  app.elements.get('signin-pin').value = '183726';
  captcha.callback('signin-captcha');
  app.elements.get('btn-signin').click();
  await flush(); await flush();
  assert.doesNotMatch(app.elements.get('signup-error').textContent, /incorrect/i);
  assert.match(app.elements.get('signup-error').textContent, /signed in|card/i);
});

test('recovery forwards its CAPTCHA token and request failures stay on the email form', async () => {
  const app = makeApp({ auth: { resetPasswordForEmail: async () => ({ data: null, error: { message: 'captcha rejected' } }) } });
  await flush();
  app.elements.get('link-forgot-pin').click();
  app.elements.get('forgot-email').value = 'bea@krema.ph';
  const captcha = app.calls.turnstile.at(-1).options;
  captcha.callback('forgot-captcha');
  app.elements.get('btn-forgot-email').click();
  await flush();
  assert.deepEqual(plain(app.calls.auth.find(([name]) => name === 'resetPasswordForEmail').slice(1)), ['bea@krema.ph', { captchaToken: 'forgot-captcha' }]);
  assert.ok(!app.elements.get('view-forgot-pin').classList.contains('hidden'));
  assert.match(app.elements.get('forgot-error').textContent, /try again/i);
});

test('signup verification claims the card and duplicate identities do not reveal account existence', async () => {
  const card = { member_code: 'KREMA1', name: 'Bea', stamps: 0, goal: 20, tiers: [6, 10, 16, 20], claimed: [], reward_ready: false };
  const app = makeApp({
    savedCode: 'KREMA1',
    auth: { signUp: async () => ({ data: { user: { identities: [{}] }, session: null }, error: null }) },
    rpc: { get_card: { data: [card] }, claim_card: { data: [card] } },
  });
  await flush();
  app.elements.get('btn-secure-card').click();
  app.elements.get('secure-email').value = 'bea@krema.ph';
  app.elements.get('secure-phone').value = '09171234567';
  app.elements.get('secure-pin').value = '183726';
  app.elements.get('secure-confirm-pin').value = '183726';
  app.calls.turnstile.at(-1).options.callback('signup-captcha');
  app.elements.get('btn-secure-submit').click();
  await flush();
  app.elements.get('verify-signup-token').value = '12345678';
  app.elements.get('btn-verify-signup').click();
  await flush(); await flush();
  assert.deepEqual(plain(app.calls.auth.find(([name]) => name === 'verifyOtp').slice(1)), [{ email: 'bea@krema.ph', token: '12345678', type: 'signup' }]);
  assert.ok(app.calls.rpc.some(([name]) => name === 'claim_card'));

  const duplicate = makeApp({ savedCode: 'KREMA1', auth: { signUp: async () => ({ data: { user: { identities: [] }, session: null }, error: null }) }, rpc: { get_card: { data: [card] } } });
  await flush();
  duplicate.elements.get('btn-secure-card').click();
  duplicate.elements.get('secure-email').value = 'bea@krema.ph';
  duplicate.elements.get('secure-phone').value = '09171234567';
  duplicate.elements.get('secure-pin').value = '183726';
  duplicate.elements.get('secure-confirm-pin').value = '183726';
  duplicate.calls.turnstile.at(-1).options.callback('signup-captcha');
  duplicate.elements.get('btn-secure-submit').click();
  await flush();
  assert.match(duplicate.elements.get('signin-error').textContent, /sign in|reset/i);
  assert.doesNotMatch(duplicate.elements.get('signin-error').textContent, /exists|already/i);
});

test('a successful PIN update is not reported as a failed update when card loading fails', async () => {
  const app = makeApp({ rpc: { get_my_card: { data: null, error: { message: 'offline' } } } });
  app.elements.get('link-forgot-pin').click();
  app.elements.get('forgot-email').value = 'bea@krema.ph';
  app.calls.turnstile.at(-1).options.callback('forgot-captcha');
  app.elements.get('btn-forgot-email').click();
  await flush();
  app.elements.get('reset-token').value = '12345678';
  app.elements.get('reset-pin').value = '183726';
  app.elements.get('reset-confirm-pin').value = '183726';
  app.elements.get('btn-reset-pin').click();
  await flush(); await flush();
  assert.deepEqual(plain(app.calls.auth.find(([name]) => name === 'updateUser').slice(1)), [{ password: '183726' }]);
  assert.match(app.elements.get('signup-error').textContent, /PIN was updated/i);
  assert.doesNotMatch(app.elements.get('signup-error').textContent, /could not update/i);
});

test('returning from secure-card restarts polling and customer Auth uses its isolated storage key', async () => {
  const card = { member_code: 'KREMA1', name: 'Bea', stamps: 0, goal: 20, tiers: [6, 10, 16, 20], claimed: [], reward_ready: false };
  const app = makeApp({ savedCode: 'KREMA1', rpc: { get_card: { data: [card] } } });
  await flush();
  app.elements.get('btn-secure-card').click();
  app.elements.get('link-secure-back').click();
  assert.equal(app.calls.intervals, 2);
  assert.deepEqual(plain(app.calls.createClient[0].slice(2)), [{ auth: { storageKey: 'krema-customer-auth', detectSessionInUrl: false } }]);
  assert.notEqual(app.calls.createClient[0][2].auth.storageKey, 'krema-staff-auth');
});

test('a retained session does not hide failed sign-in credentials feedback', async () => {
  const app = makeApp({
    auth: {
      getSession: async () => ({ data: { session: { user: { email: 'existing@krema.ph' } } }, error: null }),
      signInWithPassword: async () => ({ data: { session: null }, error: { message: 'invalid credentials' } }),
    },
    rpc: { get_my_card: { data: [] } },
  });
  await flush(); await flush();
  const captcha = showSignIn(app);
  app.elements.get('signin-email').value = 'other@krema.ph';
  app.elements.get('signin-pin').value = '183726';
  captcha.callback('signin-captcha');
  app.elements.get('btn-signin').click();
  await flush();
  assert.match(app.elements.get('signin-error').textContent, /email or PIN is incorrect/i);
});

test('a retained session does not hide failed signup-verification feedback', async () => {
  const app = makeApp({
    exposeTestHooks: true,
    auth: { verifyOtp: async () => ({ data: null, error: { message: 'invalid token' } }) },
  });
  await flush();
  app.hooks.setCustomerEmail('existing@krema.ph');
  app.hooks.setAccountContext({ code: 'KREMA1', phone: '09171234567', email: 'other@krema.ph' });
  app.hooks.showAccountView('view-verify-signup');
  app.elements.get('verify-signup-token').value = '12345678';
  app.elements.get('btn-verify-signup').click();
  await flush();
  assert.match(app.elements.get('verify-signup-error').textContent, /could not be verified/i);
});

const fixtureCard = { member_code: 'KREMA1', name: 'Bea', stamps: 3, goal: 20, tiers: [6, 10, 16, 20], claimed: [], reward_ready: false };
const customerSession = { user: { email: 'bea@krema.ph' } };
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function startRecovery(app) {
  app.elements.get('link-forgot-pin').click();
  app.elements.get('forgot-email').value = 'bea@krema.ph';
  app.calls.turnstile.at(-1).options.callback('captcha');
  app.elements.get('btn-forgot-email').click();
  await flush();
  app.elements.get('reset-token').value = '12345678';
  app.elements.get('reset-pin').value = '183726';
  app.elements.get('reset-confirm-pin').value = '183726';
}

test('resolved logout errors retain the account/card and show a retryable error', async () => {
  const app = makeApp({ auth: {
    getSession: async () => ({ data: { session: customerSession }, error: null }),
    signOut: async () => ({ error: { message: 'offline' } }),
  }, rpc: { get_my_card: { data: [fixtureCard] } } });
  await flush();
  app.elements.get('btn-customer-logout').click();
  await flush();
  assert.ok(!app.elements.get('view-card').classList.contains('hidden'));
  assert.match(app.elements.get('card-account-copy').textContent, /bea@krema.ph/);
  assert.match(app.elements.get('card-account-error')?.textContent || '', /sign out.*try again/i);
  assert.equal(app.elements.get('btn-customer-logout').disabled, false);
});

test('a failed PIN update retries with the verified recovery session, without reusing OTP', async () => {
  let attempts = 0;
  const app = makeApp({ auth: {
    verifyOtp: async () => ({ data: { session: customerSession }, error: null }),
    updateUser: async () => ({ data: {}, error: ++attempts === 1 ? { message: 'offline' } : null }),
  }, rpc: { get_my_card: { data: [fixtureCard] } } });
  await flush();
  await startRecovery(app);
  app.elements.get('btn-reset-pin').click();
  await flush();
  assert.match(app.elements.get('reset-error').textContent, /could not update/i);
  app.elements.get('reset-token').value = '';
  app.elements.get('btn-reset-pin').click();
  await flush();
  assert.ok(!app.elements.get('view-card').classList.contains('hidden'));
  assert.equal(app.calls.auth.filter(([name]) => name === 'verifyOtp').length, 1);
  assert.equal(app.calls.auth.filter(([name]) => name === 'updateUser').length, 2);
});

test('cancelling recovery clears verified state before a new reset', async () => {
  const app = makeApp({ auth: { updateUser: async () => ({ data: {}, error: { message: 'offline' } }) } });
  await flush();
  await startRecovery(app);
  app.elements.get('btn-reset-pin').click();
  await flush();
  app.elements.get('link-reset-back').click();
  await startRecovery(app);
  app.elements.get('btn-reset-pin').click();
  await flush();
  assert.equal(app.calls.auth.filter(([name]) => name === 'verifyOtp').length, 2);
});

for (const transition of ['secure', 'start-over', 'logout']) {
  test(`late card polling cannot reopen the card after ${transition}`, async () => {
    const pending = deferred();
    let reads = 0;
    const app = makeApp({ savedCode: 'KREMA1', rpc: { get_card: () => ++reads === 1 ? { data: [fixtureCard] } : pending.promise } });
    await flush();
    app.calls.intervalCallbacks.at(-1)();
    if (transition === 'secure') app.elements.get('btn-secure-card').click();
    if (transition === 'start-over') app.elements.get('link-start-over').click();
    if (transition === 'logout') { app.elements.get('btn-customer-logout').click(); await flush(); }
    pending.resolve({ data: [{ ...fixtureCard, stamps: 4 }], error: null });
    await flush();
    assert.ok(app.elements.get('view-card').classList.contains('hidden'));
    assert.equal(app.calls.activeIntervals.size, 0);
  });
}

test('a late initial card read cannot replace a newly opened sign-in view', async () => {
  const pending = deferred();
  const app = makeApp({ savedCode: 'KREMA1', rpc: { get_card: () => pending.promise } });
  await flush();
  showSignIn(app);
  pending.resolve({ data: [fixtureCard], error: null });
  await flush();
  assert.ok(!app.elements.get('view-signin').classList.contains('hidden'));
  assert.equal(app.calls.activeIntervals.size, 0);
});

for (const [view, kind, error, button] of [
  ['view-signin', 'signin', 'signin-error', 'btn-signin'],
  ['view-secure-card', 'signup', 'secure-error', 'btn-secure-submit'],
  ['view-forgot-pin', 'forgot', 'forgot-error', 'btn-forgot-email'],
]) {
  test(`${kind} handles synchronous CAPTCHA failure and retries on submit`, async () => {
    const app = makeApp({ exposeTestHooks: true, turnstileResults: [new Error('blocked'), 'retry'] });
    await flush();
    assert.doesNotThrow(() => app.hooks.showAccountView(view));
    assert.match(app.elements.get(error).textContent, /security check.*refresh|security check.*reload/i);
    app.elements.get(button).click();
    await flush();
    assert.equal(app.calls.turnstile.length, 2);
    assert.ok(!app.calls.auth.some(([name]) => ['signUp', 'signInWithPassword', 'resetPasswordForEmail'].includes(name)));
  });
  test(`${kind} CAPTCHA fits its container on a 320px screen`, async () => {
    const app = makeApp({ exposeTestHooks: true, turnstileWidth: 236 });
    await flush();
    app.hooks.showAccountView(view);
    assert.equal(app.calls.turnstile.at(-1).options.size, 'compact');
    const wide = makeApp({ exposeTestHooks: true, turnstileWidth: 340 });
    await flush();
    wide.hooks.showAccountView(view);
    assert.equal(wide.calls.turnstile.at(-1).options.size, 'normal');
  });
}

for (const locationSearch of ['', '?c=KREMA1']) {
  test(`restored session reconciles linked card while keeping URL/saved precedence (${locationSearch})`, async () => {
    const app = makeApp({ savedCode: 'KREMA1', locationSearch,
      auth: { getSession: async () => ({ data: { session: customerSession }, error: null }) },
      rpc: { get_card: { data: [fixtureCard] }, get_my_card: { data: [{ ...fixtureCard, member_code: 'OTHER' }, fixtureCard] } },
    });
    await flush();
    assert.equal(app.elements.get('member-code').textContent, 'KREMA1');
    assert.ok(app.elements.get('btn-secure-card').classList.contains('hidden'));
    assert.match(app.elements.get('card-account-copy').textContent, /Signed in as bea@krema.ph/);
  });
}

test('failed linked-card reconciliation preserves display but never offers an unverified claim', async () => {
  const app = makeApp({ savedCode: 'KREMA1', auth: { getSession: async () => ({ data: { session: customerSession }, error: null }) },
    rpc: { get_card: { data: [fixtureCard] }, get_my_card: { error: { message: 'offline' } } } });
  await flush();
  assert.equal(app.elements.get('member-code').textContent, 'KREMA1');
  assert.ok(app.elements.get('btn-secure-card').classList.contains('hidden'));
  assert.match(app.elements.get('card-account-copy').textContent, /could not check|checking/i);
});

test('account views are semantic forms with only one submit route per action', async () => {
  const app = makeApp();
  await flush();
  for (const [view, button] of [['signin', 'signin'], ['secure-card', 'secure-submit'], ['claim-card', 'claim-card'], ['verify-signup', 'verify-signup'], ['forgot-pin', 'forgot-email'], ['reset-pin', 'reset-pin']]) {
    const form = app.elements.get('view-' + view);
    assert.match(page, new RegExp('<form id="view-' + view + '"'));
    assert.ok(form.listeners.has('submit'), view);
    assert.ok(!app.elements.get('btn-' + button).listeners.has('click'), view);
    assert.equal(app.elements.get('btn-' + button).submitForm, form);
  }
  const pending = deferred();
  const signin = makeApp({ auth: { signInWithPassword: () => pending.promise }, rpc: { get_my_card: { data: [fixtureCard] } } });
  await flush();
  showSignIn(signin).callback('captcha');
  signin.elements.get('signin-email').value = 'bea@krema.ph';
  signin.elements.get('signin-pin').value = '183726';
  signin.elements.get('view-signin').submit();
  signin.elements.get('view-signin').submit();
  pending.resolve({ data: { session: customerSession }, error: null });
  await flush();
  assert.equal(signin.calls.auth.filter(([name]) => name === 'signInWithPassword').length, 1);
  assert.ok(!signin.elements.get('view-card').classList.contains('hidden'));
});

test('cancelling an in-flight recovery verification cannot update the PIN or revive verified state', async () => {
  const pending = deferred();
  const app = makeApp({ auth: { verifyOtp: () => pending.promise } });
  await flush();
  await startRecovery(app);
  app.elements.get('btn-reset-pin').click();
  app.elements.get('link-reset-back').click();
  pending.resolve({ data: { session: customerSession }, error: null });
  await flush();
  assert.ok(!app.elements.get('view-signin').classList.contains('hidden'));
  assert.equal(app.calls.auth.filter(([name]) => name === 'updateUser').length, 0);
});

test('late ownership reconciliation cannot replace a new account view', async () => {
  const pending = deferred();
  const app = makeApp({ savedCode: 'KREMA1', auth: { getSession: async () => ({ data: { session: customerSession }, error: null }) },
    rpc: { get_card: { data: [fixtureCard] }, get_my_card: () => pending.promise } });
  await flush();
  showSignIn(app);
  pending.resolve({ data: [fixtureCard], error: null });
  await flush();
  assert.ok(!app.elements.get('view-signin').classList.contains('hidden'));
  assert.equal(app.calls.activeIntervals.size, 0);
});

test('a different URL card keeps precedence and is claimable only after ownership reconciliation', async () => {
  const app = makeApp({ savedCode: 'SAVED', locationSearch: '?c=KREMA1',
    auth: { getSession: async () => ({ data: { session: customerSession }, error: null }) },
    rpc: { get_card: { data: [fixtureCard] }, get_my_card: { data: [{ ...fixtureCard, member_code: 'OWNED' }] } } });
  await flush();
  assert.equal(app.elements.get('member-code').textContent, 'KREMA1');
  assert.equal(app.storage.get('krema_member_code'), 'KREMA1');
  assert.ok(!app.elements.get('btn-secure-card').classList.contains('hidden'));
  app.elements.get('btn-secure-card').click();
  assert.ok(!app.elements.get('view-claim-card').classList.contains('hidden'));
});
