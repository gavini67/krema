-- Phase 3 — customer accounts
-- Paste once into Supabase SQL Editor after the Phase 1 hardening migration.
-- This is additive: it preserves existing customers, stamps, rewards, staff,
-- and Auth users.
begin;

alter table public.customers
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists customers_user_id_idx
  on public.customers (user_id);

alter table public.card_claim_events enable row level security;
revoke all on public.card_claim_events from anon, authenticated;

create or replace function public.signup_customer(p_name text, p_phone text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean)
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_phone text; v_name text; v_user_id uuid;
begin
  p_name := trim(p_name);
  if length(p_name) < 1 then raise exception 'please enter your name'; end if;
  if length(p_name) > 60 then p_name := substr(p_name, 1, 60); end if;

  v_phone := krema_norm_phone(p_phone);
  if v_phone is null then
    raise exception 'enter a valid mobile number, e.g. 0917 123 4567';
  end if;

  -- Lock an existing card through the returned card shape. This conflicts
  -- with claim_card's link update, so signup cannot return a newly secured
  -- existing card after checking its previous user_id.
  select c.id, c.name, c.user_id into v_id, v_name, v_user_id
    from public.customers c where c.phone = v_phone for share;

  if v_id is null then
    insert into public.customers (member_code, name, phone, stamps, lifetime)
    values (krema_new_code(), p_name, v_phone, 0, 0)
    returning id into v_id;
  elsif lower(trim(v_name)) is distinct from lower(p_name) then
    raise exception 'that number''s already on a card — tap "already have a card?"';
  elsif v_user_id is not null then
    raise exception 'this card is already secured — sign in to continue';
  end if;

  return query select * from public.krema_card(v_id);
end $$;

create or replace function public.customer_lookup(p_phone text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean)
  language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select c.id into v_id from public.customers c
   where (c.phone = coalesce(krema_norm_phone(p_phone), '~none~')
      or c.phone = trim(p_phone))
     and c.user_id is null
   limit 1 for share;
  if v_id is null then return; end if;
  return query select * from public.krema_card(v_id);
end $$;

create or replace function public.customer_lookup(p_phone text, p_name text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean)
  language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_phone text;
begin
  v_phone := krema_norm_phone(p_phone);
  if v_phone is null then return; end if;

  select c.id into v_id from public.customers c
   where c.phone = v_phone
     and lower(trim(c.name)) = lower(trim(p_name))
     and c.user_id is null
   limit 1 for share;
  if v_id is null then return; end if;
  return query select * from public.krema_card(v_id);
end $$;

create or replace function public.claim_card(p_code text, p_phone text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean)
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
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean)
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
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean)
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

-- Supabase restores default grants whenever a function is replaced. Keep anon
-- limited to public customer-card entrypoints, and grant account/staff work
-- only to authenticated users (staff authorization is enforced in each RPC).
revoke all on function public.signup_customer(text,text)       from public, anon, authenticated;
revoke all on function public.customer_lookup(text)            from public, anon, authenticated;
revoke all on function public.customer_lookup(text,text)       from public, anon, authenticated;
revoke all on function public.claim_card(text,text)            from public, anon;
revoke all on function public.get_my_card()                    from public, anon;
revoke all on function public.unlink_card(text)                from public, anon;

grant execute on function public.signup_customer(text,text)       to anon, authenticated;
grant execute on function public.get_card(text)                   to anon, authenticated;
grant execute on function public.customer_lookup(text)            to anon, authenticated;
grant execute on function public.customer_lookup(text,text)       to anon, authenticated;
grant execute on function public.claim_card(text,text)            to authenticated;
grant execute on function public.get_my_card()                    to authenticated;
grant execute on function public.unlink_card(text)                to authenticated;

commit;
