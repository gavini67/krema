# Returning-customer login + empty-card signup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let returning customers pull up their card by phone number (and via a bookmarkable link), and make new signups start empty so staff add the first stamp.

**Architecture:** Static single-file frontend (`rewards.html`, no build step) calling Supabase `SECURITY DEFINER` RPCs. Add one anon RPC (`customer_lookup`), tweak one (`signup_customer`), and extend the `rewards.html` landing screen + init flow. No new libraries.

**Tech Stack:** Plain HTML/CSS/vanilla JS, `@supabase/supabase-js@2.45.4` (already loaded), Supabase Postgres RPCs, Vercel static hosting.

## Global Constraints

- **No test framework exists** (static site, no build). "Tests" are concrete manual/DB verifications: `pg_get_functiondef`, RPC calls, browser DOM checks, live-site scenarios. Do not scaffold a test runner.
- **The build agent cannot apply Supabase SQL** (no `service_role` key, by design). Every DB task produces an exact SQL block that **the human operator runs in the Supabase SQL Editor**, then confirms. The agent edits `supabase-setup.sql` (source of truth) so the two stay in sync.
- **CDN pins are frozen** — never touch/upgrade: `qrcode@1.5.1`, `@supabase/supabase-js@2.45.4`. (qrcode MUST stay 1.5.1; 1.5.3/1.5.4 have no browser bundle.)
- **Brand tokens (verbatim):** navy `#2b3a66`, yellow `#FCEC60`/`#f0d820`, cream `#FEFFE6`, blue `#dcebf7`/`#7db9dd`, purple `#9F8FEA`, muted `#8695ba`/`#4a5a8a`. Fonts: Neighbor (display), Fraunces (body), Bukhari Script (accent).
- **Reward thresholds stay 11 / 6** (`krema_goal()`=11, `krema_discount_at()`=6). Do not change.
- **Deploy = push to `main`** → Vercel auto-deploys (~30s). Live site is `www.kremadesserthaus.com` (apex 308-redirects to www; test the www URL and follow redirects).
- **Supabase (public-safe):** URL `https://skwppxosekdctjtxxvme.supabase.co`, anon key `sb_publishable_ftoEouVkkZUVkLWPQ4XQdA_nV0X8hha`. Never add the secret/service_role key.

---

### Task 1: Empty-card signup + remove "first stamp free" copy

**Files:**
- Modify: `supabase-setup.sql` (function `signup_customer`, ~line 90; comments ~lines 7, 72)
- Modify: `rewards.html` (signup hero span ~line 76; signup subtitle ~line 95)

**Interfaces:**
- Produces: `signup_customer(p_name, p_phone)` now creates cards at `stamps=0, lifetime=0`. Card shape unchanged (7 cols: member_code, name, stamps, goal, discount_at, discount_available, reward_ready).

- [ ] **Step 1: Edit `supabase-setup.sql` — signup starts empty**

In `signup_customer`, change the insert values line from:
```sql
    values (v_code, p_name, p_phone, 1, 1);            -- first stamp free
```
to:
```sql
    values (v_code, p_name, p_phone, 0, 0);            -- empty card; staff add the first stamp
```
Also update the two comments to match: line ~7 `-- first stamp free on signup · 1 free-drink redeem per day.` → `-- empty card on signup · 1 free-drink redeem per day.`; line ~72 `-- ── Customer signup (anon) — first stamp free ─...` → `-- ── Customer signup (anon) — empty card ─...`.

- [ ] **Step 2: Edit `rewards.html` — remove the freebie copy**

Delete the "№1 is on us" span (~line 76):
```html
            <span style="font-family:'Fraunces',Georgia,serif;font-size:11px;font-style:italic;color:#cdd6ef;margin-left:4px;">№1 is on us</span>
```
Replace the signup subtitle (~line 95):
```html
        <div style="text-align:center;font-family:'Fraunces',Georgia,serif;font-size:14px;font-style:italic;color:#4a5a8a;">first stamp's on us when you join &#10024;</div>
```
with:
```html
        <div style="text-align:center;font-family:'Fraunces',Georgia,serif;font-size:14px;font-style:italic;color:#4a5a8a;">free to join — start collecting stamps &#10024;</div>
```

- [ ] **Step 3: Produce the SQL block for the operator to run**

