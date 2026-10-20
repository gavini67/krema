const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const setup = read('supabase-setup.sql');
const migration = read('docs/migrations/2026-10-20-owner-dashboard.sql');
const page = read('owner.html');

const normalise = (sql) => sql.replace(/\s+/g, ' ').toLowerCase();

function fnBlock(sql, signature) {
  const start = sql.indexOf(`create or replace function public.${signature}`);
  assert.notEqual(start, -1, `missing public.${signature}`);
  const m = /(end \$\$;|\n\$\$;)/g;
  m.lastIndex = start;
  const hit = m.exec(sql);
  return normalise(sql.slice(start, hit.index + hit[0].length));
}

test('migration is transactional and matches the setup schema', () => {
  const m = migration.trim();
  assert.ok(m.startsWith('begin;'));
  assert.ok(m.endsWith('commit;'));
  for (const sig of ['is_owner()', 'owner_dashboard(p_days int default 7)', 'owner_members(p_group text)']) {
    assert.equal(fnBlock(setup, sig), fnBlock(migration, sig), `${sig} differs between setup and migration`);
  }
});

test('owners are a separate locked table and every owner RPC checks is_owner first', () => {
  for (const sql of [setup, migration]) {
    const n = normalise(sql);
    assert.match(n, /create table if not exists public\.owners \( uid uuid primary key references auth\.users\(id\) on delete cascade/);
    assert.match(n, /alter table public\.owners enable row level security/);
    assert.match(n, /revoke all on table public\.owners from anon, authenticated/);
    assert.doesNotMatch(n, /create policy[^;]*owners/);
  }
  assert.match(fnBlock(setup, 'is_owner()'), /select exists \(select 1 from public\.owners o where o\.uid = auth\.uid\(\)\)/);
  for (const sig of ['owner_dashboard(p_days int default 7)', 'owner_members(p_group text)']) {
    assert.match(fnBlock(setup, sig), /^create or replace function [^$]*\$\$ declare[^]*?begin if not is_owner\(\) then raise exception 'owner only'; end if;|begin if not is_owner\(\) then raise exception 'owner only'; end if;/);
    assert.match(fnBlock(setup, sig), /security definer set search_path = public/);
  }
});

test('owner RPCs are never callable anonymously', () => {
  for (const sql of [setup, migration]) {
    const n = normalise(sql);
    for (const sig of ['is_owner()', 'owner_dashboard(int)', 'owner_members(text)']) {
      const esc = sig.replace(/[()]/g, '\\$&');
      assert.match(n, new RegExp(`revoke all on function public\\.${esc} from public, anon;`));
      assert.match(n, new RegExp(`grant execute on function public\\.${esc} to authenticated;`));
      assert.doesNotMatch(n, new RegExp(`grant execute on function public\\.${esc} to anon`));
    }
  }
});

test('dashboard excludes test cards and member groups do not overlap', () => {
  const body = fnBlock(setup, 'owner_dashboard(p_days int default 7)');
  assert.match(body, /select \* from public\.customers where not is_test/);
  assert.match(body, /'active', \(select count\(\*\) from last_visit lv where lv\.at >= now\(\) - interval '14 days'\)/);
  assert.match(body, /'cooling', \(select count\(\*\) from last_visit lv where lv\.at < now\(\) - interval '14 days' and lv\.at >= now\(\) - interval '30 days'\)/);
  assert.match(body, /'lapsed', \(select count\(\*\) from last_visit lv where lv\.at < now\(\) - interval '30 days'\)/);
  assert.match(body, /coalesce\(r\.kind, ''\) <> 'waived'/);
  const members = fnBlock(setup, 'owner_members(p_group text)');
  assert.match(members, /where not c\.is_test/);
  assert.match(members, /if p_group not in \('active', 'cooling', 'lapsed', 'never'\) then raise exception/);
});

test('owner.html uses its own session, gates on is_owner and never injects data as HTML', () => {
  assert.match(page, /storageKey: 'krema-owner-auth'/);
  assert.match(page, /detectSessionInUrl: false/);
  assert.match(page, /supabaseClient\.rpc\('is_owner'\)/);
  assert.match(page, /captchaToken: captchaToken/);
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(page, /@supabase\/supabase-js@2\.45\.4\//, 'supabase-js must stay pinned');
  const script = page.slice(page.lastIndexOf('<script>'));
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|document\.write/);
  // no staff RPCs from the owner page
  assert.doesNotMatch(script, /add_stamp|claim_reward|waive_reward/);
});
