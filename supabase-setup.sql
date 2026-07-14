-- ════════════════════════════════════════════════════════════════════════
--  Krema Rewards — database setup  (11-stamp mechanic)
--  Run ONCE: Supabase Dashboard → SQL Editor → New query → paste → Run.
--  Safe to re-run (uses "if not exists" / "create or replace").
--
--  Mechanic: 11 stamps = free drink · 6 stamps = 10% off voucher ·
--            empty card on signup · 1 free-drink redeem per day.
-- ════════════════════════════════════════════════════════════════════════

-- ── Tables ──────────────────────────────────────────────────────────────
create table if not exists public.customers (
  id                 uuid primary key default gen_random_uuid(),
  member_code        text unique not null,        -- short code in the QR
  name               text not null,
  phone              text unique not null,
  stamps             int  not null default 0,      -- progress 0..11 in current cycle
  lifetime           int  not null default 0,      -- total stamps ever earned
  discount_available boolean not null default false, -- 10% off unlocked, unspent
  created_at         timestamptz not null default now()
);

create table if not exists public.redemptions (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  kind         text not null check (kind in ('free_drink','discount')),
  redeemed_at  timestamptz not null default now()
);

-- Who may add stamps / redeem. A logged-in Auth user only counts as staff if
-- their uid is in this table (defense-in-depth beyond "just logged in").
create table if not exists public.staff (
  uid       uuid primary key,
  added_at  timestamptz not null default now()
);

-- Lock every table: clients NEVER touch them directly, only via the SECURITY
-- DEFINER functions below. RLS on + no policies = no direct anon/auth access.
alter table public.customers   enable row level security;
alter table public.redemptions enable row level security;
alter table public.staff       enable row level security;
revoke all on public.customers   from anon, authenticated;
revoke all on public.redemptions from anon, authenticated;
revoke all on public.staff       from anon, authenticated;

-- ── Config ──────────────────────────────────────────────────────────────
create or replace function public.krema_goal() returns int          -- free drink at
  language sql immutable as $$ select 11 $$;
create or replace function public.krema_discount_at() returns int    -- 10% off at
  language sql immutable as $$ select 6 $$;

-- ── Helpers ─────────────────────────────────────────────────────────────
create or replace function public.is_staff() returns boolean
  language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.staff where uid = auth.uid())
$$;

create or replace function public.krema_new_code() returns text
  language plpgsql security definer set search_path = public as $$
declare c text;
begin
  loop
    c := 'KREMA-' || lpad((floor(random()*10000))::int::text, 4, '0');
    exit when not exists (select 1 from public.customers where member_code = c);
  end loop;
  return c;
end $$;

-- Shared shape returned to clients (never exposes phone to anon callers).
--   member_code, name, stamps, goal, discount_at, discount_available,
--   reward_ready (stamps >= goal)

-- ── Customer signup (anon) — empty card ─────────────────────────────────
create or replace function public.signup_customer(p_name text, p_phone text)
  returns table (member_code text, name text, stamps int, goal int,
                 discount_at int, discount_available boolean, reward_ready boolean)
  language plpgsql security definer set search_path = public as $$
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
    values (v_code, p_name, p_phone, 0, 0);            -- empty card; staff add the first stamp
  end if;

  return query
    select c.member_code, c.name, c.stamps, krema_goal(), krema_discount_at(),
           c.discount_available, (c.stamps >= krema_goal())
    from public.customers c where c.member_code = v_code;
end $$;

-- ── Get card by code (anon — customer viewing their own card) ───────────
create or replace function public.get_card(p_code text)
  returns table (member_code text, name text, stamps int, goal int,
                 discount_at int, discount_available boolean, reward_ready boolean)
  language plpgsql security definer set search_path = public as $$
begin
  return query
    select c.member_code, c.name, c.stamps, krema_goal(), krema_discount_at(),
           c.discount_available, (c.stamps >= krema_goal())
    from public.customers c where c.member_code = p_code;
end $$;

