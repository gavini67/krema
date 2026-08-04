-- ════════════════════════════════════════════════════════════════════════
--  Krema Rewards — database setup / migration  (KREMA CLUB · 20-stamp card)
--  Run in: Supabase Dashboard → SQL Editor → New query → paste → Run.
--  Safe to re-run, and safe to run from EITHER the old 11-stamp schema or
--  a partially-migrated one. Non-destructive: customers keep their stamps.
--
--  Mechanic:
--    20-stamp card · 1 stamp per drink · EMPTY card on signup
--    (staff add the first stamp on the first purchase)
--    Milestones:  6 → 10% off
--                10 → free drink   (lowest-priced drink · except matcha)
--                16 → free merch
--                20 → free bingsu  (solo, regular flavors) → card resets
--    Each milestone is claimable ONCE per card cycle.
--    "Valid for 2 months" is DISPLAYED but NOT enforced (expires_at is
--    returned for the UI; nothing expires server-side — deliberate).
--
--  NOTE: every function body qualifies columns with the `c.` alias. Bare
--  column names collide with the RETURNS TABLE output columns and throw
--  'column reference "stamps" is ambiguous'. Keep the aliases.
-- ════════════════════════════════════════════════════════════════════════

-- ── Base tables (no-ops on a re-run) ────────────────────────────────────
create table if not exists public.customers (
  id                 uuid primary key default gen_random_uuid(),
  member_code        text unique not null,
  name               text not null,
  phone              text unique not null,
  stamps             int  not null default 0,
  lifetime           int  not null default 0,
  discount_available boolean not null default false,   -- legacy (pre-tier), unused
  created_at         timestamptz not null default now()
);

create table if not exists public.redemptions (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  kind         text,
  redeemed_at  timestamptz not null default now()
);

create table if not exists public.staff (
  uid       uuid primary key,
  added_at  timestamptz not null default now()
);

-- One row per stamp given, so daily/period totals can be reported.
-- (customers.stamps is only the current card count; lifetime is a running
-- total. Neither can answer "how many stamps did we give today".)
create table if not exists public.stamp_events (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  staff_uid    uuid,
  created_at   timestamptz not null default now()
);

create index if not exists stamp_events_created_idx
  on public.stamp_events (created_at desc);

-- One row per card claim / unlink, so "who secured this card, and when" is
-- answerable after the fact. Needed by claim_card + unlink_card (Phase 3):
-- an unlink is a support action that moves a card between accounts, and that
-- must leave a trail.
create table if not exists public.card_claim_events (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  user_id      uuid,                                   -- auth.users id; null after account deletion
  action       text not null check (action in ('claim','unlink')),
  created_at   timestamptz not null default now()
);

create index if not exists card_claim_events_customer_idx
  on public.card_claim_events (customer_id, created_at desc);

-- ── Lock every table: no direct client access ───────────────────────────
-- RLS on with NO policies = anon/authenticated cannot read or write these
-- tables at all. Everything goes through the SECURITY DEFINER functions
-- below, which is where the staff checks live.
alter table public.customers         enable row level security;
alter table public.redemptions       enable row level security;
alter table public.staff             enable row level security;
alter table public.stamp_events      enable row level security;
alter table public.card_claim_events enable row level security;
revoke all on public.customers         from anon, authenticated;
revoke all on public.redemptions       from anon, authenticated;
revoke all on public.staff             from anon, authenticated;
revoke all on public.stamp_events      from anon, authenticated;
revoke all on public.card_claim_events from anon, authenticated;

-- ── Schema migration ────────────────────────────────────────────────────
-- Each card has a cycle; milestone claims are scoped to the cycle they
-- happened in, so a completed card starts everyone fresh.
alter table public.customers
  add column if not exists cycle_started_at timestamptz not null default now();

alter table public.redemptions
  add column if not exists tier int;