Hand this to the human to paste into Supabase → SQL Editor and Run:
```sql
CREATE OR REPLACE FUNCTION public.signup_customer(p_name text, p_phone text)
  RETURNS TABLE(member_code text, name text, stamps integer, goal integer,
                discount_at integer, discount_available boolean, reward_ready boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_code text;
begin
  p_name  := trim(p_name);
  p_phone := trim(p_phone);
  if length(p_name) < 1 or length(p_phone) < 5 then
    raise exception 'name and phone required';
  end if;
  select c.member_code into v_code from public.customers c where c.phone = p_phone;
  if v_code is null then
    v_code := krema_new_code();
    insert into public.customers (member_code, name, phone, stamps, lifetime)
    values (v_code, p_name, p_phone, 0, 0);
  end if;
  return query
    select c.member_code, c.name, c.stamps, krema_goal(), krema_discount_at(),
           c.discount_available, (c.stamps >= krema_goal())
    from public.customers c where c.member_code = v_code;
end $function$;
```

- [ ] **Step 4: Verify the DB change is live** (operator, in SQL Editor)

Run: `select pg_get_functiondef('public.signup_customer(text,text)'::regprocedure);`
Expected: the insert line reads `values (v_code, p_name, p_phone, 0, 0)`.

- [ ] **Step 5: Commit + push the frontend copy change**

```bash
git add rewards.html supabase-setup.sql
git commit -m "feat(rewards): empty card on signup; staff add the first stamp"
git push origin main
```

- [ ] **Step 6: Verify on live** — open `https://www.kremadesserthaus.com/rewards.html` in a fresh/incognito tab, sign up with a NEW phone number. Expected: card shows **0/11**, no auto stamp, no "on us" copy anywhere.

---

### Task 2: `customer_lookup(phone)` anon RPC

**Files:**
- Modify: `supabase-setup.sql` (add function after `get_card`, ~line 109; add revoke/grant near the permissions block ~lines 205-218)

**Interfaces:**
- Produces: `customer_lookup(p_phone text)` → returns the 7-col card shape (NO phone column) for the matching phone, or **zero rows** if none. Anon-callable. Never creates a customer.

- [ ] **Step 1: Add the function to `supabase-setup.sql`** (immediately after the `get_card` function block)

```sql
-- ── Get card by phone (anon — returning customer retrieving their card) ──
--  Returns the card shape WITHOUT the phone (never echo phone to an anon
--  caller). Zero rows when not found. Does NOT create a customer.
create or replace function public.customer_lookup(p_phone text)
  returns table (member_code text, name text, stamps int, goal int,
                 discount_at int, discount_available boolean, reward_ready boolean)
  language plpgsql security definer set search_path = public as $$
begin
  return query
    select c.member_code, c.name, c.stamps, krema_goal(), krema_discount_at(),
           c.discount_available, (c.stamps >= krema_goal())
    from public.customers c where c.phone = trim(p_phone);
end $$;
```

- [ ] **Step 2: Add permissions** (in the permissions block, alongside the other `get_card` grants ~lines 207/214)

```sql
revoke all on function public.customer_lookup(text)       from public;
grant execute on function public.customer_lookup(text)    to anon, authenticated;
```

- [ ] **Step 3: Produce the SQL block for the operator to run** (the function from Step 1 + the two grant lines from Step 2, pasted together into the SQL Editor and Run).

- [ ] **Step 4: Verify the function exists + behaves** (operator, SQL Editor)

Run (replace with a real existing phone):
```sql
select * from public.customer_lookup('09XXXXXXXXX');   -- existing phone → 1 row, no phone column
select * from public.customer_lookup('00000');         -- unknown → 0 rows
```
Expected: existing phone returns exactly one row with `member_code, name, stamps, goal, discount_at, discount_available, reward_ready` and **no phone field**; unknown returns 0 rows.

- [ ] **Step 5: Commit**

```bash
git add supabase-setup.sql
git commit -m "feat(db): add anon customer_lookup(phone) RPC"
git push origin main
```

---

### Task 3: "Already have a card?" phone lookup — UI + wiring

**Files:**
- Modify: `rewards.html` (markup inside `#view-signup`, after `#signup-error` ~line 93; JS: add `handleLookup`, wire in `init` ~line 478)

