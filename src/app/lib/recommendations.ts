import { supabase } from "./supabase";
import {
  ACTIVE_MEDIA_CATEGORIES,
  isActiveMediaCategory,
  type ActiveMediaCategory,
} from "./categories";

export type Recommendation = {
  id: string;
  fromUserId: string;
  fromDisplayName: string;
  fromEmail: string;
  contentType: ActiveMediaCategory;
  contentId: string;
  contentTitle: string;
  posterPath: string | null;
  message: string | null;
  isRead: boolean;
  isWatched: boolean;
  createdAt: string;
};

type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
};

type RecommendationRow = {
  id: string;
  from_user_id: string;
  content_type: string;
  content_id: string;
  content_title: string;
  poster_path: string | null;
  message: string | null;
  is_read: boolean;
  is_watched: boolean;
  created_at: string;
};

async function fetchProfilesByIds(
  ids: string[],
): Promise<Record<string, { email: string; displayName: string }>> {
  if (ids.length === 0) {
    return {};
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,display_name")
    .in("id", ids);

  if (error) {
    throw error;
  }

  const map: Record<string, { email: string; displayName: string }> = {};

  (data || []).forEach((row: ProfileRow) => {
    map[row.id] = {
      email: row.email || "",
      displayName: row.display_name || row.email || "Unknown",
    };
  });

  return map;
}

/*
 * Sends a recommendation from the current user to a friend.
 * contentId should match the same convention used elsewhere
 * in the app (e.g. `movies-1234`, `tv-5678`).
 */
export async function sendRecommendation(params: {
  toUserId: string;
  contentType: ActiveMediaCategory;
  contentId: string;
  contentTitle: string;
  posterPath?: string | null;
  message?: string;
}): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Please login first.");
  }

  if (!isActiveMediaCategory(params.contentType)) {
    throw new Error("Only TV, Movies, and YouTube can be recommended.");
  }

  if (user.id === params.toUserId) {
    throw new Error("You can't recommend to yourself.");
  }

  const { error } = await supabase.from("recommendations").insert({
    from_user_id: user.id,
    to_user_id: params.toUserId,
    content_type: params.contentType,
    content_id: params.contentId,
    content_title: params.contentTitle,
    poster_path: params.posterPath ?? null,
    message: params.message && params.message.trim() ? params.message.trim() : null,
  });

  if (error) {
    throw error;
  }
}

/*
 * Recommendations sent TO the current user (for the
 * "Recommended" sidebar page).
 */
export async function listRecommendationsForMe(): Promise<Recommendation[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from("recommendations")
    .select(
      "id,from_user_id,content_type,content_id,content_title,poster_path,message,is_read,is_watched,created_at",
    )
    .eq("to_user_id", user.id)
    .in("content_type", [...ACTIVE_MEDIA_CATEGORIES])
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const rows = (data || []) as RecommendationRow[];
  const activeRows = rows.filter((row) =>
    isActiveMediaCategory(row.content_type),
  );

  const profilesMap = await fetchProfilesByIds(
    activeRows.map((row) => row.from_user_id),
  );

  return activeRows.map((row) => {
    const profile = profilesMap[row.from_user_id];

    return {
      id: row.id,
      fromUserId: row.from_user_id,
      fromDisplayName: profile ? profile.displayName : "Unknown",
      fromEmail: profile ? profile.email : "",
      contentType: row.content_type as ActiveMediaCategory,
      contentId: row.content_id,
      contentTitle: row.content_title,
      posterPath: row.poster_path,
      message: row.message,
      isRead: row.is_read,
      isWatched: row.is_watched,
      createdAt: row.created_at,
    };
  });
}

export async function markRecommendationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from("recommendations")
    .update({ is_read: true })
    .eq("id", id);

  if (error) {
    throw error;
  }
}

export async function markRecommendationWatched(id: string): Promise<void> {
  const { error } = await supabase
    .from("recommendations")
    .update({ is_watched: true, is_read: true })
    .eq("id", id);

  if (error) {
    throw error;
  }
}

export async function deleteRecommendation(id: string): Promise<void> {
  const { error } = await supabase
    .from("recommendations")
    .delete()
    .eq("id", id);

  if (error) {
    throw error;
  }
}

/*
 * Unread count for the sidebar badge.
 */
export async function countUnreadRecommendations(): Promise<number> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return 0;
  }

  const { count, error } = await supabase
    .from("recommendations")
    .select("id", { count: "exact", head: true })
    .eq("to_user_id", user.id)
    .in("content_type", [...ACTIVE_MEDIA_CATEGORIES])
    .eq("is_read", false);

  if (error) {
    throw error;
  }

  return count || 0;
}

/*
 * Best-effort runtime lookup for a recommended Movie/TV title,
 * via the same /api/tmdb/*-details routes UniversalBrowser
 * uses (fetchAccurateRuntimeSeconds). YouTube has no
 * equivalent lookup here, so it falls back to 0 seconds —
 * the item still shows up on the Dashboard, just without an
 * estimated runtime until edited from Browse.
 */
async function fetchRecommendationRuntimeSeconds(
  contentType: ActiveMediaCategory,
  rawId: string,
): Promise<number> {
  try {
    if (contentType === "Movies") {
      const res = await fetch(
        `/api/tmdb/movie-details?id=${encodeURIComponent(rawId)}`,
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
    }

    if (contentType === "TV") {
      const res = await fetch(
        `/api/tmdb/tv-details?id=${encodeURIComponent(rawId)}`,
        { cache: "no-store" },
      );

      if (!res.ok) {
        return 0;
      }

      const data = await res.json();

      const perEpisodeMinutes = Number(
        data?.episodeRuntime,
      );
      const episodeCount = Number(data?.numberOfEpisodes);

      if (
        Number.isFinite(perEpisodeMinutes) &&
        perEpisodeMinutes > 0 &&
        Number.isFinite(episodeCount) &&
        episodeCount > 0
      ) {
        return Math.round(
          perEpisodeMinutes * episodeCount * 60,
        );
      }

      return 0;
    }
  } catch (err) {
    console.error(
      "Failed to fetch recommendation runtime:",
      err,
    );
  }

  return 0;
}

/*
 * Adds a recommendation onto the Dashboard as a "completed"
 * watchlist item — same table (watchlist_items) and status
 * vocabulary ("completed", lowercase) that UniversalBrowser's
 * saveItemStatus() and Dashboard's markNextEpisode() use, so
 * it shows up consistently everywhere the Dashboard reads
 * watchlist_items from.
 *
 * contentId already follows the `${type}-${rawId}` convention
 * (see sendRecommendation's doc comment), so this reuses it
 * as-is rather than re-deriving it.
 */
export async function addRecommendationToWatchlist(
  recommendation: Pick<
    Recommendation,
    "contentType" | "contentId" | "contentTitle" | "posterPath"
  >,
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Please login first.");
  }

  const prefix = `${recommendation.contentType.toLowerCase()}-`;

  const rawId = recommendation.contentId.startsWith(prefix)
    ? recommendation.contentId.slice(prefix.length)
    : recommendation.contentId;

  const estimatedSeconds =
    await fetchRecommendationRuntimeSeconds(
      recommendation.contentType,
      rawId,
    );

  const { error } = await supabase
    .from("watchlist_items")
    .upsert(
      {
        user_id: user.id,
        content_id: recommendation.contentId,
        category: recommendation.contentType,
        title: recommendation.contentTitle,
        image_url: recommendation.posterPath ?? null,
        status: "completed",
        estimated_seconds: estimatedSeconds,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,content_id" },
    );

  if (error) {
    throw error;
  }
}