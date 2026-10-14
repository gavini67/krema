begin;

-- ════════════════════════════════════════════════════════════════════════
--  K-list newsletter (Phase 4)
--  Marketing consent lives here, never on public.customers: rewards email is
--  transactional, newsletter email is marketing — separate lists, separate consent.
--  Campaigns go out from Brevo; Brevo's own unsubscribe link is the opt-out, and
--  Brevo keeps unsubscribed contacts blocklisted across re-imports.
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.newsletter_subscribers (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique check (email = lower(btrim(email))),
  source           text not null default 'footer',
  consent_text     text not null,
  consented_at     timestamptz not null default now(),
  consent_ip       text,
  unsubscribed_at  timestamptz,
  created_at       timestamptz not null default now()
);
alter table public.newsletter_subscribers enable row level security;
revoke all on table public.newsletter_subscribers from anon, authenticated;
create index if not exists newsletter_subscribers_ip_recent
  on public.newsletter_subscribers (consent_ip, consented_at);

-- Always succeeds for a valid address, new or duplicate: an "already subscribed"
-- answer would let anyone test whether an email is on the list. The consent
-- sentence is fixed here, not sent by the client, and must match the checkbox
-- label in index.html word for word (tests/newsletter.test.js checks this).
create or replace function public.subscribe_newsletter(p_email text, p_source text default 'footer')
  returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_consent constant text := 'Yes, email me Krema news, new drops & promos. I can unsubscribe anytime.';
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_source  text := left(coalesce(nullif(btrim(p_source), ''), 'footer'), 40);
  v_headers json := nullif(current_setting('request.headers', true), '')::json;
  v_ip      text;
begin
  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email';
  end if;

  v_ip := coalesce(nullif(btrim(v_headers ->> 'cf-connecting-ip'), ''),
                   nullif(btrim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''));

  -- Bot guard: at most 5 fresh sign-ups per IP per hour.
  if v_ip is not null and (
       select count(*) from public.newsletter_subscribers s
        where s.consent_ip = v_ip and s.consented_at > now() - interval '1 hour') >= 5 then
    raise exception 'too many sign-ups, try again later';
  end if;

  insert into public.newsletter_subscribers (email, source, consent_text, consented_at, consent_ip)
  values (v_email, v_source, v_consent, now(), v_ip)
  on conflict (email) do update
     set source = excluded.source,
         consent_text = excluded.consent_text,
         consented_at = excluded.consented_at,
         consent_ip = excluded.consent_ip,
         unsubscribed_at = null
   where public.newsletter_subscribers.unsubscribed_at is not null;
end $$;

revoke all on function public.subscribe_newsletter(text,text) from public, anon, authenticated;
grant execute on function public.subscribe_newsletter(text,text) to anon, authenticated;

commit;