-- Cycles are identified by an explicit counter, NOT by timestamp.
-- (Timestamps fail: claiming the final tier inserts the redemption and moves
-- the cycle in ONE transaction, and now() is the transaction time, so both get
-- the identical value — the completing claim then leaks into the new cycle and
-- the card can never be completed again.)
alter table public.customers
  add column if not exists cycle_seq int not null default 1;

alter table public.redemptions
  add column if not exists cycle_seq int;

-- Backfill cycle_seq for rows written before this column existed.
-- Strictly-after the cycle start = current cycle; anything at or before it
-- (including the claim that ended the previous cycle) = an earlier cycle.
update public.redemptions r
   set cycle_seq = case when r.redeemed_at > c.cycle_started_at then 1 else 0 end
  from public.customers c
 where c.id = r.customer_id and r.cycle_seq is null;

-- Old constraint only allowed kind in ('free_drink','discount').
alter table public.redemptions drop constraint if exists redemptions_kind_check;
alter table public.redemptions alter column kind drop not null;

create index if not exists redemptions_customer_idx
  on public.redemptions (customer_id, redeemed_at desc);

-- Undo the bad back-fill from the first (aborted) 20-stamp migration: it
-- wrote tier-6 rows with kind='discount', which would wrongly read as
-- "10% off already claimed". Real claims use kind 'milestone'/'free_bingsu'.
delete from public.redemptions where tier is not null and kind = 'discount';

-- ── Drop every function whose return shape changes ──────────────────────
-- Postgres refuses CREATE OR REPLACE when the OUT columns differ (42P13),
-- so these must go first. All of them are recreated below.
drop function if exists public.signup_customer(text,text);
drop function if exists public.get_card(text);
drop function if exists public.customer_lookup(text);
drop function if exists public.add_stamp(text);
drop function if exists public.staff_lookup(text);
drop function if exists public.claim_reward(text,int);
drop function if exists public.stamps_today();
drop function if exists public.krema_card(uuid);
drop function if exists public.krema_claimed(uuid,timestamptz);
drop function if exists public.krema_claimed(uuid,int);
-- retired by the 20-stamp model
drop function if exists public.redeem(text);
drop function if exists public.redeem_discount(text);
drop function if exists public.krema_discount_at();

-- ── Config ──────────────────────────────────────────────────────────────
create or replace function public.krema_goal() returns int
  language sql immutable as $$ select 20 $$;

create or replace function public.krema_tiers() returns int[]
  language sql immutable as $$ select array[6, 10, 16, 20] $$;

-- Display-only card validity. Deliberately not enforced anywhere.
create or replace function public.krema_validity() returns interval
  language sql immutable as $$ select interval '2 months' $$;

-- ── Helpers ─────────────────────────────────────────────────────────────
create or replace function public.is_staff() returns boolean
  language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.staff where uid = auth.uid())
$$;

-- Normalise a PH mobile number to 09XXXXXXXXX. Returns NULL if it isn't one.
-- Accepts 0917…, +63917…, 63917…, 917…, with spaces/dashes/brackets.
create or replace function public.krema_norm_phone(p_raw text) returns text
  language sql immutable as $$
  select case
           when d ~ '^09[0-9]{9}$'  then d
           when d ~ '^639[0-9]{9}$' then '0' || substr(d, 3)
           when d ~ '^9[0-9]{9}$'   then '0' || d
           else null
         end
  from (select regexp_replace(coalesce(p_raw, ''), '\D', '', 'g') as d) s
$$;

-- Member codes: 6 chars from an unambiguous alphabet (no O/0/I/1) ≈ 887M
-- combinations. The old 4-digit codes only had 10,000 — every card was
-- enumerable, and krema_new_code would spin forever once they ran out.
-- Existing KREMA-1234 codes keep working; only new ones use this format.
create or replace function public.krema_new_code() returns text
  language plpgsql security definer set search_path = public as $$
declare v_code text; v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i int;
begin
  loop
    v_code := 'KREMA-';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.customers c where c.member_code = v_code);
  end loop;
  return v_code;
end $$;

