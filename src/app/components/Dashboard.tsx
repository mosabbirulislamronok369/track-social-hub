"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { supabase } from "../lib/supabase";
import {
  setEpisodeWatched,
  fetchTvSeasonBreakdown,
  resolveFlatEpisode,
} from "../lib/episodeProgress";
import { fetchTodayQuranLog } from "../lib/quranTrack";
import WatchTimeChart from "./WatchTimeChart";

type SearchType =
  | "Anime"
  | "TV"
  | "Movies"
  | "YouTube";

type Category =
  | "YouTube"
  | "Anime"
  | "TV"
  | "Movies"
  | "Social"
  | "Private";

type Stats = Record<Category, number>;

type WatchStatus =
  | "watching"
  | "hold"
  | "completed"
  | "dropped";

type SearchResult = {
  id: string | number;
  title: string;
  subtitle?: string;
  image?: string | null;
  description?: string | null;
  rating?: number | null;
  date?: string | null;

  runtimeSeconds?: number | null;
  runtime?: number | null;
  episodes?: number | null;
  episodeRuntime?: number | null;
  duration?: string | null;
};

/*
 * Continue Watching
 * Sourced from the watchlist_items table, which
 * UniversalBrowser (and friends) upsert into whenever the
 * user sets a status on something — not just "completed".
 */
type ContinueWatchingStatus =
  | "watchlist"
  | "watching"
  | "on_hold"
  | "rewatch";

type ContinueWatchingItem = {
  contentId: string;
  category: Category;
  title: string;
  imageUrl: string | null;
  status: ContinueWatchingStatus;
  estimatedSeconds: number;
  updatedAt: string;
  currentEpisode: number;
  totalEpisodes: number | null;
};

/*
 * Statuses the 3-dot card menu can move an item to.
 * "completed", "dropped", AND "on_hold" are NOT in
 * CONTINUE_WATCHING_STATUSES, so setting any of those
 * removes the card from this rail entirely (same effect as
 * "Remove", but recorded with a real status instead of a
 * delete).
 */
type CardMenuStatus = "completed" | "on_hold" | "dropped";

const CONTINUE_WATCHING_STATUSES: ContinueWatchingStatus[] = [
  "watching",
  "watchlist",
  "rewatch",
];

const CONTINUE_WATCHING_LABELS: Record<
  ContinueWatchingStatus,
  string
> = {
  watchlist: "Watchlist",
  watching: "Watching",
  on_hold: "On Hold",
  rewatch: "Rewatch",
};

const CONTINUE_WATCHING_ICONS: Record<
  ContinueWatchingStatus,
  string
> = {
  watchlist: "🔖",
  watching: "▶",
  on_hold: "⏸",
  rewatch: "↻",
};

/*
 * Options shown in the card's 3-dot menu. `remove` deletes the
 * watchlist_items row outright; the rest just update `status`.
 */
const CARD_MENU_ACTIONS: {
  key: CardMenuStatus | "remove";
  label: string;
  icon: string;
}[] = [
  { key: "completed", label: "Mark Completed", icon: "✔" },
  { key: "on_hold", label: "Put on Hold", icon: "⏸" },
  { key: "dropped", label: "Drop", icon: "✕" },
  { key: "remove", label: "Remove", icon: "🗑" },
];

const categories: Category[] = [
  "YouTube",
  "Anime",
  "TV",
  "Movies",
  "Social",
  "Private",
];

const emptyStats: Stats = {
  YouTube: 0,
  Anime: 0,
  TV: 0,
  Movies: 0,
  Social: 0,
  Private: 0,
};

function formatTime(totalSeconds: number) {
  const seconds = Math.max(
    0,
    Math.floor(Number(totalSeconds) || 0)
  );

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return `${days}d ${hours}h ${minutes}m`;
}

/*
 * Quran card needs finer granularity than formatTime's d/h/m
 * rollup — most daily reading sessions are under an hour, so
 * this shows m/s (or h/m for longer ones) instead of "0d 0h 5m".
 */
function formatQuranTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }

  return `${secs}s`;
}

function getPlaceholderImage() {
  return "https://placehold.co/600x900/111827/ffffff?text=No+Image";
}

/*
 * The contentId convention (getContentId in UniversalBrowser)
 * is `${type.toLowerCase()}-${id}` — e.g. "tv-12345". We only
 * need the raw TMDB id back out here, to look up season data.
 */
function extractRawId(contentId: string, category: Category) {
  const prefix = `${category.toLowerCase()}-`;

  return contentId.startsWith(prefix)
    ? contentId.slice(prefix.length)
    : contentId;
}

/* ============================================================
   RUNTIME HELPERS
   (kept — still used by watchlist / status logic elsewhere
   in the app, e.g. PrivateWatchlist)
============================================================ */

