-- ════════════════════════════════════════════════════════════════════════
--  Fix: staff-only functions were still EXECUTE-able by the anon role
--
--  Cause: Supabase ships default privileges that grant EXECUTE on every new
--  function in `public` DIRECTLY to anon/authenticated:
--      alter default privileges in schema public
--        grant all on functions to anon, authenticated, service_role;
--  So `revoke ... from public` (the PUBLIC pseudo-role) does NOT remove
--  anon's grant — anon holds its own. Every `create or replace function`
--  re-applies it, too.
--
--  NOT exploitable: each of these starts with
--      if not is_staff() then raise exception 'staff only'; end if;
--  and is_staff() is false for anon (no auth.uid()). This restores the
--  permission layer that was supposed to reject the call before that.
--
--  Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════
begin;

revoke all on function public.add_stamp(text)        from public, anon;
revoke all on function public.claim_reward(text,int) from public, anon;
revoke all on function public.waive_reward(text,int) from public, anon;
revoke all on function public.staff_lookup(text)     from public, anon;
revoke all on function public.stamps_today()         from public, anon;

grant execute on function public.add_stamp(text)        to authenticated;
grant execute on function public.claim_reward(text,int) to authenticated;
grant execute on function public.waive_reward(text,int) to authenticated;
grant execute on function public.staff_lookup(text)     to authenticated;
grant execute on function public.stamps_today()         to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
--  VERIFY — full grant surface. `anon` must be true ONLY for
--  get_card, signup_customer, customer_lookup.
--
--    select p.proname,
--           has_function_privilege('anon',          p.oid, 'execute') as anon,
--           has_function_privilege('authenticated', p.oid, 'execute') as authed
--    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--    order by 2 desc, 1;
--
--  ⚠️ RE-RUN THIS AUDIT after any future migration that creates or replaces
--  a function — the default privilege re-grants anon every single time.
-- ════════════════════════════════════════════════════════════════════════
