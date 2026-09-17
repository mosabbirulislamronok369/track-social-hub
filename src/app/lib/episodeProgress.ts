import { supabase } from "./supabase";

export type TrackedCategory = "TV" | "Anime";

export type EpisodeInfo = {
  episodeNumber: number;
  name: string;
  runtimeSeconds: number;
  airDate?: string | null;
};

export type Arc = {
  id: string;
  contentId: string;
  category: TrackedCategory;
  seasonNumber: number;
  name: string;
  startEpisode: number;
  endEpisode: number;
};

/* ============================================================
   TV — episodes for one season
============================================================ */

export async function fetchTvSeasonEpisodes(
  tmdbId: string | number,
  seasonNumber: number,
  fallbackRuntimeMinutes: number | null,
): Promise<EpisodeInfo[]> {
  const res = await fetch(
    `/api/tmdb/tv-season?id=${encodeURIComponent(
      String(tmdbId),
    )}&season=${encodeURIComponent(String(seasonNumber))}`,
    {
      cache: "no-store",
    },
  );

  let data: any = null;

  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        `Failed to load season ${seasonNumber}.`,
    );
  }

  const fallbackSeconds =
    typeof fallbackRuntimeMinutes === "number" &&
    Number.isFinite(fallbackRuntimeMinutes) &&
    fallbackRuntimeMinutes > 0
      ? Math.round(fallbackRuntimeMinutes * 60)
      : 0;

  const episodes = Array.isArray(data?.episodes)
    ? data.episodes
    : [];

  return episodes
    .map((ep: any) => ({
      episodeNumber: Number(ep?.episodeNumber),
      name:
        typeof ep?.name === "string" && ep.name.trim()
          ? ep.name
          : `Episode ${ep?.episodeNumber ?? ""}`,
      runtimeSeconds:
        typeof ep?.runtime === "number" &&
        Number.isFinite(ep.runtime) &&
        ep.runtime > 0
          ? Math.round(ep.runtime * 60)
          : fallbackSeconds,
      airDate: ep?.airDate ?? null,
    }))
    .filter(
      (ep: EpisodeInfo) =>
        Number.isFinite(ep.episodeNumber) &&
        ep.episodeNumber > 0,
    );
}

/* ============================================================
   ANIME — episodes through our server-side Jikan proxy

   Browser
      ↓
   /api/anime/episodes
      ↓
   Jikan
      ↓
   MyAnimeList

   IMPORTANT:
   Never call api.jikan.moe directly from the browser.
============================================================ */

export async function fetchAnimeEpisodes(
  malId: string | number,
  averageRuntimeSeconds: number,
): Promise<EpisodeInfo[]> {
  if (
    malId === null ||
    malId === undefined ||
    String(malId).trim() === ""
  ) {
    throw new Error("Anime MAL ID is missing.");
  }

  const params = new URLSearchParams();

  params.set("malId", String(malId));

  if (
    Number.isFinite(averageRuntimeSeconds) &&
    averageRuntimeSeconds > 0
  ) {
    params.set(
      "runtimeSeconds",
      String(Math.round(averageRuntimeSeconds)),
    );
  }

  const res = await fetch(
    `/api/anime/episodes?${params.toString()}`,
    {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    },
  );

  let data: any = null;

  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message =
      data?.message ||
      data?.error ||
      `Failed to load anime episodes (HTTP ${res.status}).`;

    throw new Error(message);
  }

  const episodes = Array.isArray(data?.episodes)
    ? data.episodes
    : Array.isArray(data?.data)
      ? data.data
      : [];

  return episodes
    .map((ep: any) => {
      const episodeNumber = Number(ep?.episodeNumber);

      const runtimeSeconds =
        typeof ep?.runtimeSeconds === "number" &&
        Number.isFinite(ep.runtimeSeconds) &&
        ep.runtimeSeconds >= 0
          ? ep.runtimeSeconds
          : averageRuntimeSeconds;

      return {
        episodeNumber,
        name:
          typeof ep?.name === "string" &&
          ep.name.trim()
            ? ep.name
            : `Episode ${episodeNumber}`,
        runtimeSeconds,
        airDate: ep?.airDate ?? null,
      };
    })
    .filter(
      (ep: EpisodeInfo) =>
        Number.isFinite(ep.episodeNumber) &&
        ep.episodeNumber > 0,
    )
    .sort(
      (a: { episodeNumber: number; }, b: { episodeNumber: number; }) =>
        a.episodeNumber - b.episodeNumber,
    );
}

