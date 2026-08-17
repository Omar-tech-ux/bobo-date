create or replace function public.join_pair_code(submitted_code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  target_couple uuid;
  current_couple uuid;
  current_count integer;
  target_count integer;
begin
  select id into target_couple
  from public.couples
  where pair_code = upper(trim(submitted_code))
  for update;

  if target_couple is null then
    raise exception 'That pairing code could not find its person.';
  end if;

  select couple_id into current_couple
  from public.couple_members
  where user_id = auth.uid();

  if current_couple = target_couple then
    raise exception 'That is your own code, silly goose ♡ Enter the code your person sent you.';
  end if;

  if current_couple is not null then
    select count(*) into current_count
    from public.couple_members
    where couple_id = current_couple;

    if current_count >= 2 then
      raise exception 'This account is already paired with its person.';
    end if;

    delete from public.couples where id = current_couple;
  end if;

  select count(*) into target_count
  from public.couple_members
  where couple_id = target_couple;

  if target_count >= 2 then
    raise exception 'This little mailbox already has its two people.';
  end if;

  insert into public.couple_members (couple_id, user_id)
  values (target_couple, auth.uid());

  update public.couples set sealed = true where id = target_couple;
  return target_couple;
end;
$$;

revoke execute on function public.join_pair_code(text) from public, anon;
grant execute on function public.join_pair_code(text) to authenticated;
