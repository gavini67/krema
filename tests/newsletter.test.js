const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const setup = read('supabase-setup.sql');
const migration = read('docs/migrations/2026-10-14-newsletter.sql');
const index = read('index.html');
const privacy = read('privacy.html');

function normalise(sql) {
  return sql.replace(/\s+/g, ' ').toLowerCase();
}

function functionBody(sql, signature) {
  const start = sql.indexOf(`create or replace function public.${signature}`);
  assert.notEqual(start, -1, `missing public.${signature}`);
  const end = sql.indexOf('end $$;', start);
  assert.notEqual(end, -1);
  return sql.slice(start, end + 'end $$;'.length);
}

test('migration is transactional and matches the setup schema', () => {
  const m = migration.trim();
  assert.ok(m.startsWith('begin;'));
  assert.ok(m.endsWith('commit;'));
  assert.equal(
    functionBody(setup, 'subscribe_newsletter('),
    functionBody(migration, 'subscribe_newsletter('),
    'supabase-setup.sql and the migration must define the same function',
  );
});

for (const [label, sql] of [['setup', setup], ['migration', migration]]) {
  test(`${label}: subscriber table is locked down and only subscribe is anonymous`, () => {
    const n = normalise(sql);
    assert.match(n, /alter table public\.newsletter_subscribers enable row level security/);
    assert.match(n, /revoke all on table public\.newsletter_subscribers from anon, authenticated/);
    assert.doesNotMatch(n, /create policy[^;]*newsletter_subscribers/);
    assert.match(n, /revoke all on function public\.subscribe_newsletter\(text,text\) from public, anon, authenticated/);
    assert.match(n, /grant execute on function public\.subscribe_newsletter\(text,text\) to anon, authenticated/);
  });

  test(`${label}: subscribe never reveals whether an email is already listed`, () => {
    const body = normalise(functionBody(sql, 'subscribe_newsletter('));
    assert.match(body, /returns void/);
    assert.match(body, /security definer set search_path = public/);
    assert.match(body, /lower\(btrim\(/);
    assert.match(body, /on conflict \(email\) do update/);
    // Only a lapsed subscriber gets re-consented; an active row is left untouched.
    assert.match(body, /where public\.newsletter_subscribers\.unsubscribed_at is not null/);
    assert.doesNotMatch(body, /already/);
    assert.match(body, /interval '1 hour'\) >= 5/);
  });
}

test('checkbox label is the exact consent sentence the database stores', () => {
  const dbConsent = migration.match(/v_consent constant text := '([^']+)';/)[1];
  const uiConsent = index.match(/const NEWSLETTER_CONSENT = '([^']+)';/)[1];
  assert.equal(uiConsent, dbConsent);
  assert.ok(setup.includes(`v_consent constant text := '${dbConsent}';`));
});

test('footer form is live, opt-in is unticked, and privacy notice is linked', () => {
  assert.doesNotMatch(index, /onSubmit=\{\(e\) => e\.preventDefault\(\)\}/, 'dead footer form is back');
  assert.match(index, /<NewsletterForm \/>/);
  assert.match(index, /rest\/v1\/rpc\/subscribe_newsletter/);
  assert.match(index, /useState\(false\);\s*\n\s*const \[status/, 'consent must default to unticked');
  assert.doesNotMatch(index, /type="checkbox"[^>]*defaultChecked/);
  assert.match(index, /<a href="privacy\.html">privacy notice<\/a>/);
  assert.doesNotMatch(index, /privacy · terms · accessibility/);
});

test('privacy notice is filled in before launch', () => {
  assert.match(privacy, /Parqal Mall/);
  assert.match(privacy, /RA 10173|Republic Act No\. 10173/);
  assert.doesNotMatch(privacy, /\[PRIVACY-EMAIL\]/, 'privacy contact email is still a placeholder');
});
