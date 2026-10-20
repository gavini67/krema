const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const setup = read('supabase-setup.sql');
const migration = read('docs/migrations/2026-10-20-same-day-reward-expiry.sql');

const normalise = (sql) => sql.replace(/\s+/g, ' ').toLowerCase();

function fnBlock(sql, signature) {
  const start = sql.indexOf(`create or replace function public.${signature}`);
  assert.notEqual(start, -1, `missing public.${signature}`);
  const m = /(end \$\$;|\n\$\$;)/g;
  m.lastIndex = start;
  const hit = m.exec(sql);
  assert.ok(hit, `public.${signature} has no end`);
  return normalise(sql.slice(start, hit.index + hit[0].length));
}

const CARD_FUNCTIONS = [
  'krema_card(p_id uuid)',
  'signup_customer(p_name text, p_phone text)',
  'get_card(p_code text)',
  'customer_lookup(p_phone text)\n',
  'customer_lookup(p_phone text, p_name text)',
  'claim_card(p_code text, p_phone text)',
  'get_my_card()',
  'unlink_card(p_code text)',
  'add_stamp(p_code text)',
  'claim_reward(p_code text, p_tier int)',
  'waive_reward(p_code text, p_tier int)',
  'staff_lookup(p_phone text)',
];

test('migration is transactional and drops every card function before recreating it', () => {
  const m = migration.trim();
  assert.ok(m.startsWith('begin;'));
  assert.ok(m.endsWith('commit;'));
  for (const sig of ['krema_card(uuid)', 'add_stamp(text)', 'claim_reward(text,int)', 'waive_reward(text,int)',
    'get_card(text)', 'signup_customer(text,text)', 'customer_lookup(text)', 'customer_lookup(text,text)',
    'claim_card(text,text)', 'get_my_card()', 'unlink_card(text)', 'staff_lookup(text)']) {
    assert.ok(migration.includes(`drop function if exists public.${sig};`), `migration must drop ${sig}`);
  }
});

test('setup and migration define identical card functions with the expired column', () => {
  for (const sig of [...CARD_FUNCTIONS, 'krema_expired(p_id uuid)', 'krema_roll_cycle(p_id uuid)', 'krema_expiry_start()']) {
    assert.equal(fnBlock(setup, sig), fnBlock(migration, sig), `${sig.trim()} differs between setup and migration`);
  }
  for (const sig of CARD_FUNCTIONS) {
    assert.match(fnBlock(setup, sig), /reward_ready boolean, expired int\[\]\)/, `${sig.trim()} must return expired[]`);
  }
});

test('rule starts on 2026-10-21 Manila time and legacy stamps never expire', () => {
  assert.match(fnBlock(setup, 'krema_expiry_start()'), /select date '2026-10-21'/);
  const body = fnBlock(setup, 'krema_expired(p_id uuid)');
  assert.match(body, /at time zone 'asia\/manila'\)::date >= krema_expiry_start\(\)/);
  assert.match(body, /at time zone 'asia\/manila'\)::date < \(now\(\) at time zone 'asia\/manila'\)::date/);
  // stamps without a stamp_events row are the oldest ones and are skipped
  assert.match(body, /join ev on c\.stamps - ev\.total \+ ev\.n = t/);
  assert.match(body, /not \(t = any \(krema_claimed\(c\.id, c\.cycle_seq\)\)\)/);
});

test('staff mutations roll an expired card first and refuse expired rewards', () => {
  for (const sig of ['add_stamp(p_code text)', 'claim_reward(p_code text, p_tier int)', 'waive_reward(p_code text, p_tier int)']) {
    const body = fnBlock(setup, sig);
    assert.match(body, /if not is_staff\(\) then raise exception 'staff only'; end if;/, `${sig} lost its staff check`);
    assert.match(body, /perform krema_roll_cycle\(v_id\)/, `${sig} must roll an expired card`);
    assert.match(body, /for update/, `${sig} must lock the card row`);
  }
  const claim = fnBlock(setup, 'claim_reward(p_code text, p_tier int)');
  assert.match(claim, /if p_tier = any \(v_expired\) then raise exception 'reward expired/);
  assert.match(claim, /and not \(t = any \(v_expired\)\);/, 'expired lower tiers must not block the bingsu');
  assert.match(fnBlock(setup, 'waive_reward(p_code text, p_tier int)'), /raise exception 'reward already expired'/);
  const card = fnBlock(setup, 'krema_card(p_id uuid)');
  assert.match(card, /case when krema_goal\(\) = any \(c\.exp\) then 0 else c\.stamps end/);
  assert.match(card, /and not \(krema_goal\(\) = any \(c\.exp\)\)\)/);
});

test('new helpers are never callable by clients and anon access is unchanged', () => {
  for (const sql of [setup, migration]) {
    const n = normalise(sql);
    for (const helper of ['krema_expiry_start()', 'krema_expired(uuid)', 'krema_roll_cycle(uuid)', 'krema_card(uuid)']) {
      assert.match(n, new RegExp(`revoke all on function public\\.${helper.replace(/[()]/g, '\\$&')} from public, anon, authenticated`));
      assert.doesNotMatch(n, new RegExp(`grant execute on function public\\.${helper.replace(/[()]/g, '\\$&')}`));
    }
  }
  const anonGrants = normalise(migration).match(/grant execute on function public\.[a-z_]+\([a-z,]*\) to anon/g) || [];
  assert.deepEqual(anonGrants.map((g) => g.split('public.')[1].split(' ')[0]).sort(), [
    'customer_lookup(text)', 'customer_lookup(text,text)', 'get_card(text)', 'signup_customer(text,text)',
  ]);
});

function loadDeriveState(file) {
  const src = read(file);
  const start = src.indexOf('function deriveState(c) {');
  assert.notEqual(start, -1, `${file} has no deriveState`);
  const end = src.indexOf('\n  }\n', start);
  const ctx = { GOAL: 20, TIERS: [6, 10, 16, 20] };
  vm.runInNewContext(`${src.slice(start, end + 4)}; this.deriveState = deriveState;`, ctx);
  return ctx.deriveState;
}

for (const file of ['staff.html', 'rewards.html']) {
  test(`${file}: expired tiers are never offered as pending`, () => {
    const derive = loadDeriveState(file);
    const base = { goal: 20, tiers: [6, 10, 16, 20], claimed: [10], reward_ready: false };
    const s = derive({ ...base, stamps: 17, expired: [6] });
    assert.deepEqual([...s.pending], [16]);
    assert.deepEqual([...s.expired], [6]);
    // older server responses without the column still work
    assert.deepEqual([...derive({ ...base, stamps: 17 }).pending], [6, 16]);
  });
}

test('rewards.html explains expired treats and the reset card', () => {
  const page = read('rewards.html');
  assert.match(page, /id="expired-note"/);
  assert.match(page, /your free bingsu expired/);
  assert.match(page, /treats expire at midnight on the day you earn them/);
  const staff = read('staff.html');
  assert.match(staff, /id="result-expired-note"/);
  assert.match(staff, /treats must be claimed the day they're earned/);
});
