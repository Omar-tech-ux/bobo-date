begin;

alter table public.date_invitations add column activities text[];
update public.date_invitations set activities = array[activity];

create function public.valid_invitation_activities(value text[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce(
    array_ndims(value) = 1 and array_lower(value, 1) = 1
    and cardinality(value) between 1 and 5
    and array_position(value, null) is null
    and value <@ array['video-dinner', 'movie-night', 'online-game', 'coffee-call', 'surprise']::text[]
    and cardinality(value) = (select count(distinct item) from unnest(value) item), false);
$$;

alter table public.date_invitations
  alter column activities set not null,
  add constraint invitation_activities_valid check (public.valid_invitation_activities(activities)),
  add constraint invitation_first_activity_matches check (activity = activities[1]);

create function public.initialize_invitation_activities()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.activities is null then
    new.activities := array[new.activity];
  else
    new.activity := new.activities[1];
  end if;
  return new;
end;
$$;

create trigger initialize_invitation_activities before insert on public.date_invitations
for each row execute function public.initialize_invitation_activities();

commit;
