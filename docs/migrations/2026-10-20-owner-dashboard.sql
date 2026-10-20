begin;

-- ════════════════════════════════════════════════════════════════════════
--  Owner dashboard (owner.html) — read-only numbers for the shop owner.
--  Owners are a separate list from staff: the shared barista login must
--  never see every member's name and phone. Add the owner after their
--  Supabase Auth account exists (Authentication → Users → Add user):
--    insert into public.owners (uid)
--    select id from auth.users where email = 'OWNER-EMAIL'
--    on conflict (uid) do nothing;
--  `authenticated` is an untrusted public role (customers have accounts),
--  so every owner RPC starts with the is_owner() check — never remove it.
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.owners (
  uid        uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.owners enable row level security;
revoke all on table public.owners from anon, authenticated;

create or replace function public.is_owner() returns boolean
  language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.owners o where o.uid = auth.uid())
$$;

-- Everything on the page in one call. p_days: 1 = today (Manila calendar day,
-- compared with the same day last week up to the same time), 7 or 30 = rolling
-- window compared with the window before it. Test cards are excluded.
create or replace function public.owner_dashboard(p_days int default 7)
  returns json
  language plpgsql security definer set search_path = public stable as $$
declare
  v_days int := case when p_days in (1, 7, 30) then p_days else 7 end;
  v_from timestamptz; v_prev_from timestamptz; v_prev_to timestamptz;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_week date := date_trunc('week', now() at time zone 'Asia/Manila')::date;
  v_out json;
begin
  if not is_owner() then raise exception 'owner only'; end if;

  if v_days = 1 then
    v_from := v_today::timestamp at time zone 'Asia/Manila';
    v_prev_from := v_from - interval '7 days';
    v_prev_to := now() - interval '7 days';
  else
    v_from := now() - make_interval(days => v_days);
    v_prev_from := now() - make_interval(days => 2 * v_days);
    v_prev_to := v_from;
  end if;

  with c as (
    select * from public.customers where not is_test
  ), e as (
    select e.customer_id, e.staff_uid, e.created_at
      from public.stamp_events e join c on c.id = e.customer_id
  ), last_visit as (
    select customer_id, max(created_at) as at from e group by customer_id
  ), cards as (
    select c.id, c.name, c.member_code, k.stamps, k.claimed, k.expired
      from c cross join lateral public.krema_card(c.id) k
  ), waiting as (
    select cards.name, cards.member_code,
           array(select t from unnest(krema_tiers()) t
                  where t <= cards.stamps
                    and not (t = any (cards.claimed))
                    and not (t = any (cards.expired))
                  order by t) as tiers
      from cards
  ), r as (
    select r.* from public.redemptions r join c on c.id = r.customer_id
     where r.tier is not null and coalesce(r.kind, '') <> 'waived'
  )
  select json_build_object(
    'days', v_days,
    'generated_at', now(),
    'stamps', (select count(*) from e where e.created_at >= v_from),
    'stamps_prev', (select count(*) from e where e.created_at >= v_prev_from and e.created_at < v_prev_to),
    'customers', (select count(distinct e.customer_id) from e where e.created_at >= v_from),
    'first_timers', (select count(*) from (select customer_id, min(created_at) as f from e group by 1) x where x.f >= v_from),
    'rewards', (select count(*) from r where r.redeemed_at >= v_from),
    'new_members', (select count(*) from c where c.created_at >= v_from),
    'members_total', (select count(*) from c),
    'rewards_30d', json_build_object(
      'claimed', (select count(*) from r where r.redeemed_at >= now() - interval '30 days'),
      'expired', (select coalesce(sum(cardinality(cards.expired)), 0) from cards),
      'waiting', (select count(*) from waiting where cardinality(waiting.tiers) > 0)
    ),
    'waiting', coalesce((select json_agg(json_build_object('name', w.name, 'member_code', w.member_code, 'tiers', w.tiers) order by w.tiers desc, w.name)
                           from waiting w where cardinality(w.tiers) > 0), '[]'::json),
    'groups', json_build_object(
      'active',  (select count(*) from last_visit lv where lv.at >= now() - interval '14 days'),
      'cooling', (select count(*) from last_visit lv where lv.at < now() - interval '14 days' and lv.at >= now() - interval '30 days'),
      'lapsed',  (select count(*) from last_visit lv where lv.at < now() - interval '30 days'),
      'never',   (select count(*) from c where not exists (select 1 from last_visit lv where lv.customer_id = c.id))
    ),
    'weekly', (select json_agg(json_build_object('week', w.wk, 'stamps',
                 (select count(*) from e where date_trunc('week', e.created_at at time zone 'Asia/Manila')::date = w.wk)) order by w.wk)
                 from (select v_week - (7 - i) * 7 as wk from generate_series(0, 7) i) w),
    'hours', (select json_agg(json_build_object('hour', h, 'stamps',
                (select count(*) from e where extract(hour from e.created_at at time zone 'Asia/Manila') = h)) order by h)
                from generate_series(10, 22) h),
    'regulars', coalesce((select json_agg(json_build_object('name', x.name, 'member_code', x.member_code, 'lifetime', x.lifetime))
                  from (select name, member_code, lifetime from c where lifetime > 0 order by lifetime desc, created_at limit 5) x), '[]'::json),
    'staff', coalesce((select json_agg(json_build_object('login', split_part(u.email, '@', 1),
                  'stamps', (select count(*) from e where e.staff_uid = s.uid and e.created_at >= v_from)) order by u.email)
                  from public.staff s join auth.users u on u.id = s.uid), '[]'::json),
    'newsletter', (select count(*) from public.newsletter_subscribers ns where ns.unsubscribed_at is null)
  ) into v_out;

  return v_out;
end $$;

-- Who is in a members group, so the owner can message them.
create or replace function public.owner_members(p_group text)
  returns table (name text, phone text, member_code text, stamps int, lifetime int, last_visit timestamptz)
  language plpgsql security definer set search_path = public stable as $$
begin
  if not is_owner() then raise exception 'owner only'; end if;
  if p_group not in ('active', 'cooling', 'lapsed', 'never') then raise exception 'unknown group'; end if;

  return query
    with lv as (
      select e.customer_id, max(e.created_at) as at
        from public.stamp_events e group by e.customer_id
    )
    select c.name, c.phone, c.member_code, c.stamps, c.lifetime, lv.at
      from public.customers c left join lv on lv.customer_id = c.id
     where not c.is_test
       and case p_group
             when 'active'  then lv.at >= now() - interval '14 days'
             when 'cooling' then lv.at < now() - interval '14 days' and lv.at >= now() - interval '30 days'
             when 'lapsed'  then lv.at < now() - interval '30 days'
             else lv.at is null
           end
     order by lv.at desc nulls last, c.created_at desc;
end $$;

revoke all on function public.is_owner()             from public, anon;
revoke all on function public.owner_dashboard(int)   from public, anon;
revoke all on function public.owner_members(text)    from public, anon;
grant execute on function public.is_owner()           to authenticated;
grant execute on function public.owner_dashboard(int) to authenticated;
grant execute on function public.owner_members(text)  to authenticated;

commit;
