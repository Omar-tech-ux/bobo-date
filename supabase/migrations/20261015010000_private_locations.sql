-- Foreground-only sharing for one explicitly frozen two-account pair.
create table public.location_access (
  singleton boolean primary key default true check (singleton),
  couple_id uuid not null unique references public.couples(id) on delete cascade,
  first_user_id uuid not null,
  second_user_id uuid not null,
  check (first_user_id < second_user_id),
  foreign key (couple_id, first_user_id) references public.couple_members(couple_id, user_id) on delete cascade,
  foreign key (couple_id, second_user_id) references public.couple_members(couple_id, user_id) on delete cascade
);

create table public.location_states (
  user_id uuid primary key,
  couple_id uuid not null references public.location_access(couple_id) on delete cascade,
  sharing_enabled boolean not null default false,
  sharing_revision integer not null default 0 check (sharing_revision >= 0),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  accuracy double precision check (accuracy between 0 and 100000),
  observed_at timestamptz,
  expires_at timestamptz,
  last_accepted_write_at timestamptz,
  foreign key (couple_id, user_id) references public.couple_members(couple_id, user_id) on delete cascade,
  check ((latitude is null and longitude is null and accuracy is null and observed_at is null and expires_at is null)
    or (latitude is not null and longitude is not null and accuracy is not null and observed_at is not null and expires_at is not null
      and expires_at = observed_at + interval '24 hours' and sharing_enabled))
);

alter table public.location_access enable row level security;
alter table public.location_states enable row level security;
-- Access is exclusively through the authenticated, identity-checking RPCs below.
-- In particular, direct reads cannot bypass the RPC's exact expiry redaction.
revoke all on public.location_access, public.location_states from public, anon, authenticated;

-- This runs only once at migration time. Ambiguity leaves the feature disabled;
-- new or replacement couples are never automatically authorized afterwards.
insert into public.location_access(couple_id, first_user_id, second_user_id)
select c.id, (array_agg(m.user_id order by m.user_id))[1], (array_agg(m.user_id order by m.user_id))[2]
from public.couples c join public.couple_members m on m.couple_id = c.id
where c.sealed and (select count(*) from public.couples where sealed) = 1
group by c.id having count(*) = 2;

create function public.authorized_location_access()
returns public.location_access language sql stable security definer set search_path = '' as $$
  select a.* from public.location_access a join public.couples c on c.id = a.couple_id
  where auth.uid() in (a.first_user_id, a.second_user_id) and c.sealed
    and (select array_agg(m.user_id order by m.user_id) from public.couple_members m
      where m.couple_id = a.couple_id) = array[a.first_user_id, a.second_user_id];
$$;
revoke all on function public.authorized_location_access() from public, anon, authenticated;

create function public.get_location_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare allowed public.location_access; server_time timestamptz := clock_timestamp(); states jsonb; revision integer;
begin
  select * into allowed from public.authorized_location_access();
  if allowed.couple_id is null then
    return jsonb_build_object('available', false, 'server_time', server_time, 'own_revision', null, 'states', '[]'::jsonb);
  end if;
  select coalesce(s.sharing_revision, 0) into revision from public.location_states s where s.user_id = auth.uid();
  select jsonb_agg(jsonb_build_object(
    'user_id', members.user_id, 'sharing_enabled', coalesce(s.sharing_enabled, false),
    'latitude', case when s.sharing_enabled and s.expires_at > server_time then s.latitude end,
    'longitude', case when s.sharing_enabled and s.expires_at > server_time then s.longitude end,
    'accuracy', case when s.sharing_enabled and s.expires_at > server_time then s.accuracy end,
    'observed_at', case when s.sharing_enabled and s.expires_at > server_time then s.observed_at end,
    'expires_at', case when s.sharing_enabled and s.expires_at > server_time then s.expires_at end
  ) order by members.user_id) into states
  from unnest(array[allowed.first_user_id, allowed.second_user_id]) members(user_id)
  left join public.location_states s on s.user_id = members.user_id and s.couple_id = allowed.couple_id;
  return jsonb_build_object('available', true, 'server_time', server_time,
    'own_revision', coalesce(revision, 0), 'states', states);
end;
$$;