**Interfaces:**
- Consumes: `customer_lookup` RPC (Task 2); existing `saveCode`, `renderCard`, `startPolling`, `currentCard`.
- Produces: `handleLookup(e)` handler; DOM ids `#lookup-phone`, `#btn-lookup`, `#lookup-error`.

- [ ] **Step 1: Add the lookup markup** inside `#view-signup`, immediately after the signup subtitle div (the "free to join…" line from Task 1):

```html
        <!-- returning customer: phone-only "welcome back" lookup -->
        <div style="display:flex;align-items:center;gap:12px;margin-top:2px;">
          <div style="flex:1;height:2px;background:repeating-linear-gradient(90deg,#8695ba 0 6px,transparent 6px 12px);"></div>
          <span style="font-family:'Neighbor',system-ui,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.18em;color:#8695ba;">OR</span>
          <div style="flex:1;height:2px;background:repeating-linear-gradient(90deg,#8695ba 0 6px,transparent 6px 12px);"></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:9px;">
          <span style="font-family:'Fraunces',Georgia,serif;font-weight:700;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#4a5a8a;">already have a card?</span>
          <div style="display:flex;gap:10px;">
            <input id="lookup-phone" type="tel" placeholder="09XX XXX XXXX" style="flex:1;min-width:0;padding:14px 16px;font-size:16px;color:#2b3a66;background:#FEFFE6;border:2.5px solid #2b3a66;border-radius:16px;box-shadow:inset 0 2px 0 rgba(255,255,255,0.6);outline:none;">
            <button id="btn-lookup" style="flex:none;padding:0 20px;font-family:'Fraunces',Georgia,serif;font-weight:700;font-size:15px;background:#dcebf7;color:#2b3a66;border:2.5px solid #2b3a66;border-radius:16px;box-shadow:inset 0 2px 0 rgba(255,255,255,0.6),4px 5px 0 #2b3a66;cursor:pointer;">find</button>
          </div>
          <div id="lookup-error" class="hidden" style="text-align:center;font-family:'Fraunces',Georgia,serif;font-size:13px;font-style:italic;color:#c0392b;"></div>
        </div>
```

- [ ] **Step 2: Add the `handleLookup` function** (in the `<script>`, next to `handleJoin`):

```javascript
  function handleLookup(e) {
    if (e) e.preventDefault();
    $('lookup-error').classList.add('hidden');
    var input = $('lookup-phone');
    var phone = (input.value || '').trim();
    if (phone.length < 5) {
      input.focus();
      input.style.borderColor = '#c0392b';
      return;
    }
    input.style.borderColor = '#2b3a66';
    var btn = $('btn-lookup');
    btn.disabled = true;
    supabaseClient.rpc('customer_lookup', { p_phone: phone }).then(function (res) {
      if (res.error) throw res.error;
      var rows = res.data;
      if (!rows || rows.length === 0) {
        $('lookup-error').textContent = 'no card with that number yet — join below!';
        $('lookup-error').classList.remove('hidden');
        $('cust-phone').value = phone;   // prefill the join form
        $('cust-name').focus();
        return;
      }
      var card = rows[0];
      saveCode(card.member_code);
      currentCard = card;
      renderCard(card);
      startPolling(card.member_code);
    }).catch(function (err) {
      $('lookup-error').textContent = (err && err.message) || 'lookup failed — try again';
      $('lookup-error').classList.remove('hidden');
    }).finally(function () {
      btn.disabled = false;
    });
  }
```

- [ ] **Step 3: Wire the button** in `init()` (after the existing `btn-join` listener ~line 478):

```javascript
    $('btn-lookup').addEventListener('click', handleLookup);
```

- [ ] **Step 4: Verify on live** (after commit+push). In a fresh/incognito tab at `https://www.kremadesserthaus.com/rewards.html`:
  - Enter an existing customer's phone → **their card loads** (correct name + stamp count).
  - Enter an unknown number → inline message "no card with that number yet — join below!" and the join form's phone is prefilled.
  - Confirm no console errors.

- [ ] **Step 5: Commit + push**

```bash
git add rewards.html
git commit -m "feat(rewards): returning-customer phone lookup on the signup screen"
git push origin main
```

---

### Task 4: Bookmarkable `?c=` card link + bookmark hint

