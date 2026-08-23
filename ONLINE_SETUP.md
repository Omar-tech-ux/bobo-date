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