/* ============================================================
   EPISODE PROGRESS
============================================================ */

export async function fetchWatchedEpisodes(
  contentId: string,
  seasonNumber: number,
): Promise<Set<number>> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Set<number>();
  }

  const { data, error } = await supabase
    .from("episode_progress")
    .select("episode_number")
    .eq("user_id", user.id)
    .eq("content_id", contentId)
    .eq("season_number", seasonNumber)
    .eq("watched", true);

  if (error) {
    console.error(
      "Failed to load episode progress:",
      error,
    );

    return new Set<number>();
  }

  return new Set<number>(
    (data ?? [])
      .map((row: any) => Number(row.episode_number))
      .filter(
        (episodeNumber: number) =>
          Number.isFinite(episodeNumber) &&
          episodeNumber > 0,
      ),
  );
}

/* ============================================================
   SET EPISODE WATCHED
============================================================ */

export async function setEpisodeWatched(
  contentId: string,
  category: TrackedCategory,
  seasonNumber: number,
  episode: EpisodeInfo,
  watched: boolean,
  options?: {
    sync?: boolean;
  },
): Promise<void> {
  const shouldSync = options?.sync ?? true;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Please login first.");
  }

  if (
    !Number.isFinite(episode.episodeNumber) ||
    episode.episodeNumber <= 0
  ) {
    throw new Error("Invalid episode number.");
  }

  if (watched) {
    const { error } = await supabase
      .from("episode_progress")
      .upsert(
        {
          user_id: user.id,
          content_id: contentId,
          category,
          season_number: seasonNumber,
          episode_number: episode.episodeNumber,
          runtime_seconds:
            Number.isFinite(episode.runtimeSeconds) &&
            episode.runtimeSeconds >= 0
              ? episode.runtimeSeconds
              : 0,
          watched: true,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict:
            "user_id,content_id,season_number,episode_number",
        },
      );

    if (error) {
      throw error;
    }
  } else {
    const { error } = await supabase
      .from("episode_progress")
      .delete()
      .eq("user_id", user.id)
      .eq("content_id", contentId)
      .eq("season_number", seasonNumber)
      .eq(
        "episode_number",
        episode.episodeNumber,
      );

    if (error) {
      throw error;
    }
  }

  /*
   * Bulk operations can pass { sync: false }.
   * The caller then performs one final sync.
   */
  if (!shouldSync) {
    return;
  }

  await syncTotalWatchTimeFromEpisodes(
    contentId,
    category,
    episode.name,
  );

  await syncWatchlistProgress(contentId);
}

/* ============================================================
   WATCHLIST PROGRESS SYNC
============================================================ */

