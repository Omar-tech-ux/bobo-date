create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);

create table if not exists public.couples (
  id uuid primary key default gen_random_uuid(),
  pair_code text not null unique check (pair_code ~ '^[A-F0-9]{6}$'),
  created_by uuid not null references public.profiles(id) on delete cascade,
  sealed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.couple_members (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (couple_id, user_id)
);

create table if not exists public.date_invitations (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  time time not null,
  activity text not null check (activity in ('video-dinner', 'movie-night', 'online-game', 'coffee-call', 'surprise')),
  guest_timezone text not null,
  host_timezone text not null default 'Asia/Amman',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'needs_changes', 'declined')),
  response_note text check (char_length(response_note) <= 240),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (sender_id <> recipient_id)
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  requested_username text;
  requested_name text;
begin
  requested_username := lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)));
  requested_username := regexp_replace(requested_username, '[^a-z0-9_]', '', 'g');
  if char_length(requested_username) < 3 then
    requested_username := 'bobo_' || substring(new.id::text from 1 for 6);
  end if;
  requested_name := left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), 'Bobo'), 40);

  insert into public.profiles (id, username, display_name)
  values (new.id, left(requested_username, 20), requested_name);
  return new;
exception when unique_violation then
  raise exception 'That tiny username is already taken. Please choose another one.';
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_couple_member(target_couple uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.couple_members
    where couple_id = target_couple and user_id = target_user
  );
$$;

create or replace function public.are_couplemates(first_user uuid, second_user uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.couple_members mine
    join public.couple_members theirs on theirs.couple_id = mine.couple_id
    where mine.user_id = first_user and theirs.user_id = second_user
  );
$$;

alter table public.profiles enable row level security;
alter table public.couples enable row level security;
alter table public.couple_members enable row level security;
alter table public.date_invitations enable row level security;
alter table public.push_subscriptions enable row level security;

revoke all on public.profiles from anon;
revoke all on public.couples from anon;
revoke all on public.couple_members from anon;
revoke all on public.date_invitations from anon;
revoke all on public.push_subscriptions from anon;

create policy "profiles are visible only inside the pair"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.are_couplemates(auth.uid(), id));

create policy "people may update their own profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "couples are visible to their members"
on public.couples for select
to authenticated
using (public.is_couple_member(id));

create policy "members may see their two-person membership"
on public.couple_members for select
to authenticated
using (public.is_couple_member(couple_id));

create policy "invitations stay inside their pair"
on public.date_invitations for select
to authenticated
using (
  public.is_couple_member(couple_id)
  and auth.uid() in (sender_id, recipient_id)
);

create policy "a member may invite only their partner"
on public.date_invitations for insert
to authenticated
with check (
  sender_id = auth.uid()
  and public.is_couple_member(couple_id, sender_id)
  and public.is_couple_member(couple_id, recipient_id)
  and sender_id <> recipient_id
);

create policy "only the recipient may answer"
on public.date_invitations for update
to authenticated
using (recipient_id = auth.uid() and public.is_couple_member(couple_id))
with check (recipient_id = auth.uid() and public.is_couple_member(couple_id));

revoke update on public.date_invitations from authenticated;
grant update (status, response_note, responded_at) on public.date_invitations to authenticated;

create policy "people manage their own notification devices"
on public.push_subscriptions for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.create_pair_code()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  existing_code text;
  new_code text;
  new_couple uuid;
begin
  select c.pair_code into existing_code
  from public.couples c
  join public.couple_members m on m.couple_id = c.id
  where m.user_id = auth.uid();

  if existing_code is not null then return existing_code; end if;

  loop
    new_code := upper(substring(encode(extensions.gen_random_bytes(5), 'hex') from 1 for 6));
    begin
      insert into public.couples (pair_code, created_by)
      values (new_code, auth.uid()) returning id into new_couple;
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;

  insert into public.couple_members (couple_id, user_id) values (new_couple, auth.uid());
  return new_code;
end;
$$;

create or replace function public.join_pair_code(submitted_code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  target_couple uuid;
  current_count integer;
begin
  if exists (select 1 from public.couple_members where user_id = auth.uid()) then
    raise exception 'This account already belongs to a pair.';
  end if;

  select id into target_couple
  from public.couples
  where pair_code = upper(trim(submitted_code))
  for update;

  if target_couple is null then
    raise exception 'That pairing code could not find its person.';
  end if;

  select count(*) into current_count from public.couple_members where couple_id = target_couple;
  if current_count >= 2 then
    raise exception 'This little mailbox already has its two people.';
  end if;

  insert into public.couple_members (couple_id, user_id) values (target_couple, auth.uid());
  update public.couples set sealed = true where id = target_couple;
  return target_couple;
end;
$$;

create or replace function public.get_my_pairing()
returns table (
  couple_id uuid,
  pair_code text,
  partner_id uuid,
  partner_username text,
  partner_display_name text
)
language sql
stable
security definer set search_path = public
as $$
  select
    c.id,
    c.pair_code,
    partner.id,
    partner.username::text,
    partner.display_name
  from public.couple_members mine
  join public.couples c on c.id = mine.couple_id
  left join public.couple_members other
    on other.couple_id = mine.couple_id and other.user_id <> mine.user_id
  left join public.profiles partner on partner.id = other.user_id
  where mine.user_id = auth.uid()
  limit 1;
$$;

revoke execute on function public.create_pair_code() from public, anon;
revoke execute on function public.join_pair_code(text) from public, anon;
revoke execute on function public.get_my_pairing() from public, anon;
grant execute on function public.create_pair_code() to authenticated;
grant execute on function public.join_pair_code(text) to authenticated;
grant execute on function public.get_my_pairing() to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.date_invitations;
exception when duplicate_object then
  null;
end $$;
