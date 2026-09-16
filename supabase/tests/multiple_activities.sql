-- Transaction-local fixtures; no tickets or notifications survive these checks.
begin;
do $$
declare
  pair uuid;
  sender uuid;
  recipient uuid;
  t public.date_invitations;
  invalid text[];
  denied boolean;
begin
  select a.couple_id, a.user_id, b.user_id into pair, sender, recipient
  from public.couple_members a join public.couple_members b
    on a.couple_id = b.couple_id and a.user_id < b.user_id limit 1;
  if pair is null then raise exception 'A paired test account is required.'; end if;

  assert not exists (select 1 from public.date_invitations
    where not public.valid_invitation_activities(activities) or activity <> activities[1]);
  insert into public.date_invitations(couple_id, sender_id, recipient_id, date, time, activity, guest_timezone)
  values (pair, sender, recipient, '2099-01-01', '12:00', 'coffee-call', 'Asia/Amman') returning * into t;
  assert t.activities = array['coffee-call'], 'Legacy insert did not populate activities';

  insert into public.date_invitations(couple_id, sender_id, recipient_id, date, time, activities, guest_timezone)
  values (pair, sender, recipient, '2099-01-01', '12:00', array['video-dinner', 'surprise'], 'Asia/Amman') returning * into t;
  assert t.activity = 'video-dinner';
  perform set_config('request.jwt.claim.sub', recipient::text, true);
  t := public.change_date_invitation(t.id, 0, 'responded', p_status => 'accepted');
  assert t.activities = array['video-dinner', 'surprise'];
  t := public.change_date_invitation(t.id, 1, 'rescheduled', p_date => '2099-01-02', p_time => '12:00', p_timezone => 'Asia/Amman', p_scheduled_at => '2099-01-02T09:00:00Z');
  assert t.activities = array['video-dinner', 'surprise'];
  t := public.change_date_invitation(t.id, 2, 'cancelled');
  assert t.activities = array['video-dinner', 'surprise'];

  assert public.valid_invitation_activities(array['video-dinner', 'movie-night', 'online-game', 'coffee-call', 'surprise']);
  for invalid in select value from (values
    (array[]::text[]), (array['invalid']), (array['coffee-call', 'coffee-call']),
    (array['video-dinner', null]),
    (array['video-dinner', 'movie-night', 'online-game', 'coffee-call', 'surprise', 'extra'])
  ) cases(value) loop
    denied := false;
    begin
      insert into public.date_invitations(couple_id, sender_id, recipient_id, date, time, activities, guest_timezone)
      values (pair, sender, recipient, '2099-01-01', '12:00', invalid, 'Asia/Amman');
    exception when check_violation or not_null_violation then denied := true;
    end;
    assert denied, 'Invalid activities were accepted';
  end loop;
  raise notice 'Legacy, multiple-activity, validation and invitation preservation checks passed.';
end;
$$;
rollback;