-- Tiers already claimed in the customer's CURRENT cycle, matched on the cycle
-- counter (see the note above — timestamps cannot express this correctly).
create or replace function public.krema_claimed(p_customer uuid, p_seq int)
  returns int[]
  language sql security definer set search_path = public stable as $$
  select coalesce(array_agg(distinct r.tier order by r.tier), '{}')
  from public.redemptions r
  where r.customer_id = p_customer and r.tier is not null and r.cycle_seq = p_seq
$$;

-- ── The card shape every client receives ────────────────────────────────
--   member_code, name, stamps, goal, tiers[], claimed[], expires_at, reward_ready
create or replace function public.krema_card(p_id uuid)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean)
  language sql security definer set search_path = public stable as $$
  select c.member_code, c.name, c.stamps, krema_goal(), krema_tiers(),
         krema_claimed(c.id, c.cycle_seq),
         c.cycle_started_at + krema_validity(),
         (c.stamps >= krema_goal()
          and not (krema_goal() = any (krema_claimed(c.id, c.cycle_seq))))
  from public.customers c where c.id = p_id
$$;

-- ── Customer signup (anon) — EMPTY card; staff add the first stamp ───────
create or replace function public.signup_customer(p_name text, p_phone text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean)
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_phone text; v_name text;
begin
  p_name := trim(p_name);
  if length(p_name) < 1 then raise exception 'please enter your name'; end if;
  if length(p_name) > 60 then p_name := substr(p_name, 1, 60); end if;

  v_phone := krema_norm_phone(p_phone);
  if v_phone is null then
    raise exception 'enter a valid mobile number, e.g. 0917 123 4567';
  end if;

  select c.id, c.name into v_id, v_name
    from public.customers c where c.phone = v_phone;

  if v_id is null then
    insert into public.customers (member_code, name, phone, stamps, lifetime)
    values (krema_new_code(), p_name, v_phone, 0, 0)     -- empty card
    returning id into v_id;
  elsif lower(trim(v_name)) is distinct from lower(p_name) then
    -- Phone is already on a card and the name doesn't match. Without this,
    -- typing a stranger's number returned THEIR card — member code included,
    -- and that code is the card's only credential. Same generic message for
    -- "wrong name" as the UI shows for a taken number: don't confirm to a
    -- guesser whether they got the name right.
    raise exception 'that number''s already on a card — tap "already have a card?"';
  end if;

  return query select * from public.krema_card(v_id);
end $$;

-- ── Get card by member code (anon — customer viewing their own card) ────
create or replace function public.get_card(p_code text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean)
  language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select c.id into v_id from public.customers c where c.member_code = p_code;
  if v_id is null then return; end if;               -- empty result = not found
  return query select * from public.krema_card(v_id);
end $$;

-- ── Get card by phone (anon — returning customer retrieving their card) ──
--  Never echoes the phone back. Zero rows when not found. Creates nothing.
create or replace function public.customer_lookup(p_phone text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean)
  language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  -- match on the normalised number, falling back to the raw string so rows
  -- stored before normalisation are still findable
  select c.id into v_id from public.customers c
   where c.phone = coalesce(krema_norm_phone(p_phone), '~none~')
      or c.phone = trim(p_phone)
   limit 1;
  if v_id is null then return; end if;
  return query select * from public.krema_card(v_id);
end $$;

-- ── Staff: add a stamp ──────────────────────────────────────────────────
create or replace function public.add_stamp(p_code text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean)
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_stamps int;
begin
  if not is_staff() then raise exception 'staff only'; end if;

  select c.id, c.stamps into v_id, v_stamps
    from public.customers c where c.member_code = p_code;
  if v_id is null then raise exception 'card not found'; end if;
  if v_stamps >= krema_goal() then
    raise exception 'card is full — claim the free bingsu first';
  end if;

  update public.customers c
     set stamps = c.stamps + 1, lifetime = c.lifetime + 1
   where c.id = v_id;

  insert into public.stamp_events (customer_id, staff_uid)
  values (v_id, auth.uid());

  return query select * from public.krema_card(v_id);
