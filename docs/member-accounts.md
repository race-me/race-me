# Member accounts and sync

Members can sign in with their email to keep their tool data (Suspension Bench cars, Corner Balance, Setup Log)
online and the same on every device. It's optional: without signing in, the tools save in the browser as before.

- Code: `members/sync.js` (sign-in button and panel in the members header, and the sync itself).
- Database: Supabase project `lkktdmdnwdklyvapyjxb`, table `public.tool_data`, one row per member per tool.
  Created by `supabase/setup.sql` in the race-me/Suspension repo. Row-level security limits every member to their own rows.
- The publishable key in `sync.js` is meant to be public. Never put the `service_role` key in any page.

## One-time Supabase setup

1. **SQL Editor:** paste and run `supabase/setup.sql`.
2. **Authentication → Sign In / Providers:** turn off "Allow new users to sign up". Leave Email enabled.
3. **Authentication → URL Configuration:** Site URL `https://race-me.org/members/`. Add these Redirect URLs:
   `https://race-me.org/members/` and `https://race-me.org/members/index.html`.
4. **Authentication → Emails → SMTP:** set up a real email sender (for example Resend, or the provider behind
   info@race-me.org). Supabase's built-in sender is for testing and may only deliver to your own team's addresses.

## Single login

Members with an account don't need the club password: the login screen offers "Email me a sign-in link", and an
invite or sign-in link opens the members area directly. This works because the page's unlock key is stored in the
one-row table `public.members_key`, which only signed-in members can read (`supabase/members-key.sql` in
race-me/Suspension). Accounts are invite-only, so this is the same as giving a member the club password.

- **Setup:** run `supabase/members-key.sql` once, then the `insert into public.members_key …` statement printed by
  `node build.mjs --site ../race-me --tools ../Suspension --key-sql` (in race-me/members-src).
- **Changing the club password:** build with `--new-password`; it prints the new statement. Run it, or account
  holders get "can't be unlocked from your account yet" until you do.
- **Removing a member:** delete their user. Like the club password, a device that already unlocked the page keeps
  it until the password changes.

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