**Files:**
- Modify: `rewards.html` (JS: add `getCodeFromUrl`, update `init` precedence ~lines 481-486; markup: add a bookmark hint in `#view-card`)

**Interfaces:**
- Consumes: existing `getSavedCode`, `saveCode`, `fetchAndRenderCard`, `showSignup`.
- Produces: `getCodeFromUrl()` → uppercased member code from `?c=` or `null`; load precedence `?c=` → saved → signup.

- [ ] **Step 1: Add the URL parser** (near `getSavedCode`):

```javascript
  function getCodeFromUrl() {
    try {
      var m = (window.location.search || '').match(/[?&]c=([^&]+)/);
      return m ? decodeURIComponent(m[1]).toUpperCase() : null;
    } catch (e) { return null; }
  }
```

- [ ] **Step 2: Update `init()`** load precedence. Replace:

```javascript
    var savedCode = getSavedCode();
    if (savedCode) {
      fetchAndRenderCard(savedCode, true);
    } else {
      showSignup();
    }
```
with:
```javascript
    var urlCode = getCodeFromUrl();
    var code = urlCode || getSavedCode();
    if (code) {
      if (urlCode) saveCode(urlCode);
      fetchAndRenderCard(code, true);
    } else {
      showSignup();
    }
```
(A bad `?c=` falls through `fetchAndRenderCard`'s initial-load catch → `clearCode()` + `showSignup()`, so no blank card.)

- [ ] **Step 3: Add a subtle bookmark hint** in `#view-card`. Add right after the member-code / QR block (near `#qr-hint-normal`), styled muted:

```html
          <div style="text-align:center;font-family:'Fraunces',Georgia,serif;font-size:11px;font-style:italic;color:#8695ba;margin-top:10px;">tip: bookmark this page so your card is always one tap away</div>
```

- [ ] **Step 4: Verify on live** (after commit+push):
  - Open `https://www.kremadesserthaus.com/rewards.html?c=KREMA-XXXX` (a real code) in a fresh/incognito tab → that card loads and is remembered on reload (drop the `?c=` and refresh → same card).
  - Open `?c=KREMA-0000` (nonexistent) → falls back to the signup screen, no blank card.

- [ ] **Step 5: Commit + push**

```bash
git add rewards.html
git commit -m "feat(rewards): bookmarkable ?c= card link + bookmark hint"
git push origin main
```

---

### Task 5: Update HANDOFF.md + full-loop live verification

**Files:**
- Modify: `HANDOFF.md` (§3 mechanic; note the new lookup + link)

- [ ] **Step 1: Update `HANDOFF.md` §3.** Change "**First stamp free** on signup." to "**Empty card** on signup (0/11); staff add the first stamp on the first purchase." Add a bullet: "Returning customers retrieve their card by **phone number** (`customer_lookup` anon RPC) or a bookmarkable `rewards.html?c=KREMA-XXXX` link — no password/PIN (see the login design spec)."

- [ ] **Step 2: Full-loop live test** on `www.kremadesserthaus.com` (real browser + phone):
  1. New signup → card **0/11**, no freebie copy.
  2. Staff (`keionchua@gmail.com`) scans/looks up → **+ add stamp** → 1/11; customer card auto-updates (~4s).
  3. Stamp to 6 → "apply 10% off" works (no ambiguity error).
  4. Stamp to 11 → "redeem free drink" resets to 0 (no ambiguity error).
  5. New device → "already have a card?" → phone → card loads.
  6. `?c=` link in fresh browser → card loads.

- [ ] **Step 3: Commit + push**

```bash
git add HANDOFF.md
git commit -m "docs: update handoff for empty-card signup + returning-customer login"
git push origin main
```

---

## Notes for the executor

- Tasks 1 & 2 have a **human-in-the-loop DB step** (running SQL in Supabase) — pause and hand over the SQL block, wait for the operator's "done + verified" before relying on it end-to-end. Frontend code (Tasks 3-4) can be written before the DB is applied, but its live verification depends on Tasks 1-2 being applied first.
- Preview/screenshot tools are network-isolated (can't reach Supabase/CDNs) — verify via the live site in a real browser, not the sandbox preview.
- Watch the Claude-Design regression list if `index.html` is ever touched (it isn't in this plan).
