grant usage on schema public to authenticated;

grant select, update on table public.profiles to authenticated;
grant select on table public.couples to authenticated;
grant select on table public.couple_members to authenticated;
grant select, insert on table public.date_invitations to authenticated;
grant update (status, response_note, responded_at)
  on table public.date_invitations
  to authenticated;
grant select, insert, update, delete
  on table public.push_subscriptions
  to authenticated;

revoke all on table public.profiles from anon;
revoke all on table public.couples from anon;
revoke all on table public.couple_members from anon;
revoke all on table public.date_invitations from anon;
revoke all on table public.push_subscriptions from anon;
