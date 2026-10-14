-- Private monthly contributions. Calendar dates always refer to the 14th in Amman.
create or replace function public.anniversary_due_date(p_now timestamptz)
returns date language sql immutable set search_path = '' as $$
  select case when d >= date '2026-10-14' then d end
  from (select (date_trunc('month', timezone('Asia/Amman', p_now))
    - case when extract(day from timezone('Asia/Amman', p_now)) < 15
      then interval '1 month' else interval '0' end + interval '13 days')::date d) dates;
$$;
revoke all on function public.anniversary_due_date(timestamptz) from public, anon;
grant execute on function public.anniversary_due_date(timestamptz) to authenticated;

create table public.anniversary_contributions (
  couple_id uuid not null references public.couples(id) on delete cascade,
  anniversary_date date not null check (anniversary_date >= date '2026-10-14' and extract(day from anniversary_date) = 14),
  user_id uuid not null references public.profiles(id) on delete cascade,
  revision integer not null default 0 check (revision >= 0),
  completed_at timestamptz,
  primary key (couple_id, anniversary_date, user_id),
  foreign key (couple_id, user_id) references public.couple_members(couple_id, user_id) on delete cascade
);

create table public.anniversary_photos (
  id uuid primary key,
  couple_id uuid not null,
  anniversary_date date not null,
  user_id uuid not null,
  object_path text not null unique,
  slot smallint not null check (slot between 1 and 3),
  width integer not null check (width between 1 and 2560),
  height integer not null check (height between 1 and 2560),
  unique (couple_id, anniversary_date, user_id, slot),
  foreign key (couple_id, anniversary_date, user_id)
    references public.anniversary_contributions(couple_id, anniversary_date, user_id) on delete cascade
);

alter table public.anniversary_contributions enable row level security;
alter table public.anniversary_photos enable row level security;
revoke all on public.anniversary_contributions, public.anniversary_photos from anon, authenticated;
grant select on public.anniversary_contributions, public.anniversary_photos to authenticated;
grant all on public.anniversary_contributions, public.anniversary_photos to service_role;
create policy "pair reads anniversary contributions" on public.anniversary_contributions
  for select to authenticated using (public.is_couple_member(couple_id));
create policy "pair reads anniversary photos" on public.anniversary_photos
  for select to authenticated using (public.is_couple_member(couple_id));

-- Bucket provisioning is transactional with the application's access policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anniversary-photos', 'anniversary-photos', false, 5242880, array['image/jpeg']);

create or replace function public.can_upload_anniversary_photo(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare parts text[] := string_to_array(p_name, '/');
begin
  if auth.uid() is null or array_length(parts, 1) <> 4
    or parts[3] <> auth.uid()::text
    or parts[2] !~ '^\d{4}-(0[1-9]|1[0-2])-14$'
    or parts[4] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
  then return false; end if;
  return parts[2]::date >= date '2026-10-14'
    and parts[2]::date <= public.anniversary_due_date(now())
    and exists (select 1 from public.couple_members m join public.couples c on c.id = m.couple_id
      where m.user_id = auth.uid() and m.couple_id::text = parts[1] and c.sealed);
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$$;
revoke all on function public.can_upload_anniversary_photo(text) from public, anon;
grant execute on function public.can_upload_anniversary_photo(text) to authenticated;

create policy "own immutable anniversary uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'anniversary-photos' and owner_id = auth.uid()::text
    and public.can_upload_anniversary_photo(name));
create policy "read own uploads or paired saved photos" on storage.objects for select to authenticated
  using (bucket_id = 'anniversary-photos' and (
    (owner_id = auth.uid()::text and public.can_upload_anniversary_photo(name))
    or exists (select 1 from public.anniversary_photos p where p.object_path = name
      and public.is_couple_member(p.couple_id))
  ));
-- A newly attached object must be <1h old. Cleanup waits >24h, so a reference
-- cannot race into existence between this predicate and the physical deletion.
create policy "clean own unused anniversary uploads" on storage.objects for delete to authenticated
  using (bucket_id = 'anniversary-photos' and owner_id = auth.uid()::text
    and created_at < now() - interval '24 hours'
    and not exists (select 1 from public.anniversary_photos p where p.object_path = name));

create or replace function public.get_anniversary_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare pair uuid; due date := public.anniversary_due_date(now()); item public.anniversary_contributions;
begin
  select m.couple_id into pair from public.couple_members m join public.couples c on c.id = m.couple_id
    where m.user_id = auth.uid() and c.sealed;
  if pair is null then raise exception 'Pair your accounts first.' using errcode = '42501'; end if;
  select * into item from public.anniversary_contributions
    where couple_id = pair and user_id = auth.uid() and anniversary_date = due;
  return jsonb_build_object('latest_date', due, 'completed_at', item.completed_at, 'revision', coalesce(item.revision, 0));
end;
$$;

