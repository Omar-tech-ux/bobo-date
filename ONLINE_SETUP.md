# Bobo's two-person mailbox setup

The frontend, database migration, realtime subscription, PWA service worker, and notification function are included in this repository. Personal account and invitation data is stored in Supabase; the old scrapbook progress remains local to each browser.

## 1. Create the private tables

Open the Supabase SQL Editor for project `mkokgytybuencwkilpbh`, create a new query, paste all of:

`supabase/migrations/20260816010000_love_mailbox.sql`

Run it once. It creates the account profiles, sealed two-person pairing, date invitations, device subscriptions, realtime publication, and Row Level Security policies.

## 2. Auth settings

In Supabase **Authentication → URL Configuration**:

- Site URL: `https://omar-tech-ux.github.io/bobo-date/`
- Redirect URL: `https://omar-tech-ux.github.io/bobo-date/**`

Keep email confirmation enabled if both people can access their email. For a private two-person beta, sign-ups can be disabled after both accounts exist.

## 3. Deploy background notifications

The VAPID private key is stored only in the ignored local file `supabase/.env.local`; never commit it.

The Edge Function also requires this public deployment URL so declarative notifications can open the installed PWA directly:

```sh
PWA_BASE_URL=https://omar-tech-ux.github.io/bobo-date/
```

After authenticating the Supabase CLI, run:

```sh
npx supabase link --project-ref mkokgytybuencwkilpbh
npx supabase secrets set --env-file supabase/.env.local
npx supabase functions deploy notify-love-mail
```

### Anniversary reminder automation

The anniversary worker is separate from invitation delivery. It is called only
by Supabase Cron and authenticates with a random secret that exists in two
private locations: the Edge Function environment and Supabase Vault.

1. Generate a random value of at least 32 characters and keep it out of Git.
2. Add it to `supabase/.env.local` as:

   ```sh
   ANNIVERSARY_AUTOMATION_SECRET=replace-with-the-random-value
   ```

3. Upload the Edge Function secrets and store the exact same value in Vault from
   the Supabase SQL Editor:

   ```sh
   npx supabase secrets set --env-file supabase/.env.local
   ```

   ```sql
   select vault.create_secret(
     'replace-with-the-same-random-value',
     'anniversary_automation_secret',
     'Authenticates the monthly anniversary Cron worker'
   );
   ```

4. Deploy both functions before installing the Cron migration. The existing
   function is redeployed because its Web Push transport is now shared, but its
   request and response contracts are unchanged.

   ```sh
   npx supabase functions deploy notify-love-mail
   npx supabase functions deploy notify-anniversary --no-verify-jwt
   npx supabase db push --linked
   ```

The migration enables reminders only when the database contains exactly one
sealed couple. It never enables every couple as a fallback. Verify the target
and schedule after applying it:

```sql
select s.couple_id, s.time_zone, s.enabled
from public.anniversary_reminder_settings s;

select jobname, schedule, active
from cron.job
where jobname = 'notify-anniversary-reminders';
```

Exactly one enabled `Asia/Amman` row and one active `* * 13-15 * *` job must be
present. If the settings query returns no rows, stop and identify the intended
couple before inserting its UUID explicitly; do not bulk-enable existing pairs.

Cron evaluates the Amman clock inside PostgreSQL and calls the worker only from
00:00–00:14 and 10:00–10:14 on the 14th. Delivery results and retries can be
inspected without exposing subscription credentials:

```sql
select reminder_date, slot, status, attempts, accepted_at, updated_at
from public.anniversary_notification_deliveries
order by updated_at desc;

select status, start_time, end_time, return_message
from cron.job_run_details
where jobid = (
  select jobid from cron.job where jobname = 'notify-anniversary-reminders'
)
order by start_time desc
limit 20;
```

If the automation secret is rotated, upload the new value to the Edge Function
and create a newer Vault secret with the same `anniversary_automation_secret`
name before the next reminder window.

The app's public VAPID key is safe to bundle in the frontend. The private VAPID key and Supabase service-role key must never be placed in Vite variables or committed.

## 4. Pair the two accounts

1. Both people create and confirm their accounts in **Our little love mailbox**.
2. One person opens **Pair our accounts** and creates a six-character code.
3. Send that code privately to the other person.
4. The other person enters it once. The mailbox then seals at exactly two members.
5. Each person taps **turn on date notifications** from their own installed device.

On iPhone/iPad, install the site from Safari using **Share → Add to Home Screen**, open the installed app, and then enable notifications from the account page. Web Push on iOS requires a Home Screen web app.

## Privacy note

Accounts and invitations are private under Row Level Security. The photos and video currently stored in `public/` are still public GitHub Pages assets. Moving that media to a private Supabase Storage bucket and removing it from public Git history is a separate migration.

