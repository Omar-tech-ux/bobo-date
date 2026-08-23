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
