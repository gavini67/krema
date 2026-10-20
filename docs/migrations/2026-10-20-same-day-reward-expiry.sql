begin;

-- ════════════════════════════════════════════════════════════════════════
--  Same-day reward expiry (owner rule, 2026-10-20)
--  A milestone reward (6 / 10 / 16 / 20) must be claimed on the Manila
--  calendar day the stamp that unlocked it was added. At midnight it expires.
--  An expired free bingsu (20) starts a fresh card.
--  Rewards unlocked BEFORE krema_expiry_start() are honored indefinitely, and
--  so are stamps with no stamp_events row (pre-audit legacy stamps) — their
--  unlock day is unknown, so they never expire.
--
--  The card shape gains a 9th column, `expired int[]`: tiers in the current
--  cycle that expired unclaimed. Adding an OUT column is a return-type change
--  (Postgres 42P13), so every function returning the card is dropped and
--  recreated, and its grants re-applied exactly as before.
-- ════════════════════════════════════════════════════════════════════════

drop function if exists public.signup_customer(text,text);
drop function if exists public.get_card(text);
drop function if exists public.customer_lookup(text);
drop function if exists public.customer_lookup(text,text);
drop function if exists public.claim_card(text,text);
drop function if exists public.get_my_card();
drop function if exists public.unlink_card(text);
drop function if exists public.add_stamp(text);
drop function if exists public.claim_reward(text,int);
drop function if exists public.waive_reward(text,int);
drop function if exists public.staff_lookup(text);
drop function if exists public.krema_card(uuid);

-- First Manila day on which the same-day rule applies.
create or replace function public.krema_expiry_start() returns date
  language sql immutable as $$ select date '2026-10-21' $$;

-- Tiers in the customer's CURRENT cycle that were reached on an earlier
-- Manila day (on/after krema_expiry_start) and never claimed or waived.
-- The k-th stamp of the cycle is matched to its stamp_events row; any
-- stamps without an event row are the oldest ones (offset), unlock unknown.
create or replace function public.krema_expired(p_id uuid)
  returns int[]
  language sql security definer set search_path = public stable as $$
  with c as (
    select c.id, c.stamps, c.cycle_seq, c.cycle_started_at
      from public.customers c where c.id = p_id
  ), ev as (
    select e.created_at,
           row_number() over (order by e.created_at, e.id) as n,
           count(*) over () as total
      from public.stamp_events e join c on e.customer_id = c.id
     where e.created_at >= c.cycle_started_at
  )
  select coalesce(array_agg(t order by t), '{}')
    from c
    cross join unnest(krema_tiers()) t
    join ev on c.stamps - ev.total + ev.n = t
   where t <= c.stamps
     and not (t = any (krema_claimed(c.id, c.cycle_seq)))
     and (ev.created_at at time zone 'Asia/Manila')::date >= krema_expiry_start()
     and (ev.created_at at time zone 'Asia/Manila')::date < (now() at time zone 'Asia/Manila')::date
$$;

-- If the free bingsu expired, start the next cycle for real. Called by every
-- staff mutation so stamps/claims always act on the card the customer sees.
create or replace function public.krema_roll_cycle(p_id uuid)
  returns void
  language plpgsql security definer set search_path = public as $$
begin
  if krema_goal() = any (krema_expired(p_id)) then
    update public.customers c
       set stamps = 0, cycle_seq = c.cycle_seq + 1,
           cycle_started_at = now(), discount_available = false
     where c.id = p_id;
  end if;
end $$;

-- ── The card shape every client receives ────────────────────────────────
--   member_code, name, stamps, goal, tiers[], claimed[], expires_at, reward_ready, expired[]
--  When the free bingsu expired, the card is shown as already reset (0 stamps)
--  with expired = {20} so the customer page can explain why; the row itself is
--  reset by krema_roll_cycle at the next staff action.
create or replace function public.krema_card(p_id uuid)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean,
                 expired int[])
  language sql security definer set search_path = public stable as $$
  with c as (
    select c.*, krema_claimed(c.id, c.cycle_seq) as clm, krema_expired(c.id) as exp
      from public.customers c where c.id = p_id
  )
  select c.member_code, c.name,
         case when krema_goal() = any (c.exp) then 0 else c.stamps end,
         krema_goal(), krema_tiers(),
         case when krema_goal() = any (c.exp) then '{}'::int[] else c.clm end,
         case when krema_goal() = any (c.exp) then now() + krema_validity()
              else c.cycle_started_at + krema_validity() end,
         (c.stamps >= krema_goal()
          and not (krema_goal() = any (c.clm))
          and not (krema_goal() = any (c.exp))),
         case when krema_goal() = any (c.exp) then array[krema_goal()] else c.exp end
  from c
$$;

