"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";

/*
 * IMDB IMPORT
 *
 * IMDb lets a user export their watchlist as a CSV
 * ("Your Watchlist" -> Export). That CSV only has IMDb's
 * own ids (e.g. "tt1234567") — it has no connection to the
 * TMDB ids the rest of this app uses for tracking (see
 * getContentId() in UniversalBrowser.tsx, which keys
 * watch_sessions rows as `${type}-${tmdbId}`).
 *
 * So importing isn't just "read the file" — each row has to
 * be matched to the right TMDB entry first, by title + year,
 * using the existing /api/tmdb/movies and /api/tmdb/tv search
 * routes. Anything that can't be confidently matched is shown
 * to the user instead of silently guessing.
 *
 * Matched items are saved using the SAME localStorage
 * key/shape UniversalBrowser.tsx already uses, so they show
 * up there immediately with no extra wiring. The user picks
 * the status up front (Watchlist / Watching / Completed) —
 * see ImportMode below. When logged in, matches are also
 * synced to Supabase's watchlist_items table (so Dashboard /
 * Continue Watching pick them up, not just the local status
 * cache), and — only for "Completed" — to watch_sessions with
 * an estimated runtime, matching how a manual status change
 * in UniversalBrowser.tsx behaves.
 */

const STORAGE_KEY = "universal_browser_status_v1";

type ImportMode = "watchlist" | "watching" | "completed";

/*
 * Movie/TV search results don't include runtime — only the
 * *-details routes do (same routes UniversalBrowser.tsx uses
 * for the same reason). Only called when importing "As
 * Completed", so ordinary Watchlist/Watching imports don't pay
 * for the extra request.
 */
async function fetchMovieRuntimeSeconds(
  tmdbId: number,
): Promise<number> {
  try {
    const res = await fetch(
      `/api/tmdb/movie-details?id=${encodeURIComponent(String(tmdbId))}`,
      { cache: "no-store" },
    );

    if (!res.ok) {
      return 0;
    }

    const data = await res.json();
    const runtime = Number(data?.runtime);

    return Number.isFinite(runtime) && runtime > 0
      ? Math.round(runtime * 60)
      : 0;
  } catch {
    return 0;
  }
}

async function fetchTvRuntimeInfo(
  tmdbId: number,
): Promise<{ seconds: number; episodes: number | null }> {
  try {
    const res = await fetch(
      `/api/tmdb/tv-details?id=${encodeURIComponent(String(tmdbId))}`,
      { cache: "no-store" },
    );

    if (!res.ok) {
      return { seconds: 0, episodes: null };
    }

    const data = await res.json();
    const episodeRuntime = Number(data?.episodeRuntime);
    const episodes = Number(data?.numberOfEpisodes) || null;

    const seconds =
      Number.isFinite(episodeRuntime) &&
      episodeRuntime > 0 &&
      episodes
        ? Math.round(episodes * episodeRuntime * 60)
        : 0;

    return { seconds, episodes };
  } catch {
    return { seconds: 0, episodes: null };
  }
}

async function persistWatchlistItem(params: {
  userId: string;
  contentId: string;
  category: "Movies" | "TV";
  title: string;
  imageUrl: string | null;
  status: ImportMode;
  estimatedSeconds: number;
  totalEpisodes: number | null;
}) {
  const { error } = await supabase.from("watchlist_items").upsert(
    {
      user_id: params.userId,
      content_id: params.contentId,
      category: params.category,
      title: params.title,
      image_url: params.imageUrl,
      status: params.status,
      estimated_seconds: params.estimatedSeconds,
      total_episodes: params.totalEpisodes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,content_id" },
  );

  if (error) {
    console.error("Failed to sync watchlist item:", error);
  }
}

async function persistCompletedWatchSession(params: {
  userId: string;
  contentId: string;
  category: "Movies" | "TV";
  estimatedSeconds: number;
}) {
  if (params.estimatedSeconds <= 0) {
    return;
  }

  const { data: existingSessions, error: findError } = await supabase
    .from("watch_sessions")
    .select("id,total_seconds")
    .eq("user_id", params.userId)
    .eq("content_id", params.contentId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (findError) {
    console.error("Failed to check existing watch session:", findError);
    return;
  }

  const existing = existingSessions?.[0];

  if (existing) {
    const finalSeconds = Math.max(
      Number(existing.total_seconds || 0),
      params.estimatedSeconds,
    );

    const { error } = await supabase
      .from("watch_sessions")
      .update({
        total_seconds: finalSeconds,
        is_active: false,
        category: params.category,
        last_heartbeat: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("user_id", params.userId);

    if (error) {
      console.error("Failed to update watch session:", error);
    }

    return;
  }

  const now = new Date().toISOString();

  const { error } = await supabase.from("watch_sessions").insert({
    user_id: params.userId,
    content_id: params.contentId,
    started_at: now,
    last_heartbeat: now,
    is_active: false,
    total_seconds: params.estimatedSeconds,
    category: params.category,
  });

  if (error) {
    console.error("Failed to insert watch session:", error);
  }
}

type ImdbRow = {
  title: string;
  year: number | null;
  titleType: string;
};

type MatchResult = {
  row: ImdbRow;
  matchedTitle?: string;
  tmdbId?: number;
  type?: "Movies" | "TV";
};

function getStoredStatuses(): Record<string, string> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);

    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoredStatuses(statuses: Record<string, string>) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(statuses));
  } catch {
    // Ignore localStorage errors.
  }
}