## Monthly anniversary photo albums

Apply `20261014010000_anniversary_photos.sql` **before** publishing this frontend:

```sh
npx supabase db push --linked
npx supabase db query --linked --file supabase/tests/anniversary_photos.sql
npm test
npm run build
```

The migration provisions the private `anniversary-photos` bucket, contribution
and photo tables, and authenticated RPCs and Storage policies. It needs no new
environment variables, Edge Function, Cron job, or notification permission.
The database checks use temporary fixture users and Storage metadata inside a
rollback-only transaction; they do not upload physical files or change real
albums. They also fix the eligibility clock inside that transaction so the
checks work before the first anniversary opens.

Albums begin with October 14, 2026. Each month unlocks at midnight on the 15th
in `Asia/Amman`. The newest due month is prompted once per fresh app load after
sign-in/pairing and the intro. “Later” lasts only for that app session. Returning
from another app or a photo picker refreshes visible data without reopening a
dismissed prompt. Earlier gaps remain accessible from the anniversary list.

Each partner has up to three photos and a separate completion timestamp.
Saving one photo stops that person's reminder on every device. Removing their
last photo clears completion; it restores the next-load reminder only when
that month is the newest due month. Both partners can view saved images; each
can edit only their own contribution. The existing day-14 push reminders are
independent of photo uploads.

JPEG, PNG, and WebP files up to 20 MiB are accepted locally. The browser applies
image orientation and resizes proportionally to a maximum 2560-pixel edge before
JPEG encoding. Uploads are processed sequentially and capped at 5 MiB per file
by both client and bucket. HEIC must be exported as JPEG. Viewing uses private,
15-minute signed URLs refreshed while an album is open. Photos are not added
to the service-worker cache or persisted in browser storage by the app.

The revision-checked `save_anniversary_photos` RPC validates membership, date,
file ownership/existence, dimensions, and the three-photo limit, then commits
the complete selection and completion timestamp atomically. An interrupted
save rechecks the server before allowing a retry. Replacement objects have new
paths; old photos remain saved until the replacement transaction commits.

Removed and abandoned files are reclaimed through the Storage API in batches
of at most 20 on subsequent authenticated online launches and after saves.
Only the uploader's unreferenced objects older than 24 hours qualify; newly
attached objects must be under one hour old, while existing saved photos may
be retained indefinitely. These nonoverlapping windows prevent cleanup/save
races. Cleanup errors retry on later launches, so physical removal is eventual
and depends on the uploader using the app again. Never delete Storage metadata
directly with SQL. Monitor bucket size and Storage request errors in Supabase
if cleanup or uploads fail repeatedly.

Useful post-deployment checks (no photo contents or account identifiers):

```sql
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'anniversary-photos';

select tablename, policyname, cmd
from pg_policies
where tablename in ('anniversary_contributions', 'anniversary_photos')
   or (schemaname = 'storage' and (
     policyname like '%anniversary%'
     or policyname = 'read own uploads or paired saved photos'
   ));
```

Expect a private bucket with a 5 MiB JPEG limit and member-only reads, with
writes restricted to the owning contributor. Deploy the frontend through the
existing GitHub Pages workflow after these checks pass. The migration is
additive and compatible with the previous frontend; to roll the frontend back,
preserve the private bucket and tables so saved photos are not lost.

## Multiple activities

Apply `20260916020000_multiple_activities.sql` before publishing the frontend.
The migration backfills existing tickets and accepts legacy single-activity
inserts. New clients send `activities`; the first item is mirrored to `activity`
for older clients, which display only that first item until reloaded. Current
clients display every selection. No Edge Function deployment is needed.
Run `supabase/tests/multiple_activities.sql` against the linked database to check
validation and preservation through invitation actions; its fixtures roll back.

## Canceling and rescheduling invitations

Deploy `20260916010000_invitation_changes.sql`, then `notify-love-mail`, then
publish the frontend. Users with an older page open should reload it: responses
now use the revision-checked `change_date_invitation` RPC instead of direct table
updates. Original sender/recipient ownership stays unchanged; `latest_proposer_id`
determines who must answer the current proposal.

```sh
npx supabase db push --linked
npx supabase functions deploy notify-love-mail
npm test
npm run build
```

The rollback-only database checks require an existing paired account and leave
no tickets or notifications behind:

```sh
npx supabase db query --linked --file supabase/tests/invitation_changes.sql
```

Both partners can cancel or propose a future time on active tickets. Cancellation
is final, and rescheduling resets acceptance. Notification failures leave the
saved ticket intact and show a warning. Phone delivery still depends on each
partner's existing notification permission and subscription.

