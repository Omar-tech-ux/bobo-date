begin;

alter table public.date_invitations
  drop constraint date_invitations_status_check,
  add constraint date_invitations_status_check
    check (status in ('pending', 'accepted', 'needs_changes', 'declined', 'cancelled')),
  add column latest_proposer_id uuid references public.profiles(id),
  add column cancellation_note text check (char_length(cancellation_note) <= 240),
  add column last_action text not null default 'invited'
    check (last_action in ('invited', 'responded', 'cancelled', 'rescheduled')),
  add column last_actor_id uuid references public.profiles(id),
  add column revision integer not null default 0 check (revision >= 0);

update public.date_invitations set
  latest_proposer_id = sender_id,
  last_actor_id = case when status = 'pending' then sender_id else recipient_id end,
  last_action = case when status = 'pending' then 'invited' else 'responded' end;
alter table public.date_invitations
  alter column latest_proposer_id set not null,
  alter column last_actor_id set not null,
  add constraint invitation_proposer_is_participant check (latest_proposer_id in (sender_id, recipient_id)),
  add constraint invitation_actor_is_participant check (last_actor_id in (sender_id, recipient_id));

create function public.initialize_invitation_action()
returns trigger language plpgsql set search_path = public as $$
begin
  new.latest_proposer_id := new.sender_id;
  new.last_actor_id := new.sender_id;
  new.last_action := 'invited';
  new.revision := 0;
  new.status := 'pending';
  new.response_note := null;
  new.responded_at := null;
  new.cancellation_note := null;
  return new;
end;
$$;
create trigger initialize_invitation_action before insert on public.date_invitations
for each row execute function public.initialize_invitation_action();

-- Mutations must go through the locked, revision-checked operation below.
revoke update on public.date_invitations from authenticated;
revoke update (status, response_note, responded_at) on public.date_invitations from authenticated;
drop policy "only the recipient may answer" on public.date_invitations;

create function public.change_date_invitation(
  p_invitation_id uuid,
  p_expected_revision integer,
  p_action text,
  p_note text default null,
  p_status text default null,
  p_date date default null,
  p_time time default null,
  p_timezone text default null,
  p_scheduled_at timestamptz default null
) returns public.date_invitations
language plpgsql security definer set search_path = public as $$
declare
  ticket public.date_invitations;
  caller uuid := auth.uid();
begin
  select * into ticket from public.date_invitations where id = p_invitation_id for update;
  if not found or caller is null or caller not in (ticket.sender_id, ticket.recipient_id)
    or not public.is_couple_member(ticket.couple_id, caller) then
    raise exception 'This invitation is not in your mailbox.' using errcode = '42501';
  end if;
  if p_expected_revision is null or ticket.revision <> p_expected_revision then
    raise exception 'This ticket changed. Please review it and try again.' using errcode = '40001';
  end if;
  if ticket.status not in ('pending', 'accepted', 'needs_changes') then
    raise exception 'This invitation is already closed.';
  end if;
  if char_length(btrim(p_note)) > 240 then raise exception 'Keep your note within 240 characters.'; end if;

  if p_action = 'cancelled' then
    ticket.status := 'cancelled';
    ticket.cancellation_note := nullif(btrim(p_note), '');
  elsif p_action = 'rescheduled' then
    if p_date is null or p_time is null or p_timezone is null or p_scheduled_at is null
      or not exists (select 1 from pg_timezone_names where name = p_timezone) then
      raise exception 'Please choose a real date, time, and timezone.';
    end if;
    -- Check the exact instant as well as its wall clock. This rejects DST gaps
    -- and accepts either real occurrence of an ambiguous fall-back time.
    if not isfinite(p_scheduled_at) or p_scheduled_at <= now()
      or p_scheduled_at at time zone p_timezone <> p_date + p_time then
      raise exception 'Please choose a real date and time in the future.';
    end if;
    if (p_date = ticket.date and p_time = ticket.time and p_timezone = ticket.guest_timezone)
      or p_scheduled_at = (ticket.date + ticket.time) at time zone ticket.guest_timezone then
      raise exception 'Please choose a different time for your date.';
    end if;
    ticket.date := p_date;
    ticket.time := p_time;
    ticket.guest_timezone := p_timezone;
    ticket.latest_proposer_id := caller;
    ticket.status := 'pending';
    ticket.response_note := null;
    ticket.responded_at := null;
  elsif p_action = 'responded' then
    if ticket.status <> 'pending' or caller = ticket.latest_proposer_id then
      raise exception 'Only the other partner can answer the latest proposal.' using errcode = '42501';
    end if;
    if p_status is null or p_status not in ('accepted', 'needs_changes', 'declined') then
      raise exception 'Please choose a valid response.';
    end if;
    ticket.status := p_status;
    ticket.response_note := nullif(btrim(p_note), '');
    ticket.responded_at := now();
  else
    raise exception 'Unknown invitation action.';
  end if;

  update public.date_invitations set
    status = ticket.status, date = ticket.date, time = ticket.time,
    guest_timezone = ticket.guest_timezone, latest_proposer_id = ticket.latest_proposer_id,
    response_note = ticket.response_note, responded_at = ticket.responded_at,
    cancellation_note = ticket.cancellation_note, last_action = p_action,
    last_actor_id = caller, revision = ticket.revision + 1
  where id = ticket.id returning * into ticket;
  return ticket;
end;
$$;
revoke all on function public.change_date_invitation(uuid, integer, text, text, text, date, time, text, timestamptz) from public, anon;
grant execute on function public.change_date_invitation(uuid, integer, text, text, text, date, time, text, timestamptz) to authenticated;
commit;
