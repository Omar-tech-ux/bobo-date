-- Run after the migration. All fixture changes are rolled back.
begin;
-- Uses an existing paired account only for transaction-local, uncommitted tickets.
do $$
declare
  pair uuid;
  first_user uuid;
  second_user uuid;
  t public.date_invitations;
  denied boolean;
begin
  select a.couple_id, a.user_id, b.user_id into pair, first_user, second_user
  from public.couple_members a join public.couple_members b
    on a.couple_id = b.couple_id and a.user_id < b.user_id limit 1;
  if pair is null then raise exception 'A paired test account is required.'; end if;
  insert into public.date_invitations(couple_id, sender_id, recipient_id, date, time, activity, guest_timezone)
  values (pair, first_user, second_user, '2000-01-01', '12:00', 'coffee-call', 'Asia/Amman') returning * into t;
  assert t.latest_proposer_id = first_user and t.revision = 0 and t.last_actor_id = first_user;

  perform set_config('request.jwt.claim.sub', second_user::text, true);
  t := public.change_date_invitation(t.id, 0, 'responded', 'yes', 'accepted');
  assert t.status = 'accepted' and t.revision = 1;
  t := public.change_date_invitation(t.id, 1, 'rescheduled', p_date => '2099-01-01', p_time => '12:00', p_timezone => 'Asia/Amman', p_scheduled_at => '2099-01-01T09:00:00Z');
  assert t.status = 'pending' and t.latest_proposer_id = second_user and t.response_note is null and t.responded_at is null;
  denied := false;
  begin perform public.change_date_invitation(t.id, 2, 'responded', p_status => 'accepted');
  exception when insufficient_privilege then denied := true; end;
  assert denied, 'Proposer accepted their own proposal';

  perform set_config('request.jwt.claim.sub', first_user::text, true);
  t := public.change_date_invitation(t.id, 2, 'responded', p_status => 'accepted');
  assert t.status = 'accepted';
  denied := false;
  begin perform public.change_date_invitation(t.id, 2, 'cancelled');
  exception when serialization_failure then denied := true; end;
  assert denied, 'Stale revision was accepted';

  denied := false;
  begin perform public.change_date_invitation(t.id, 3, 'rescheduled', p_date => '2000-01-01', p_time => '12:00', p_timezone => 'Asia/Amman', p_scheduled_at => '2000-01-01T10:00:00Z');
  exception when raise_exception then denied := true; end;
  assert denied, 'Past schedule was accepted';
  denied := false;
  begin perform public.change_date_invitation(t.id, 3, 'rescheduled', p_date => '2099-01-01', p_time => '12:00', p_timezone => 'Asia/Amman', p_scheduled_at => '2099-01-01T09:00:00Z');
  exception when raise_exception then denied := true; end;
  assert denied, 'Unchanged schedule was accepted';
  denied := false;
  begin perform public.change_date_invitation(t.id, 3, 'rescheduled', p_date => '2099-03-08', p_time => '02:30', p_timezone => 'America/New_York', p_scheduled_at => '2099-03-08T07:30:00Z');
  exception when raise_exception then denied := true; end;
  assert denied, 'Nonexistent DST time was accepted';
  denied := false;
  begin perform public.change_date_invitation(t.id, 3, 'rescheduled', p_date => '2099-01-01', p_time => '12:00', p_timezone => 'Not/A_Zone', p_scheduled_at => '2099-01-01T09:00:00Z');
  exception when raise_exception then denied := true; end;
  assert denied, 'Invalid timezone was accepted';

  t := public.change_date_invitation(t.id, 3, 'rescheduled', p_date => '2099-01-02', p_time => '12:00', p_timezone => 'Asia/Amman', p_scheduled_at => '2099-01-02T09:00:00Z');
  assert t.latest_proposer_id = first_user and t.status = 'pending';
  perform set_config('request.jwt.claim.sub', second_user::text, true);
  t := public.change_date_invitation(t.id, 4, 'cancelled', '  Little hug  ');
  assert t.status = 'cancelled' and t.cancellation_note = 'Little hug' and t.last_actor_id = second_user;
  denied := false;
  begin perform public.change_date_invitation(t.id, 5, 'responded', p_status => 'accepted');
  exception when raise_exception then denied := true; end;
  assert denied, 'Closed ticket was changed';
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  denied := false;
  begin perform public.change_date_invitation(t.id, 5, 'cancelled');
  exception when insufficient_privilege then denied := true; end;
  assert denied, 'Non-participant changed a ticket';
  assert not has_column_privilege('authenticated', 'public.date_invitations', 'status', 'UPDATE');
  assert not has_column_privilege('authenticated', 'public.date_invitations', 'date', 'UPDATE');
  assert not has_function_privilege('anon', 'public.change_date_invitation(uuid,integer,text,text,text,date,time,text,timestamp with time zone)', 'EXECUTE');
  raise notice 'Invitation transition, validation, stale revision and authorization checks passed.';
end;
$$;

rollback;
