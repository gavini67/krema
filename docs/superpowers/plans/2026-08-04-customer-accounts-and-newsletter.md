# Krema — customer accounts (email + 6-digit PIN) & newsletter

## Context

Two features the owner asked for:

1. **Newsletter** — email customers when new menu items launch. The footer form in `index.html` is currently **dead** (`onSubmit={(e) => e.preventDefault()}`, and the input has no `id`/`name`, so it can't even be read). Every signup is being thrown away today.
2. **Customer accounts** — email + 6-digit PIN login, with "forgot PIN" by email.

Today a customer has **no account at all**: identity is a `KREMA-XXXXXX` code in `localStorage`, or a `?c=CODE` link. Anyone who knows a customer's **phone number** can pull up their card (name + stamp count) via the anon `customer_lookup` RPC. Accounts fix that and give people a real way to recover a card on a new phone.

Three problems found while planning that change the shape of this:

- **Card hijack.** `customer_lookup(phone)` *returns the member code*, so "code + phone" is really one factor. Anyone knowing a phone could permanently claim someone's card. **Must be fixed before accounts ship.**
- **Session clash.** `rewards.html` and `staff.html` share one origin and one default Supabase storage key. A customer logging in on the counter iPad would silently log out the barista.
- **Supabase's minimum password length is 6** — a 4-digit PIN is impossible without hand-rolling auth. Owner chose **6 digits**.

### Decisions locked
- PIN = **6 digits**, implemented as a Supabase Auth *password* (never a hand-rolled column — we get hashing, rate limiting and reset emails for free).
- Existing ~7 customers **keep working via phone lookup**; they're invited to add email + PIN, never forced.
- Newsletter list lives in **Supabase**; campaigns are **sent from Brevo's dashboard**. No serverless function, no build step.
- **No `customers.email` column** — `auth.users.email` already holds it; don't keep two copies of PII.

---

## Phase 0 — Prerequisites (owner tasks, no code, blocks everything)

Nothing here is testable without working email, so do this first.

1. **Brevo account** (free tier: SMTP relay + marketing campaigns in one). Serves both PIN-reset and the newsletter.
2. **DNS at GoDaddy: SPF, DKIM, DMARC** for `kremadesserthaus.com`. Without these, Gmail/Yahoo bin the PIN-reset emails and the feature looks broken. **Test to a Gmail address before writing code.**
3. **Supabase → Auth → SMTP Settings**: point at Brevo. Send a test.
4. **CAPTCHA** — create hCaptcha or Cloudflare Turnstile keys, enable Auth → *Enable CAPTCHA protection*. Non-optional, see R1.
5. **Email templates** → Auth → Email Templates. In *Confirm signup* and *Reset password*, replace `{{ .ConfirmationURL }}` with `{{ .Token }}` so they send a **6-digit code, not a link** (see "Why OTP" below).
6. **Auth → Rate Limits** → cap emails/hour (e.g. 30).
7. **Verify frozen settings**: min password length **6**, Password Requirements = **"No required characters"**. Turn **on** "Prevent use of leaked passwords" (blocks `123456`, `000000`).
8. **Export `public.customers` to CSV** before any `ALTER`. 7 real customers with stamps.
9. Write `privacy.html` (see Phase 4).

**Why OTP, not a magic link:** a link opens in the mail app's in-app browser — a different storage context where `localStorage.krema_member_code` doesn't exist, so the customer would have to re-type their member code. A 6-digit code keeps everything in the tab they started in, and matches what they already know from GCash.

---

## Phase 1 — Security hardening (SQL only, ships alone)

Prerequisite for Phase 3. No page changes, no function-shape changes.

- **`signup_customer(p_name, p_phone)`** — today, when the phone already exists it returns that card **regardless of the name given**. Require the name to match; otherwise raise *"that number's already on a card — tap 'already have a card?'"*. Shape unchanged → plain `create or replace`.
- **Lock the internal helpers.** `krema_card(uuid)`, `krema_claimed(uuid,int)`, `krema_new_code()`, `krema_norm_phone(text)`, `krema_goal/tiers/validity()` still have Postgres's default `EXECUTE TO PUBLIC`, so anon can call them over PostgREST. `krema_card(uuid)` returns a full card for any customer UUID. Add `revoke all on function ... from public, anon, authenticated`.
- **`is_staff()`** — explicit `revoke all from public` + `grant execute to authenticated`, so `staff.html` can gate its UI.
- **`card_claim_events`** audit table `(id, customer_id, user_id, action, created_at)`, `action ∈ claim|unlink`. RLS on, zero policies, revoked. Needed by Phase 3.

---

## Phase 2 — Staff gate + session isolation (pages only)

Must land **before** public signup is re-enabled.

- `staff.html:248` and `rewards.html:271` — give each client its own storage key:
  `createClient(URL, KEY, { auth: { storageKey: 'krema-staff-auth' } })` / `'krema-customer-auth'`.
  On `rewards.html` also set `detectSessionInUrl: false` (we use OTP, and the page parses its own `?c=`). Changing the staff key logs the current barista out once — expected.
- `staff.html:441` (`handleLogin`) and `staff.html:599` (`getSession` path) — call `rpc('is_staff')` after a session exists; if false, `signOut()` + "this account isn't a staff account." Without this, any customer account can open the barista UI (every action still fails "staff only", but it looks broken).

---

## Phase 3 — Customer accounts

### SQL
- `customers.user_id uuid references auth.users(id) **on delete set null**` — never cascade; deleting an auth user must not destroy a card with stamps. **No UNIQUE constraint** (households share one email). Plain index.
- **`claim_card(p_code, p_phone)`** → returns the standard 8-column card shape. `authenticated` only, never anon.
  - no `auth.uid()` → "please log in first"
  - match on `member_code` **and** normalised phone; **one generic error** for both wrong-code and wrong-phone (don't build an oracle)
  - `user_id = auth.uid()` → **idempotent success** (retries and double-taps must not error)
  - `user_id` is someone else → "this card is already secured by another account"
  - else set `user_id`, write `card_claim_events`, return the card
- **`get_my_card()`** — same 8-column shape, `setof`, ordered `stamps desc, created_at`. Identity comes only from `auth.uid()`, never a parameter. Client uses `rows[0]` in v1.
- **`unlink_card(p_code)`** — `is_staff()` gated, audited. **Required scope, not polish** — it's the only fix for "customer claimed a card with a typo'd email."
- **`customer_lookup(p_phone, p_name)`** — new **overload** alongside the existing 1-arg version. Matches phone + case-insensitive name, and **returns zero rows once `user_id` is set** (secured cards move to email+PIN). Drop the 1-arg version a week later, not in the same deploy.

### Pages
- `rewards.html` — new views following the existing `#view-signup`/`#view-card` show-hide pattern: `#view-secure` (email + PIN + confirm), `#view-verify` (6-digit OTP), `#view-signin`, `#view-forgot`.
  - Card screen gets a "🔒 secure your card" row near `#link-start-over` (line 253), or "signed in as …" + log out.
  - `init()` (line 723) precedence becomes `?c=` → saved code → **session (`get_my_card`)** → signup. `getSession()` is async — resolve it *before* painting, or signed-in customers see a flash of the signup screen.
  - PIN inputs: `type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"`; reject non-6-digit, `000000`, `123456`, all-same.
  - Reuse the existing `showSignupError`/`hideSignupError` helpers (lines 571–579) and `normPhone` (332–338).
  - **Never reveal "that email is taken"** — Supabase returns a success with an empty `identities` array; route to sign-in with "forgot PIN?" prominent.
- **The counter path is untouched.** The card is still fetched anonymously by member code, so an unverified email never blocks someone standing at the till.

### Then
Re-enable public Auth signup — **with CAPTCHA already on** (Phase 0.4) and Phase 2 shipped.

---

## Phase 4 — Newsletter

Deliberately **no backend**. `index.html` loads no Supabase SDK today and doesn't need one — a plain `fetch` to PostgREST is ~10 lines.

- **SQL**: `newsletter_subscribers (id, email unique, source, consent_text, consented_at, consent_ip, unsub_token unique, unsubscribed_at, created_at)`. Store `lower(trim(email))`.
  - `subscribe_newsletter(p_email, p_source)` — anon. Upsert; on conflict clear `unsubscribed_at`. **Always returns success**, even on duplicate (an "already subscribed" response is an email-enumeration oracle). Capture IP via `current_setting('request.headers', true)::json ->> 'x-forwarded-for'`.
  - `unsubscribe_newsletter(p_token)` — anon, opaque token, never the email in a URL.
  - `newsletter_list()` — `is_staff()` gated, excludes unsubscribed. Safe export path.
- **`index.html` footer (lines 3468–3475)**: add `useState` to `Footer`, give the input an `id`/`name`/`required`, add an **unticked** consent checkbox, real submit handler, inline success/error. Add `SUPABASE_URL`/`SUPABASE_KEY` constants near the top of the `text/babel` script. **No new CDN script.**
- **New files**: `privacy.html` (what's collected, why, shared with Supabase/Brevo/Vercel, retention, how to request deletion) and `unsubscribe.html`. Turn the footer's dead `privacy · terms · accessibility` `<span>`s into a real link.
- **Sending**: owner exports `where unsubscribed_at is null` → imports to Brevo → sends the campaign from Brevo's editor (templates, unsubscribe footer, business address handled). Write a 5-step runbook in `HANDOFF.md`.
- **Menu tie-in**: revive the dead `badge === 'new'` branch (`index.html:2830`) so a launched item shows NEW on the site; the campaign links to `#menu`. `MENU_CATEGORIES` is hardcoded, so "new item" is already a manual deploy — no automation wanted.

**Compliance (RA 10173)** — minimum: unticked opt-in, store the exact consent sentence + timestamp + IP, working unsubscribe in every campaign, and a real privacy notice **live before the first email is collected**. Keep the newsletter list separate from `customers` — rewards email is transactional consent, newsletter is marketing consent; conflating them is the classic mistake. Not legal advice; have the owner check current NPC guidance.

---

## Deploy rules (learned the hard way — see `HANDOFF.md` §3)

1. **SQL first, pages second.** Old page + new SQL is fine; new page + old SQL is broken.
2. **Never change an existing `RETURNS TABLE` shape.** `get_my_card` and `claim_card` reuse `krema_card`'s exact 8 columns, so every `rewards.html` change is purely additive and nothing needs a simultaneous deploy. (This is why we're *not* adding a `secured` flag to the card shape in v1.)
3. **Change signatures by additive overload, then drop later.** `customer_lookup(text,text)` ships beside `customer_lookup(text)`; drop the old one a week on. Protects customers holding stale JS in a backgrounded tab.
4. Wrap any drop+create script in explicit `begin; … commit;`.

---

## Verification

**Phase 1–2**
- `select pg_get_functiondef('public.signup_customer(text,text)'::regprocedure);` — confirm the name check is live.
- From the live site console (as I did in the security test): anon `krema_card`, `krema_new_code` etc. should now fail *permission denied*.
- Sign into `staff.html` with a non-staff account → should be signed out with a clear message.
- Sign into `rewards.html` as a customer in one tab, confirm the barista session in another tab **survives**.

**Phase 3**
- Full flow on a **throwaway card** first: signup → OTP → `claim_card` → log out → log back in on a different browser → `get_my_card` returns the right card with stamps intact.
- Re-run `claim_card` twice → second call succeeds silently (idempotent).
- Try claiming an already-claimed card from a second account → clear error; then `unlink_card` from staff → claimable again.
- Confirm the **counter path still works with no session at all**: open `?c=CODE` in a private window, card renders, staff can stamp it.
- Wrong-code and wrong-phone must return the **same** message.

**Phase 4**
- Subscribe from the footer → row appears with consent text, timestamp, IP.
- Subscribe the same address twice → success both times, one row.
- Unsubscribe link → `unsubscribed_at` set; re-subscribing clears it.
- Send a real test campaign from Brevo to a Gmail address; confirm it lands in **inbox, not spam** (this is the R2 check).

---

## Risks

- **R1 🔴 Public signup + your own SMTP = your domain can email-bomb strangers.** A script hitting `signUp` with arbitrary addresses makes *your* SMTP send unsolicited mail — burning quota, sender reputation, and possibly the SMTP account (which would also kill PIN reset). **CAPTCHA is a hard requirement.**
- **R2 🔴 Deliverability is the most likely way this fails.** No SPF/DKIM/DMARC → reset emails land in spam → "the login is broken."
- **R3 Lockout support burden.** Typo'd email at signup = a card nobody can claim. `unlink_card` + a staff button + a runbook are required scope.
- **R4 PIN reuse.** People will use their ATM/GCash PIN. Say "don't reuse your bank PIN" in the copy, and keep the PIN worthless — it only ever *views* a card; every value-bearing action stays `is_staff()`-gated.
- **R5 The 7 live customers.** CSV export before any `ALTER`. `user_id` is additive and defaults to NULL, so stamps are safe — but verify.
- **R6 We're undoing a deliberate security fix.** Re-enabling public signup is necessary here, but CAPTCHA + the `staff.html` gate + the email rate limit must land **in the same change**, not "later."
- **R7 Growing PII.** Names + phones today; + emails + marketing consent after. `privacy.html` before the first email is collected.
- **R8 Free-tier ceilings** — Supabase MAU, Brevo 300/day.
- **R9 Scope.** Phases 0–3 ≈ 2–3 focused days including live testing; Phase 0 is mostly waiting on DNS and owner decisions. Newsletter ≈ half a day once the provider and privacy notice exist. **Don't start Phase 3 before Phase 0 is signed off** — it's untestable without working email.

**Never remove:** the `if not is_staff() then raise` line at the top of `add_stamp`, `claim_reward`, `staff_lookup`, `stamps_today`. Once customers are auth users, `authenticated` is an untrusted public role, and that single line is all that separates a cracked customer PIN from self-stamping. Any future RPC granted to `authenticated` needs the same check.

---

## Continuing on the Mac

```bash
git clone https://github.com/gavini67/krema.git   # or: git pull
cd krema
```

Read `HANDOFF.md` first — it has the Supabase URL/keys, the staff account, the CDN pinning rule, and the Claude-Design regression checklist. Then this plan.

Repo path differs from Windows (`~/Desktop/krema1` → wherever you clone). Everything else is identical; the site is static, so `node server.js` + a normal browser is the whole local setup.

**On approval I'll also commit this plan to `docs/` in the repo** so it travels with `git pull` instead of living only on this machine.

### Frozen settings to record in `HANDOFF.md`
Alongside the existing CDN pins:
- Supabase Auth **min password length = 6**, Password Requirements = **"No required characters"**. Changing either breaks every existing PIN and the reset flow.
- CDN pins in use: `@supabase/supabase-js@2.45.4`, `html5-qrcode@2.3.8`, `qrcode@1.5.1` (**not** 1.5.3/1.5.4 — no browser bundle), React 18.3.1, Babel 7.26.4. Any CAPTCHA script must be pinned too.
