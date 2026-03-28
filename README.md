# IPL Fantasy Tracker

Next.js + Supabase dashboard for your head-to-head IPL fantasy battle.

## What changed
- No default players anymore.
- You enter 4 players per side.
- Exactly 1 trump per side.
- The app can auto-link the current league match from the configured cricket source.
- The app can auto-refresh live stats into the dashboard.

## Environment variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRICKET_API_BASE_URL` defaults to `https://api.cricapi.com`
- `CRICKET_API_KEY` optional, only if your chosen provider needs one
- `CRICKET_API_HOST` optional, useful for RapidAPI-style providers
- `CRON_SECRET` optional if you want to protect cron-triggered routes later

## Deploy
1. Run `supabase/schema.sql` in Supabase.
2. Add the environment variables in Vercel.
3. Deploy.
4. Open the site.
5. Click **Link Today's Match**.
6. Enter the 4 players for each side and mark one trump.
7. Click **Sync Scores Now** to test the live feed.

## Important note
The default provider in this build is an unofficial Cricbuzz-based feed. It is convenient because it does not require a key, but provider payloads can change. The refresh code is written to try multiple common scorecard endpoint shapes and parse several response formats, but if your provider changes you may need to adjust `lib/cricket-provider.ts`.


## Debugging update
- Sync now shows whether the request was throttled.
- It shows how many selected players matched provider rows.
- It lists unmatched selected players and a sample of provider player names.
- Name matching is looser for initials and shortened variants.


## CricketData.org setup

Set `CRICKET_API_BASE_URL=https://api.cricapi.com` and add your CricketData/CricAPI key as `CRICKET_API_KEY`. The app uses `currentMatches` to discover the IPL fixture and `match_scorecard` to refresh player stats.
