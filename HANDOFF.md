# Krema — full project handoff

Context dump to continue on another machine. Everything below is current as of the last commit on `main`.

## 1. What this repo is
Two things live in this one repo (`github.com/gavini67/krema`, deployed on Vercel → **kremadesserthaus.com**, DNS via GoDaddy):

1. **The main marketing site** — `index.html`. A single self-contained file: React 18 + ReactDOM + `@babel/standalone` loaded from CDN, all JSX inline in one `<script type="text/babel">`, compiled in the browser. **No build step.**
2. **Krema Rewards** (loyalty punch card) — `rewards.html` (customer) + `staff.html` (staff). Plain static HTML/CSS/JS, no build step. Backed by **Supabase**.

Live URLs:
- `https://kremadesserthaus.com` — main site
- `https://kremadesserthaus.com/rewards.html` — customer rewards card
- `https://kremadesserthaus.com/staff.html` — barista page

## 2. Continue on the Mac
```bash
git clone https://github.com/gavini67/krema.git
cd krema
# local preview (static server on :3000):
node server.js       # then open http://localhost:3000/rewards.html etc.
```
Push to `main` → Vercel auto-deploys (~30s). Hard-refresh / private tab to skip cache.

⚠️ A local preview **cannot reach Supabase or external CDNs from a sandboxed tool**, but a *normal* browser on your Mac can — so test rewards/staff by opening the real localhost URL in your own browser, or just on the live site.

## 3. Krema Rewards — how it works
Digital "buy N, get one free" punch card. Replaces a paper card.

**Mechanic (locked):**
- 11-slot card. Counter shows `X / 11`.
- **First stamp free** on signup.
- **6 stamps** → 10% off voucher unlocked (spendable until redeemed).
- **11 stamps** → free drink. Staff redeems → card resets to 0, cycle repeats.
- **1 free-drink redeem per customer per day** (discount has no daily limit).
- Only **staff** can add stamps / redeem. Enforced server-side (see §5).

**Customer flow:** open `/rewards.html` → sign up (name + phone) → get a card with a QR + member code (e.g. `KREMA-1234`), remembered on the phone (localStorage stores only the member code). Card auto-refreshes every 4s + on focus, so staff stamps show up live.

**Staff flow:** open `/staff.html` → log in (Supabase Auth) → scan customer QR (html5-qrcode camera) or phone-lookup fallback → add stamp / redeem / redeem discount.

## 4. Supabase (the backend)
- Project: **kremadesserthaus** (Free tier, region: Seoul / ap-northeast-2)
- Org owner email on the dashboard: **stevencochua@gmail.com** (note: different from the main Google/site account)
- **URL:** `https://skwppxosekdctjtxxvme.supabase.co`
- **Publishable (anon) key** (public-safe, embedded in `rewards.html` + `staff.html`):
  `sb_publishable_ftoEouVkkZUVkLWPQ4XQdA_nV0X8hha`
- 🔒 **NEVER** commit or expose the **`service_role` / secret** key or the **DB password**. They bypass all security. Not in this repo — keep it that way.

**Schema:** `supabase-setup.sql` (in this repo) — already run once in the SQL Editor. Tables: `customers`, `redemptions`, `staff`. All tables have RLS on with **no policies** → no direct client access; every read/write goes through `SECURITY DEFINER` functions:
`signup_customer`, `get_card` (anon) · `add_stamp`, `redeem`, `redeem_discount`, `staff_lookup` (staff-only, checked via `is_staff()` = uid present in `public.staff`).

**Staff login setup (REQUIRED for staff.html to work — verify this is done):**
1. Supabase → Authentication → Users → Add user → email `crew@krema.ph` + password, **Auto Confirm** on.
2. Copy that user's UID → SQL Editor:
   ```sql
   insert into public.staff (uid) values ('THE-UID');
   ```
Only uids in `public.staff` can stamp/redeem.

