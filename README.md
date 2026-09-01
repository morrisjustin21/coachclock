# Coach's Clock

A standalone race-timing tool for cross country coaches. Build your team
roster once, pick who's running each race, arrange your expected finish
order, then tap names as runners cross the line.

## How it works

1. **Team roster** — add your athletes once (name + optional bib). Reused
   across every race all season.
2. **New race** — create a race, then select which athletes from your
   roster are competing (handles varsity/JV/middle school splits) and
   arrange them into your predicted finish order.
3. **Race day** — hit Start, tap each name as they finish. They drop to
   the results list at the bottom with a timestamp. Misclick? Hit Undo to
   pull back the last one.
4. **Share results** — every race has a public URL (`/race/:id`) that
   updates live for anyone you send it to, no login required.

## Setup

This app is designed to share an existing Supabase project (like the one
behind OKXCRankings) rather than needing its own. All of its tables live
in a dedicated `coaches_clock` schema, so nothing collides with another
app's tables in the same project.

### 1. Use an existing Supabase project (or create one)
- If you already have a Supabase project you're not maxed out on, you can
  reuse it — no need to create a new one
- Otherwise go to supabase.com and create a new project

### 2. Run the schema
- In the SQL editor, run everything in `schema.sql`
- This creates a `coaches_clock` schema containing `team_athletes`,
  `races`, `athletes`, and `splits`, with RLS policies scoped to that
  schema only

### 3. Expose the schema to the API
- Go to Project Settings → API → Exposed schemas
- Add `coaches_clock` to the list (Supabase only serves `public` by
  default — without this step the app can't reach its own tables)

### 4. Confirm email settings (optional)
- Under Authentication → Providers → Email, consider disabling "Confirm
  email" if you want coaches to sign up and use the app immediately

### 5. Get your API keys
- Project Settings → API → copy the Project URL and anon public key
  (these are the same keys your other app on this project already uses)

### 6. Deploy to Vercel
- Push this repo to GitHub (use the GitHub web editor to create the files
  under the paths shown, matching this folder structure)
- Import the repo in Vercel — name the project `coachs-clock` so your URL
  comes out as `coachs-clock.vercel.app`
- Add environment variables in Vercel project settings:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- Deploy

### 7. Local development (optional)
Create a `.env` file with the same two variables, then:
```
npm install
npm run dev
```

## Notes for sharing with other coaches

Each coach who signs up gets their own private roster and races — nothing
is shared between accounts except a race's public results link, which
anyone can view but only the owning coach can edit.
