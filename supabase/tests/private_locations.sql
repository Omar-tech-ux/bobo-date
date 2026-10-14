-- Rollback-only security, expiration, throttle, and opt-out checks. No real
-- account locations are read; the allowlist replacement is transaction-local.
begin;

do $$
begin
  assert not has_table_privilege('authenticated', 'public.location_access', 'SELECT');
  assert not has_table_privilege('authenticated', 'public.location_states', 'SELECT');
  assert not has_table_privilege('authenticated', 'public.location_states', 'INSERT');
  assert not has_table_privilege('authenticated', 'public.location_states', 'UPDATE');
  assert not has_table_privilege('authenticated', 'public.location_states', 'DELETE');
  assert not has_function_privilege('anon', 'public.get_location_state()', 'EXECUTE');
  assert not has_function_privilege('anon', 'public.enable_location_sharing(integer)', 'EXECUTE');
  assert not has_function_privilege('anon', 'public.stop_location_sharing()', 'EXECUTE');
  assert not has_function_privilege('anon', 'public.publish_location(integer,double precision,double precision,double precision,timestamptz)', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'public.authorized_location_access()', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'public.clear_expired_locations()', 'EXECUTE');
  assert (select bool_and(relrowsecurity) from pg_class where oid in ('public.location_access'::regclass, 'public.location_states'::regclass));
  assert exists (select 1 from cron.job where jobname = 'clear-expired-locations' and schedule = '*/15 * * * *' and active);
end;
$$;

delete from public.location_access;
do $$
declare
  person uuid := gen_random_uuid(); partner uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  outsiders_partner uuid := gen_random_uuid(); third_person uuid := gen_random_uuid();
  pair uuid := gen_random_uuid(); other_pair uuid := gen_random_uuid(); actor uuid;
begin
  perform set_config('location_test.person', person::text, true);
  perform set_config('location_test.partner', partner::text, true);
  perform set_config('location_test.outsider', outsider::text, true);
  perform set_config('location_test.third_person', third_person::text, true);
  perform set_config('location_test.pair', pair::text, true);
  foreach actor in array array[person, partner, outsider, outsiders_partner, third_person] loop
    insert into auth.users(id, email, raw_user_meta_data) values (actor, actor::text || '@example.invalid',
      jsonb_build_object('display_name', 'Location test', 'username', 'loc_' || substr(replace(actor::text, '-', ''), 1, 12)));
    insert into public.profiles(id, username, display_name)
      values (actor, 'loc_' || substr(replace(actor::text, '-', ''), 1, 12), 'Location test') on conflict (id) do nothing;
  end loop;
  insert into public.couples(id, pair_code, created_by, sealed)
    values (pair, upper(substr(replace(pair::text, '-', ''), 1, 6)), person, true),
      (other_pair, upper(substr(replace(other_pair::text, '-', ''), 1, 6)), outsider, true);
  insert into public.couple_members(couple_id, user_id)
    values (pair, person), (pair, partner), (other_pair, outsider), (other_pair, outsiders_partner);
  insert into public.location_access(couple_id, first_user_id, second_user_id)
    values (pair, least(person, partner), greatest(person, partner));
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('location_test.person'), true);
do $$
declare result jsonb; observed timestamptz := clock_timestamp(); denied boolean; bad double precision;
begin
  result := public.get_location_state();
  assert (result->>'available')::boolean and (result->>'own_revision')::integer = 0;
  assert jsonb_array_length(result->'states') = 2;
  assert not exists (select 1 from jsonb_array_elements(result->'states') s where (s->>'sharing_enabled')::boolean or s->>'latitude' is not null);
  assert (public.enable_location_sharing(0)->>'revision')::integer = 1;
  result := public.publish_location(1, 31.95, 35.91, 50, observed);
  assert result->>'status' = 'accepted';
  assert (result->>'next_allowed_at')::timestamptz > observed;
  assert public.publish_location(1, 31.96, 35.92, 50, observed)->>'status' = 'stale';
  assert public.publish_location(1, 31.96, 35.92, 50, observed + interval '1 second')->>'status' = 'throttled';
  foreach bad in array array['NaN'::double precision, 'Infinity'::double precision, 91::double precision] loop
    denied := false;
    begin perform public.publish_location(1, bad, 35.91, 50, observed);
    exception when invalid_parameter_value then denied := true; end;
    assert denied, 'Invalid latitude was accepted';
  end loop;
  denied := false;
  begin perform public.publish_location(1, 31.95, 181, 50, observed);
  exception when invalid_parameter_value then denied := true; end;
  assert denied, 'Invalid longitude was accepted';
  denied := false;
  begin perform public.publish_location(1, 31.95, 35.91, -1, observed);
  exception when invalid_parameter_value then denied := true; end;
  assert denied, 'Invalid accuracy was accepted';
  denied := false;
  begin perform public.publish_location(1, 31.95, 35.91, 50, observed - interval '3 minutes');
  exception when invalid_parameter_value then denied := true; end;
  assert denied, 'An old cached observation was accepted';
  denied := false;
  begin perform public.publish_location(1, 31.95, 35.91, 50, observed + interval '1 minute');
  exception when invalid_parameter_value then denied := true; end;
  assert denied, 'A future observation was accepted';
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('location_test.partner'), true);
do $$
declare result jsonb; person_state jsonb;
begin
  result := public.get_location_state();
  assert (result->>'own_revision')::integer = 0, 'Partner inherited the other account revision';
  select s into person_state from jsonb_array_elements(result->'states') s where s->>'user_id' = current_setting('location_test.person');
  assert (person_state->>'latitude')::double precision = 31.95;
  assert (person_state->>'longitude')::double precision = 35.91;
  assert (person_state->>'expires_at')::timestamptz - (person_state->>'observed_at')::timestamptz = interval '24 hours';
  assert not person_state ? 'sharing_revision', 'Partner revision leaked into the read interface';
  assert (public.enable_location_sharing(0)->>'revision')::integer = 1;
  assert public.publish_location(1, 51.5, -0.1, 100, clock_timestamp())->>'status' = 'accepted';
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('location_test.outsider'), true);
do $$
declare denied boolean; result jsonb;
begin
  result := public.get_location_state();
  assert not (result->>'available')::boolean and result->'states' = '[]'::jsonb and result->>'own_revision' is null;
  denied := false;
  begin perform public.enable_location_sharing(0); exception when insufficient_privilege then denied := true; end;
  assert denied, 'A different valid pair was authorized';
  denied := false;
  begin perform public.publish_location(1, 1, 1, 10, clock_timestamp()); exception when insufficient_privilege then denied := true; end;
  assert denied, 'Outsider published a location';
  denied := false;
  begin perform public.stop_location_sharing(); exception when insufficient_privilege then denied := true; end;
  assert denied, 'Outsider stopped another account sharing';
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('location_test.person'), true);
do $$
declare denied boolean; result jsonb; own_state jsonb;
begin
  -- Upload-before-Stop and Stop-before-delayed-upload both end with no location.
  assert (public.stop_location_sharing()->>'revision')::integer = 2;
  denied := false;
  begin perform public.publish_location(1, 1, 1, 10, clock_timestamp()); exception when serialization_failure then denied := true; end;
  assert denied, 'A delayed upload resurrected a stopped location';
  denied := false;
  begin perform public.enable_location_sharing(1); exception when serialization_failure then denied := true; end;
  assert denied, 'A queued enable undid a later Stop';
  result := public.get_location_state();
  select s into own_state from jsonb_array_elements(result->'states') s where s->>'user_id' = current_setting('location_test.person');
  assert not (own_state->>'sharing_enabled')::boolean and own_state->>'latitude' is null;
  assert (public.stop_location_sharing()->>'revision')::integer = 3, 'Repeated Stop must invalidate queued enables';
  assert (public.enable_location_sharing(3)->>'revision')::integer = 4;
  assert public.publish_location(4, 31.95, 35.91, 50, clock_timestamp())->>'status' = 'throttled', 'Enable bypassed the account-wide throttle';
