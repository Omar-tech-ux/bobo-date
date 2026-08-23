-- Monthly anniversary reminders are backend-only. The guarded seed enables the
-- feature only when this private app has exactly one sealed couple.
create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table public.anniversary_reminder_settings (
  couple_id uuid primary key references public.couples(id) on delete cascade,
  time_zone text not null default 'Asia/Amman' check (char_length(trim(time_zone)) between 1 and 80),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.anniversary_notification_deliveries (
  couple_id uuid not null references public.couples(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  reminder_date date not null,
  slot text not null check (slot in ('midnight', 'morning')),
  status text not null check (status in ('processing', 'accepted', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  lease_expires_at timestamptz,
  accepted_at timestamptz,
  last_error text check (char_length(last_error) <= 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (subscription_id, reminder_date, slot)
);

create index anniversary_delivery_couple_date_idx
  on public.anniversary_notification_deliveries (couple_id, reminder_date, slot);

alter table public.anniversary_reminder_settings enable row level security;
alter table public.anniversary_notification_deliveries enable row level security;

revoke all on public.anniversary_reminder_settings from anon, authenticated;
revoke all on public.anniversary_notification_deliveries from anon, authenticated;

grant usage on schema public to service_role;
grant select on public.couples, public.couple_members, public.anniversary_reminder_settings to service_role;
grant select, insert, update on public.anniversary_notification_deliveries to service_role;

create or replace function public.claim_anniversary_delivery(
  p_couple_id uuid,
  p_subscription_id uuid,
  p_reminder_date date,
  p_slot text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean;
begin
  with claimed_row as (
    insert into public.anniversary_notification_deliveries (
      couple_id,
      subscription_id,
      reminder_date,
      slot,
      status,
      attempts,
      lease_expires_at,
      updated_at
    )
    values (
      p_couple_id,
      p_subscription_id,
      p_reminder_date,
      p_slot,
      'processing',
      1,
      now() + interval '90 seconds',
      now()
    )
    on conflict (subscription_id, reminder_date, slot) do update
      set status = 'processing',
          attempts = public.anniversary_notification_deliveries.attempts + 1,
          lease_expires_at = now() + interval '90 seconds',
          last_error = null,
          updated_at = now()
      where public.anniversary_notification_deliveries.status = 'failed'
         or (
           public.anniversary_notification_deliveries.status = 'processing'
           and public.anniversary_notification_deliveries.lease_expires_at < now()
         )
    returning true
  )
  select coalesce(bool_or(true), false) into claimed from claimed_row;

  return coalesce(claimed, false);
end;
$$;

revoke all on function public.claim_anniversary_delivery(uuid, uuid, date, text) from public, anon, authenticated;
grant execute on function public.claim_anniversary_delivery(uuid, uuid, date, text) to service_role;

-- Enable the reminder only if the intended pair is unambiguous. Empty local
-- databases and projects with multiple sealed couples remain safely disabled.
insert into public.anniversary_reminder_settings (couple_id, time_zone, enabled)
select id, 'Asia/Amman', true
from public.couples
where sealed = true
  and (select count(*) from public.couples where sealed = true) = 1
on conflict (couple_id) do nothing;

create or replace function public.enqueue_anniversary_reminder_if_due()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  amman_now timestamp without time zone := timezone('Asia/Amman', now());
  local_time time without time zone;
  automation_secret text;
  request_id bigint;
begin
  local_time := amman_now::time;
  if extract(day from amman_now) <> 14
     or not (
       (local_time >= time '00:00' and local_time < time '00:15')
       or (local_time >= time '10:00' and local_time < time '10:15')
     ) then
    return null;
  end if;

  select decrypted_secret
  into automation_secret
  from vault.decrypted_secrets
  where name = 'anniversary_automation_secret'
  order by created_at desc
  limit 1;

  if automation_secret is null or char_length(automation_secret) < 32 then
    raise warning 'Anniversary automation secret is missing from Vault';
    return null;
  end if;

  select net.http_post(
    url := 'https://mkokgytybuencwkilpbh.supabase.co/functions/v1/notify-anniversary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-anniversary-secret', automation_secret
    ),
    body := jsonb_build_object('scheduled_at', now()),
    timeout_milliseconds := 10000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.enqueue_anniversary_reminder_if_due() from public, anon, authenticated;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'notify-anniversary-reminders';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'notify-anniversary-reminders',
    '* * 13-15 * *',
    'select public.enqueue_anniversary_reminder_if_due()'
  );
end;
$$;
