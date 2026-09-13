// Browser integration with mocked Supabase/Turnstile boundaries; no live requests.
// npm install --prefix /tmp/krema-final-check --ignore-scripts --no-audit --no-fund playwright@1.55.0
// NODE_PATH=/tmp/krema-final-check/node_modules node tests/verify-customer-accounts-browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.fulfill({ body: '', contentType: 'text/javascript' });
      const file = url.pathname === '/rewards.html' ? 'rewards.html' : url.pathname.slice(1);
      if (!/^(rewards\.html|assets\/[\w.-]+)$/.test(file) || !fs.existsSync(path.join(root, file))) return route.fulfill({ status: 404, body: '' });
      await route.fulfill({ path: path.join(root, file) });
    });
    await context.addInitScript(() => {
      const card = { member_code: 'KREMA1', name: 'Bea', stamps: 3, goal: 20, tiers: [6, 10, 16, 20], claimed: [], reward_ready: false };
      window.checks = { auth: [], widgets: [] };
      let signedIn = false;
      const auth = {};
      for (const name of ['getSession', 'signInWithPassword', 'signUp', 'verifyOtp', 'resetPasswordForEmail', 'updateUser', 'signOut']) {
        auth[name] = async (...args) => {
          checks.auth.push([name, ...args]);
          if (['signInWithPassword', 'verifyOtp'].includes(name)) signedIn = true;
          if (name === 'signOut') signedIn = false;
          return { data: { session: signedIn ? { user: { email: 'bea@example.com' } } : null, user: { identities: [{}] } }, error: null };
        };
      }
      window.supabase = { createClient: () => ({ auth, rpc: async (name) => ({ data: name === 'get_my_card' && !signedIn ? [] : [card], error: null }) }) };
      window.QRCode = { toCanvas() {} };
      const widgets = [];
      window.turnstile = {
        render(target, options) {
          checks.widgets.push({ width: target.clientWidth, size: options.size });
          const widget = document.createElement('div');
          widget.textContent = 'Security check (test)';
          widget.style.cssText = `width:${options.size === 'compact' ? 150 : 300}px;height:${options.size === 'compact' ? 140 : 65}px;background:#eee;padding:10px`;
          target.appendChild(widget);
          widgets.push(options);
          options.callback('test-captcha');
          return String(widgets.length - 1);
        },
        reset(id) { widgets[Number(id)].callback('test-captcha'); },
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const visible = (id) => page.locator('#' + id).waitFor({ state: 'visible' });
    const fill = async (entries) => { for (const [id, value] of Object.entries(entries)) await page.locator('#' + id).fill(value); };
    const authCount = (name) => page.evaluate((name) => checks.auth.filter(([action]) => action === name).length, name);
    const fits = async (kind) => {
      const bounds = await page.locator('#captcha-' + kind).evaluate((el) => ({ parent: el.getBoundingClientRect().toJSON(), widget: el.firstChild.getBoundingClientRect().toJSON() }));
      assert.ok(bounds.widget.right <= bounds.parent.right && bounds.widget.right <= 320, `${kind} must fit at 320px`);
      assert.equal((await page.evaluate(() => checks.widgets.at(-1))).size, 'compact');
    };
    await page.goto('http://127.0.0.1:4317/rewards.html');
    await visible('view-signup');
    assert.equal(await page.locator('#lookup-phone').count(), 0);
    await page.locator('#link-sign-in').click();
    await fits('signin');
    await fill({ 'signin-email': 'bea@example.com', 'signin-pin': '183726' });
    await page.locator('#signin-pin').press('Enter');
    await visible('view-card');
    assert.equal(await authCount('signInWithPassword'), 1);
    await page.locator('#btn-customer-logout').click();
    await visible('view-signup');
    await page.goto('http://127.0.0.1:4317/rewards.html?c=KREMA1');
    await visible('view-card');
    await page.locator('#btn-secure-card').click();
    await fits('signup');
    await fill({ 'secure-email': 'bea@example.com', 'secure-phone': '09171234567', 'secure-pin': '183726', 'secure-confirm-pin': '183726' });
    await page.locator('#secure-confirm-pin').press('Enter');
    await visible('view-verify-signup');
    assert.equal(await authCount('signUp'), 1);
    await fill({ 'verify-signup-token': '12345678' });
    await page.locator('#verify-signup-token').press('Enter');
    await visible('view-card');
    assert.equal(await authCount('verifyOtp'), 1);
    await page.locator('#btn-customer-logout').click();
    await visible('view-signup');
    await page.locator('#link-sign-in').click();
    await page.locator('#link-forgot-pin').click();
    await fits('forgot');
    await fill({ 'forgot-email': 'bea@example.com' });
    await page.locator('#forgot-email').press('Enter');
    await visible('view-reset-pin');
    assert.equal(await authCount('resetPasswordForEmail'), 1);
    await fill({ 'reset-token': '12345678', 'reset-pin': '183726', 'reset-confirm-pin': '183726' });
    await page.locator('#reset-confirm-pin').press('Enter');
    await visible('view-card');
    assert.equal(await authCount('updateUser'), 1);
    assert.equal(await authCount('verifyOtp'), 2);
    assert.deepEqual(errors, []);
    console.log('PASS: Chrome 320px — sign-in, secure, verification, forgot/reset submit with Enter once; all three compact widgets fit; no page errors (mocked service boundaries)');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
