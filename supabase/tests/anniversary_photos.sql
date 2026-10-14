-- Rollback-only integration checks. Fixture Storage rows have no physical files.
begin;

do $$
begin
  assert public.anniversary_due_date('2026-10-14T20:59:59Z') is null;
  assert public.anniversary_due_date('2026-10-14T21:00:00Z') = date '2026-10-14';
  assert public.anniversary_due_date('2027-01-14T20:59:59Z') = date '2026-12-14';
  assert public.anniversary_due_date('2027-01-14T21:00:00Z') = date '2027-01-14';
  assert public.anniversary_due_date('2027-02-07T10:00:00Z') = date '2027-01-14';
end;
$$;

-- Only this uncommitted test transaction sees a fixed eligible month. The
-- original clock helper is restored automatically by ROLLBACK, including errors.
create or replace function public.anniversary_due_date(p_now timestamptz)
returns date language sql immutable set search_path = '' as $$ select date '2026-10-14'; $$;

do $$
declare
  person uuid := gen_random_uuid(); partner uuid := gen_random_uuid(); outsider uuid := gen_random_uuid(); pair uuid := gen_random_uuid();
  actor uuid; image uuid; object_name text; n integer;
begin
  perform set_config('anniversary_test.person', person::text, true);
  perform set_config('anniversary_test.partner', partner::text, true);
  perform set_config('anniversary_test.outsider', outsider::text, true);
  perform set_config('anniversary_test.pair', pair::text, true);
  foreach actor in array array[person, partner, outsider] loop
    insert into auth.users(id, email, raw_user_meta_data) values (actor, actor::text || '@example.invalid',
      jsonb_build_object('display_name', 'Album test', 'username', 'test_' || substr(replace(actor::text, '-', ''), 1, 12)));
    insert into public.profiles(id, username, display_name)
      values (actor, 'test_' || substr(replace(actor::text, '-', ''), 1, 12), 'Album test') on conflict (id) do nothing;
  end loop;
  insert into public.couples(id, pair_code, created_by, sealed) values (pair, upper(substr(replace(pair::text, '-', ''), 1, 6)), person, true);
  insert into public.couple_members(couple_id, user_id) values (pair, person), (pair, partner);
  foreach actor in array array[person, partner] loop
    for n in 1..4 loop
      image := gen_random_uuid();
      perform set_config('anniversary_test.' || case when actor = person then 'photo' else 'partner_photo' end || n, image::text, true);
      object_name := pair::text || '/2026-10-14/' || actor::text || '/' || image::text || '.jpg';
      insert into storage.objects(bucket_id, name, owner_id, metadata)
        values ('anniversary-photos', object_name, actor::text, '{"mimetype":"image/jpeg","size":1000}');
    end loop;
  end loop;
  insert into storage.objects(bucket_id, name, owner_id, created_at, metadata)
    values ('anniversary-photos', pair::text || '/2026-10-14/' || person::text || '/00000000-0000-4000-8000-000000000099.jpg',
      person::text, now() - interval '25 hours', '{"mimetype":"image/jpeg","size":1000}');
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('anniversary_test.person'), true);

do $$
declare
  result jsonb; selection jsonb; denied boolean; cleanup_count integer;
  person text := current_setting('anniversary_test.person'); pair text := current_setting('anniversary_test.pair');
