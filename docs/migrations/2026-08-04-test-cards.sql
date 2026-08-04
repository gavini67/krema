-- ════════════════════════════════════════════════════════════════════════
--  Test cards: stamp your own card without corrupting today's numbers
--
--  Adds customers.is_test and filters it out of stamps_today(). Also drops
--  waived tiers from rewards_given — a waive means nothing was handed over.
--
--  RUN THIS in Supabase → SQL Editor. Safe to re-run.
--  No page deploy needed: stamps_today()'s return shape is unchanged.
-- ════════════════════════════════════════════════════════════════════════
begin;

alter table public.customers
  add column if not exists is_test boolean not null default false;

create or replace function public.stamps_today()
  returns table (stamps_given int, customers_seen int, rewards_given int)
  language plpgsql security definer set search_path = public stable as $$
declare v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return query
    select
      (select count(*)::int from public.stamp_events e
         join public.customers c on c.id = e.customer_id
        where not c.is_test
          and (e.created_at at time zone 'Asia/Manila')::date = v_today),
      (select count(distinct e.customer_id)::int from public.stamp_events e
         join public.customers c on c.id = e.customer_id
        where not c.is_test
          and (e.created_at at time zone 'Asia/Manila')::date = v_today),
      (select count(*)::int from public.redemptions r
         join public.customers c on c.id = r.customer_id
        where not c.is_test
          and r.tier is not null
          and coalesce(r.kind, '') <> 'waived'
          and (r.redeemed_at at time zone 'Asia/Manila')::date = v_today);
end $$;

-- ⚠️ REQUIRED after any create-or-replace: Supabase's default privileges
-- re-grant EXECUTE to anon every time. See HANDOFF §7.
revoke all on function public.stamps_today() from public, anon;
grant execute on function public.stamps_today() to authenticated;

-- Flag the owner's test card.
update public.customers set is_test = true where member_code = 'KREMA-0585';

commit;

-- ════════════════════════════════════════════════════════════════════════
--  VERIFY
--    select member_code, name, is_test from public.customers where is_test;
--      -> KREMA-0585 / Gavin / true
--
--    select has_function_privilege('anon','public.stamps_today()','execute');
--      -> false   (proves the re-grant was undone)
--
--  To flag another test card:   update public.customers set is_test = true
--                                where member_code = 'KREMA-XXXXXX';
--  To un-flag:                  ... set is_test = false ...
-- ════════════════════════════════════════════════════════════════════════