/*
 * Small CSV parser (handles quoted fields containing commas,
 * which IMDb's export uses for titles like "Ocean's, Eleven").
 * Avoids adding a papaparse dependency just for this.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") {
        i += 1;
      }

      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function extractRows(csvText: string): ImdbRow[] {
  const table = parseCsv(csvText);

  if (table.length < 2) {
    return [];
  }

  const header = table[0].map((col) => col.trim().toLowerCase());

  const titleIndex = header.findIndex((col) => col === "title");
  const yearIndex = header.findIndex((col) => col === "year");
  const typeIndex = header.findIndex(
    (col) => col === "title type" || col === "titletype",
  );

  if (titleIndex === -1) {
    return [];
  }

  return table.slice(1).map((cols) => ({
    title: (cols[titleIndex] || "").trim(),
    year:
      yearIndex !== -1 && Number(cols[yearIndex])
        ? Number(cols[yearIndex])
        : null,
    titleType:
      typeIndex !== -1 ? (cols[typeIndex] || "").toLowerCase() : "",
  })).filter((row) => row.title);
}

function guessType(row: ImdbRow): "Movies" | "TV" {
  if (
    row.titleType.includes("series") ||
    row.titleType.includes("episode")
  ) {
    return "TV";
  }

  return "Movies";
}

async function searchTmdb(
  row: ImdbRow,
  type: "Movies" | "TV",
): Promise<{
  id: number;
  title: string;
  posterPath: string | null;
} | null> {
  const endpoint = type === "Movies" ? "movies" : "tv";

  const res = await fetch(
    `/api/tmdb/${endpoint}?query=${encodeURIComponent(row.title)}&page=1`,
    { cache: "no-store" },
  );

  if (!res.ok) {
    return null;
  }

  const data = await res.json();
  const results = data?.results || [];

  if (results.length === 0) {
    return null;
  }

  // Prefer a result whose year matches, otherwise take the top hit.
  const withYear = row.year
    ? results.find((entry: any) => {
        const dateField =
          type === "Movies"
            ? entry.release_date
            : entry.first_air_date;

        return (
          dateField &&
          Number(String(dateField).slice(0, 4)) === row.year
        );
      })
    : null;

  const best = withYear || results[0];

  const tmdbId = best.tmdb_id ?? best.id;
  const title = best.title || best.name || row.title;
  const posterPath = best.poster_path ?? null;

  if (!tmdbId) {
    return null;
  }

  return { id: tmdbId, title, posterPath };
}

export default function IMDBImport() {
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [matched, setMatched] = useState<MatchResult[]>([]);
  const [unmatched, setUnmatched] = useState<ImdbRow[]>([]);
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(false);

  /* Watchlist / Watching / Completed — picked before uploading. */
  const [importMode, setImportMode] = useState<ImportMode>("watchlist");
  const [syncedToAccount, setSyncedToAccount] = useState(false);

  async function handleFile(file: File) {
    setError("");
    setFinished(false);
    setMatched([]);
    setUnmatched([]);
    setFileName(file.name);

    const text = await file.text();
    const rows = extractRows(text);

    if (rows.length === 0) {
      setError(
        "Couldn't find any rows in that file. Make sure it's the CSV exported from IMDb's Watchlist page.",
      );
      return;
    }

    setImporting(true);
    setProgress({ done: 0, total: rows.length });

    const matchedResults: MatchResult[] = [];
    const unmatchedRows: ImdbRow[] = [];

    const statuses = getStoredStatuses();

    /*
     * Logged in -> also sync each match to Supabase so
     * Dashboard / Continue Watching / watch time stats see
     * these too, not just the local status cache. Not logged
     * in -> import still works, just stays local-only (same
     * as before).
     */
    const {
      data: { user },
    } = await supabase.auth.getUser();

    setSyncedToAccount(Boolean(user));

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const type = guessType(row);

      try {
        // eslint-disable-next-line no-await-in-loop
        const found = await searchTmdb(row, type);

        if (found) {
          matchedResults.push({
            row,
            matchedTitle: found.title,
            tmdbId: found.id,
            type,
          });

          const contentId = `${type.toLowerCase()}-${found.id}`;

          statuses[contentId] = importMode;

          if (user) {
            try {
              let estimatedSeconds = 0;
              let totalEpisodes: number | null = null;

              if (importMode === "completed") {
                if (type === "Movies") {
                  estimatedSeconds =
                    await fetchMovieRuntimeSeconds(found.id);
                } else {
                  const info = await fetchTvRuntimeInfo(found.id);
                  estimatedSeconds = info.seconds;
                  totalEpisodes = info.episodes;
                }
              }

              const imageUrl = found.posterPath
                ? `https://image.tmdb.org/t/p/w500${found.posterPath}`
                : null;

              // eslint-disable-next-line no-await-in-loop
              await persistWatchlistItem({
                userId: user.id,
                contentId,
                category: type,
                title: found.title,
                imageUrl,
                status: importMode,
                estimatedSeconds,
                totalEpisodes,
              });

              if (importMode === "completed") {
                // eslint-disable-next-line no-await-in-loop
                await persistCompletedWatchSession({
                  userId: user.id,
                  contentId,
                  category: type,
                  estimatedSeconds,
                });
              }
            } catch (syncError) {
              console.error(
                "Failed to sync to Supabase:",
                row.title,
                syncError,
              );
            }
          }
        } else {
          unmatchedRows.push(row);
        }
      } catch (err) {
        console.error("IMDB import match failed:", row.title, err);
        unmatchedRows.push(row);
      }

      setProgress({ done: i + 1, total: rows.length });
    }

    saveStoredStatuses(statuses);

    setMatched(matchedResults);
    setUnmatched(unmatchedRows);
    setImporting(false);
    setFinished(true);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="text-2xl font-bold text-white">
        Import from IMDb
      </h2>

      <p className="mt-2 text-sm text-white/50">
        Go to your IMDb Watchlist page, click the ⋯ menu, choose{" "}
        <span className="text-white/80">Export</span>, then upload
        the CSV file it downloads here. Each title gets matched to
        this app's Movies/TV database and added with the status you
        pick below.
      </p>

      {/* Import Mode */}
      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="mb-3 text-sm font-medium text-white/70">
          Add matched titles as
        </p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              { value: "watchlist" as const, label: "Watchlist" },
              { value: "watching" as const, label: "As Watching" },
              { value: "completed" as const, label: "As Completed" },
            ]
          ).map((option) => {
            const active = importMode === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setImportMode(option.value)}
                disabled={importing}
                className={[
                  "rounded-xl border px-3 py-3 text-sm font-semibold transition",
                  active
                    ? "border-purple-400/60 bg-purple-500/20 text-white"
                    : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                ].join(" ")}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-6 py-10 text-center transition hover:border-purple-400/40 hover:bg-white/[0.05]">
        <input
          type="file"
          accept=".csv"
          className="hidden"
          disabled={importing}
          onChange={(event) => {
            const file = event.target.files?.[0];

            if (file) {
              handleFile(file);
            }
          }}
        />

        <span className="text-lg font-semibold text-white">
          {fileName || "Choose IMDb watchlist CSV"}
        </span>

        <span className="text-xs text-white/40">
          .csv file exported from IMDb
        </span>
      </label>

      {error && (
        <div className="mt-6 rounded-2xl border border-red-500/50 bg-red-500/10 p-5">
          <p className="text-red-200/80">{error}</p>
        </div>
      )}

      {importing && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center justify-between text-sm text-white/60">
            <span>Matching titles against TMDB...</span>
            <span>
              {progress.done} / {progress.total}
            </span>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-purple-400 to-fuchsia-500 transition-all"
              style={{
                width: `${
                  progress.total
                    ? (progress.done / progress.total) * 100
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      )}

      {finished && (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-5">
            <p className="font-semibold text-emerald-300">
              ✓ {matched.length} title
              {matched.length === 1 ? "" : "s"} added as{" "}
              {importMode === "watchlist"
                ? "Watchlist"
                : importMode === "watching"
                ? "Watching"
                : "Completed"}
            </p>

            {!syncedToAccount && (
              <p className="mt-1 text-xs text-emerald-300/60">
                Log in to also sync these to your account's watch
                time & Dashboard stats.
              </p>
            )}
          </div>

          {unmatched.length > 0 && (
            <div className="rounded-2xl border border-yellow-400/30 bg-yellow-500/10 p-5">
              <p className="font-semibold text-yellow-300">
                {unmatched.length} title
                {unmatched.length === 1 ? "" : "s"} couldn't be
                matched automatically
              </p>

              <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-sm text-yellow-100/70">
                {unmatched.map((row, index) => (
                  <li key={index}>
                    {row.title}
                    {row.year ? ` (${row.year})` : ""}
                  </li>
                ))}
              </ul>

              <p className="mt-3 text-xs text-yellow-100/50">
                Search for these manually in Browse and add them
                from there.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}