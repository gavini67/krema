# Owner dashboard — design

**Approved:** 2026-10-20 (mockups + Design canvas https://claude.ai/artifact/T7qqELNHSXa13owC4Nz8vV)

## Why
The shop owner wants to see how Krema Club is doing — on a Mac and on a phone —
without opening Supabase or claude.ai. The existing "Krema Club report" dashboard
only works for someone with the Supabase connector in claude.ai; it stays as the
deeper analysis tool.

## Goals
- `kremadesserthaus.com/owner.html`: a private, read-only page in the Krema look
  (cream ground, navy outlined cards with offset shadow, yellow/sky/lilac/pink
  tiles, logo + mascot stickers) using **Inter** for all text — the owner asked
  for easy-to-read type, not the display fonts.
- Mobile-first; spreads to a multi-column grid on a Mac.
- Live from the same Supabase DB as the rewards cards.

## Non-goals / anti-goals
- No stamping, claiming or editing — that stays on `staff.html`.
- Baristas must NOT be able to see it (it shows every member's name and phone).
- No new build step, no new CDN libraries beyond what staff.html already pins.

## Access (decided by the user)
- A **separate owner login**, not the shared barista login `kremaphilippines@gmail.com`.
- The owner will create a Gmail (planned `kremaowner@gmail.com`) later; the account
  is created in Supabase Auth by the user (password typed by them), then its uid is
  inserted into `public.owners`. Until then nobody can see owner data. The inbox
  MUST exist before the account is created (the rewards page's forgot-PIN flow can
  send a reset to any account email).
- DB: `public.owners (uid uuid pk → auth.users on delete cascade)`, RLS on, no
  policies. `is_owner()` security definer, executable by `authenticated` only.
  Every owner RPC starts with `if not is_owner() then raise exception 'owner only'`.
  Staff accounts are not owners and vice versa.
- Page: Supabase Auth email + password + Turnstile (same site keys as staff.html),
  own `storageKey: 'krema-owner-auth'` so it never logs out the barista/customer
  sessions on the same origin; a signed-in non-owner is signed straight back out.

## What the page shows (from the approved design)
Header: logo, "Owner dashboard", date, period switch **Today / 7 days / 30 days**
(default 7 days), Log out.

1. **Period tiles** (Manila time, test cards excluded): stamps given (+ previous
   equal period for comparison), customers (+ first-timers), rewards claimed
   (+ members waiting now), new members (+ total members).
2. **Rewards** (fixed last 30 days): claimed, expired (same-day rule), waiting now;
   list of members waiting with the reward(s); note about the same-day rule.
3. **Members**: active (<30 days), cooling off (14–30 days), lapsed (30+ days),
   never stamped — stacked bar + rows; tapping a row lists the members in that
   group (name, phone, last visit, stamps) so the owner can message them.
4. **Stamps per week**, last 8 weeks (current week highlighted).
5. **Busiest hours**, all time, 10am–10pm.
6. **Top regulars** by lifetime stamps (top 5).
7. **Staff**: stamps per staff login in the period.
8. **K-list**: active newsletter subscribers.
Footnote: counts only Club-card stamps, test cards excluded, Manila time.

Refreshes every 60 s while visible.

## Data contract (my call)
- `owner_dashboard(p_days int)` → one `json` object with every section above;
  `p_days` ∈ {1 (= today, Manila calendar day), 7, 30}.
- `owner_members(p_group text)` → rows `(name, phone, member_code, stamps,
  last_visit)` for `active|cooling|lapsed|never|waiting`.
- "Expired" counts tiers that expired unclaimed (via `krema_expired`) for cards
  touched in the last 30 days; it's 0 until the rule starts 2026-10-21.
- Data values rendered with `textContent` only.

## Left to the builder
Exact copy, empty/loading/error states, chart drawing (plain divs, no library).
