import { supabase } from "./supabase";

/* ============================================================
   TYPES
============================================================ */

export type TrackedCategory = "Anime" | "TV";

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
  createdAt: string;
};

export type EpisodeGroup = {
  arc: Arc | null;
  episodes: EpisodeInfo[];
};

/* ============================================================
   TMDB SEASON EPISODES (shared by TV and Anime)
============================================================ */

/**
 * Fetches the episode list for a TMDB TV show's season.
 * Both TV and Anime (modeled as TV on TMDB) use this.
 *
 * The backend route `/api/tmdb/tv-season-episodes` wraps
 * TMDB's `/tv/{id}/season/{n}` endpoint and returns:
 *   { episodes: [{ episodeNumber, name, runtimeSeconds, airDate }] }
 */
export async function fetchTvSeasonEpisodes(
  tmdbId: string | number,
  seasonNumber: number,
  fallbackRuntimeMinutes: number | null,
): Promise<EpisodeInfo[]> {
  const fallbackSeconds =
    typeof fallbackRuntimeMinutes === "number" &&
    fallbackRuntimeMinutes > 0
      ? Math.round(fallbackRuntimeMinutes * 60)
      : 0;

  const res = await fetch(
    `/api/tmdb/tv-season-episodes?id=${encodeURIComponent(
      String(tmdbId),
    )}&season=${encodeURIComponent(
      String(seasonNumber),
    )}&fallbackRuntime=${encodeURIComponent(
      String(fallbackSeconds),
    )}`,
    { cache: "no-store" },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to load season episodes (${res.status})${
        text ? `: ${text}` : ""
      }`,
    );
  }

  const data = await res.json();
  const raw = Array.isArray(data?.episodes) ? data.episodes : [];

  return raw
    .filter(
      (ep: any) =>
        typeof ep?.episodeNumber === "number" &&
        ep.episodeNumber > 0,
    )
    .map((ep: any) => ({
      episodeNumber: ep.episodeNumber,
      name:
        typeof ep?.name === "string" && ep.name.trim()
          ? ep.name
          : `Episode ${ep.episodeNumber}`,
      runtimeSeconds:
        typeof ep?.runtimeSeconds === "number" &&
        ep.runtimeSeconds > 0
          ? ep.runtimeSeconds
          : fallbackSeconds,
      airDate:
        typeof ep?.airDate === "string"
          ? ep.airDate
          : null,
    }));
}

/* ============================================================
   ANIME EPISODES (TMDB-backed; kept for backward compatibility)
============================================================ */

/**
 * Anime is now served from TMDB (modeled as a TV show), so
 * this delegates to fetchTvSeasonEpisodes with season 1.
 *
 * Kept as a separate export so existing Anime code paths
 * continue to work without change — the underlying data
 * source is the same TMDB season endpoint.
 */
export async function fetchAnimeEpisodes(
  tmdbId: string | number,
  fallbackRuntimeSeconds: number,
): Promise<EpisodeInfo[]> {
  const fallbackMinutes =
    fallbackRuntimeSeconds > 0
      ? fallbackRuntimeSeconds / 60
      : null;

  return fetchTvSeasonEpisodes(
    tmdbId,
    1,
    fallbackMinutes,
  );
}

/* ============================================================
   WATCHED EPISODES
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

  const { data, error } = await supabase
    .from("episode_progress")
    .select("episode_number")
    .eq("user_id", user.id)
    .eq("content_id", contentId)
    .eq("season_number", seasonNumber)
    .eq("watched", true);

  if (error) {
    console.error("Failed to load watched episodes:", error);
    return new Set();
  }

  return new Set(
    (data ?? [])
      .map((row: any) => Number(row.episode_number))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
}

/* ============================================================
   SET EPISODE WATCHED / UNWATCHED
============================================================ */

export async function setEpisodeWatched(
  contentId: string,
  category: TrackedCategory,
  seasonNumber: number,
  episode: EpisodeInfo,
  watched: boolean,
  options?: { sync?: boolean },
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Please login before marking episodes.");
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
          episode_name: episode.name,
          runtime_seconds: episode.runtimeSeconds,
          watched: true,
          watched_at: new Date().toISOString(),
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
      .eq("episode_number", episode.episodeNumber);

    if (error) {
      throw error;
    }
  }

  // Skip derived recomputes when caller is doing a bulk batch
  // and will call syncTotalWatchTimeFromEpisodes /
  // syncWatchlistProgress once at the end.
  if (options?.sync !== false) {
    await syncTotalWatchTimeFromEpisodes(contentId, category);
    await syncWatchlistProgress(contentId);
  }
}

/* ============================================================
   TOTAL WATCH TIME RECOMPUTE
============================================================ */

export async function syncTotalWatchTimeFromEpisodes(
  contentId: string,
  category: TrackedCategory,
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
      "Failed to recompute total watch time:",
      error,
    );
    return;
  }

  const totalSeconds = (data ?? []).reduce(
    (sum, row: any) =>
      sum + Number(row.runtime_seconds ?? 0),
    0,
  );

  const now = new Date().toISOString();

  const { data: existingSessions, error: findError } =
    await supabase
      .from("watch_sessions")
      .select("id")
      .eq("user_id", user.id)
      .eq("content_id", contentId)
      .order("created_at", { ascending: false })
      .limit(1);

  if (findError) {
    console.error(
      "Failed to find watch session:",
      findError,
    );
    return;
  }

  const existing = existingSessions?.[0];

  if (existing) {
    const { error: updateError } = await supabase
      .from("watch_sessions")
      .update({
        total_seconds: totalSeconds,
        is_active: false,
        category,
        last_heartbeat: now,
      })
      .eq("id", existing.id)
      .eq("user_id", user.id);

    if (updateError) {
      console.error(
        "Failed to update watch session:",
        updateError,
      );
    }

    return;
  }

  if (totalSeconds <= 0) {
    return;
  }

  const { error: insertError } = await supabase
    .from("watch_sessions")
    .insert({
      user_id: user.id,
      content_id: contentId,
      started_at: now,
      last_heartbeat: now,
      is_active: false,
      total_seconds: totalSeconds,
      category,
    });

  if (insertError) {
    console.error(
      "Failed to insert watch session:",
      insertError,
    );
  }
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
    .select("season_number,episode_number")
    .eq("user_id", user.id)
    .eq("content_id", contentId)
    .eq("watched", true)
    .order("season_number", { ascending: true })
    .order("episode_number", { ascending: true });

  if (error) {
    console.error(
      "Failed to load episode progress for watchlist sync:",
      error,
    );
    return;
  }

  if (!data || data.length === 0) {
    const { error: resetError } = await supabase
      .from("watchlist_items")
      .update({
        current_episode: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .eq("content_id", contentId);

    if (resetError) {
      console.error(
        "Failed to reset watchlist progress:",
        resetError,
      );
    }

    return;
  }

  // Flat episode number = (completed seasons' episode count)
  // + current season's episode number. We don't know prior
  // season sizes here, so this uses a simple "highest episode
  // number in any season" heuristic — good enough for the
  // Continue Watching card, which only needs an approximate
  // "Ep X / Y" display.
  const maxEpisodeNumber = data.reduce(
    (max, row: any) =>
      Math.max(max, Number(row.episode_number ?? 0)),
    0,
  );

  const { error: updateError } = await supabase
    .from("watchlist_items")
    .update({
      current_episode: maxEpisodeNumber,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("content_id", contentId);

  if (updateError) {
    console.error(
      "Failed to sync watchlist progress:",
      updateError,
    );
  }
}

/* ============================================================
   ARCS
============================================================ */

export async function fetchArcs(
  contentId: string,
  seasonNumber: number,
): Promise<Arc[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from("episode_arcs")
    .select("*")
    .eq("user_id", user.id)
    .eq("content_id", contentId)
    .eq("season_number", seasonNumber)
    .order("start_episode", { ascending: true });

  if (error) {
    console.error("Failed to load arcs:", error);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    contentId: row.content_id,
    category: row.category as TrackedCategory,
    seasonNumber: Number(row.season_number),
    name: row.name,
    startEpisode: Number(row.start_episode),
    endEpisode: Number(row.end_episode),
    createdAt: row.created_at,
  }));
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

  if (!user) {
    throw new Error("Please login before creating an arc.");
  }

  const { data, error } = await supabase
    .from("episode_arcs")
    .insert({
      user_id: user.id,
      content_id: contentId,
      category,
      season_number: seasonNumber,
      name,
      start_episode: startEpisode,
      end_episode: endEpisode,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return {
    id: data.id,
    contentId: data.content_id,
    category: data.category as TrackedCategory,
    seasonNumber: Number(data.season_number),
    name: data.name,
    startEpisode: Number(data.start_episode),
    endEpisode: Number(data.end_episode),
    createdAt: data.created_at,
  };
}

/* ============================================================
   GROUP EPISODES BY ARC
============================================================ */

export function groupEpisodesByArc(
  episodes: EpisodeInfo[],
  arcs: Arc[],
): EpisodeGroup[] {
  if (arcs.length === 0) {
    return [{ arc: null, episodes }];
  }

  const groups: EpisodeGroup[] = [];
  const assignedEpisodeNumbers = new Set<number>();

  // Sort arcs by startEpisode to ensure correct order
  const sortedArcs = [...arcs].sort((a, b) => a.startEpisode - b.startEpisode);

  for (const arc of sortedArcs) {
    const arcEpisodes = episodes.filter(
      (ep) =>
        ep.episodeNumber >= arc.startEpisode &&
        ep.episodeNumber <= arc.endEpisode,
    );

    if (arcEpisodes.length > 0) {
      groups.push({ arc, episodes: arcEpisodes });
      arcEpisodes.forEach((ep) => assignedEpisodeNumbers.add(ep.episodeNumber));
    }
  }

  const unassignedEpisodes = episodes.filter(
    (ep) => !assignedEpisodeNumbers.has(ep.episodeNumber),
  );

  if (unassignedEpisodes.length > 0) {
    groups.push({ arc: null, episodes: unassignedEpisodes });
  }

  return groups;
}