-- ════════════════════════════════════════════════════════════════════════
--  Fix: completing a card silently discarded unclaimed rewards
--
--  Reported at the counter: a customer reached 20 stamps without claiming
--  the free drink (10) or free merch (16). Claiming the bingsu reset the
--  card and both were gone — claim_reward started a new cycle regardless of
--  what was still pending.
--
--  Now: the final tier is REFUSED while any reached lower tier is unclaimed.
--  Staff can hand them over, or skip them explicitly with waive_reward.
--
--  RUN THIS in Supabase → SQL Editor. Safe to re-run.
--  Deploy order: SQL first, then the pages (staff.html calls waive_reward).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. claim_reward: refuse completion while rewards are pending ────────
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
  -- reward the customer earned but never collected.
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

-- ── 2. waive_reward: the escape hatch ───────────────────────────────────
-- Without this the guard above deadlocks a card when the customer genuinely
-- doesn't want a reward: they can't complete, and won't claim. Recorded as
-- kind='waived' so reporting can tell it from a real handover.
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

revoke all on function public.waive_reward(text,int) from public;
grant execute on function public.waive_reward(text,int) to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
--  VERIFY
--    select has_function_privilege('authenticated','public.waive_reward(text,int)','execute'),  -- true
--           has_function_privilege('anon','public.waive_reward(text,int)','execute');           -- false
--
--  Then on a TEST card at 20 stamps with tier 10/16 unclaimed:
--    · tapping FREE BINGSU now prompts instead of resetting
--    · Cancel → nothing happens, rewards still there
--    · OK → those tiers are marked waived, then the card completes
--    · claiming 10 and 16 normally, then 20, works with no prompt
-- ════════════════════════════════════════════════════════════════════════