export async function syncWatchlistProgress(
  contentId: string,
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return;
  }

  const { data, error } = await supabase
    .from("episode_progress")
    .select("episode_number")
    .eq("user_id", user.id)
    .eq("content_id", contentId)
    .eq("watched", true);

  if (error) {
    console.error(
      "Failed to recompute watchlist progress:",
      error,
    );

    return;
  }

  const watchedCount =
    (data ?? []).length;

  const { error: updateError } =
    await supabase
      .from("watchlist_items")
      .update({
        current_episode: watchedCount,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .eq("content_id", contentId);

  if (updateError) {
    console.error(
      "Failed to sync watchlist current_episode:",
      updateError,
    );
  }
}

/* ============================================================
   TOTAL WATCH TIME SYNC
============================================================ */

export async function syncTotalWatchTimeFromEpisodes(
  contentId: string,
  category: TrackedCategory,
  title?: string,
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return;
  }

  const { data, error } = await supabase
    .from("episode_progress")
    .select("runtime_seconds")
    .eq("user_id", user.id)
    .eq("content_id", contentId)
    .eq("watched", true);

  if (error) {
    console.error(
      "Failed to recompute watch time:",
      error,
    );

    return;
  }

  const totalSeconds =
    (data ?? []).reduce(
      (sum: number, row: any) =>
        sum +
        Number(row?.runtime_seconds || 0),
      0,
    );

  const { data: existing, error: existingError } =
    await supabase
      .from("watch_sessions")
      .select("id")
      .eq("user_id", user.id)
      .eq("content_id", contentId)
      .order("created_at", {
        ascending: false,
      })
      .limit(1);

  if (existingError) {
    console.error(
      "Failed to find watch session:",
      existingError,
    );
  }

  const row = existing?.[0];

  if (row) {
    const { error: updateError } =
      await supabase
        .from("watch_sessions")
        .update({
          total_seconds: totalSeconds,
          category,
          is_active: false,
          last_heartbeat:
            new Date().toISOString(),
          ...(title ? { title } : {}),
        })
        .eq("id", row.id)
        .eq("user_id", user.id);

    if (updateError) {
      console.error(
        "Failed to update watch session:",
        updateError,
      );
    }

    return;
  }

  if (totalSeconds > 0) {
    const now =
      new Date().toISOString();

    const { error: insertError } =
      await supabase
        .from("watch_sessions")
        .insert({
          user_id: user.id,
          content_id: contentId,
          category,
          started_at: now,
          last_heartbeat: now,
          is_active: false,
          total_seconds: totalSeconds,
          ...(title ? { title } : {}),
        });

    if (insertError) {
      console.error(
        "Failed to create watch session:",
        insertError,
      );
    }
  }
}

/* ============================================================
   TV FLAT EPISODE -> SEASON / EPISODE
============================================================ */

export async function fetchTvSeasonBreakdown(
  tmdbId: string | number,
): Promise<
  {
    seasonNumber: number;
    episodeCount: number;
  }[]
> {
  const res = await fetch(
    `/api/tmdb/tv-details?id=${encodeURIComponent(
      String(tmdbId),
    )}`,
    {
      cache: "no-store",
    },
  );

  let data: any = null;

  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        "Failed to load season breakdown.",
    );
  }

  return (Array.isArray(data?.seasons)
    ? data.seasons
    : []
  )
    .filter(
      (season: any) =>
        typeof season?.seasonNumber ===
          "number" &&
        Number.isFinite(
          season.seasonNumber,
        ) &&
        season.seasonNumber > 0 &&
        typeof season?.episodeCount ===
          "number" &&
        Number.isFinite(
          season.episodeCount,
        ) &&
        season.episodeCount > 0,
    )
    .sort(
      (a: any, b: any) =>
        a.seasonNumber -
        b.seasonNumber,
    )
    .map((season: any) => ({
      seasonNumber:
        season.seasonNumber,
      episodeCount:
        season.episodeCount,
    }));
}

export function resolveFlatEpisode(
  breakdown: {
    seasonNumber: number;
    episodeCount: number;
  }[],
  flatEpisodeNumber: number,
): {
  seasonNumber: number;
  episodeNumber: number;
} | null {
  if (
    !Number.isFinite(flatEpisodeNumber) ||
    flatEpisodeNumber <= 0
  ) {
    return null;
  }

  let remaining =
    Math.floor(flatEpisodeNumber);

  for (const season of breakdown) {
    if (remaining <= season.episodeCount) {
      return {
        seasonNumber:
          season.seasonNumber,
        episodeNumber:
          remaining,
      };
    }

    remaining -=
      season.episodeCount;
  }

  return null;
}

/* ============================================================
   ARCS
============================================================ */