function parseDurationToMinutes(duration?: string | null) {
  if (!duration) {
    return null;
  }

  const text = duration.toLowerCase();

  const hourMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:hour|hours|hr|hrs|h)/
  );

  const minuteMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:minute|minutes|min|mins|m)/
  );

  let totalMinutes = 0;

  if (hourMatch) {
    totalMinutes += Number(hourMatch[1]) * 60;
  }

  if (minuteMatch) {
    totalMinutes += Number(minuteMatch[1]);
  }

  if (totalMinutes > 0) {
    return Math.round(totalMinutes);
  }

  const plainNumber = Number(text);

  if (Number.isFinite(plainNumber) && plainNumber > 0) {
    return Math.round(plainNumber);
  }

  return null;
}

function getRuntimeSeconds(result: SearchResult) {
  if (
    typeof result.runtimeSeconds === "number" &&
    result.runtimeSeconds > 0
  ) {
    return Math.round(result.runtimeSeconds);
  }

  if (typeof result.runtime === "number" && result.runtime > 0) {
    if (result.runtime > 10000) {
      return Math.round(result.runtime);
    }

    return Math.round(result.runtime * 60);
  }

  if (typeof result.episodes === "number" && result.episodes > 0) {
    let episodeMinutes =
      typeof result.episodeRuntime === "number"
        ? result.episodeRuntime
        : null;

    if (!episodeMinutes) {
      episodeMinutes = parseDurationToMinutes(result.duration);
    }

    if (typeof episodeMinutes === "number" && episodeMinutes > 0) {
      return Math.round(result.episodes * episodeMinutes * 60);
    }
  }

  const parsedDuration = parseDurationToMinutes(result.duration);

  if (typeof parsedDuration === "number" && parsedDuration > 0) {
    return Math.round(parsedDuration * 60);
  }

  return 0;
}

