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

The members content isn't in the page: after sign-in, `members/index.html` loads it from the Supabase storage bucket
`members-area`, which only signed-in members can read. The GitHub Action in race-me/members-src publishes it (on every
push, daily, and on demand). There is no page key any more.

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

Race day (members only) is for live threads at events: an open Race day thread checks for new posts every 30 seconds,
so members who can't be there can follow along. While someone is typing a reply, new posts wait behind a "new posts"
button instead.

## Crew

The Crew tab on the members page (race-me.org/members/#crew) lets a member share a car from their Setup Log with another
member: a remote crew chief, a coach, a friend. The crew member opens that car's setup sheet and sessions read only (the
Setup Log in a read-only mode), and either of them can leave notes on the car. The owner can stop sharing any time and
the crew member can leave. The shared copy is whatever the owner's Setup Log last synced to their account.

- **Database:** `supabase/crew.sql` in race-me/members-src (`crew_shares`, `crew_notes`, `crew_overview()`,
  `crew_car_notes()`). Only the owner and the members a car is shared with can see it.
- **Code:** `members/crew.js`, loaded by the members page the first time the Crew tab is opened; the read-only mode is
  in `tools/setup-log.html` (`window.RACEME_CREW`).

## Standings

race-me.org/standings/ is the season table. Before each event members pick 1st, 2nd, 3rd and fastest lap from the entry
list; picks lock at the time the admin sets (8 am on the event day by default) and everyone's picks show once they
lock. After the event the admin enters the results. Scoring: 5 points for each driver in the exact podium spot, 2 for a
driver on the podium in a different spot, 3 for fastest lap. Bragging rights only: no money, no prizes.

The admin (info@race-me.org) gets Add an event, Edit event (name, track, date, when picks close, entry list one driver
per line) and Enter results on the page itself.

- **Database:** `supabase/standings.sql` in race-me/members-src. Picks go through `standings_pick()`, which checks the
  deadline and the entry list; only the admin can change events and results.
- **Code:** `standings/index.html` and `standings/standings.js`.

## Member profiles

The first time a member signs in, a profile form opens before they can use the members area: name, phone, address,
emergency contact, driving experience, their cars (year, make, model, optional
modifications), "I'm 21 or older" and agreement to the member rules (saved with the date). They can change it later
with "Edit my profile" in the account panel.

- **Table:** `public.member_profiles`, one row per member (`supabase/profiles.sql` in race-me/members-src). Each member
  can read and change only their own row; officers see everyone's in the Table Editor. Deleting a user deletes their
  profile.
- **Code:** `members/profile.js`, loaded by `sync.js`. If the table can't be reached, members aren't blocked.

## Members page

`members/index.html` is a copy of `src/shell.html` in race-me/members-src (header, sign-in, and the loader). The
content (`body.html`, `benefits.json`, the eight car tools) lives in members-src and is published to Supabase by its
**Publish members area** action; see its README. `sync.js`, `profile.js`, `admin.js` live here in race-me.

## Profile photos

Members can add a photo in their profile; it's cropped square to 256 px and stored as `avatars/<user id>.jpg`. Members
see photos next to names in the Paddock; visitors see initials. The admin can remove a photo from the Admin panel.

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
