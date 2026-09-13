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
    )}&season=${seasonNumber}`,
    {
      cache: "no-store",
    },
  );

  if (!res.ok) {
    throw new Error(
      `Failed to load season ${seasonNumber}.`,
    );
  }

  const data = await res.json();

  const fallbackSeconds =
    typeof fallbackRuntimeMinutes === "number" &&
    fallbackRuntimeMinutes > 0
      ? Math.round(
          fallbackRuntimeMinutes * 60,
        )
      : 0;

  return (data?.episodes || []).map(
    (ep: any) => ({
      episodeNumber:
        ep.episodeNumber,

      name:
        ep.name ||
        `Episode ${ep.episodeNumber}`,

      runtimeSeconds:
        typeof ep.runtime === "number" &&
        ep.runtime > 0
          ? Math.round(
              ep.runtime * 60,
            )
          : fallbackSeconds,

      airDate:
        ep.airDate ?? null,
    }),
  );
}

/* ============================================================
   ANIME — episodes via our /api/anime proxy
============================================================ */

export async function fetchAnimeEpisodes(
  malId: string | number,
  averageRuntimeSeconds: number,
): Promise<EpisodeInfo[]> {
  const all: EpisodeInfo[] = [];

  let page = 1;
  let hasNextPage = true;

  /*
   * Jikan returns up to 100 episodes per page.
   *
   * IMPORTANT:
   * Browser no longer calls Jikan directly.
   * Browser -> /api/anime -> Jikan
   */

  while (hasNextPage) {
    const res = await fetch(
      `/api/anime?malId=${encodeURIComponent(
        String(malId),
      )}&episodes=true&page=${page}`,
      {
        method: "GET",
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
      /*
       * Give the actual server error back to the UI.
       */

      throw new Error(
        data?.message ||
          data?.error ||
          "Failed to load episode list.",
      );
    }

    const items = Array.isArray(
      data?.data,
    )
      ? data.data
      : [];

    for (const ep of items) {
      if (
        typeof ep?.episodeNumber !==
          "number" ||
        ep.episodeNumber <= 0
      ) {
        continue;
      }

      all.push({
        episodeNumber:
          ep.episodeNumber,

        name:
          ep.name ||
          `Episode ${ep.episodeNumber}`,

        runtimeSeconds:
          typeof ep.runtimeSeconds ===
            "number" &&
          ep.runtimeSeconds > 0
            ? ep.runtimeSeconds
            : averageRuntimeSeconds,

        airDate:
          ep.airDate ?? null,
      });
    }

    hasNextPage = Boolean(
      data?.pagination
        ?.has_next_page ??
        data?.hasNextPage,
    );

    page += 1;

    /*
     * Small delay between pages.
     *
     * This protects Jikan from a burst of requests
     * for long-running anime such as One Piece.
     */

    if (hasNextPage) {
      await new Promise(
        (resolve) =>
          setTimeout(resolve, 400),
      );
    }

    /*
     * Safety guard.
     *
     * Prevent an unexpected pagination response
     * from causing an infinite loop.
     */

    if (page > 100) {
      console.warn(
        "Anime episode pagination exceeded safety limit.",
      );

      break;
    }
  }

  return all.sort(
    (a, b) =>
      a.episodeNumber -
      b.episodeNumber,
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
    return new Set();
  }

  const {
    data,
    error,
  } = await supabase
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

    return new Set();
  }

  return new Set(
    (data ?? []).map(
      (row) => row.episode_number,
    ),
  );
}

export async function setEpisodeWatched(
  contentId: string,
  category: TrackedCategory,
  seasonNumber: number,
  episode: EpisodeInfo,
  watched: boolean,
  options?: {
    sync?: boolean;
  },
) {
  const shouldSync =
    options?.sync ?? true;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error(
      "Please login first.",
    );
  }

  if (watched) {
    const { error } =
      await supabase
        .from("episode_progress")
        .upsert(
          {
            user_id: user.id,
            content_id: contentId,
            category,
            season_number:
              seasonNumber,
            episode_number:
              episode.episodeNumber,
            runtime_seconds:
              episode.runtimeSeconds,
            watched: true,
            updated_at:
              new Date().toISOString(),
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
    const { error } =
      await supabase
        .from("episode_progress")
        .delete()
        .eq(
          "user_id",
          user.id,
        )
        .eq(
          "content_id",
          contentId,
        )
        .eq(
          "season_number",
          seasonNumber,
        )
        .eq(
          "episode_number",
          episode.episodeNumber,
        );

    if (error) {
      throw error;
    }
  }

  if (!shouldSync) {
    return;
  }

  await syncTotalWatchTimeFromEpisodes(
    contentId,
    category,
    episode.name,
  );

  await syncWatchlistProgress(
    contentId,
  );
}

/* ============================================================
   WATCHLIST PROGRESS SYNC
============================================================ */

export async function syncWatchlistProgress(
  contentId: string,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return;
  }

  const {
    data,
    error,
  } = await supabase
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

  const {
    error: updateError,
  } = await supabase
    .from("watchlist_items")
    .update({
      current_episode:
        watchedCount,

      updated_at:
        new Date().toISOString(),
    })
    .eq(
      "user_id",
      user.id,
    )
    .eq(
      "content_id",
      contentId,
    );

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
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return;
  }

  const {
    data,
    error,
  } = await supabase
    .from("episode_progress")
    .select("runtime_seconds")
    .eq(
      "user_id",
      user.id,
    )
    .eq(
      "content_id",
      contentId,
    )
    .eq(
      "watched",
      true,
    );

  if (error) {
    console.error(
      "Failed to recompute watch time:",
      error,
    );

    return;
  }

  const totalSeconds =
    (data ?? []).reduce(
      (sum, row) =>
        sum +
        Number(
          row.runtime_seconds || 0,
        ),
      0,
    );

  const {
    data: existing,
  } = await supabase
    .from("watch_sessions")
    .select("id")
    .eq(
      "user_id",
      user.id,
    )
    .eq(
      "content_id",
      contentId,
    )
    .order(
      "created_at",
      {
        ascending: false,
      },
    )
    .limit(1);

  const row =
    existing?.[0];

  if (row) {
    await supabase
      .from("watch_sessions")
      .update({
        total_seconds:
          totalSeconds,

        category,

        is_active: false,

        last_heartbeat:
          new Date().toISOString(),

        ...(title
          ? { title }
          : {}),
      })
      .eq(
        "id",
        row.id,
      )
      .eq(
        "user_id",
        user.id,
      );

    return;
  }

  if (totalSeconds > 0) {
    const now =
      new Date().toISOString();

    await supabase
      .from("watch_sessions")
      .insert({
        user_id: user.id,

        content_id:
          contentId,

        category,

        started_at: now,

        last_heartbeat:
          now,

        is_active: false,

        total_seconds:
          totalSeconds,

        ...(title
          ? { title }
          : {}),
      });
  }
}

/* ============================================================
   TV FLAT -> SEASON / EPISODE
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

  if (!res.ok) {
    throw new Error(
      "Failed to load season breakdown.",
    );
  }

  const data =
    await res.json();

  return (data?.seasons || [])
    .filter(
      (s: any) =>
        typeof s.seasonNumber ===
          "number" &&
        s.seasonNumber > 0 &&
        typeof s.episodeCount ===
          "number" &&
        s.episodeCount > 0,
    )
    .sort(
      (
        a: any,
        b: any,
      ) =>
        a.seasonNumber -
        b.seasonNumber,
    )
    .map(
      (s: any) => ({
        seasonNumber:
          s.seasonNumber,

        episodeCount:
          s.episodeCount,
      }),
    );
}

export function resolveFlatEpisode(
  breakdown: {
    seasonNumber: number;
    episodeCount: number;
  }[],
  flatEpisodeNumber: number,
):
  | {
      seasonNumber: number;
      episodeNumber: number;
    }
  | null {
  let remaining =
    flatEpisodeNumber;

  for (const season of breakdown) {
    if (
      remaining <=
      season.episodeCount
    ) {
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
  const {
    data,
    error,
  } = await supabase
    .from("content_arcs")
    .select(
      "id,content_id,category,season_number,name,start_episode,end_episode",
    )
    .eq(
      "content_id",
      contentId,
    )
    .eq(
      "season_number",
      seasonNumber,
    )
    .order(
      "start_episode",
      {
        ascending: true,
      },
    );

  if (error) {
    console.error(
      "Failed to load arcs:",
      error,
    );

    return [];
  }

  return (data ?? []).map(
    (row) => ({
      id: row.id,
      contentId:
        row.content_id,
      category:
        row.category,
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

  const {
    data,
    error,
  } = await supabase
    .from("content_arcs")
    .insert({
      content_id: contentId,
      category,
      season_number:
        seasonNumber,
      name,
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

export function groupEpisodesByArc(
  episodes: EpisodeInfo[],
  arcs: Arc[],
): {
  arc: Arc | null;
  episodes: EpisodeInfo[];
}[] {
  if (arcs.length === 0) {
    return [
      {
        arc: null,
        episodes,
      },
    ];
  }

  const sortedArcs =
    [...arcs].sort(
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
    const before =
      episodes
        .slice(currentIndex)
        .filter(
          (ep) =>
            ep.episodeNumber <
            arc.startEpisode,
        );

    if (before.length > 0) {
      groups.push({
        arc: null,
        episodes: before,
      });
    }

    const inArc =
      episodes.filter(
        (ep) =>
          ep.episodeNumber >=
            arc.startEpisode &&
          ep.episodeNumber <=
            arc.endEpisode,
      );

    groups.push({
      arc,
      episodes: inArc,
    });

    const lastCovered =
      episodes.findIndex(
        (ep) =>
          ep.episodeNumber >
          arc.endEpisode,
      );

    currentIndex =
      lastCovered === -1
        ? episodes.length
        : lastCovered;
  }

  const remaining =
    episodes.slice(
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