/* ============================================================
   DASHBOARD
============================================================ */

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [loading, setLoading] = useState(true);

  /*
   * Total time spent on rewatches (2nd+ session per content),
   * computed from watch_sessions. Replaces the old "Social" card.
   */
  const [rewatchSeconds, setRewatchSeconds] = useState(0);

  /*
   * Grand total across EVERY watch_sessions row for this user,
   * regardless of its `category` value. Kept separate from
   * `stats` (which only buckets the 6 known categories) so a
   * row with an unexpected/legacy category string still counts
   * toward the headline "Total Watch Time" number — otherwise
   * it silently disappears here while still being counted by
   * the Leaderboard's get_leaderboard() RPC, which sums by
   * whatever `category` value actually exists with no such
   * filter. That mismatch is what caused Dashboard's total to
   * read lower than the Leaderboard's total for the same user.
   */
  const [rawTotalSeconds, setRawTotalSeconds] = useState(0);

  /*
   * Continue Watching — anything the user has added to their
   * watchlist / is watching / on hold / rewatching, newest
   * first. Populated from watchlist_items (see saveItemStatus
   * in UniversalBrowser, which upserts into that table).
   */
  const [continueWatching, setContinueWatching] = useState<
    ContinueWatchingItem[]
  >([]);

  const [continueWatchingLoading, setContinueWatchingLoading] =
    useState(true);

  /*
   * contentId currently being updated via "Mark Next Episode",
   * so we can disable just that one button while it saves.
   */
  const [markingEpisodeId, setMarkingEpisodeId] = useState<
    string | null
  >(null);

  /*
   * contentId of the card whose 3-dot menu (Completed / Hold /
   * Drop / Remove) is currently open. Only one menu open at a
   * time, and it closes on outside click (see the effect
   * below) or once an action is chosen.
   */
  const [openMenuId, setOpenMenuId] = useState<string | null>(
    null,
  );

  /*
   * contentId currently being updated via the 3-dot menu, so
   * we can show a small "Updating..." state on that card and
   * ignore repeat clicks while the request is in flight.
   */
  const [updatingItemId, setUpdatingItemId] = useState<
    string | null
  >(null);

  /*
   * contentId of the Continue Watching card whose details
   * modal is open. We deliberately store just the id — not a
   * snapshot of the item — so the modal always reads the
   * live entry from `continueWatching`. That keeps the modal's
   * progress bar and "Mark Next Episode" button in sync with
   * the card's, since both render from the same array/state
   * instead of two separate copies.
   */
  const [selectedContentId, setSelectedContentId] = useState<
    string | null
  >(null);

  /*
   * Today's Quran reading progress (quran_reading_log), shown
   * as its own card alongside the watch-time stat cards below.
   */
  const [quranSeconds, setQuranSeconds] = useState(0);
  const [quranGoalMinutes, setQuranGoalMinutes] = useState<
    number | null
  >(null);
  const [quranLoading, setQuranLoading] = useState(true);

  const loadQuran = useCallback(async () => {
    setQuranLoading(true);

    const log = await fetchTodayQuranLog();

    setQuranSeconds(log?.totalSeconds ?? 0);
    setQuranGoalMinutes(log?.goalMinutes ?? null);
    setQuranLoading(false);
  }, []);

  /* ============================================================
     LOAD DASHBOARD STATS
  ============================================================ */

  const loadStats = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      /*
       * Uses a server-side RPC (get_dashboard_stats) instead of
       * pulling every watch_sessions row and summing in JS.
       *
       * Why: PostgREST caps an unbounded select at 1000 rows by
       * default. WatchEngine inserts a new watch_sessions row
       * per session, so active users can easily pass 1000 rows —
       * once that happened, ordering by created_at ascending
       * silently returned only the OLDEST 1000 rows and dropped
       * the newest ones, so Total Watch Time stopped reflecting
       * recent activity (while the Leaderboard, backed by its
       * own SQL aggregate, kept updating correctly). The RPC
       * does the same rewatch/category/raw-total math inside
       * Postgres, so the row cap never applies and only a
       * handful of summary rows come back over the wire.
       */
      const { data, error } = await supabase.rpc(
        "get_dashboard_stats",
      );

      if (error) {
        console.error("Failed to load watch stats:", error);
        setLoading(false);
        return;
      }

      const nextStats: Stats = { ...emptyStats };
      let rewatchTotal = 0;
      let rawTotal = 0;

      for (const row of data ?? []) {
        const category = row.category as Category;
        const seconds = Number(row.total_seconds ?? 0);

        if (categories.includes(category)) {
          nextStats[category] = seconds;
        }

        // Same value on every row (cross-joined in the RPC) —
        // just needs reading once.
        rewatchTotal = Number(row.rewatch_seconds ?? 0);
        rawTotal = Number(row.raw_total_seconds ?? 0);
      }

      setStats(nextStats);
      setRewatchSeconds(rewatchTotal);
      setRawTotalSeconds(rawTotal);
    } catch (error) {
      console.error("Dashboard error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  /* ============================================================
     LOAD CONTINUE WATCHING
  ============================================================ */

  /*
   * loadContinueWatching() gets triggered from several places
   * at once — the watchlist_items realtime channel, the 10s
   * poll, a custom event, AND our own optimistic-update flows.
   * Those fetches can resolve out of order: an older, slower
   * request can come back AFTER a newer one and stomp on
   * fresher state with stale data (e.g. the episode count
   * flashing back to an old number right after "Mark Next
   * Episode"). This ref tags each fetch with an id and only
   * applies the result if it's still the most recent one.
   */
  const continueWatchingRequestId = useRef(0);

  const loadContinueWatching = useCallback(async () => {
    const requestId = ++continueWatchingRequestId.current;

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (requestId === continueWatchingRequestId.current) {
          setContinueWatchingLoading(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from("watchlist_items")
        .select(
          "content_id,category,title,image_url,status,estimated_seconds,updated_at,current_episode,total_episodes",
        )
        .eq("user_id", user.id)
        .in("status", CONTINUE_WATCHING_STATUSES)
        .order("updated_at", { ascending: false })
        .limit(12);

      // A newer request has already started (or finished)
      // since this one was issued — discard this stale result
      // instead of overwriting fresher state with it.
      if (requestId !== continueWatchingRequestId.current) {
        return;
      }

      if (error) {
        console.error(
          "Failed to load continue watching:",
          error,
        );
        setContinueWatchingLoading(false);
        return;
      }

      setContinueWatching(
        (data ?? []).map((row: any) => ({
          contentId: row.content_id,
          category: row.category as Category,
          title: row.title,
          imageUrl: row.image_url,
          status: row.status as ContinueWatchingStatus,
          estimatedSeconds: Number(
            row.estimated_seconds ?? 0,
          ),
          updatedAt: row.updated_at,
          currentEpisode: Number(row.current_episode ?? 0),
          totalEpisodes:
            row.total_episodes != null
              ? Number(row.total_episodes)
              : null,
        })),
      );
    } catch (error) {
      console.error("Continue watching error:", error);
    } finally {
      if (requestId === continueWatchingRequestId.current) {
        setContinueWatchingLoading(false);
      }
    }
  }, []);

  /* ============================================================
     MARK NEXT EPISODE (Anime + TV)

     Both branches ultimately call setEpisodeWatched()
     (lib/episodeProgress.ts) — the same function EpisodeTracker
     uses — so episode_progress stays the single source of
     truth and watch_sessions.total_seconds is always
     recomputed from it, never hand-added here. This card's
     own current_episode/total_episodes columns on
     watchlist_items are just a display cache for the progress
     bar, not the source of truth.

     Anime: episode numbering is flat (no seasons in Jikan), so
     the flat counter maps directly onto episode_progress with
     season_number = 1.

     TV: episode numbering is season-based. This card only
     stores a flat total_episodes count, so we resolve the
     flat "next episode" number into the actual
     (season_number, episode_number) pair via
     fetchTvSeasonBreakdown() + resolveFlatEpisode() — the same
     season data EpisodeTracker's season dropdown is built
     from — before writing anything.
  ============================================================ */

  const markNextEpisode = useCallback(
    async (item: ContinueWatchingItem) => {
      if (
        (item.category !== "Anime" &&
          item.category !== "TV") ||
        !item.totalEpisodes ||
        item.totalEpisodes <= 0 ||
        markingEpisodeId === item.contentId
      ) {
        return;
      }

      setMarkingEpisodeId(item.contentId);

      const nextEpisode = Math.min(
        item.currentEpisode + 1,
        item.totalEpisodes,
      );

      const isNowComplete = nextEpisode >= item.totalEpisodes;

      const perEpisodeSeconds =
        item.estimatedSeconds > 0
          ? Math.round(
              item.estimatedSeconds / item.totalEpisodes,
            )
          : 0;

      // Optimistic UI update — bump the episode count, and
      // drop the card entirely once it's complete.
      setContinueWatching((current) =>
        current
          .map((row) =>
            row.contentId === item.contentId
              ? {
                  ...row,
                  currentEpisode: nextEpisode,
                  status: isNowComplete
                    ? row.status
                    : ("watching" as ContinueWatchingStatus),
                }
              : row,
          )
          .filter(
            (row) =>
              !(
                row.contentId === item.contentId &&
                isNowComplete
              ),
          ),
      );

      try {
        if (item.category === "Anime") {
          await setEpisodeWatched(
            item.contentId,
            "Anime",
            1,
            {
              episodeNumber: nextEpisode,
              name: `Episode ${nextEpisode}`,
              runtimeSeconds: perEpisodeSeconds,
            },
            true,
          );
        } else {
          const rawId = extractRawId(
            item.contentId,
            "TV",
          );

          const breakdown = await fetchTvSeasonBreakdown(
            rawId,
          );

          const resolved = resolveFlatEpisode(
            breakdown,
            nextEpisode,
          );

          if (!resolved) {
            throw new Error(
              `Couldn't resolve episode ${nextEpisode} to a season for "${item.title}".`,
            );
          }

          await setEpisodeWatched(
            item.contentId,
            "TV",
            resolved.seasonNumber,
            {
              episodeNumber: resolved.episodeNumber,
              name: `Episode ${resolved.episodeNumber}`,
              runtimeSeconds: perEpisodeSeconds,
            },
            true,
          );
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new Error(
            "Please login before marking episodes.",
          );
        }

        /*
         * current_episode is no longer written here — setEpisodeWatched()
         * (called above) already recomputes it from episode_progress via
         * syncWatchlistProgress(), which is the real source of truth.
         * Writing it again here from `nextEpisode` could race with (and
         * overwrite) that recompute, or drift out of sync with it, so
         * this call only touches `status`.
         */
        const { error: watchlistError } = await supabase
          .from("watchlist_items")
          .update({
            status: isNowComplete ? "completed" : "watching",
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id)
          .eq("content_id", item.contentId);

        if (watchlistError) {
          throw watchlistError;
        }

        loadStats();
      } catch (error) {
        console.error("Failed to mark next episode:", error);

        alert(
          error instanceof Error
            ? error.message
            : "Failed to mark episode as watched.",
        );

        // Roll back the optimistic update by re-fetching.
        loadContinueWatching();
      } finally {
        setMarkingEpisodeId(null);
      }
    },
    [markingEpisodeId, loadStats, loadContinueWatching],
  );

  /*
   * Sum of total_seconds already logged in watch_sessions for
   * this piece of content (across every session row, e.g. one
   * per episode). Used by the "Mark Completed" menu action so
   * it only credits the *remaining* runtime instead of
   * double-counting time the user already tracked normally.
   */
  async function getTrackedSeconds(
    userId: string,
    contentId: string,
  ) {
    const { data, error } = await supabase
      .from("watch_sessions")
      .select("total_seconds")
      .eq("user_id", userId)
      .eq("content_id", contentId);

    if (error) {
      throw error;
    }

    return (data ?? []).reduce(
      (sum, row: any) => sum + Number(row.total_seconds ?? 0),
      0,
    );
  }

  /* ============================================================
     CARD 3-DOT MENU — Mark Completed / Put on Hold / Drop

     Updates watchlist_items.status. "completed", "dropped", and
     "on_hold" aren't in CONTINUE_WATCHING_STATUSES, so the
     optimistic update simply drops the card from this rail
     (it'll show up wherever the rest of the app lists
     completed/dropped/on-hold items).

     Total Watch Time (the big number at the top of the
     dashboard) is a straight sum over watch_sessions — it has
     no idea about watchlist_items.status. So just flipping the
     status to "completed" here, like the old code did, could
     never move that number. To fix that, when the new status
     is "completed" we also insert a watch_sessions row crediting
     whatever runtime hasn't already been logged for this title
     (item.estimatedSeconds minus what getTrackedSeconds finds),
     the same way finishing the last episode via "Mark Next
     Episode" naturally finishes crediting an anime/TV show.
  ============================================================ */

  const updateItemStatus = useCallback(
    async (
      item: ContinueWatchingItem,
      newStatus: CardMenuStatus,
    ) => {
      if (updatingItemId === item.contentId) {
        return;
      }

      setOpenMenuId(null);
      setUpdatingItemId(item.contentId);

      const staysInRail = CONTINUE_WATCHING_STATUSES.includes(
        newStatus as ContinueWatchingStatus,
      );

      // Optimistic update.
      setContinueWatching((current) =>
        staysInRail
          ? current.map((row) =>
              row.contentId === item.contentId
                ? {
                    ...row,
                    status: newStatus as ContinueWatchingStatus,
                  }
                : row,
            )
          : current.filter(
              (row) => row.contentId !== item.contentId,
            ),
      );

      if (
        !staysInRail &&
        selectedContentId === item.contentId
      ) {
        setSelectedContentId(null);
      }

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new Error(
            "Please login before updating this item.",
          );
        }

        const { error } = await supabase
          .from("watchlist_items")
          .update({
            status: newStatus,
            // Snap the episode counter to the end too, so the
            // watchlist row doesn't say "Ep 4 / 26" for
            // something marked completed straight from the menu.
            ...(newStatus === "completed" && item.totalEpisodes
              ? { current_episode: item.totalEpisodes }
              : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user.id)
          .eq("content_id", item.contentId);

        if (error) {
          throw error;
        }

        // Credit any not-yet-logged runtime so Total Watch
        // Time actually reflects the completion.
        if (newStatus === "completed" && item.estimatedSeconds > 0) {
          const trackedSeconds = await getTrackedSeconds(
            user.id,
            item.contentId,
          );

          const remainingSeconds =
            item.estimatedSeconds - trackedSeconds;

          if (remainingSeconds > 0) {
            const now = new Date().toISOString();

            const { error: sessionError } = await supabase
              .from("watch_sessions")
              .insert({
                user_id: user.id,
                content_id: item.contentId,
                category: item.category,
                started_at: now,
                last_heartbeat: now,
                total_seconds: remainingSeconds,
              });

            if (sessionError) {
              throw sessionError;
            }
          }
        }

        loadStats();
      } catch (error) {
        console.error("Failed to update status:", error);

        alert(
          error instanceof Error
            ? error.message
            : "Failed to update status.",
        );

        // Roll back the optimistic update by re-fetching.
        loadContinueWatching();
      } finally {
        setUpdatingItemId(null);
      }
    },
    [
      updatingItemId,
      selectedContentId,
      loadStats,
      loadContinueWatching,
    ],
  );

  /* ============================================================
     CARD 3-DOT MENU — Remove

     Deletes the row from watchlist_items outright, rather than
     just changing its status.

     This intentionally does NOT touch watch_sessions. Total
     Watch Time is meant to be a permanent record of time
     actually tracked (via WatchEngine / episode marking) — if
     someone genuinely watched 5 hours of a show, removing it
     from the watchlist rail shouldn't erase that history, the
     same way deleting a video from your "watch later" list on
     YouTube doesn't erase it from your watch history. So after
     a plain Remove, Total Watch Time is expected to stay the
     same UNLESS this item still had unlogged runtime credited
     to it via "Mark Completed" moments ago — in which case
     removing it now also removes that specific credit (see
     below), since that credit was never really watched either.
  ============================================================ */

  const removeItem = useCallback(
    async (item: ContinueWatchingItem) => {
      if (updatingItemId === item.contentId) {
        return;
      }

      const confirmed = window.confirm(
        `Remove "${item.title}" from your watchlist?`,
      );

      if (!confirmed) {
        return;
      }

      setOpenMenuId(null);
      setUpdatingItemId(item.contentId);

      // Optimistic update.
      setContinueWatching((current) =>
        current.filter((row) => row.contentId !== item.contentId),
      );

      if (selectedContentId === item.contentId) {
        setSelectedContentId(null);
      }

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new Error(
            "Please login before removing this item.",
          );
        }

        // Find any "instant credit" sessions for this title —
        // rows where started_at === last_heartbeat, meaning
        // they were logged all at once (by "Mark Completed" or
        // by finishing the last episode) rather than tracked
        // live minute-by-minute like WatchEngine does. Those
        // don't represent real watch time, so clean them up
        // along with the watchlist entry. Anything with a real
        // gap between started_at and last_heartbeat is left
        // alone — that's genuine tracked history.
        const { data: sessionRows, error: fetchSessionsError } =
          await supabase
            .from("watch_sessions")
            .select("id,started_at,last_heartbeat")
            .eq("user_id", user.id)
            .eq("content_id", item.contentId);

        if (fetchSessionsError) {
          throw fetchSessionsError;
        }

        const creditOnlySessionIds = (sessionRows ?? [])
          .filter(
            (row: any) => row.started_at === row.last_heartbeat,
          )
          .map((row: any) => row.id);

        if (creditOnlySessionIds.length > 0) {
          const { error: deleteSessionsError } = await supabase
            .from("watch_sessions")
            .delete()
            .in("id", creditOnlySessionIds);

          if (deleteSessionsError) {
            throw deleteSessionsError;
          }
        }

        const { error } = await supabase
          .from("watchlist_items")
          .delete()
          .eq("user_id", user.id)
          .eq("content_id", item.contentId);

        if (error) {
          throw error;
        }

        loadStats();
      } catch (error) {
        console.error("Failed to remove item:", error);

        alert(
          error instanceof Error
            ? error.message
            : "Failed to remove item.",
        );

        // Roll back the optimistic update by re-fetching.
        loadContinueWatching();
      } finally {
        setUpdatingItemId(null);
      }
    },
    [updatingItemId, selectedContentId, loadStats, loadContinueWatching],
  );

  /* ============================================================
     DASHBOARD REFRESH
  ============================================================ */

  useEffect(() => {
    loadStats();
    loadContinueWatching();
    loadQuran();

    const statsChannel = supabase
      .channel("dashboard-watch-stats")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "watch_sessions",
        },
        () => {
          loadStats();
        }
      )
      .subscribe();

    const watchlistChannel = supabase
      .channel("dashboard-watchlist-items")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "watchlist_items",
        },
        () => {
          loadContinueWatching();
        },
      )
      .subscribe();

    const interval = setInterval(() => {
      loadStats();
      loadContinueWatching();
    }, 10000);

    /*
     * PrivateWatchlist dispatches this event
     * after adding private runtime.
     */
    const handlePrivateChange = () => {
      loadStats();
    };

    /*
     * UniversalBrowser dispatches this the moment the user
     * changes an item's status (Add to Watchlist, Completed,
     * etc) — refresh immediately instead of waiting for the
     * realtime event or the 10s poll.
     */
    const handleStatusChange = () => {
      loadContinueWatching();
    };

    window.addEventListener(
      "private-watch-time-changed",
      handlePrivateChange
    );

    window.addEventListener(
      "universal-browser-status-changed",
      handleStatusChange,
    );

    return () => {
      clearInterval(interval);

      window.removeEventListener(
        "private-watch-time-changed",
        handlePrivateChange
      );

      window.removeEventListener(
        "universal-browser-status-changed",
        handleStatusChange,
      );

      supabase.removeChannel(statsChannel);
      supabase.removeChannel(watchlistChannel);
    };
  }, [loadStats, loadContinueWatching]);

  /*
   * Close the 3-dot menu on any outside click. Menu items and
   * the toggle button itself stopPropagation, so this only
   * fires for genuine "clicked elsewhere" events.
   */
  useEffect(() => {
    if (!openMenuId) {
      return;
    }

    const closeMenu = () => setOpenMenuId(null);

    window.addEventListener("click", closeMenu);

    return () => window.removeEventListener("click", closeMenu);
  }, [openMenuId]);

  /* ============================================================
     TOTAL TIME
  ============================================================ */

  /*
   * Headline total. Uses rawTotalSeconds (every row, any
   * category value) rather than summing the 6 known `stats`
   * buckets, so it always matches what the Leaderboard's
   * get_leaderboard() RPC computes for "Total" — that RPC sums
   * by whatever category string is actually stored, with no
   * allow-list. See rawTotalSeconds above for why this matters.
   */
  const totalSeconds = rawTotalSeconds;

  const maxCategorySeconds = Math.max(
    ...categories.map((category) => stats[category]),
    rewatchSeconds,
    1
  );

  /*
   * Live-looked-up details-modal item. Deliberately derived
   * from `continueWatching` on every render (not a snapshot)
   * so it always reflects the same state the card shows —
   * including right after markNextEpisode's optimistic update.
   */
  const selectedItem = useMemo(
    () =>
      continueWatching.find(
        (row) => row.contentId === selectedContentId,
      ) || null,
    [continueWatching, selectedContentId],
  );

  /* ============================================================
     UI
  ============================================================ */

  return (
    <section className="relative w-full max-w-5xl px-4 py-8">
      {/* HEADER */}

      <div className="mb-8">
        <p className="eyebrow mb-2">
          Search and manage your watch activity
        </p>

        <h2 className="text-3xl font-bold tracking-tight text-white">
          Watch Dashboard
        </h2>
      </div>

      {/* TOTAL WATCH TIME */}

      <div className="glass-panel mb-6 p-6 sm:p-8">
        <p className="eyebrow">Total Watch Time</p>

        <div className="gradient-text mt-2 text-5xl font-black tracking-tight">
          {loading ? "Loading..." : formatTime(totalSeconds)}
        </div>

        <p className="mt-2 text-sm text-white/40">
          Completed and rewatched runtimes are included.
        </p>
      </div>

      {/* CONTINUE WATCHING */}

      {(continueWatchingLoading || continueWatching.length > 0) && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xl font-bold">
              Continue Watching
            </h3>

            {!continueWatchingLoading && (
              <span className="text-sm text-white/40">
                {continueWatching.length} item
                {continueWatching.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {continueWatchingLoading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="glass-panel overflow-hidden"
                >
                  <div className="aspect-[2/3] animate-pulse bg-white/5" />
                  <div className="space-y-2 p-3">
                    <div className="h-4 animate-pulse rounded bg-white/5" />
                    <div className="h-3 w-2/3 animate-pulse rounded bg-white/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {continueWatching.map((item) => {
                const hasEpisodes =
                  item.totalEpisodes != null &&
                  item.totalEpisodes > 0;

                const episodeProgress = hasEpisodes
                  ? Math.round(
                      (item.currentEpisode /
                        (item.totalEpisodes as number)) *
                        100,
                    )
                  : 0;

                const isMarking =
                  markingEpisodeId === item.contentId;

                const isUpdating =
                  updatingItemId === item.contentId;

                const isMenuOpen =
                  openMenuId === item.contentId;

                const canQuickMark =
                  item.category === "Anime" ||
                  item.category === "TV";

                return (
                  <div
                    key={item.contentId}
                    onClick={() =>
                      setSelectedContentId(item.contentId)
                    }
                    className="glass-panel glass-panel-interactive group relative cursor-pointer overflow-visible"
                  >
                    <div className="relative aspect-[2/3] overflow-hidden rounded-t-[var(--radius-lg)] bg-black">
                      <img
                        src={item.imageUrl || getPlaceholderImage()}
                        alt={item.title}
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                        loading="lazy"
                      />

                      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent" />

                      <div className="absolute left-2 top-2 rounded-full border border-white/15 bg-black/50 px-2 py-1 text-[10px] font-semibold backdrop-blur-md">
                        {CONTINUE_WATCHING_ICONS[item.status]}{" "}
                        {CONTINUE_WATCHING_LABELS[item.status]}
                      </div>

                      {/* 3-DOT MENU TOGGLE */}
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenMenuId(
                            isMenuOpen ? null : item.contentId,
                          );
                        }}
                        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-sm text-white backdrop-blur-md transition hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isUpdating ? (
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        ) : (
                          "⋮"
                        )}
                      </button>

                      {/* 3-DOT MENU */}
                      {isMenuOpen && (
                        <div
                          onClick={(event) =>
                            event.stopPropagation()
                          }
                          className="absolute right-2 top-11 z-20 w-40 overflow-hidden rounded-xl border border-white/10 bg-[#151522]/95 p-1 shadow-2xl backdrop-blur-xl"
                        >
                          {CARD_MENU_ACTIONS.map((action) => (
                            <button
                              key={action.key}
                              type="button"
                              onClick={() =>
                                action.key === "remove"
                                  ? removeItem(item)
                                  : updateItemStatus(
                                      item,
                                      action.key,
                                    )
                              }
                              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition hover:bg-white/10 ${
                                action.key === "remove"
                                  ? "text-red-300 hover:text-red-200"
                                  : "text-white/70 hover:text-white"
                              }`}
                            >
                              <span>{action.icon}</span>
                              <span>{action.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="p-3">
                      <p className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-5 text-white">
                        {item.title}
                      </p>

                      <p className="mt-1 text-xs text-white/40">
                        {item.category}
                        {item.estimatedSeconds > 0
                          ? ` · ${formatTime(item.estimatedSeconds)}`
                          : ""}
                      </p>

                      {hasEpisodes && (
                        <>
                          <p className="mt-1 text-xs text-white/40">
                            Ep {item.currentEpisode} /{" "}
                            {item.totalEpisodes}
                          </p>

                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                            <div
                              className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent)_0%,var(--accent-2)_100%)] transition-all duration-500"
                              style={{
                                width: `${episodeProgress}%`,
                              }}
                            />
                          </div>

                          {canQuickMark && (
                            <button
                              type="button"
                              disabled={isMarking}
                              onClick={(event) => {
                                event.stopPropagation();
                                markNextEpisode(item);
                              }}
                              className="mt-2 h-8 w-full rounded-[var(--radius-sm)] bg-white text-xs font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isMarking
                                ? "Marking..."
                                : "▶ Mark Next Episode"}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* CATEGORY CARDS */}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => {
          /* "Social" slot now shows Total Re Watch Time instead */

          if (category === "Social") {
            const percentage =
              totalSeconds > 0
                ? Math.round((rewatchSeconds / totalSeconds) * 100)
                : 0;

            const barWidth = Math.round(
              (rewatchSeconds / maxCategorySeconds) * 100
            );

            return (
              <div
                key="rewatch-time"
                className="glass-panel p-5"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white">Total Re Watch Time</h3>

                  <span className="text-sm text-white/40">
                    {percentage}%
                  </span>
                </div>

                <div className="mt-4 text-2xl font-bold text-white">
                  {loading ? "..." : formatTime(rewatchSeconds)}
                </div>

                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent)_0%,var(--accent-2)_100%)] transition-all duration-500"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          }

          const seconds = stats[category];

          const percentage =
            totalSeconds > 0
              ? Math.round((seconds / totalSeconds) * 100)
              : 0;

          const barWidth = Math.round(
            (seconds / maxCategorySeconds) * 100
          );

          return (
            <div
              key={category}
              className="glass-panel p-5"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-white">{category}</h3>

                <span className="text-sm text-white/40">
                  {percentage}%
                </span>
              </div>

              <div className="mt-4 text-2xl font-bold text-white">
                {loading ? "..." : formatTime(seconds)}
              </div>

              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent)_0%,var(--accent-2)_100%)] transition-all duration-500"
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* QURAN READING (today, quran_reading_log) */}

      <div className="glass-panel mt-4 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">
            🕌 Quran Reading Today
          </h3>

          {quranGoalMinutes ? (
            <span className="text-sm text-white/40">
              Goal: {quranGoalMinutes}m
            </span>
          ) : null}
        </div>

        <div className="mt-4 text-2xl font-bold text-white">
          {quranLoading ? "..." : formatQuranTime(quranSeconds)}
        </div>

        {quranGoalMinutes ? (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent)_0%,var(--accent-2)_100%)] transition-all duration-500"
              style={{
                width: `${Math.min(
                  100,
                  Math.round(
                    (quranSeconds / (quranGoalMinutes * 60)) * 100,
                  ),
                )}%`,
              }}
            />
          </div>
        ) : (
          <p className="mt-3 text-xs text-white/40">
            Set a goal on the Islamic Track page to see progress
            here.
          </p>
        )}
      </div>

      {/* WATCH TIME CHART (weekly breakdown) */}

      <WatchTimeChart />

      {/* LIVE STATUS */}

      <div className="glass-panel mt-6 border-[var(--accent-2-soft)] p-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent-2)] opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent-2)]" />
          </span>

          <span className="text-sm font-medium text-[var(--accent-2)]">Dashboard Live</span>
        </div>

        <p className="mt-1 text-xs text-white/40">
          Watch time automatically refreshes from Supabase.
        </p>
      </div>

      {/* DETAILS MODAL */}
      {selectedItem && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
          onClick={() => setSelectedContentId(null)}
        >
          <div
            className="glass-panel max-h-[90vh] w-full max-w-3xl overflow-y-auto !rounded-[var(--radius-lg)] bg-[#0d0d16]/95"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="grid md:grid-cols-[220px_1fr]">
              {/* MODAL IMAGE */}
              <div className="relative aspect-[2/3] md:aspect-auto">
                <img
                  src={selectedItem.imageUrl || getPlaceholderImage()}
                  alt={selectedItem.title}
                  className="h-full w-full object-cover"
                />
              </div>

              {/* MODAL CONTENT */}
              <div className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold">
                      {selectedItem.title}
                    </h2>

                    <p className="mt-1 text-sm text-white/40">
                      {selectedItem.category}
                      {selectedItem.estimatedSeconds > 0
                        ? ` · ${formatTime(
                            selectedItem.estimatedSeconds,
                          )}`
                        : ""}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedContentId(null)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:bg-white/10"
                  >
                    ✕
                  </button>
                </div>

                {/* META */}
                <div className="mt-5 flex flex-wrap gap-2">
                  <span className="rounded-full bg-white/5 px-3 py-1 text-sm text-white/60">
                    {CONTINUE_WATCHING_ICONS[selectedItem.status]}{" "}
                    {CONTINUE_WATCHING_LABELS[selectedItem.status]}
                  </span>

                  {selectedItem.totalEpisodes ? (
                    <span className="rounded-full bg-purple-500/10 px-3 py-1 text-sm text-purple-300">
                      Ep {selectedItem.currentEpisode} /{" "}
                      {selectedItem.totalEpisodes}
                    </span>
                  ) : null}
                </div>

                {/* PROGRESS — same source as the card, so it
                    always matches what "Mark Next Episode"
                    just updated */}
                {selectedItem.totalEpisodes ? (
                  <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <p className="text-xs uppercase tracking-wider text-white/30">
                      Progress
                    </p>

                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent)_0%,var(--accent-2)_100%)] transition-all duration-500"
                        style={{
                          width: `${Math.round(
                            (selectedItem.currentEpisode /
                              (selectedItem.totalEpisodes as number)) *
                              100,
                          )}%`,
                        }}
                      />
                    </div>

                    <p className="mt-3 text-sm text-white/60">
                      {selectedItem.currentEpisode} of{" "}
                      {selectedItem.totalEpisodes} episodes watched
                    </p>
                  </div>
                ) : null}

                {/* ACTIONS */}
                <div className="mt-6 grid gap-2">
                  {(selectedItem.category === "Anime" ||
                    selectedItem.category === "TV") &&
                  selectedItem.totalEpisodes ? (
                    <button
                      type="button"
                      disabled={
                        markingEpisodeId === selectedItem.contentId
                      }
                      onClick={() => markNextEpisode(selectedItem)}
                      className="h-11 rounded-xl bg-white font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {markingEpisodeId === selectedItem.contentId
                        ? "Marking..."
                        : "▶ Mark Next Episode"}
                    </button>
                  ) : null}

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      disabled={
                        updatingItemId === selectedItem.contentId
                      }
                      onClick={() =>
                        updateItemStatus(selectedItem, "completed")
                      }
                      className="h-10 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ✔ Completed
                    </button>

                    <button
                      type="button"
                      disabled={
                        updatingItemId === selectedItem.contentId
                      }
                      onClick={() =>
                        updateItemStatus(selectedItem, "on_hold")
                      }
                      className="h-10 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ⏸ Hold
                    </button>

                    <button
                      type="button"
                      disabled={
                        updatingItemId === selectedItem.contentId
                      }
                      onClick={() =>
                        updateItemStatus(selectedItem, "dropped")
                      }
                      className="h-10 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ✕ Drop
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={
                      updatingItemId === selectedItem.contentId
                    }
                    onClick={() => removeItem(selectedItem)}
                    className="h-10 rounded-xl border border-red-500/20 bg-red-500/10 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    🗑 Remove from Watchlist
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedContentId(null)}
                    className="h-11 rounded-xl border border-white/10 bg-white/5 font-semibold text-white transition hover:bg-white/10"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}