begin
  assert (public.get_anniversary_status()->>'completed_at') is null;
  assert not has_table_privilege('authenticated', 'public.anniversary_photos', 'INSERT');
  assert not has_table_privilege('authenticated', 'public.anniversary_contributions', 'UPDATE');
  assert not has_function_privilege('anon', 'public.save_anniversary_photos(date,integer,jsonb)', 'EXECUTE');
  assert not has_function_privilege('anon', 'public.get_anniversary_status()', 'EXECUTE');
  assert not has_function_privilege('anon', 'public.list_my_unused_anniversary_uploads(integer)', 'EXECUTE');
  assert public.can_upload_anniversary_photo(pair || '/2026-10-14/' || person || '/' || gen_random_uuid()::text || '.jpg');
  assert not public.can_upload_anniversary_photo(pair || '/2026-11-14/' || person || '/' || gen_random_uuid()::text || '.jpg');
  assert not public.can_upload_anniversary_photo(pair || '/2026-10-14/' || current_setting('anniversary_test.partner') || '/' || gen_random_uuid()::text || '.jpg');
  assert not public.can_upload_anniversary_photo('bad/path');

  selection := jsonb_build_array(jsonb_build_object('id', current_setting('anniversary_test.photo1'), 'width', 100, 'height', 200));
  result := public.save_anniversary_photos('2026-10-14', 0, selection);
  assert (result->>'revision')::int = 1 and result->>'completed_at' is not null;
  assert jsonb_array_length(result->'photos') = 1;
  assert public.get_anniversary_status()->>'completed_at' is not null;
  assert (select count(*) from public.anniversary_photos) = 1;

  denied := false;
  begin perform public.save_anniversary_photos('2026-10-14', 0, selection);
  exception when serialization_failure then denied := true; end;
  assert denied, 'A stale revision overwrote the saved contribution';

  denied := false;
  begin perform public.save_anniversary_photos('2026-11-14', 0, selection);
  exception when invalid_parameter_value then denied := true; end;
  assert denied, 'A future month was accepted';
  denied := false;
  begin perform public.save_anniversary_photos('2026-09-14', 0, selection);
  exception when invalid_parameter_value then denied := true; end;
  assert denied, 'A pre-feature month was accepted';

  denied := false;
  begin perform public.save_anniversary_photos('2026-10-14', 1, selection || selection);
  exception when invalid_parameter_value then denied := true; end;
  assert denied, 'Duplicate photo IDs were accepted';
  denied := false;
  begin perform public.save_anniversary_photos('2026-10-14', 1, jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'width', 100, 'height', 100)));
  exception when invalid_parameter_value then denied := true; end;
  assert denied, 'Missing replacement file was accepted';
  assert (public.get_anniversary_status()->>'revision')::int = 1;
  assert (select count(*) from public.anniversary_photos) = 1, 'Failed replacement removed saved photos';

  select jsonb_agg(jsonb_build_object('id', current_setting('anniversary_test.photo' || n), 'width', 100, 'height', 200)) into selection from generate_series(1, 4) n;
  denied := false;
  begin perform public.save_anniversary_photos('2026-10-14', 1, selection);
  exception when invalid_parameter_value then denied := true; end;
  assert denied, 'Fourth photo was accepted';
  result := public.save_anniversary_photos('2026-10-14', 1, selection - 3);
  assert jsonb_array_length(result->'photos') = 3;

  -- Unsaved uploads remain private to their owner, even inside the pair.
  assert (select count(*) from storage.objects where bucket_id = 'anniversary-photos' and owner_id = current_setting('anniversary_test.partner')) = 0;
  assert (select count(*) from public.list_my_unused_anniversary_uploads()) = 1;
  denied := false;
  begin perform public.save_anniversary_photos('2026-10-14', 2,
    '[{"id":"00000000-0000-4000-8000-000000000099","width":100,"height":100}]');
  exception when invalid_parameter_value then denied := true; end;
  assert denied, 'An old cleanup candidate was reattached';

  -- Evaluate the actual DELETE policy as this role without executing a SQL
  -- delete: Supabase reserves physical removal for its Storage API.
  execute 'select count(*) from storage.objects where (' || (select qual from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'clean own unused anniversary uploads') || ')'
    into cleanup_count;
  assert cleanup_count = 1, 'DELETE policy admitted active/recent uploads or refused the old orphan';

  denied := false;
  begin
    insert into storage.objects(bucket_id, name, owner_id, metadata) values ('anniversary-photos',
      pair || '/2026-10-14/' || current_setting('anniversary_test.partner') || '/' || gen_random_uuid()::text || '.jpg',
      person, '{"mimetype":"image/jpeg","size":1000}');
  exception when insufficient_privilege then denied := true; end;
  assert denied, 'A forged partner upload path passed Storage INSERT RLS';
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('anniversary_test.partner'), true);
do $$
declare selection jsonb; result jsonb; denied boolean;
begin
  assert public.get_anniversary_status()->>'completed_at' is null, 'Partner inherited the other person completion';
  assert (select count(*) from public.anniversary_photos) = 3;
  assert (select count(*) from storage.objects where bucket_id = 'anniversary-photos' and owner_id = current_setting('anniversary_test.person')) = 3;
  denied := false;
  begin perform public.save_anniversary_photos('2026-10-14', 0,
    jsonb_build_array(jsonb_build_object('id', current_setting('anniversary_test.photo1'), 'width', 100, 'height', 100)));
  exception when invalid_parameter_value then denied := true; end;
  assert denied, 'Partner attached another person upload';
  select jsonb_agg(jsonb_build_object('id', current_setting('anniversary_test.partner_photo' || n), 'width', 100, 'height', 200)) into selection from generate_series(1, 3) n;
  result := public.save_anniversary_photos('2026-10-14', 0, selection);
  assert jsonb_array_length(result->'photos') = 3;
  assert (select count(*) from public.anniversary_photos) = 6;
  result := public.save_anniversary_photos('2026-10-14', 1, '[]');
  assert result->>'completed_at' is null;
  assert (select count(*) from public.anniversary_photos) = 3;
  assert (select completed_at is not null from public.anniversary_contributions where user_id::text = current_setting('anniversary_test.person'));
end;
$$;

-- Old saved files remain retainable and must never be collected.
reset role;
update storage.objects set created_at = now() - interval '25 hours'
where bucket_id = 'anniversary-photos' and owner_id = current_setting('anniversary_test.person');
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('anniversary_test.person'), true);
do $$
declare selection jsonb; result jsonb; cleanup_count integer;
begin
  assert (select count(*) from public.list_my_unused_anniversary_uploads()) = 2;
  select jsonb_agg(jsonb_build_object('id', id, 'width', width, 'height', height) order by slot) into selection
    from public.anniversary_photos where user_id::text = current_setting('anniversary_test.person');
  result := public.save_anniversary_photos('2026-10-14', 2, selection);
  assert jsonb_array_length(result->'photos') = 3;
  execute 'select count(*) from storage.objects where (' || (select qual from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'clean own unused anniversary uploads') || ')'
    into cleanup_count;
  assert cleanup_count = 2, 'DELETE policy admitted an old file that is still saved';
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('anniversary_test.outsider'), true);
do $$
declare denied boolean := false;
begin
  assert (select count(*) from public.anniversary_photos) = 0;
  assert (select count(*) from public.anniversary_contributions) = 0;
  assert (select count(*) from storage.objects where bucket_id = 'anniversary-photos') = 0;
  begin perform public.save_anniversary_photos('2026-10-14', 0, '[]');
  exception when insufficient_privilege then denied := true; end;
  assert denied, 'Unpaired account wrote anniversary data';
  raise notice 'Anniversary date, completion, quota, ownership, revision, privacy, and cleanup checks passed.';
end;
$$;
rollback;
