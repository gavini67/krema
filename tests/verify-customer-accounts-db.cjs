// Isolated PostgreSQL behavior checks. Install only test tooling, outside the site:
// npm install --prefix /tmp/krema-final-check --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14
// NODE_PATH=/tmp/krema-final-check/node_modules node tests/verify-customer-accounts-db.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const read = (file) => process.env.KREMA_SQL_REF
  ? execFileSync('git', ['show', `${process.env.KREMA_SQL_REF}:${file}`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, file), 'utf8');

async function verify(applyMigration) {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    await db.exec(read('supabase-setup.sql'));
    if (applyMigration) {
      await db.exec(read('docs/migrations/2026-09-13-customer-accounts.sql'));
      await db.exec(read('docs/migrations/2026-09-13-customer-accounts.sql')); // rerunnable
    }
    const alice = '00000000-0000-4000-8000-000000000001';
    const other = '00000000-0000-4000-8000-000000000002';
    await db.query('insert into auth.users values ($1), ($2)', [alice, other]);
    await db.exec('set role anon');
    const { rows: [card] } = await db.query("select * from signup_customer('Bea', '09171234567')");
    assert.equal(card.stamps, 0);
    assert.equal(card.goal, 20);
    assert.deepEqual(card.tiers, [6, 10, 16, 20]);
    for (const linked of [false, true]) {
      if (linked) {
        await db.exec('reset role');
        await db.query('update customers set user_id = $1', [alice]);
        await db.exec('set role anon');
      }
      for (const phone of ['09171234567', '+63 917 123 4567', '9171234567', '09999999999', '', null]) {
        assert.deepEqual((await db.query('select * from customer_lookup($1)', [phone])).rows, []);
        for (const name of ['Bea', ' bea ', 'Wrong', '', null]) {
          assert.deepEqual((await db.query('select * from customer_lookup($1, $2)', [phone, name])).rows, []);
        }
      }
      for (const phone of ['09171234567', '+63 917 123 4567', '9171234567']) {
        for (const name of ['Bea', 'Wrong']) {
          await assert.rejects(db.query('select * from signup_customer($1, $2)', [name, phone]),
            { message: 'please sign in or ask staff to reopen your card' });
        }
      }
      assert.equal((await db.query('select * from get_card($1)', [card.member_code])).rows[0].member_code, card.member_code);
    }
    for (const query of ["select * from claim_card('missing', '09171234567')", 'select * from get_my_card()', "select * from staff_lookup('09171234567')"])
      await assert.rejects(db.query(query), /permission denied/);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int as count from customers')).rows[0].count, 1);
    await db.exec('update customers set user_id = null; set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [alice]);
    await assert.rejects(db.query("select * from staff_lookup('09171234567')"), /staff only/);
    await assert.rejects(db.query("select * from claim_card('wrong', '09171234567')"), /card details do not match/);
    await assert.rejects(db.query('select * from claim_card($1, $2)', [card.member_code, '09999999999']), /card details do not match/);
    for (let i = 0; i < 2; i++) {
      const claimed = await db.query('select * from claim_card($1, $2)', [card.member_code, '+639171234567']);
      assert.equal(claimed.rows[0].member_code, card.member_code);
    }
    assert.equal((await db.query('select * from get_my_card()')).rows[0].member_code, card.member_code);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [other]);
    assert.deepEqual((await db.query('select * from get_my_card()')).rows, []);
    await assert.rejects(db.query('select * from claim_card($1, $2)', [card.member_code, '09171234567']), /already secured/);
    await db.exec('reset role');
    assert.equal((await db.query("select count(*)::int as count from card_claim_events where action = 'claim'")).rows[0].count, 1);
    await db.query('insert into staff (uid) values ($1)', [other]);
    await db.exec('set role authenticated');
    assert.equal((await db.query("select * from staff_lookup('09171234567')")).rows[0].member_code, card.member_code);
    console.log(`PASS: ${applyMigration ? 'migration (applied twice)' : 'setup'} — zero-row shims, generic duplicate signup, new-card mechanics, code access, authenticated claim/idempotency/audit, ownership, staff-only lookup`);
  } finally { await db.close(); }
}
(async () => { await verify(false); await verify(true); })().catch((error) => { console.error(error); process.exitCode = 1; });
