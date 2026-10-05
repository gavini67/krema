begin;

-- Exact name + phone can reopen a legacy card only until that card is secured
-- with an email and PIN. The phone-only overload remains a zero-row shim.
create or replace function public.customer_lookup(p_phone text, p_name text)
  returns table (member_code text, name text, stamps int, goal int,
                 tiers int[], claimed int[], expires_at timestamptz, reward_ready boolean)
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

revoke all on function public.customer_lookup(text,text) from public, anon, authenticated;
grant execute on function public.customer_lookup(text,text) to anon, authenticated;

commit;
