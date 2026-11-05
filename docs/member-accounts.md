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

## Members page build

`members/index.html` is built by `build-members.ps1` from `members-src/` (kept off GitHub because it holds the
unencrypted members content). On 2026-11-05 it was rebuilt outside that script to add:

- the Corner Balance and Setup Log pages (tabs, overview cards, legal and account notes),
- tool frames by name: the encrypted payload is now `{ html, benefits, tools: { bench, balance, setup } }`, and the
  page script makes a frame from `tools[name]` inside `[data-frame="name"]`; buttons use
  `data-action="open-tool" data-tool="name"`,
- `<script src="sync.js" defer></script>` before `</body>`.

Bring `members-src/` and `build-members.ps1` up to date with these before the next local build, or that build will
drop them. The tool pages come from the race-me/Suspension repo: `index.html` (bench), `corner-balance.html`,
`setup-log.html`.

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