create or replace function public.save_anniversary_photos(p_anniversary_date date, p_expected_revision integer, p_photos jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pair uuid;
  actor uuid := auth.uid();
  item public.anniversary_contributions;
  photo jsonb;
  photo_id uuid;
  photo_path text;
  ids uuid[] := array[]::uuid[];
  position integer := 0;
begin
  select m.couple_id into pair from public.couple_members m join public.couples c on c.id = m.couple_id
    where m.user_id = actor and c.sealed;
  if pair is null then raise exception 'Pair your accounts first.' using errcode = '42501'; end if;
  if p_anniversary_date is null or p_anniversary_date < date '2026-10-14'
    or extract(day from p_anniversary_date) <> 14
    or public.anniversary_due_date(now()) is null
    or p_anniversary_date > public.anniversary_due_date(now()) then
    raise exception 'Photos unlock on the 15th in Amman time.' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_photos is null
    or jsonb_typeof(p_photos) <> 'array' then
    raise exception 'Invalid photo selection.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_photos) > 3 then raise exception 'Choose at most three photos.' using errcode = '22023'; end if;

  insert into public.anniversary_contributions(couple_id, anniversary_date, user_id)
    values (pair, p_anniversary_date, actor) on conflict do nothing;
  select * into item from public.anniversary_contributions
    where couple_id = pair and anniversary_date = p_anniversary_date and user_id = actor for update;
  if item.revision <> p_expected_revision then
    raise exception 'Your photos changed on another device.' using errcode = '40001';
  end if;

  for photo in select value from jsonb_array_elements(p_photos) loop
    photo_id := (photo->>'id')::uuid;
    if photo_id is null or photo_id = any(ids)
      or (photo->>'width') is null or (photo->>'height') is null
      or (photo->>'width')::integer not between 1 and 2560
      or (photo->>'height')::integer not between 1 and 2560 then
      raise exception 'Invalid or repeated photo.' using errcode = '22023';
    end if;
    ids := array_append(ids, photo_id);
    photo_path := pair::text || '/' || p_anniversary_date::text || '/' || actor::text || '/' || photo_id::text || '.jpg';
    if not exists (select 1 from storage.objects o where o.bucket_id = 'anniversary-photos'
      and o.name = photo_path and o.owner_id = actor::text
      and o.metadata->>'mimetype' = 'image/jpeg'
      and (o.metadata->>'size')::bigint between 1 and 5242880
      and (o.created_at > now() - interval '1 hour' or exists (
        select 1 from public.anniversary_photos p where p.id = photo_id and p.object_path = photo_path
          and p.couple_id = pair and p.anniversary_date = p_anniversary_date and p.user_id = actor
      ))) then
      raise exception 'A photo is missing or its upload expired. Choose it again.' using errcode = '22023';
    end if;
  end loop;

  delete from public.anniversary_photos where couple_id = pair and anniversary_date = p_anniversary_date and user_id = actor;
  for photo in select value from jsonb_array_elements(p_photos) loop
    position := position + 1;
    photo_id := (photo->>'id')::uuid;
    insert into public.anniversary_photos(id, couple_id, anniversary_date, user_id, object_path, slot, width, height)
    values (photo_id, pair, p_anniversary_date, actor,
      pair::text || '/' || p_anniversary_date::text || '/' || actor::text || '/' || photo_id::text || '.jpg',
      position, (photo->>'width')::integer, (photo->>'height')::integer);
  end loop;
  update public.anniversary_contributions set revision = revision + 1,
    completed_at = case when position > 0 then coalesce(completed_at, now()) else null end
    where couple_id = pair and anniversary_date = p_anniversary_date and user_id = actor returning * into item;
  return to_jsonb(item) || jsonb_build_object('photos', coalesce((select jsonb_agg(to_jsonb(p) order by p.slot)
    from public.anniversary_photos p where p.couple_id = pair and p.anniversary_date = p_anniversary_date and p.user_id = actor), '[]'::jsonb));
end;
$$;

create or replace function public.list_my_unused_anniversary_uploads(p_limit integer default 20)
returns table(name text) language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o
  where o.bucket_id = 'anniversary-photos' and o.owner_id = auth.uid()::text
    and o.created_at < now() - interval '24 hours'
    and not exists (select 1 from public.anniversary_photos p where p.object_path = o.name)
  order by o.created_at limit least(greatest(coalesce(p_limit, 20), 1), 20);
$$;

revoke all on function public.get_anniversary_status() from public, anon;
revoke all on function public.save_anniversary_photos(date, integer, jsonb) from public, anon;
revoke all on function public.list_my_unused_anniversary_uploads(integer) from public, anon;
grant execute on function public.get_anniversary_status() to authenticated;
grant execute on function public.save_anniversary_photos(date, integer, jsonb) to authenticated;
grant execute on function public.list_my_unused_anniversary_uploads(integer) to authenticated;