## Private foreground location sharing

Apply `20261015010000_private_locations.sql` before publishing the location UI:

```sh
npx supabase db push --linked
npx supabase db query --linked --file supabase/tests/private_locations.sql
npm test
npm run build
```

The new migration uses the existing `pg_cron` extension from the anniversary
reminder migration. It creates no Edge Function, map subscription, secret, or
environment variable. React continues to use only the public Supabase
publishable key; never put a service-role key in a `VITE_` variable.

Location access is restricted to one frozen pair and its two account UUIDs.
At migration time, the allowlist is seeded only if exactly one sealed couple
exists and it has exactly two members. An empty or ambiguous database remains
disabled. New pairs are never automatically authorized. Both allowlist and
location tables have RLS enabled and no direct anonymous or authenticated table
access; only the four authenticated RPCs can access them, after checking the
frozen identities and exact current membership. Removing either allowed member
cascades the allowlist and both latest-location rows. Restoring membership
does not automatically enable the feature again.

Check setup from the Supabase SQL Editor as an administrator:

```sql
select a.couple_id, p.username as first_account, q.username as second_account
from public.location_access a
join public.profiles p on p.id = a.first_user_id
join public.profiles q on q.id = a.second_user_id;

select jobname, schedule, active from cron.job
where jobname = 'clear-expired-locations';
```

Expect exactly the intended two accounts and one active `*/15 * * * *` job.
If no allowlist exists, first identify the intended pair privately using
`public.couples`, `public.couple_members`, and `public.profiles`. Then fill in
all three UUIDs in this administrator-only query. It fails closed when the
specified accounts do not exactly match the sealed pair; it never replaces an
existing allowlist. Do not expose this setup capability in the frontend.

```sql
with intended as (
  select 'REPLACE_WITH_COUPLE_UUID'::uuid as couple_id,
    least('REPLACE_WITH_FIRST_ACCOUNT_UUID'::uuid, 'REPLACE_WITH_SECOND_ACCOUNT_UUID'::uuid) as first_user_id,
    greatest('REPLACE_WITH_FIRST_ACCOUNT_UUID'::uuid, 'REPLACE_WITH_SECOND_ACCOUNT_UUID'::uuid) as second_user_id
)
insert into public.location_access(couple_id, first_user_id, second_user_id)
select i.couple_id, i.first_user_id, i.second_user_id
from intended i join public.couples c on c.id = i.couple_id
where c.sealed and i.first_user_id <> i.second_user_id
  and (select array_agg(m.user_id order by m.user_id) from public.couple_members m
    where m.couple_id = i.couple_id) = array[i.first_user_id, i.second_user_id];
```

Each account opts in independently. Only the latest accepted position is stored;
there is no location history. The server enforces a 60-second minimum between
accepted writes per account across all devices. Stopping sharing immediately
clears its coordinates and advances a revision, invalidating delayed uploads
and queued enable requests. Re-enabling requires the current revision and an
explicit user action. A successful Stop is account-wide; an offline Stop ends
collection on that device immediately but cannot promise server deletion until
the request succeeds. Location errors must never silently turn sharing back on.

The app requests a low-power location only while visible, approximately every
two minutes, slowing to five minutes after two stationary readings. It accepts
cached fixes up to 60 seconds old and limits acquisition to ten seconds (the
browser excludes permission-prompt time). It sends a new position on the first
reading, meaningful movement, a ten-minute heartbeat, or a manual update,
subject to the server minimum. Hidden pages stop scheduling immediately and
ignore late callbacks. This is foreground PWA functionality: iOS suspension
cannot reliably collect or update GPS. An iOS Home Screen icon opens the app;
the location card is inside the app, not a native Home Screen widget.

Coordinates expire 24 hours after the observation time. The read RPC hides
expired coordinates immediately, even if cleanup is delayed. The SQL Cron job
clears expired coordinate fields every 15 minutes; no phone wake-up is involved.
This does not imply immediate removal from provider backups. Cleanup retains
only sharing preferences, revision, and the last accepted-write timestamp.
Coordinates are never persisted to browser storage, the service-worker cache,
push messages, or logs. Maps load only after the user opens the map view; map
tile providers can observe the requested map area, so they must not receive
account identifiers or location records.

The SQL test file creates synthetic users and a temporary allowlist inside one
rollback-only transaction. It checks access restrictions, invalid observations,
throttling, revision/Stop ordering, expiry before cleanup, exact membership, and
cascading removal without reading real coordinates. It briefly locks the
allowlist while running and restores it on rollback. Run it before deployment;
frontend unit tests do not substitute for these database checks. Monitor the
cleanup job's status in `cron.job_run_details` without logging coordinates.