end $$;

-- ── Staff: claim a milestone reward ─────────────────────────────────────
--  Any tier (6/10/16/20), once per cycle, only once enough stamps exist.
--  Claiming the final tier (20) completes the card: stamps → 0, new cycle.
create or replace function public.claim_reward(p_code text, p_tier int)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean)
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_stamps int; v_seq int; v_pending text;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if not (p_tier = any (krema_tiers())) then raise exception 'unknown reward'; end if;

  select c.id, c.stamps, c.cycle_seq into v_id, v_stamps, v_seq
    from public.customers c where c.member_code = p_code;
  if v_id is null then raise exception 'card not found'; end if;
  if v_stamps < p_tier then raise exception 'not enough stamps yet'; end if;
  if p_tier = any (krema_claimed(v_id, v_seq)) then
    raise exception 'already claimed';
  end if;

  -- Completing the card resets the cycle, which permanently discards any
  -- reward the customer earned but never collected. Refuse until every
  -- reached lower tier is either claimed or explicitly waived by staff
  -- (waive_reward), so nothing is lost by a mis-tap at the counter.
  if p_tier = krema_goal() then
    select string_agg(t::text, ', ' order by t) into v_pending
      from unnest(krema_tiers()) t
     where t < krema_goal()
       and t <= v_stamps
       and not (t = any (krema_claimed(v_id, v_seq)));
    if v_pending is not null then
      raise exception 'unclaimed rewards at % stamps — claim or skip them first', v_pending;
    end if;
  end if;

  -- Stamped with the cycle being claimed against, so completing the card
  -- leaves this row behind in the OLD cycle.
  insert into public.redemptions (customer_id, tier, kind, cycle_seq)
  values (v_id, p_tier,
          case when p_tier = krema_goal() then 'free_bingsu' else 'milestone' end,
          v_seq);

  if p_tier = krema_goal() then                       -- card complete → new cycle
    update public.customers c
       set stamps = 0, cycle_seq = c.cycle_seq + 1,
           cycle_started_at = now(), discount_available = false
     where c.id = v_id;
  end if;

  return query select * from public.krema_card(v_id);
end $$;

-- ── Staff: skip an unclaimed reward ─────────────────────────────────────
--  The customer doesn't want it (declines the merch, already has one, etc.).
--  Without this, claim_reward's completion guard would deadlock the card:
--  they can't claim tier 20 while a lower tier is pending, and they don't
--  want the lower tier. Recorded as kind='waived' so it stays distinguishable
--  from a real redemption in reporting — nothing was actually handed over.
create or replace function public.waive_reward(p_code text, p_tier int)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean)
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_stamps int; v_seq int;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if not (p_tier = any (krema_tiers())) then raise exception 'unknown reward'; end if;
  if p_tier = krema_goal() then
    raise exception 'the final reward cannot be skipped';
  end if;

  select c.id, c.stamps, c.cycle_seq into v_id, v_stamps, v_seq
    from public.customers c where c.member_code = p_code;
  if v_id is null then raise exception 'card not found'; end if;
  if v_stamps < p_tier then raise exception 'not enough stamps yet'; end if;
  if p_tier = any (krema_claimed(v_id, v_seq)) then
    raise exception 'already claimed';
  end if;

  insert into public.redemptions (customer_id, tier, kind, cycle_seq)
  values (v_id, p_tier, 'waived', v_seq);

  return query select * from public.krema_card(v_id);
end $$;

-- ── Staff: look up a card by phone (camera-fail fallback) ───────────────
create or replace function public.staff_lookup(p_phone text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean)
  language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select c.id into v_id from public.customers c
   where c.phone = coalesce(krema_norm_phone(p_phone), '~none~')
      or c.phone = trim(p_phone)
   limit 1;
  if v_id is null then return; end if;
  return query select * from public.krema_card(v_id);
end $$;

