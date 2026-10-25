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
} from "../lib/episodeProgress";
import { fetchTodayQuranLog } from "../lib/quranTrack";
import WatchTimeChart from "./WatchTimeChart";

type Category =
  | "YouTube"
  | "Anime"
  | "TV"
  | "Movies"
  | "Social"
  | "Private";

type Stats = Record<Category, number>;

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

const YEAR_SECONDS = 365 * 86400;
const MONTH_SECONDS = 30 * 86400;

function formatTime(totalSeconds: number) {
  let seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));

  const years = Math.floor(seconds / YEAR_SECONDS);
  seconds %= YEAR_SECONDS;

  const months = Math.floor(seconds / MONTH_SECONDS);
  seconds %= MONTH_SECONDS;

  const days = Math.floor(seconds / 86400);
  seconds %= 86400;

  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;

  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  const secs = seconds;

  const units = [
    { value: years, label: "y" },
    { value: months, label: "mo" },
    { value: days, label: "d" },
    { value: hours, label: "h" },
    { value: minutes, label: "m" },
    { value: secs, label: "s" },
  ];

  let startIndex = units.findIndex((unit) => unit.value > 0);

  if (startIndex === -1) {
    startIndex = units.length - 1;
  }

  return units
    .slice(startIndex)
    .map((unit) => `${unit.value}${unit.label}`)
    .join(" ");
}

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

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [loading, setLoading] = useState(true);
  const [rewatchSeconds, setRewatchSeconds] = useState(0);
  const [rawTotalSeconds, setRawTotalSeconds] = useState(0);

  const [continueWatching, setContinueWatching] = useState<
    ContinueWatchingItem[]
  >([]);
  const [continueWatchingLoading, setContinueWatchingLoading] = useState(true);
  const [markingEpisodeId, setMarkingEpisodeId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);

  const [quranSeconds, setQuranSeconds] = useState(0);
  const [quranGoalMinutes, setQuranGoalMinutes] = useState<number | null>(null);
  const [quranLoading, setQuranLoading] = useState(true);

  const loadQuran = useCallback(async () => {
    setQuranLoading(true);
    const log = await fetchTodayQuranLog();
    setQuranSeconds(log?.totalSeconds ?? 0);
    setQuranGoalMinutes(log?.goalMinutes ?? null);
    setQuranLoading(false);
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.rpc("get_dashboard_stats");

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

      if (requestId !== continueWatchingRequestId.current) {
        return;
      }

      if (error) {
        console.error("Failed to load continue watching:", error);
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
          estimatedSeconds: Number(row.estimated_seconds ?? 0),
          updatedAt: row.updated_at,
          currentEpisode: Number(row.current_episode ?? 0),
          totalEpisodes:
            row.total_episodes != null ? Number(row.total_episodes) : null,
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

  const markNextEpisode = useCallback(
    async (item: ContinueWatchingItem) => {
      if (
        (item.category !== "Anime" && item.category !== "TV") ||
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
          ? Math.round(item.estimatedSeconds / item.totalEpisodes)
          : 0;

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
              !(row.contentId === item.contentId && isNowComplete),
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
          await setEpisodeWatched(
            item.contentId,
            "TV",
            1,
            {
              episodeNumber: nextEpisode,
              name: `Episode ${nextEpisode}`,
              runtimeSeconds: perEpisodeSeconds,
            },
            true,
          );
        }

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new Error("Please login before marking episodes.");
        }

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
        loadContinueWatching();
      } finally {
        setMarkingEpisodeId(null);
      }
    },
    [markingEpisodeId, loadStats, loadContinueWatching],
  );

  async function getTrackedSeconds(userId: string, contentId: string) {
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

  const updateItemStatus = useCallback(
    async (item: ContinueWatchingItem, newStatus: CardMenuStatus) => {
      if (updatingItemId === item.contentId) {
        return;
      }

      setOpenMenuId(null);
      setUpdatingItemId(item.contentId);

      const staysInRail = CONTINUE_WATCHING_STATUSES.includes(
        newStatus as ContinueWatchingStatus,
      );

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
          : current.filter((row) => row.contentId !== item.contentId),
      );

      if (!staysInRail && selectedContentId === item.contentId) {
        setSelectedContentId(null);
      }

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new Error("Please login before updating this item.");
        }

        const { error } = await supabase
          .from("watchlist_items")
          .update({
            status: newStatus,
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

        if (newStatus === "completed" && item.estimatedSeconds > 0) {
          const trackedSeconds = await getTrackedSeconds(
            user.id,
            item.contentId,
          );

          const remainingSeconds = item.estimatedSeconds - trackedSeconds;

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
        loadContinueWatching();
      } finally {
        setUpdatingItemId(null);
      }
    },
    [updatingItemId, selectedContentId, loadStats, loadContinueWatching],
  );

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
          throw new Error("Please login before removing this item.");
        }

        const { data: sessionRows, error: fetchSessionsError } = await supabase
          .from("watch_sessions")
          .select("id,started_at,last_heartbeat")
          .eq("user_id", user.id)
          .eq("content_id", item.contentId);

        if (fetchSessionsError) {
          throw fetchSessionsError;
        }

        const creditOnlySessionIds = (sessionRows ?? [])
          .filter((row: any) => row.started_at === row.last_heartbeat)
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
          error instanceof Error ? error.message : "Failed to remove item.",
        );
        loadContinueWatching();
      } finally {
        setUpdatingItemId(null);
      }
    },
    [updatingItemId, selectedContentId, loadStats, loadContinueWatching],
  );

  useEffect(() => {
    loadStats();
    loadContinueWatching();
    loadQuran();

    const statsChannel = supabase
      .channel("dashboard-watch-stats")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "watch_sessions" },
        () => loadStats(),
      )
      .subscribe();

    const watchlistChannel = supabase
      .channel("dashboard-watchlist-items")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "watchlist_items" },
        () => loadContinueWatching(),
      )
      .subscribe();

    const interval = setInterval(() => {
      loadStats();
      loadContinueWatching();
    }, 5 * 60 * 1000);

    const handlePrivateChange = () => loadStats();
    const handleStatusChange = () => loadContinueWatching();

    window.addEventListener("private-watch-time-changed", handlePrivateChange);
    window.addEventListener(
      "universal-browser-status-changed",
      handleStatusChange,
    );

    return () => {
      clearInterval(interval);
      window.removeEventListener(
        "private-watch-time-changed",
        handlePrivateChange,
      );
      window.removeEventListener(
        "universal-browser-status-changed",
        handleStatusChange,
      );
      supabase.removeChannel(statsChannel);
      supabase.removeChannel(watchlistChannel);
    };
  }, [loadStats, loadContinueWatching]);

  useEffect(() => {
    if (!openMenuId) return;
    const closeMenu = () => setOpenMenuId(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [openMenuId]);

  const totalSeconds = rawTotalSeconds;
  const maxCategorySeconds = Math.max(
    ...categories.map((category) => stats[category]),
    rewatchSeconds,
    1,
  );

  const selectedItem = useMemo(
    () =>
      continueWatching.find((row) => row.contentId === selectedContentId) ||
      null,
    [continueWatching, selectedContentId],
  );

  return (
    <section className="relative w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* PREMIUM HERO HEADER */}
      <div className="relative mb-8 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] p-6 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[var(--accent)]/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-[var(--accent-2)]/10 blur-3xl" />

        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent-2)] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent-2)]" />
              </span>
              Your watch space
            </div>
            <p className="eyebrow mb-2">Search, track & continue</p>
            <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
              Watch Dashboard
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">
              Pick up where you left off, track episode progress, and see your
              watch activity at a glance.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:min-w-[230px]">
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
                Continue
              </p>
              <p className="mt-1 text-xl font-bold text-white">
                {continueWatchingLoading ? "—" : continueWatching.length}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
                Rewatch
              </p>
              <p className="mt-1 text-xl font-bold text-white">
                {loading ? "—" : formatTime(rewatchSeconds)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* TOTAL WATCH TIME */}
      <div className="group relative mb-6 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] p-6 shadow-xl shadow-black/20 backdrop-blur-xl transition duration-300 hover:border-white/15 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-[var(--accent)]/10 blur-3xl transition duration-500 group-hover:scale-125" />

        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-lg">
                ⏱
              </span>
              <div>
                <p className="eyebrow">Total Watch Time</p>
                <p className="text-xs text-white/30">All tracked sessions</p>
              </div>
            </div>

            <div className="gradient-text mt-4 text-5xl font-black tracking-tight sm:text-6xl">
              {loading ? "Loading..." : formatTime(totalSeconds)}
            </div>

            <p className="mt-2 text-sm text-white/40">
              Completed and rewatched runtimes are included.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 sm:min-w-[190px]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">
              Activity
            </p>
            <p className="mt-2 text-sm font-semibold text-white/75">
              Live synced with Supabase
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full w-full rounded-full bg-[linear-gradient(90deg,var(--accent)_0%,var(--accent-2)_100%)] opacity-80" />
            </div>
          </div>
        </div>
      </div>

      {/* CONTINUE WATCHING */}
      {(continueWatchingLoading || continueWatching.length > 0) && (
        <div className="mb-8 rounded-3xl border border-white/10 bg-white/[0.025] p-4 sm:p-5">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow mb-1">Pick up where you stopped</p>
              <h3 className="text-2xl font-black tracking-tight text-white">
                Continue Watching
              </h3>
            </div>

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
                <div key={index} className="glass-panel overflow-hidden">
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
                  item.totalEpisodes != null && item.totalEpisodes > 0;

                const episodeProgress = hasEpisodes
                  ? Math.round(
                      (item.currentEpisode / (item.totalEpisodes as number)) *
                        100,
                    )
                  : 0;

                const isMarking = markingEpisodeId === item.contentId;
                const isUpdating = updatingItemId === item.contentId;
                const isMenuOpen = openMenuId === item.contentId;

                const canQuickMark =
                  item.category === "Anime" || item.category === "TV";

                return (
                  <div
                    key={item.contentId}
                    onClick={() => setSelectedContentId(item.contentId)}
                    className="glass-panel glass-panel-interactive group relative cursor-pointer overflow-visible rounded-2xl border border-white/10 shadow-lg shadow-black/20 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:shadow-2xl hover:shadow-black/30"
                  >
                    <div className="relative aspect-[2/3] overflow-hidden rounded-t-2xl bg-black">
                      <img
                        src={item.imageUrl || getPlaceholderImage()}
                        alt={item.title}
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                        loading="lazy"
                      />

                      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent" />

                      <div className="absolute left-2 top-2 rounded-full border border-white/15 bg-black/55 px-2.5 py-1.5 text-[10px] font-semibold shadow-lg backdrop-blur-xl">
                        {CONTINUE_WATCHING_ICONS[item.status]}{" "}
                        {CONTINUE_WATCHING_LABELS[item.status]}
                      </div>

                      {/* 3-DOT MENU TOGGLE */}
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenMenuId(isMenuOpen ? null : item.contentId);
                        }}
                        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/55 text-sm text-white backdrop-blur-xl transition hover:bg-black/80 hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-50"
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
                          onClick={(event) => event.stopPropagation()}
                          className="absolute right-2 top-11 z-20 w-40 overflow-hidden rounded-xl border border-white/10 bg-[#151522]/95 p-1 shadow-2xl backdrop-blur-xl"
                        >
                          {CARD_MENU_ACTIONS.map((action) => (
                            <button
                              key={action.key}
                              type="button"
                              onClick={() =>
                                action.key === "remove"
                                  ? removeItem(item)
                                  : updateItemStatus(item, action.key)
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
                            Ep {item.currentEpisode} / {item.totalEpisodes}
                          </p>

                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
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
                              className="mt-3 h-9 w-full rounded-xl bg-white text-xs font-bold text-black shadow-lg shadow-black/20 transition hover:-translate-y-0.5 hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isMarking ? "Marking..." : "▶ Mark Next Episode"}
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
          if (category === "Social") {
            const percentage =
              totalSeconds > 0
                ? Math.round((rewatchSeconds / totalSeconds) * 100)
                : 0;

            const barWidth = Math.round(
              (rewatchSeconds / maxCategorySeconds) * 100,
            );

            return (
              <div
                key="rewatch-time"
                className="glass-panel group rounded-2xl border border-white/10 p-5 shadow-lg shadow-black/10 transition duration-300 hover:-translate-y-0.5 hover:border-white/15"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white">Total Re Watch Time</h3>
                  <span className="text-sm text-white/40">{percentage}%</span>
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
            totalSeconds > 0 ? Math.round((seconds / totalSeconds) * 100) : 0;
          const barWidth = Math.round((seconds / maxCategorySeconds) * 100);

          return (
            <div
              key={category}
              className="glass-panel group rounded-2xl border border-white/10 p-5 shadow-lg shadow-black/10 transition duration-300 hover:-translate-y-0.5 hover:border-white/15"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-white">{category}</h3>
                <span className="text-sm text-white/40">{percentage}%</span>
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

      {/* QURAN READING */}
      <div className="glass-panel mt-5 rounded-2xl border border-white/10 p-5 shadow-lg shadow-black/10">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">🕌 Quran Reading Today</h3>
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
                  Math.round((quranSeconds / (quranGoalMinutes * 60)) * 100),
                )}%`,
              }}
            />
          </div>
        ) : (
          <p className="mt-3 text-xs text-white/40">
            Set a goal on the Islamic Track page to see progress here.
          </p>
        )}
      </div>

      {/* WATCH TIME CHART (weekly breakdown) */}
      <div className="mt-6 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025] p-1 shadow-xl shadow-black/10">
        <WatchTimeChart />
      </div>

      {/* LIVE STATUS */}
      <div className="glass-panel mt-6 rounded-2xl border-[var(--accent-2-soft)] bg-[var(--accent-2)]/[0.03] p-5 shadow-lg shadow-black/10">
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
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-xl"
          onClick={() => setSelectedContentId(null)}
        >
          <div
            className="glass-panel max-h-[90vh] w-full max-w-3xl overflow-y-auto !rounded-3xl border border-white/10 bg-[#0d0d16]/95 shadow-2xl shadow-black/50"
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
                        ? ` · ${formatTime(selectedItem.estimatedSeconds)}`
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

                {/* PROGRESS */}
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
                      disabled={markingEpisodeId === selectedItem.contentId}
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
                      disabled={updatingItemId === selectedItem.contentId}
                      onClick={() => updateItemStatus(selectedItem, "completed")}
                      className="h-10 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ✔ Completed
                    </button>

                    <button
                      type="button"
                      disabled={updatingItemId === selectedItem.contentId}
                      onClick={() => updateItemStatus(selectedItem, "on_hold")}
                      className="h-10 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ⏸ Hold
                    </button>

                    <button
                      type="button"
                      disabled={updatingItemId === selectedItem.contentId}
                      onClick={() => updateItemStatus(selectedItem, "dropped")}
                      className="h-10 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ✕ Drop
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={updatingItemId === selectedItem.contentId}
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