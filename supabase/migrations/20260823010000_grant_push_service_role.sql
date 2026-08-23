-- The push Edge Function authenticates callers, then uses service_role to read
-- the target user's device subscriptions and remove endpoints Apple has expired.
grant usage on schema public to service_role;

grant select
  on table public.date_invitations
  to service_role;

grant select, delete
  on table public.push_subscriptions
  to service_role;
