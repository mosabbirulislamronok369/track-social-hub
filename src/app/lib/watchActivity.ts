import { supabase } from "./supabase";

export type WatchActivityType =
  | "episode"
  | "started"
  | "completed"
  | "movie"
  | "watchlist"
  | "rewatch";

export type WatchActivity = {
  id: number;
  actor_id: string;
  actor_name: string;
  actor_avatar_url: string | null;
  event_type: WatchActivityType;
  content_id: string;
  category: string;
  title: string;
  episode_number: number | null;
  created_at: string;
};

export async function recordWatchActivity(input: {
  eventType: WatchActivityType;
  contentId: string;
  category: string;
  title: string;
  episodeNumber?: number;
  sourceKey: string;
}) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    console.warn("Watch activity was not published because no authenticated user was found.", authError);
    return;
  }

  const { error } = await supabase.from("watch_activities").insert({
    actor_id: user.id,
    event_type: input.eventType,
    content_id: input.contentId,
    category: input.category,
    title: input.title,
    episode_number: input.episodeNumber ?? null,
    source_key: input.sourceKey,
  });

  if (error) {
    // The underlying watch action has already succeeded. Do not make it appear
    // to have failed just because the optional social activity could not post.
    console.error("Failed to publish watch activity:", error);
  }
}
