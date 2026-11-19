# Track Social Hub — Episode Marking Fix Bundle

This bundle contains complete replacement copies of the six source files uploaded for the episode-marking issue.

## Files
- `Dashboard.tsx` — exposes the actual Supabase/PostgREST error in the alert and console, and reloads server state after a failed optimistic update.
- `episodeProgress.ts` — propagates database errors from watch-time and watchlist synchronization instead of silently swallowing them.
- `EpisodeTracker.tsx` — unchanged copy.
- `UniversalBrowser.tsx` — unchanged copy.
- `WatchEngine.tsx` — unchanged copy.
- `watchActivity.ts` — unchanged copy.

## Important
This is a replacement bundle for the six uploaded files, **not a complete Next.js project**. The project configuration, package files, API routes, Supabase schema/migrations, and other source files were not uploaded, so a full-project build or deployment cannot be run from this bundle alone.

Copy each file into its original project location, preserving the existing folder structure. In particular:
- `Dashboard.tsx`, `EpisodeTracker.tsx`, `UniversalBrowser.tsx`, `WatchEngine.tsx` go into the same component folder as the originals.
- `episodeProgress.ts` and `watchActivity.ts` go into the same `lib` folder as the originals.

After replacing, run the commands from the project root. If the new alert shows a Postgres error code such as `42P10`, that points to the `episode_progress` upsert conflict target/unique-index definition and the table schema/migration must be checked before changing SQL.
