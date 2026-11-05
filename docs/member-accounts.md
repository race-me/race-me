# Member accounts and sync

Members sign in with their email. Their tool data is saved to their account and stays the same on every device;
the tools also keep working from the browser when offline.

- Code: `members/sync.js` (sign-in button and panel in the members header, and the sync itself).
- Database: Supabase project `lkktdmdnwdklyvapyjxb`, table `public.tool_data`, one row per member per tool.
  Created by `supabase/setup.sql` in the private race-me/members-src repo. Row-level security limits every member to their own rows.
- The publishable key in `sync.js` is meant to be public. Never put the `service_role` key in any page.

## One-time Supabase setup

1. **SQL Editor:** run the scripts in race-me/members-src `supabase/` in the order its README gives.
2. **Authentication → Sign In / Providers:** turn off "Allow new users to sign up". Leave Email enabled.
3. **Authentication → URL Configuration:** Site URL `https://race-me.org/members/`. Add these Redirect URLs:
   `https://race-me.org/members/` and `https://race-me.org/members/index.html`.
4. **Authentication → Emails → SMTP:** set up a real email sender (for example Resend, or the provider behind
   info@race-me.org). Supabase's built-in sender is for testing and may only deliver to your own team's addresses.

## Signing in

Members sign in only with their accounts; there is no club password. The login screen emails an 8-digit code (Supabase: Email OTP Length = 8), which
they type in (a link in the email also works, and an invite link opens the members area directly).

The members content is encrypted with a random 64-byte page key. The key lives in the one-row table
`public.members_key`, which only signed-in members can read (`supabase/members-key.sql` in race-me/members-src).
Accounts are invite-only, so only members can open the page. A device that has opened it keeps the key until
Sign out, or until the key changes.

- **Rebuilding the page:** copy the key from Supabase (Table Editor → members_key → key) into `RACE_ME_PAGE_KEY` and run
  `node build.mjs --site ../race-me --tools ../Suspension` in race-me/members-src. It refuses a key that doesn't open
  the current page.
- **New key** (for example after removing a member whose device still has the page open): build with `--new-key`. It
  prints an `insert into public.members_key …` statement. Run it in the SQL Editor right after publishing, or members
  get "can't be opened from your account right now" until you do. Every device signs in again.
- **Removing a member:** delete their user. They can't sign in again; replace the key if you also want devices they
  already unlocked to lose access.

## Admin panel

info@race-me.org (any account with `app_metadata.role = 'admin'`) gets an **Admin** button in the members header:
the member list with profiles, search, CSV download, invite by email, send a sign-in code, and remove a member.

- **Database:** `supabase/admin.sql` in race-me/members-src: `is_admin()`, `admin_members()`, `admin_remove_member()`, and
  the admin read rule on profiles. It also makes info@race-me.org the admin. Every action is checked in the database;
  members can't make themselves admin.
- **Invites:** the Edge Function `supabase/functions/admin-invite` in race-me/members-src, which holds the service-role key on Supabase.
- **Code:** `members/admin.js`, loaded by `sync.js` only for the admin.

## The Paddock (forum)

race-me.org/paddock/ is the club forum; it replaced Discord. Visitors can read sections marked public (Events & road
trips) with names shortened to "First L."; members sign in with their usual code and read and post everywhere: threads,
replies, photos, @mentions, a For sale & wanted section with price, location and status, "new" markers and search. The
admin (signed in as info@race-me.org) gets pin, lock, hide, move and delete on every thread.

- **Database:** `supabase/forum.sql` in race-me/members-src. All permissions are enforced there.
- **Code:** `paddock/index.html` and `paddock/forum.js`; sign-in comes from `members/sync.js`. `paddock.html` forwards
  old links.
- **Emails** for replies and @mentions: the `forum-notify` Edge Function and Resend; see members-src
  `supabase/README.md`.

## Member profiles

The first time a member signs in, a profile form opens before they can use the members area: name, phone, address,
emergency contact, Discord username (optional), driving experience, their cars (year, make, model, optional
modifications), "I'm 21 or older" and agreement to the member rules (saved with the date). They can change it later
with "Edit my profile" in the account panel.

- **Table:** `public.member_profiles`, one row per member (`supabase/profiles.sql` in race-me/members-src). Each member
  can read and change only their own row; officers see everyone's in the Table Editor. Deleting a user deletes their
  profile.
- **Code:** `members/profile.js`, loaded by `sync.js`. If the table can't be reached, members aren't blocked.

## Members page build

`members/index.html` is built from the private repo race-me/members-src (`node build.mjs --site ../race-me
--tools ../Suspension`); see its README. Don't edit `members/index.html` by hand. The members area has eight car
tools, all from the race-me/Suspension repo, and `sync.js` keeps each tool's data per member.

## Day to day

- **New member:** Authentication → Users → Invite user, with their email. They get a sign-in email.
- **Member leaves:** delete the user. Their saved tool data is deleted with them.
- **Lost a device:** nothing to do; signing in on the new one brings the data back.

## How sync decides

Each tool's storage is uploaded when it changes and downloaded when another device changed it. If this device and
the server both changed since the last sync, the two are merged: lists of sessions, logged results and saved cars
keep every entry from both, and this device's copy wins where the same setting differs. The device's copy from
before the merge is kept in browser storage as `raceme.sync.backup.<tool>`.

Tests: `node --test tests/sync.test.cjs`.
