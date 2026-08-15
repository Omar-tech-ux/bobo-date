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

revoke execute on function public.create_pair_code() from public, anon;
grant execute on function public.create_pair_code() to authenticated;