export async function fetchArcs(
  contentId: string,
  seasonNumber: number,
): Promise<Arc[]> {
  const { data, error } =
    await supabase
      .from("content_arcs")
      .select(
        "id,content_id,category,season_number,name,start_episode,end_episode",
      )
      .eq("content_id", contentId)
      .eq(
        "season_number",
        seasonNumber,
      )
      .order("start_episode", {
        ascending: true,
      });

  if (error) {
    console.error(
      "Failed to load arcs:",
      error,
    );

    return [];
  }

  return (data ?? []).map(
    (row: any) => ({
      id: row.id,
      contentId: row.content_id,
      category: row.category,
      seasonNumber:
        row.season_number,
      name: row.name,
      startEpisode:
        row.start_episode,
      endEpisode:
        row.end_episode,
    }),
  );
}

export async function createArc(
  contentId: string,
  category: TrackedCategory,
  seasonNumber: number,
  name: string,
  startEpisode: number,
  endEpisode: number,
): Promise<Arc> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (
    !Number.isFinite(startEpisode) ||
    !Number.isFinite(endEpisode) ||
    startEpisode <= 0 ||
    endEpisode < startEpisode
  ) {
    throw new Error(
      "Invalid episode range.",
    );
  }

  const { data, error } =
    await supabase
      .from("content_arcs")
      .insert({
        content_id: contentId,
        category,
        season_number:
          seasonNumber,
        name: name.trim(),
        start_episode:
          startEpisode,
        end_episode:
          endEpisode,
        created_by:
          user?.id ?? null,
      })
      .select(
        "id,content_id,category,season_number,name,start_episode,end_episode",
      )
      .single();

  if (error) {
    throw error;
  }

  return {
    id: data.id,
    contentId:
      data.content_id,
    category:
      data.category,
    seasonNumber:
      data.season_number,
    name: data.name,
    startEpisode:
      data.start_episode,
    endEpisode:
      data.end_episode,
  };
}

/* ============================================================
   GROUP EPISODES BY ARC
============================================================ */

export function groupEpisodesByArc(
  episodes: EpisodeInfo[],
  arcs: Arc[],
): {
  arc: Arc | null;
  episodes: EpisodeInfo[];
}[] {
  if (episodes.length === 0) {
    return [];
  }

  if (arcs.length === 0) {
    return [
      {
        arc: null,
        episodes,
      },
    ];
  }

  const sortedEpisodes =
    [...episodes].sort(
      (a, b) =>
        a.episodeNumber -
        b.episodeNumber,
    );

  const sortedArcs =
    [...arcs]
      .filter(
        (arc) =>
          Number.isFinite(
            arc.startEpisode,
          ) &&
          Number.isFinite(
            arc.endEpisode,
          ) &&
          arc.endEpisode >=
            arc.startEpisode,
      )
      .sort(
        (a, b) =>
          a.startEpisode -
          b.startEpisode,
      );

  const groups: {
    arc: Arc | null;
    episodes: EpisodeInfo[];
  }[] = [];

  let currentIndex = 0;

  for (const arc of sortedArcs) {
    if (
      arc.startEpisode >
      arc.endEpisode
    ) {
      continue;
    }

    const before =
      sortedEpisodes
        .slice(currentIndex)
        .filter(
          (episode) =>
            episode.episodeNumber <
            arc.startEpisode,
        );

    if (before.length > 0) {
      groups.push({
        arc: null,
        episodes: before,
      });
    }

    const inArc =
      sortedEpisodes.filter(
        (episode) =>
          episode.episodeNumber >=
            arc.startEpisode &&
          episode.episodeNumber <=
            arc.endEpisode,
      );

    if (inArc.length > 0) {
      groups.push({
        arc,
        episodes: inArc,
      });
    }

    const lastCovered =
      sortedEpisodes.findIndex(
        (episode) =>
          episode.episodeNumber >
          arc.endEpisode,
      );

    currentIndex =
      lastCovered === -1
        ? sortedEpisodes.length
        : lastCovered;
  }

  const remaining =
    sortedEpisodes.slice(
      currentIndex,
    );

  if (remaining.length > 0) {
    groups.push({
      arc: null,
      episodes: remaining,
    });
  }

  return groups;
}