-- ── Staff: today's totals (Manila time) ─────────────────────────────────
--  stamps_given   — stamps handed out today
--  customers_seen — distinct customers stamped today
--  rewards_given  — milestone rewards claimed today
create or replace function public.stamps_today()
  returns table (stamps_given int, customers_seen int, rewards_given int)
  language plpgsql security definer set search_path = public stable as $$
declare v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return query
    select
      (select count(*)::int from public.stamp_events e
        where (e.created_at at time zone 'Asia/Manila')::date = v_today),
      (select count(distinct e.customer_id)::int from public.stamp_events e
        where (e.created_at at time zone 'Asia/Manila')::date = v_today),
      (select count(*)::int from public.redemptions r
        where r.tier is not null
          and (r.redeemed_at at time zone 'Asia/Manila')::date = v_today);
end $$;

-- ── Backfill: normalise phones already stored in mixed formats ──────────
-- Runs after krema_norm_phone exists. Same person can't end up with two
-- cards, and lookup works whatever format they type. Skipped for any row
-- where it would collide with another customer. Junk numbers (e.g.
-- 'asdasdasd') can't be normalised and are left as-is — list them with:
--   select member_code, name, phone from public.customers
--    where public.krema_norm_phone(phone) is null;
update public.customers c
   set phone = public.krema_norm_phone(c.phone)
 where public.krema_norm_phone(c.phone) is not null
   and c.phone <> public.krema_norm_phone(c.phone)
   and not exists (
     select 1 from public.customers c2
      where c2.id <> c.id and c2.phone = public.krema_norm_phone(c.phone));

-- ── Permissions ─────────────────────────────────────────────────────────
-- Postgres grants EXECUTE on every new function to PUBLIC by default, and
-- PostgREST exposes anything in `public` as an RPC. So the internal helpers
-- below were all callable by anon over HTTP until this block existed.
-- Revoking them does NOT break the RPCs that call them: every caller is
-- SECURITY DEFINER, so the inner calls run with the owner's rights, and the
-- owner keeps EXECUTE regardless.
revoke all on function public.krema_goal()            from public, anon, authenticated;
revoke all on function public.krema_tiers()           from public, anon, authenticated;
revoke all on function public.krema_validity()        from public, anon, authenticated;
revoke all on function public.krema_norm_phone(text)  from public, anon, authenticated;
revoke all on function public.krema_new_code()        from public, anon, authenticated;
revoke all on function public.krema_claimed(uuid,int) from public, anon, authenticated;
revoke all on function public.krema_card(uuid)        from public, anon, authenticated;

-- is_staff() is the one helper a client legitimately calls: staff.html needs
-- it to gate its own UI (Phase 2). Authenticated only — never anon.
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

revoke all on function public.signup_customer(text,text) from public;
revoke all on function public.get_card(text)             from public;
revoke all on function public.customer_lookup(text)      from public;
revoke all on function public.add_stamp(text)            from public;
revoke all on function public.claim_reward(text,int)     from public;
revoke all on function public.waive_reward(text,int)     from public;
revoke all on function public.staff_lookup(text)         from public;
revoke all on function public.stamps_today()             from public;

grant execute on function public.signup_customer(text,text) to anon, authenticated;
grant execute on function public.get_card(text)             to anon, authenticated;
grant execute on function public.customer_lookup(text)      to anon, authenticated;
grant execute on function public.add_stamp(text)            to authenticated;
grant execute on function public.claim_reward(text,int)     to authenticated;
grant execute on function public.waive_reward(text,int)     to authenticated;
grant execute on function public.staff_lookup(text)         to authenticated;
grant execute on function public.stamps_today()             to authenticated;

-- ════════════════════════════════════════════════════════════════════════
--  Staff accounts: only uids in public.staff can stamp or claim rewards.
--  Active account: keionchua@gmail.com
--  To add a barista: Authentication → Users → Add user (Auto Confirm on), then
--    insert into public.staff (uid)
--    select id from auth.users where email = 'THEIR-EMAIL'
--    on conflict (uid) do nothing;
-- ════════════════════════════════════════════════════════════════════════
