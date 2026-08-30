import { supabase } from "./supabase";

/* ============================================================
   FAVOURITE LIST
   Ranked list of up to MAX_FAVOURITES items (Anime / TV /
   Movies only — YouTube is excluded). Backed by a single
   `favourites` table:

     create table favourites (
       id          bigint generated always as identity primary key,
       user_id     uuid not null references auth.users(id) on delete cascade,
       content_id  text not null,   -- e.g. "anime-123" (matches
                                     -- UniversalBrowser's getContentId)
       content_type text not null,  -- "Anime" | "TV" | "Movies"
       title       text not null,
       subtitle    text,
       image       text,
       rank        int not null,
       created_at  timestamptz not null default now(),
       unique (user_id, content_id),
       unique (user_id, rank)
     );

   Reads happen once per mount (fetchFavourites) and updates are
   dispatched via a "favourites-changed" window event so every
   mounted component (UniversalBrowser cards/modal, FavouriteList,
   Sidebar badge, etc.) stays in sync without extra Supabase reads.
============================================================ */

export const MAX_FAVOURITES = 50;

export type FavouriteContentType = "Anime" | "TV" | "Movies";

export type FavouriteItem = {
  contentId: string;
  contentType: FavouriteContentType;
  title: string;
  subtitle?: string | null;
  image?: string | null;
  rank: number;
};

export const FAVOURITES_CHANGED_EVENT = "favourites-changed";

function notifyFavouritesChanged() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(FAVOURITES_CHANGED_EVENT));
}

async function getUserId(): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error("Please login first.");
  }

  return user.id;
}

/*
 * Loads the full favourite list for the current user, ordered
 * by rank. Call this once on mount (same convention as
 * fetchAllRatings in lib/ratings.ts) — never per-card.
 */
export async function fetchFavourites(): Promise<FavouriteItem[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from("favourites")
    .select(
      "content_id, content_type, title, subtitle, image, rank",
    )
    .eq("user_id", user.id)
    .order("rank", { ascending: true });

  if (error) {
    throw error;
  }

  return (data || []).map((row) => ({
    contentId: row.content_id,
    contentType: row.content_type,
    title: row.title,
    subtitle: row.subtitle,
    image: row.image,
    rank: row.rank,
  }));
}

/*
 * Adds an item to the end of the favourite list (next free
 * rank). Throws if already at MAX_FAVOURITES or if the item is
 * already favourited.
 */
export async function addFavourite(item: {
  contentId: string;
  contentType: FavouriteContentType;
  title: string;
  subtitle?: string | null;
  image?: string | null;
}): Promise<void> {
  const userId = await getUserId();

  const { count, error: countError } = await supabase
    .from("favourites")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (countError) {
    throw countError;
  }

  if ((count || 0) >= MAX_FAVOURITES) {
    throw new Error(
      `Favourite List is full (max ${MAX_FAVOURITES}). Remove something first.`,
    );
  }

  const nextRank = (count || 0) + 1;

  const { error } = await supabase.from("favourites").insert({
    user_id: userId,
    content_id: item.contentId,
    content_type: item.contentType,
    title: item.title,
    subtitle: item.subtitle ?? null,
    image: item.image ?? null,
    rank: nextRank,
  });

  if (error) {
    if (error.code === "23505") {
      throw new Error("Already in your Favourite List.");
    }

    throw error;
  }

  notifyFavouritesChanged();
}

/*
 * Removes an item and closes the rank gap so ranks stay a
 * contiguous 1..N sequence (no holes after deletion).
 */
export async function removeFavourite(
  contentId: string,
): Promise<void> {
  const userId = await getUserId();

  const { data: removedRow, error: fetchError } = await supabase
    .from("favourites")
    .select("rank")
    .eq("user_id", userId)
    .eq("content_id", contentId)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  const { error: deleteError } = await supabase
    .from("favourites")
    .delete()
    .eq("user_id", userId)
    .eq("content_id", contentId);

  if (deleteError) {
    throw deleteError;
  }

  if (removedRow?.rank) {
    const { data: below, error: belowError } = await supabase
      .from("favourites")
      .select("id, rank")
      .eq("user_id", userId)
      .gt("rank", removedRow.rank)
      .order("rank", { ascending: true });

    if (belowError) {
      throw belowError;
    }

    for (const row of below || []) {
      const { error: shiftError } = await supabase
        .from("favourites")
        .update({ rank: row.rank - 1 })
        .eq("id", row.id);

      if (shiftError) {
        throw shiftError;
      }
    }
  }

  notifyFavouritesChanged();
}

/*
 * Persists a full reorder in one go. Pass content_ids in their
 * new top-to-bottom order; ranks 1..N are assigned by position.
 * Used by both drag-and-drop and the up/down arrow buttons.
 *
 * Ranks are unique per user, so a naive left-to-right update can
 * collide with an existing rank mid-way through. To dodge that,
 * every row is first pushed into a temporary negative-rank range,
 * then given its real final rank.
 */
export async function reorderFavourites(
  orderedContentIds: string[],
): Promise<void> {
  const userId = await getUserId();

  for (let i = 0; i < orderedContentIds.length; i++) {
    const { error } = await supabase
      .from("favourites")
      .update({ rank: -(i + 1) })
      .eq("user_id", userId)
      .eq("content_id", orderedContentIds[i]);

    if (error) {
      throw error;
    }
  }

  for (let i = 0; i < orderedContentIds.length; i++) {
    const { error } = await supabase
      .from("favourites")
      .update({ rank: i + 1 })
      .eq("user_id", userId)
      .eq("content_id", orderedContentIds[i]);

    if (error) {
      throw error;
    }
  }

  notifyFavouritesChanged();
}