## 5. State of play — DONE
- Main site: brand fonts/colors, real photoshoot photos, 39 Google reviews, real Google review cards, community section with 6 REAL tagged Instagram embeds, TikTok `@kremaph`, "Mango Graham" featured bingsu, Vercel Analytics, mobile redesign (hamburger nav), mobile ticker 20s + overscroll fix.
- Rewards Phase 1 (frontend, localStorage) → then Phase 2 (wired to Supabase).
- QR scannability fix (removed decorative corner squares that masked finder patterns, added quiet-zone margin, enlarged to 144px).

Latest commit: `478ad8b` (QR fix). Recent: `e4c6a71` supabase wire · `2b21e8c` rewards frontend · `1054835` mobile nav.

## 6. State of play — PENDING / TODO
- [ ] **Verify the QR is now scannable on a phone** (just fixed; awaiting confirmation). If the QR box is *blank* white → the `qrcode@1.5.4` lib isn't loading; check the CDN path / add a fallback. Member code + phone-lookup are the backups.
- [ ] **Confirm staff auth user exists** in Supabase (§4). Without it, staff login fails.
- [ ] **"Rewards" nav link** on the main site (`index.html`) — not added yet; `/rewards.html` is currently only reachable by direct URL.
- [ ] **Undo stamp** — not implemented (no server undo RPC; the button was removed). If wanted: add an `undo_stamp` SECURITY DEFINER function (careful with the discount recompute) + re-add the button.
- [ ] **Customer "recent stamps" history** — hidden; the RPCs don't return history yet.
- [ ] Real camera QR *decode* is wired (html5-qrcode) but only tested statically — verify on a phone (needs HTTPS + camera permission; Vercel gives HTTPS).

## 7. GOTCHAS / house rules (important)
- **CDN PINNING — never use `@latest` / unpinned.** On 2026-06-26 an unpinned `@babel/standalone` auto-upgraded to Babel 8 and blanked the whole site (Babel 8 injects ES imports illegal in `text/babel`). Pinned versions in use: Babel `7.26.4`, React/ReactDOM `18.3.1`, `@supabase/supabase-js@2.45.4`, `html5-qrcode@2.3.8`, `qrcode@1.5.4`.
- **Claude Design exports regress the same fixes every time.** When applying a new `*.dc.html` / design export over `index.html`, it re-exports from an older base and wipes: (1) featuredBingsu → resets to "Mango Magic" (should be **Mango Graham**, +price/desc), (2) community Instagram → fabricates FAKE posts (real handles: `rib.onn_`, `anna_marssss`, `chayincafes`, `thefoodieatty`, `mitchyko78`, `meagannochii` with real `instagram.com/p/...` permalinks), (3) mobile ticker → resets 20s→40s, (4) drops the `overscroll-behavior-x:none` + IG-iframe clamp. Always `git diff` a fresh export and treat everything except the intended change as a regression to revert.
- **Preview/screenshot tools are network-isolated** — they can't load Google Fonts, jsdelivr, Supabase, or Instagram embeds, so screenshots hang and backend calls fail *in the tool*. Verify via DOM checks or on the live site / a real browser.
- **Model routing preference:** plan/debug on Opus, delegate big mechanical builds to a Sonnet subagent, do tiny edits inline. (This is in the user's global CLAUDE.md.)
- **Design prompts:** feed Claude Design EXACT tokens (hex, px, font names, voice), never adjectives — that's why the on-brand prompts produced good output and vague ones looked generic. Brand: navy `#2b3a66`, yellow `#FCEC60`/`#f0d820`, cream `#FEFFE6`, blue `#76B3D0`/`#d4e8f5`, purple `#9F8FEA`; fonts Neighbor (display) / Fraunces (body, New Spirit stand-in) / Bukhari Script (accents); voice = Gen-Z Taglish ("bestie", "tara, treat yo' self").

## 8. Fonts note (unresolved)
Headings want **Neighbor** (Adobe-only, no self-host) and body wants **New Spirit** (Adobe/Newlyn paid). Currently Neighbor falls back to system-ui and **Fraunces** stands in for New Spirit. Real fix needs an Adobe CC / Typekit kit (Neighbor can't be self-hosted at all).
