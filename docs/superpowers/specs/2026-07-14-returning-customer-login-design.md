# Returning-customer login + empty-card signup — design

**Date:** 2026-07-14
**Status:** Draft for review
**Files touched:** `rewards.html`, `supabase-setup.sql` (+ live DB via SQL Editor), `HANDOFF.md`

## 1. Problem

Two related gaps in the customer rewards flow:

1. **No way to get your card back.** After signing up, a customer is only remembered on the same phone/browser (member code in `localStorage`). On a new, borrowed, or cache-cleared device they must go through the **signup form again** (name + phone) to see their card — it feels like signing up twice.
2. **The free signup stamp should be removed.** Signup currently grants stamp #1 automatically ("№1 is on us"). The shop wants the **first stamp to be added by staff on the first real purchase**, like every other stamp — so a new card starts empty at 0/11.

## 2. Goals / non-goals

**Goals**
- A returning customer can pull up their existing card by entering **just their phone number** ("welcome back"), without re-entering their name.
- A new signup creates an **empty** card (0/11); staff add the first stamp.
- Ideally, most customers never re-enter anything at all (bookmarkable card link).

**Non-goals (explicitly out of scope for v1)**
- Passwords, PINs, or SMS one-time codes. (Rationale below.)
- Staff-side PIN/password reset tooling.
- Apple/Google Wallet passes.

## 3. Why no password / PIN / SMS (decision record)

- **No reward can be stolen by viewing a card.** Adding stamps and redeeming are **staff-only**, enforced server-side (`is_staff()`). Someone who pulls up another person's card by phone sees only a **first name + a stamp count (0–11)** — they cannot self-stamp, self-redeem the free drink, or use the discount.
- **A PIN/password needs a reset path, and a reset path needs identity verification.** The shop is run by a solo, non-technical operator with non-technical baristas and no admin panel — there is no workable way for staff to verify identity and reset a forgotten secret. A secret you can't reset is a lockout, not security.
- **SMS one-time codes** are the only *self-service* verification (the phone proves ownership), but they require a paid SMS provider (Twilio / Supabase phone auth): setup + ongoing per-message cost.
- **Conclusion:** phone-number lookup, matching the coffee-shop industry norm (Square Loyalty, Fivestars). Escalate to SMS codes **only if** a real privacy complaint appears.

## 4. Design overview

### 4.1 Empty-card signup
- `signup_customer` inserts a new customer with `stamps = 0, lifetime = 0` (was `1, 1`).
- Existing-phone behavior is unchanged: signing up with a phone that already exists still returns that existing card (no duplicate, no reset).
- Remove the "first stamp free" copy from `rewards.html` (`№1 is on us` line 76; `first stamp's on us when you join ✨` line 95) and the matching comments in `supabase-setup.sql`.

### 4.2 Returning-customer lookup ("welcome back")
- The rewards landing screen offers **two paths**:
  - **Join** — name + phone (creates an empty card).
  - **I already have a card** — phone number only → loads the existing card.
- New anon RPC `customer_lookup(p_phone)`:
  - Returns the standard card shape **for the matching phone**, or **zero rows** if not found.
  - Does **not** create a customer (unlike `signup_customer`).
  - Does **not** return the phone number in its result (no phone echoed back to an anonymous caller).
- On success: save the member code to `localStorage` (same as signup) and show the card; polling/QR behave exactly as today.
- On no-match: a gentle message — "No card with that number yet — want to join?" — that switches to the Join path with the phone pre-filled.

### 4.3 Bookmarkable card link (the "never type again" path)
- The card is reachable at `rewards.html?c=KREMA-XXXX`.
- On load, if `?c=` is present, load that card via the existing `get_card` and save the code to `localStorage`.
- After signup/lookup, surface a subtle "bookmark this / add to home screen" hint so the customer can save their personal link.

## 5. Data flow

```
New customer:   Join form (name, phone) → signup_customer → card 0/11 → save code → bookmark hint
Returning:      "I have a card" (phone) → customer_lookup → card X/11 → save code
                 └ not found → offer Join (phone pre-filled)
Bookmarked link: rewards.html?c=CODE → get_card → card X/11 → save code
Same device:     (unchanged) localStorage code → get_card → card X/11
```

Precedence on page load: `?c=` URL param → else saved `localStorage` code → else the landing screen (Join / I-have-a-card).

## 6. New/changed DB functions

**Changed — `signup_customer`:** insert `stamps = 0, lifetime = 0`.

**New — `customer_lookup(p_phone text)` (anon):**
- `security definer`, `search_path = public`.
- Trims `p_phone`; `return query select <card shape> from customers c where c.phone = trim(p_phone)`.
- Returns the same 7-column card shape as `get_card` (member_code, name, stamps, goal, discount_at, discount_available, reward_ready) — **no phone column**.
- Granted to `anon, authenticated`. Zero rows when not found (client treats empty as "not found").

## 7. Error handling & edge cases

- **Phone not found on lookup:** empty result → "no card yet, want to join?" (not an error toast).
- **Blank/short phone:** client-side validation before the call (reuse signup's `length >= 5` rule).
- **Bad `?c=` code:** `get_card` returns empty → fall through to the landing screen; don't leave a blank card.
- **`localStorage` unavailable (private mode):** already handled with try/catch; the phone-lookup path becomes the recovery every visit, which is acceptable.
- **Phone uniqueness:** one card per phone (existing behavior via `signup_customer`), so lookup returns at most one card.

## 8. Privacy note (accepted risk)

`customer_lookup` and the `?c=` link are anonymous and enumerable — anyone can query a phone number or guess a 4-digit member code and see a **name + stamp count**. This is the accepted, low-stakes exposure (no reward theft possible). If it ever matters: lengthen member codes and/or add SMS verification. Documented, not fixed, in v1.

## 9. Reward thresholds — RESOLVED

**Keep thresholds at 11 / 6** (`krema_goal()` = 11, `krema_discount_at()` = 6), confirmed by the owner 2026-07-14. With the empty-card signup, the 10%-off unlocks on the **6th** real purchase and the free drink on the **11th**. No change to the config functions.

## 10. Testing

- Signup → card shows **0/11**, no auto stamp; no "on us" copy.
- Staff adds first stamp → 1/11.
- New device → "I have a card" → enter phone → correct card loads.
- Lookup with unknown phone → "want to join?" with phone pre-filled.
- `rewards.html?c=KREMA-XXXX` in a fresh browser → correct card loads and is saved.
- Existing-phone re-signup still returns the same card (no reset, no duplicate).
- Live-DB apply: run changed `signup_customer` + new `customer_lookup` via SQL Editor; verify with `pg_get_functiondef`.
