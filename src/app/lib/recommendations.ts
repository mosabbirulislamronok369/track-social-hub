import { supabase } from "./supabase";

export type Recommendation = {
  id: string;
  fromUserId: string;
  fromDisplayName: string;
  fromEmail: string;
  contentType: string;
  contentId: string;
  contentTitle: string;
  posterPath: string | null;
  message: string | null;
  isRead: boolean;
  isWatched: boolean;
  createdAt: string;
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

  (data || []).forEach((row: any) => {
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
 * in the app (e.g. `movies-1234`, `tv-5678`, `anime-999`).
 */
export async function sendRecommendation(params: {
  toUserId: string;
  contentType: string;
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
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const rows = data || [];

  const profilesMap = await fetchProfilesByIds(
    rows.map((row: any) => row.from_user_id),
  );

  return rows.map((row: any) => {
    const profile = profilesMap[row.from_user_id];

    return {
      id: row.id,
      fromUserId: row.from_user_id,
      fromDisplayName: profile ? profile.displayName : "Unknown",
      fromEmail: profile ? profile.email : "",
      contentType: row.content_type,
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
    .eq("is_read", false);

  if (error) {
    throw error;
  }

  return count || 0;
}