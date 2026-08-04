-- ════════════════════════════════════════════════════════════════════════
--  Phase 1 — security hardening (SQL only, ships alone)
--  Plan: docs/superpowers/plans/2026-08-04-customer-accounts-and-newsletter.md
--
--  RUN THIS in Supabase → SQL Editor → New query → paste → Run.
--  Editing supabase-setup.sql does NOT change the live database.
--
--  Safe to re-run. No page deploy needed: no function SHAPE changes, so old
--  JS keeps working (deploy rule #2).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. signup_customer: require the name to match ───────────────────────
-- Before: if the phone was already on a card, this returned THAT card no
-- matter what name you typed — member code included. The member code is the
-- card's only credential (rewards.html?c=CODE), so knowing a phone number was
-- enough to take over a card. Now the name must match too.
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
    raise exception 'that number''s already on a card — tap "already have a card?"';
  end if;

  return query select * from public.krema_card(v_id);
end $$;

-- ── 2. card_claim_events (needed by Phase 3) ────────────────────────────
create table if not exists public.card_claim_events (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  user_id      uuid,
  action       text not null check (action in ('claim','unlink')),
  created_at   timestamptz not null default now()
);

create index if not exists card_claim_events_customer_idx
  on public.card_claim_events (customer_id, created_at desc);

alter table public.card_claim_events enable row level security;
revoke all on public.card_claim_events from anon, authenticated;

-- ── 3. Lock the internal helpers ────────────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC by default and PostgREST publishes every
-- function in `public` as an RPC, so these were all reachable by anon over
-- HTTP. Revoking is safe: every caller is SECURITY DEFINER, so inner calls
-- run as the owner, who keeps EXECUTE.
revoke all on function public.krema_goal()            from public, anon, authenticated;
revoke all on function public.krema_tiers()           from public, anon, authenticated;
revoke all on function public.krema_validity()        from public, anon, authenticated;
revoke all on function public.krema_norm_phone(text)  from public, anon, authenticated;
revoke all on function public.krema_new_code()        from public, anon, authenticated;
revoke all on function public.krema_claimed(uuid,int) from public, anon, authenticated;
revoke all on function public.krema_card(uuid)        from public, anon, authenticated;

-- is_staff() stays callable by logged-in users: staff.html needs it to gate
-- its own UI in Phase 2. Never anon.
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
--  VERIFY (run after, expect the stated result)
--
--  1) Name check is live:
--       select pg_get_functiondef('public.signup_customer(text,text)'::regprocedure);
--     -> should contain "is distinct from lower(p_name)"
--
--  2) Helpers are locked (should all be FALSE):
--       select has_function_privilege('anon','public.krema_card(uuid)','execute'),
--              has_function_privilege('anon','public.krema_new_code()','execute'),
--              has_function_privilege('anon','public.krema_norm_phone(text)','execute'),
--              has_function_privilege('anon','public.is_staff()','execute');
--
--  3) The real RPCs still work (should all be TRUE):
--       select has_function_privilege('anon','public.get_card(text)','execute'),
--              has_function_privilege('anon','public.signup_customer(text,text)','execute'),
--              has_function_privilege('authenticated','public.add_stamp(text)','execute'),
--              has_function_privilege('authenticated','public.is_staff()','execute');
--
--  4) Live smoke test — the counter path must still work:
--     open rewards.html?c=<a real code> in a private window; card renders.
--     Then in staff.html add a stamp. Both must still succeed.
-- ════════════════════════════════════════════════════════════════════════
