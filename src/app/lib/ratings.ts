import { supabase } from "./supabase";

/* ============================================================
   RATING LEVELS (1-10)
============================================================ */

export type RatingLevel = {
  value: number;
  bn: string;
  en: string;
};

export const RATING_LEVELS: RatingLevel[] = [
  { value: 1, bn: "গু হইছে", en: "Total Crap" },
  { value: 2, bn: "ছি এসব কি", en: "Eye Poison" },
  { value: 3, bn: "দেখার দরকার নাই", en: "Skip Please" },
  { value: 4, bn: "মোটামুটি চলবে", en: "Okay Timepass" },
  { value: 5, bn: "ঠিক আছে ভাই", en: "Decent Watch" },
  { value: 6, bn: "ভালোই লাগে", en: "Pretty Good" },
  { value: 7, bn: "মামা এতো ভালো", en: "Damn Fire" },
  { value: 8, bn: "দারুণ একটা জিনিস", en: "Super Solid" },
  { value: 9, bn: "", en: "Must Watch" },
  { value: 10, bn: "", en: "Absolute Cinema" },
];

export function getRatingLabel(
  value: number,
): RatingLevel | null {
  return (
    RATING_LEVELS.find(
      (level) => level.value === value,
    ) || null
  );
}

export function formatRatingLabel(
  value: number,
): string {
  const level = getRatingLabel(value);

  if (!level) {
    return `${value}/10`;
  }

  return level.bn
    ? `${level.bn} / ${level.en}`
    : level.en;
}

/* ============================================================
   SUPABASE HELPERS
============================================================ */

export type RatingRow = {
  content_id: string;
  category: string;
  title: string;
  image: string | null;
  rating: number;
};

export type RatingEntry = RatingRow & {
  updated_at: string;
};

/*
 * Loads a simple map of contentId -> rating for the
 * current user. Used by UniversalBrowser/AnimeBrowser
 * to show existing ratings on cards.
 */
export async function fetchAllRatings(): Promise<
  Record<string, number>
> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {};
  }

  const { data, error } = await supabase
    .from("ratings")
    .select("content_id,rating")
    .eq("user_id", user.id);

  if (error) {
    console.error(
      "Failed to load ratings:",
      error,
    );

    return {};
  }

  const map: Record<string, number> = {};

  for (const row of data ?? []) {
    map[row.content_id] = row.rating;
  }

  return map;
}

/*
 * Loads full rating rows (for the Rating Board page),
 * sorted best -> worst.
 */
export async function fetchAllRatingRows(): Promise<
  RatingEntry[]
> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from("ratings")
    .select(
      "content_id,category,title,image,rating,updated_at",
    )
    .eq("user_id", user.id)
    .order("rating", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) {
    console.error(
      "Failed to load rating rows:",
      error,
    );

    return [];
  }

  return data ?? [];
}

/*
 * Loads only the top-rated rows (best -> worst), capped at
 * `limit`. This is what the Rating Board shows by default so
 * it never has to pull the whole `ratings` table just to
 * render the page.
 */
export async function fetchTopRatings(
  limit = 10,
): Promise<RatingEntry[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from("ratings")
    .select(
      "content_id,category,title,image,rating,updated_at",
    )
    .eq("user_id", user.id)
    .order("rating", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(
      "Failed to load top ratings:",
      error,
    );

    return [];
  }

  return data ?? [];
}

/*
 * Searches the current user's rated content by title.
 * Only runs when there's an actual query — an empty/blank
 * query returns [] without hitting Supabase at all, so idle
 * typing costs nothing.
 */
export async function searchRatings(
  query: string,
  limit = 25,
): Promise<RatingEntry[]> {
  const trimmed = query.trim();

  if (!trimmed) {
    return [];
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from("ratings")
    .select(
      "content_id,category,title,image,rating,updated_at",
    )
    .eq("user_id", user.id)
    .ilike("title", `%${trimmed}%`)
    .order("rating", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(
      "Failed to search ratings:",
      error,
    );

    return [];
  }

  return data ?? [];
}

/*
 * Creates or updates a rating for a piece of content.
 * One row per (user_id, content_id) — rating again just
 * updates the existing row.
 */
export async function upsertRating(params: {
  contentId: string;
  category: string;
  title: string;
  image?: string | null;
  rating: number;
}) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error(
      "Please login before rating.",
    );
  }

  const { error } = await supabase
    .from("ratings")
    .upsert(
      {
        user_id: user.id,
        content_id: params.contentId,
        category: params.category,
        title: params.title,
        image: params.image || null,
        rating: params.rating,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,content_id" },
    );

  if (error) {
    throw error;
  }
}

/* ============================================================
   AGGREGATE RATING STATS (all users, storage-light)
============================================================ */

export type RatingStats = {
  contentId: string;
  totalRatings: number;
  avgRating: number;
  distribution: Record<number, number>;
};

/*
 * Batch-fetches aggregate rating stats (avg + 1-10 distribution)
 * for a set of content IDs via the get_rating_stats RPC.
 *
 * This hits a Postgres function that does the aggregation
 * server-side and returns ONE row per content_id (never raw
 * per-user rows) — so a grid of 20 cards costs one request
 * with 20 tiny summary rows, not hundreds of individual
 * ratings pulled down to average client-side.
 *
 * Call this once per visible batch of cards (all content IDs
 * on screen), not once per card.
 */
export async function fetchRatingStats(
  contentIds: string[],
): Promise<Record<string, RatingStats>> {
  const ids = Array.from(new Set(contentIds)).filter(Boolean);

  if (ids.length === 0) {
    return {};
  }

  const { data, error } = await supabase.rpc(
    "get_rating_stats",
    { p_content_ids: ids },
  );

  if (error) {
    console.error(
      "Failed to load rating stats:",
      error,
    );

    return {};
  }

  const map: Record<string, RatingStats> = {};

  for (const row of data ?? []) {
    map[row.content_id] = {
      contentId: row.content_id,
      totalRatings: row.total_ratings,
      avgRating: Number(row.avg_rating) || 0,
      distribution: row.distribution || {},
    };
  }

  return map;
}

export async function deleteRating(
  contentId: string,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Please login first.");
  }

  const { error } = await supabase
    .from("ratings")
    .delete()
    .eq("user_id", user.id)
    .eq("content_id", contentId);

  if (error) {
    throw error;
  }
}