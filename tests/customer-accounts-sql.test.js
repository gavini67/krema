const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const setupPath = path.join(root, 'supabase-setup.sql');
const migrationPath = path.join(root, 'docs/migrations/2026-09-13-customer-accounts.sql');
const setup = fs.readFileSync(setupPath, 'utf8');

function normalise(sql) {
  return sql.replace(/\s+/g, ' ').toLowerCase();
}

function functionBody(sql, signature) {
  const start = sql.indexOf(`create or replace function public.${signature}`);
  assert.notEqual(start, -1, `missing public.${signature}`);
  const end = sql.indexOf('end $$;', start);
  assert.notEqual(end, -1, `public.${signature} must end with end $$;`);
  return normalise(sql.slice(start, end + 'end $$;'.length));
}

function assertStandardCardShape(body) {
  assert.match(
    body,
    /returns table \(member_code text, name text, stamps int, goal int, tiers int\[\], claimed int\[\], expires_at timestamptz, reward_ready boolean\)/,
  );
}

test('customer account schema links cards to Auth users without exposing an email field', () => {
  const sql = normalise(setup);

  assert.match(
    sql,
    /alter table public\.customers add column if not exists user_id uuid references auth\.users\(id\) on delete set null/,
  );
  assert.match(sql, /create index if not exists customers_user_id_idx on public\.customers \(user_id\)/);
  assert.doesNotMatch(sql, /user_id uuid unique/);
  assert.doesNotMatch(sql, /alter table public\.customers add column if not exists email/);
  assert.match(sql, /alter table public\.card_claim_events enable row level security/);
  assert.doesNotMatch(sql, /create policy[^;]+card_claim_events/);
});

test('claim_card secures the matching unlocked card with an audit event and stays idempotent', () => {
  const body = functionBody(setup, 'claim_card(p_code text, p_phone text)');
  assertStandardCardShape(body);
  assert.match(body, /if auth\.uid\(\) is null then raise exception/);
  assert.match(body, /v_phone := krema_norm_phone\(p_phone\)/);
  assert.match(body, /where c\.member_code = p_code and c\.phone = v_phone for update/);
  assert.match(body, /raise exception 'card details do not match'/);
  assert.match(body, /if v_user_id = auth\.uid\(\) then return query select \* from public\.krema_card\(v_id\); return;/);
  assert.match(body, /elsif v_user_id is not null then raise exception 'this card is already secured by another account'/);
  assert.match(body, /update public\.customers c set user_id = auth\.uid\(\) where c\.id = v_id/);
  assert.match(body, /insert into public\.card_claim_events \(customer_id, user_id, action\) values \(v_id, auth\.uid\(\), 'claim'\)/);
});

test('account RPCs scope cards to the authenticated user and preserve staff unlink authorization', () => {
  const getMyCard = functionBody(setup, 'get_my_card()');
  assertStandardCardShape(getMyCard);
  assert.match(getMyCard, /if auth\.uid\(\) is null then raise exception/);
  assert.match(getMyCard, /cross join lateral public\.krema_card\(c\.id\) card where c\.user_id = auth\.uid\(\) order by c\.stamps desc, c\.created_at/);

  const unlinkCard = functionBody(setup, 'unlink_card(p_code text)');
  assertStandardCardShape(unlinkCard);
  assert.match(unlinkCard, /if not is_staff\(\) then raise exception 'staff only'; end if;/);
  assert.match(unlinkCard, /where c\.member_code = p_code for update/);
  assert.match(unlinkCard, /update public\.customers c set user_id = null where c\.id = v_id/);
  assert.match(unlinkCard, /insert into public\.card_claim_events \(customer_id, user_id, action\) values \(v_id, v_user_id, 'unlink'\)/);
});

test('customer lookup and signup do not disclose secured cards', () => {
  const phoneLookup = functionBody(setup, 'customer_lookup(p_phone text)');
  assert.match(phoneLookup, /c\.user_id is null/);

  const namedLookup = functionBody(setup, 'customer_lookup(p_phone text, p_name text)');
  assert.match(namedLookup, /v_phone := krema_norm_phone\(p_phone\)/);
  assert.match(namedLookup, /lower\(trim\(c\.name\)\) = lower\(trim\(p_name\)\)/);
  assert.match(namedLookup, /c\.user_id is null/);

  const signup = functionBody(setup, 'signup_customer(p_name text, p_phone text)');
  assert.match(signup, /elsif v_user_id is not null then raise exception 'this card is already secured — sign in to continue'/);
});

test('only the permitted RPCs remain anonymous and the migration is transactional', () => {
  const sql = normalise(setup);
  for (const signature of [
    'claim_card(text,text)',
    'get_my_card()',
    'unlink_card(text)',
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${signature.replace(/[()]/g, '\\$&')} from public, anon`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${signature.replace(/[()]/g, '\\$&')} to authenticated`));
    assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${signature.replace(/[()]/g, '\\$&')} to anon`));
  }
  assert.match(sql, /grant execute on function public\.customer_lookup\(text,text\) to anon, authenticated/);

  const migration = normalise(fs.readFileSync(migrationPath, 'utf8')).trim();
  assert.match(migration, /begin;/);
  assert.ok(migration.endsWith('commit;'));
  assert.match(migration, /create or replace function public\.claim_card\(p_code text, p_phone text\)/);
  assert.match(migration, /grant execute on function public\.customer_lookup\(text,text\) to anon, authenticated/);
});