-- ── Staff: add a stamp ──────────────────────────────────────────────────
--  +1 stamp (capped at goal). Crossing 6 unlocks the 10%-off voucher.
create or replace function public.add_stamp(p_code text)
  returns table (member_code text, name text, stamps int, goal int,
                 discount_at int, discount_available boolean, reward_ready boolean)
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_stamps int;
begin
  if not is_staff() then raise exception 'staff only'; end if;

  select c.id, c.stamps into v_id, v_stamps
    from public.customers c where c.member_code = p_code;
  if v_id is null then raise exception 'card not found'; end if;
  if v_stamps >= krema_goal() then raise exception 'card already full — redeem first'; end if;

  update public.customers c
     set stamps   = c.stamps + 1,
         lifetime = c.lifetime + 1,
         discount_available = c.discount_available or (c.stamps + 1 >= krema_discount_at())
   where c.id = v_id;

  return query
    select c.member_code, c.name, c.stamps, krema_goal(), krema_discount_at(),
           c.discount_available, (c.stamps >= krema_goal())
    from public.customers c where c.id = v_id;
end $$;

-- ── Staff: redeem the free drink (card full; 1 per customer per day) ─────
--  Resets the cycle: stamps -> 0, discount voucher for the cycle is cleared.
create or replace function public.redeem(p_code text)
  returns table (member_code text, name text, stamps int, goal int,
                 discount_at int, discount_available boolean, reward_ready boolean)
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_stamps int;
begin
  if not is_staff() then raise exception 'staff only'; end if;

  select c.id, c.stamps into v_id, v_stamps
    from public.customers c where c.member_code = p_code;
  if v_id is null then raise exception 'card not found'; end if;
  if v_stamps < krema_goal() then raise exception 'card not full yet'; end if;
  if exists (select 1 from public.redemptions
             where customer_id = v_id and kind = 'free_drink'
               and redeemed_at > now() - interval '1 day') then
    raise exception 'already redeemed today';
  end if;

  update public.customers
     set stamps = 0, discount_available = false
   where id = v_id;
  insert into public.redemptions (customer_id, kind) values (v_id, 'free_drink');

  return query
    select c.member_code, c.name, c.stamps, krema_goal(), krema_discount_at(),
           c.discount_available, (c.stamps >= krema_goal())
    from public.customers c where c.id = v_id;
end $$;

-- ── Staff: redeem the 10% off voucher (no daily limit) ──────────────────
create or replace function public.redeem_discount(p_code text)
  returns table (member_code text, name text, stamps int, goal int,
                 discount_at int, discount_available boolean, reward_ready boolean)
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_avail boolean;
begin
  if not is_staff() then raise exception 'staff only'; end if;

  select c.id, c.discount_available into v_id, v_avail
    from public.customers c where c.member_code = p_code;
  if v_id is null then raise exception 'card not found'; end if;
  if not v_avail then raise exception 'no discount available'; end if;

  update public.customers set discount_available = false where id = v_id;
  insert into public.redemptions (customer_id, kind) values (v_id, 'discount');

  return query
    select c.member_code, c.name, c.stamps, krema_goal(), krema_discount_at(),
           c.discount_available, (c.stamps >= krema_goal())
    from public.customers c where c.id = v_id;
end $$;

-- ── Staff: look up a card by phone (camera-fail fallback) ────────────────
create or replace function public.staff_lookup(p_phone text)
  returns table (member_code text, name text, phone text, stamps int, goal int,
                 discount_at int, discount_available boolean, reward_ready boolean)
  language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return query
    select c.member_code, c.name, c.phone, c.stamps, krema_goal(), krema_discount_at(),
           c.discount_available, (c.stamps >= krema_goal())
    from public.customers c where c.phone = trim(p_phone);
end $$;

-- ── Permissions: who can call each function ─────────────────────────────
revoke all on function public.signup_customer(text,text) from public;
revoke all on function public.get_card(text)             from public;
revoke all on function public.add_stamp(text)            from public;
revoke all on function public.redeem(text)               from public;
revoke all on function public.redeem_discount(text)      from public;
revoke all on function public.staff_lookup(text)         from public;

grant execute on function public.signup_customer(text,text) to anon, authenticated;
grant execute on function public.get_card(text)             to anon, authenticated;
grant execute on function public.add_stamp(text)            to authenticated;
grant execute on function public.redeem(text)               to authenticated;
grant execute on function public.redeem_discount(text)      to authenticated;
grant execute on function public.staff_lookup(text)         to authenticated;

-- ════════════════════════════════════════════════════════════════════════
--  AFTER running this:
--  1) Authentication → Users → Add user → email `crew@krema.ph` + a password
--     (turn OFF "auto-confirm"? No — leave email confirm off / auto-confirm ON
--      so the barista can log in immediately).
--  2) Copy that user's UID, then run (SQL Editor):
--        insert into public.staff (uid) values ('<paste-staff-user-uid>');
--  Only uids in public.staff can add stamps or redeem.
-- ════════════════════════════════════════════════════════════════════════