-- ── Customer signup (anon) — EMPTY card; staff add the first stamp ───────
create or replace function public.signup_customer(p_name text, p_phone text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean,
                 expired int[])
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_phone text;
begin
  p_name := trim(p_name);
  if p_name is null or length(p_name) < 1 then raise exception 'please enter your name'; end if;
  if length(p_name) > 60 then p_name := substr(p_name, 1, 60); end if;

  v_phone := krema_norm_phone(p_phone);
  if v_phone is null then
    raise exception 'enter a valid mobile number, e.g. 0917 123 4567';
  end if;

  -- Only return a newly created card. The unique phone constraint also
  -- rejects concurrent duplicate signup without revealing name/code or link state.
  insert into public.customers (member_code, name, phone, stamps, lifetime)
  values (krema_new_code(), p_name, v_phone, 0, 0)
  on conflict (phone) do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'please sign in or ask staff to reopen your card';
  end if;

  return query select * from public.krema_card(v_id);
end $$;

-- ── Customer: fetch own card by code (anon) ─────────────────────────────
create or replace function public.get_card(p_code text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean,
                 expired int[])
  language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select c.id into v_id from public.customers c where c.member_code = p_code;
  if v_id is null then return; end if;               -- empty result = not found
  return query select * from public.krema_card(v_id);
end $$;

-- Phone-only lookup is a zero-row compatibility shim.
create or replace function public.customer_lookup(p_phone text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean,
                 expired int[])
  language plpgsql security definer set search_path = public as $$
begin
  return;
end $$;

-- Exact name + phone can reopen a legacy card only until that card is secured.
create or replace function public.customer_lookup(p_phone text, p_name text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean,
                 expired int[])
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_phone text; v_name text;
begin
  v_phone := krema_norm_phone(p_phone);
  v_name := lower(trim(p_name));
  if v_phone is null or v_name is null or length(v_name) < 1 then return; end if;

  select c.id into v_id
    from public.customers c
   where c.phone = v_phone
     and lower(trim(c.name)) = v_name
     and c.user_id is null;
  if v_id is null then return; end if;

  return query select * from public.krema_card(v_id);
end $$;

-- ── Customer accounts ───────────────────────────────────────────────────
create or replace function public.claim_card(p_code text, p_phone text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean,
                 expired int[])
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_user_id uuid; v_phone text;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;

  v_phone := krema_norm_phone(p_phone);
  if v_phone is null then raise exception 'card details do not match'; end if;

  select c.id, c.user_id into v_id, v_user_id
    from public.customers c
   where c.member_code = p_code and c.phone = v_phone
   for update;
  if v_id is null then raise exception 'card details do not match'; end if;

  if v_user_id = auth.uid() then
    return query select * from public.krema_card(v_id);
    return;
  elsif v_user_id is not null then
    raise exception 'this card is already secured by another account';
  end if;

  update public.customers c set user_id = auth.uid() where c.id = v_id;
  insert into public.card_claim_events (customer_id, user_id, action)
  values (v_id, auth.uid(), 'claim');

  return query select * from public.krema_card(v_id);
end $$;

create or replace function public.get_my_card()
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean,
                 expired int[])
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;

  return query
    select card.*
      from public.customers c
      cross join lateral public.krema_card(c.id) card
     where c.user_id = auth.uid()
     order by c.stamps desc, c.created_at;
end $$;

create or replace function public.unlink_card(p_code text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean,
                 expired int[])
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_user_id uuid;
begin
  if not is_staff() then raise exception 'staff only'; end if;

  select c.id, c.user_id into v_id, v_user_id
    from public.customers c where c.member_code = p_code for update;
  if v_id is null then raise exception 'card not found'; end if;
  if v_user_id is null then raise exception 'card is not linked'; end if;

  update public.customers c set user_id = null where c.id = v_id;
  insert into public.card_claim_events (customer_id, user_id, action)
  values (v_id, v_user_id, 'unlink');

  return query select * from public.krema_card(v_id);
end $$;