create function public.enable_location_sharing(p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare allowed public.location_access; state public.location_states;
begin
  select * into allowed from public.authorized_location_access();
  if allowed.couple_id is null then raise exception 'Location sharing is available only to the authorized two accounts.' using errcode = '42501'; end if;
  insert into public.location_states(user_id, couple_id) values (auth.uid(), allowed.couple_id) on conflict (user_id) do nothing;
  select * into state from public.location_states where user_id = auth.uid() for update;
  if p_expected_revision is null or p_expected_revision <> state.sharing_revision then
    raise exception 'Location sharing changed on another device. Review its status before enabling it again.' using errcode = '40001';
  end if;
  update public.location_states set sharing_enabled = true, sharing_revision = sharing_revision + 1
    where user_id = auth.uid() returning * into state;
  return jsonb_build_object('revision', state.sharing_revision);
end;
$$;

create function public.publish_location(p_expected_revision integer, p_latitude double precision,
  p_longitude double precision, p_accuracy double precision, p_observed_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare allowed public.location_access; state public.location_states; server_time timestamptz; next_allowed timestamptz;
begin
  select * into allowed from public.authorized_location_access();
  if allowed.couple_id is null then raise exception 'Location sharing is available only to the authorized two accounts.' using errcode = '42501'; end if;
  select * into state from public.location_states where user_id = auth.uid() for update;
  if state.user_id is null or not state.sharing_enabled or p_expected_revision is null
    or p_expected_revision <> state.sharing_revision then
    raise exception 'Location sharing was stopped or changed on another device.' using errcode = '40001';
  end if;
  -- Read the clock after waiting for a concurrent publisher/Stop to finish.
  server_time := clock_timestamp();
  if p_latitude is null or not (p_latitude between -90 and 90)
    or p_longitude is null or not (p_longitude between -180 and 180)
    or p_accuracy is null or not (p_accuracy between 0 and 100000)
    or p_observed_at is null or not isfinite(p_observed_at)
    or p_observed_at < server_time - interval '2 minutes'
    or p_observed_at > server_time + interval '30 seconds' then
    raise exception 'That location is invalid or too old. Request a fresh location.' using errcode = '22023';
  end if;
  next_allowed := greatest(server_time, state.last_accepted_write_at + interval '60 seconds');
  if state.observed_at is not null and p_observed_at <= state.observed_at then
    return jsonb_build_object('status', 'stale', 'next_allowed_at', next_allowed);
  end if;
  if state.last_accepted_write_at is not null and server_time < state.last_accepted_write_at + interval '60 seconds' then
    return jsonb_build_object('status', 'throttled', 'next_allowed_at', next_allowed);
  end if;
  update public.location_states set latitude = p_latitude, longitude = p_longitude, accuracy = p_accuracy,
    observed_at = p_observed_at, expires_at = p_observed_at + interval '24 hours', last_accepted_write_at = server_time
    where user_id = auth.uid();
  return jsonb_build_object('status', 'accepted', 'next_allowed_at', server_time + interval '60 seconds');
end;
$$;

create function public.stop_location_sharing()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare allowed public.location_access; state public.location_states;
begin
  select * into allowed from public.authorized_location_access();
  if allowed.couple_id is null then raise exception 'Location sharing is available only to the authorized two accounts.' using errcode = '42501'; end if;
  insert into public.location_states(user_id, couple_id) values (auth.uid(), allowed.couple_id) on conflict (user_id) do nothing;
  select * into state from public.location_states where user_id = auth.uid() for update;
  -- Always advance, including when already disabled, to invalidate queued enables.
  update public.location_states set sharing_enabled = false, sharing_revision = sharing_revision + 1,
    latitude = null, longitude = null, accuracy = null, observed_at = null, expires_at = null
    where user_id = auth.uid() returning * into state;
  return jsonb_build_object('revision', state.sharing_revision);
end;
$$;

revoke all on function public.get_location_state() from public, anon;
revoke all on function public.enable_location_sharing(integer) from public, anon;
revoke all on function public.publish_location(integer, double precision, double precision, double precision, timestamptz) from public, anon;
revoke all on function public.stop_location_sharing() from public, anon;
grant execute on function public.get_location_state() to authenticated;
grant execute on function public.enable_location_sharing(integer) to authenticated;
grant execute on function public.publish_location(integer, double precision, double precision, double precision, timestamptz) to authenticated;
grant execute on function public.stop_location_sharing() to authenticated;

create function public.clear_expired_locations()
returns void language sql security definer set search_path = '' as $$
  update public.location_states set latitude = null, longitude = null, accuracy = null, observed_at = null, expires_at = null
    where expires_at <= clock_timestamp();
$$;
revoke all on function public.clear_expired_locations() from public, anon, authenticated;

-- pg_cron is already enabled by the anniversary-reminder migration. The read
-- RPC redacts at 24h even if this physical-scrubbing job is delayed or paused.
do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'clear-expired-locations';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('clear-expired-locations', '*/15 * * * *', 'select public.clear_expired_locations()');
end;
$$;