end;
$$;

reset role;
update public.location_states set last_accepted_write_at = clock_timestamp() - interval '61 seconds'
where user_id::text = current_setting('location_test.person');
set local role authenticated;
do $$
begin
  assert public.publish_location(4, 31.96, 35.92, 50, clock_timestamp())->>'status' = 'accepted';
end;
$$;

reset role;
update public.location_states set observed_at = statement_timestamp() - interval '25 hours',
  expires_at = statement_timestamp() - interval '1 hour'
where user_id::text = current_setting('location_test.person');
set local role authenticated;
do $$
declare own_state jsonb;
begin
  select s into own_state from jsonb_array_elements(public.get_location_state()->'states') s
    where s->>'user_id' = current_setting('location_test.person');
  assert (own_state->>'sharing_enabled')::boolean;
  assert own_state->>'latitude' is null and own_state->>'longitude' is null and own_state->>'accuracy' is null
    and own_state->>'observed_at' is null and own_state->>'expires_at' is null, 'Expired coordinates were readable before cleanup';
end;
$$;

reset role;
do $$
begin
  assert (select latitude is not null from public.location_states where user_id::text = current_setting('location_test.person'));
  perform public.clear_expired_locations();
  assert (select latitude is null and longitude is null and accuracy is null and observed_at is null and expires_at is null
    and sharing_enabled and sharing_revision = 4 and last_accepted_write_at is not null
    from public.location_states where user_id::text = current_setting('location_test.person'));
  assert (select latitude is not null from public.location_states where user_id::text = current_setting('location_test.partner'));
end;
$$;

-- Even an administrative third-member addition must fail closed.
insert into public.couple_members(couple_id, user_id)
values (current_setting('location_test.pair')::uuid, current_setting('location_test.third_person')::uuid);
set local role authenticated;
do $$
begin
  assert not (public.get_location_state()->>'available')::boolean, 'An unexpected third member was ignored';
end;
$$;
reset role;
delete from public.couple_members where user_id::text = current_setting('location_test.third_person');
set local role authenticated;
do $$
begin
  assert (public.get_location_state()->>'available')::boolean;
end;
$$;
reset role;

-- Removing either frozen account cascades the allowlist and both locations.
delete from public.couple_members where user_id::text = current_setting('location_test.partner');
do $$
begin
  assert not exists (select 1 from public.location_access);
  assert not exists (select 1 from public.location_states);
end;
$$;
insert into public.couple_members(couple_id, user_id)
values (current_setting('location_test.pair')::uuid, current_setting('location_test.partner')::uuid);
set local role authenticated;
do $$
begin
  assert not (public.get_location_state()->>'available')::boolean, 'Restored membership automatically reauthorized the pair';
  raise notice 'Location allowlist, RPC privileges, validation, throttle, revocation, expiry, and cascade checks passed.';
end;
$$;
rollback;