-- ── Staff: add a stamp ──────────────────────────────────────────────────
create or replace function public.add_stamp(p_code text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean,
                 expired int[])
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_stamps int;
begin
  if not is_staff() then raise exception 'staff only'; end if;

  select c.id into v_id
    from public.customers c where c.member_code = p_code for update;
  if v_id is null then raise exception 'card not found'; end if;

  perform krema_roll_cycle(v_id);                      -- expired bingsu → fresh card
  select c.stamps into v_stamps from public.customers c where c.id = v_id;
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
--  Any tier (6/10/16/20), once per cycle, only once enough stamps exist,
--  and only on the day it was earned (see krema_expired).
--  Claiming the final tier (20) completes the card: stamps → 0, new cycle.
create or replace function public.claim_reward(p_code text, p_tier int)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean,
                 expired int[])
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_stamps int; v_seq int; v_pending text; v_expired int[];
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if not (p_tier = any (krema_tiers())) then raise exception 'unknown reward'; end if;

  select c.id into v_id
    from public.customers c where c.member_code = p_code for update;
  if v_id is null then raise exception 'card not found'; end if;

  perform krema_roll_cycle(v_id);
  select c.stamps, c.cycle_seq into v_stamps, v_seq
    from public.customers c where c.id = v_id;
  if v_stamps < p_tier then raise exception 'not enough stamps yet'; end if;
  if p_tier = any (krema_claimed(v_id, v_seq)) then
    raise exception 'already claimed';
  end if;
  v_expired := krema_expired(v_id);
  if p_tier = any (v_expired) then
    raise exception 'reward expired — rewards must be claimed the day they are earned';
  end if;

  -- Completing the card resets the cycle, which permanently discards any
  -- reward the customer earned but never collected. Refuse until every
  -- reached, still-valid lower tier is either claimed or explicitly waived
  -- by staff (waive_reward), so nothing is lost by a mis-tap at the counter.
  if p_tier = krema_goal() then
    select string_agg(t::text, ', ' order by t) into v_pending
      from unnest(krema_tiers()) t
     where t < krema_goal()
       and t <= v_stamps
       and not (t = any (krema_claimed(v_id, v_seq)))
       and not (t = any (v_expired));
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
--  Recorded as kind='waived' so it stays distinguishable from a real
--  redemption in reporting — nothing was actually handed over.
create or replace function public.waive_reward(p_code text, p_tier int)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean,
                 expired int[])
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_stamps int; v_seq int;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if not (p_tier = any (krema_tiers())) then raise exception 'unknown reward'; end if;
  if p_tier = krema_goal() then
    raise exception 'the final reward cannot be skipped';
  end if;

  select c.id into v_id
    from public.customers c where c.member_code = p_code for update;
  if v_id is null then raise exception 'card not found'; end if;

  perform krema_roll_cycle(v_id);
  select c.stamps, c.cycle_seq into v_stamps, v_seq
    from public.customers c where c.id = v_id;
  if v_stamps < p_tier then raise exception 'not enough stamps yet'; end if;
  if p_tier = any (krema_claimed(v_id, v_seq)) then
    raise exception 'already claimed';
  end if;
  if p_tier = any (krema_expired(v_id)) then
    raise exception 'reward already expired';
  end if;

  insert into public.redemptions (customer_id, tier, kind, cycle_seq)
  values (v_id, p_tier, 'waived', v_seq);

  return query select * from public.krema_card(v_id);
end $$;

-- ── Staff: look up a card by phone (camera-fail fallback) ───────────────
create or replace function public.staff_lookup(p_phone text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean,
                 expired int[])
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

-- ── Grants (Supabase default privileges re-grant anon on every create) ──
revoke all on function public.krema_expiry_start()             from public, anon, authenticated;
revoke all on function public.krema_expired(uuid)              from public, anon, authenticated;
revoke all on function public.krema_roll_cycle(uuid)           from public, anon, authenticated;
revoke all on function public.krema_card(uuid)                 from public, anon, authenticated;

revoke all on function public.signup_customer(text,text)       from public, anon, authenticated;
revoke all on function public.get_card(text)                   from public, anon, authenticated;
revoke all on function public.customer_lookup(text)            from public, anon, authenticated;
revoke all on function public.customer_lookup(text,text)       from public, anon, authenticated;
revoke all on function public.claim_card(text,text)            from public, anon;
revoke all on function public.get_my_card()                    from public, anon;
revoke all on function public.unlink_card(text)                from public, anon;
revoke all on function public.add_stamp(text)                  from public, anon;
revoke all on function public.claim_reward(text,int)           from public, anon;
revoke all on function public.waive_reward(text,int)           from public, anon;
revoke all on function public.staff_lookup(text)               from public, anon;

grant execute on function public.signup_customer(text,text)       to anon, authenticated;
grant execute on function public.get_card(text)                   to anon, authenticated;
grant execute on function public.customer_lookup(text)            to anon, authenticated;
grant execute on function public.customer_lookup(text,text)       to anon, authenticated;
grant execute on function public.claim_card(text,text)            to authenticated;
grant execute on function public.get_my_card()                    to authenticated;
grant execute on function public.unlink_card(text)                to authenticated;
grant execute on function public.add_stamp(text)                  to authenticated;
grant execute on function public.claim_reward(text,int)           to authenticated;
grant execute on function public.waive_reward(text,int)           to authenticated;
grant execute on function public.staff_lookup(text)               to authenticated;

commit;
