import { supabase } from "./supabase";

/* ============================================================
   PROFILE
============================================================ */

export type Profile = {
  id: string;
  name: string | null;
  bio: string | null;
  avatar_url: string | null;
  date_of_birth: string | null; // "YYYY-MM-DD"
};

export async function fetchProfile(): Promise<
  Profile | null
> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id,name,bio,avatar_url,date_of_birth",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error(
      "Failed to load profile:",
      error,
    );

    return null;
  }

  if (!data) {
    // No profile row yet — sensible defaults.
    return {
      id: user.id,
      name: user.email?.split("@")[0] ?? null,
      bio: null,
      avatar_url: null,
      date_of_birth: null,
    };
  }

  return data;
}

export async function saveProfile(
  fields: Partial<Omit<Profile, "id">>,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error(
      "Please login before saving your profile.",
    );
  }

  const { error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        ...fields,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

  if (error) {
    throw error;
  }
}

export async function uploadAvatar(
  file: File,
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error(
      "Please login before uploading a photo.",
    );
  }

  const extension =
    file.name.split(".").pop() || "jpg";

  const path = `${user.id}/avatar-${Date.now()}.${extension}`;

  const { error: uploadError } =
    await supabase.storage
      .from("avatars")
      .upload(path, file, {
        upsert: true,
        cacheControl: "3600",
      });

  if (uploadError) {
    throw uploadError;
  }

  const { data } = supabase.storage
    .from("avatars")
    .getPublicUrl(path);

  return data.publicUrl;
}

/* ============================================================
   WATCHED CONTENT (from watch_sessions)
============================================================ */

export type WatchedItem = {
  contentId: string;
  category: string;
  title: string;
  totalSeconds: number;
};

/*
 * Groups watch_sessions rows by content_id (a title can have
 * multiple rows from rewatches / older data) and returns one
 * entry per item, sorted by most-watched first.
 */
export async function fetchWatchedContent(): Promise<
  WatchedItem[]
> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from("watch_sessions")
    .select(
      "content_id,category,title,total_seconds",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(
      "Failed to load watched content:",
      error,
    );

    return [];
  }

  const map = new Map<string, WatchedItem>();

  for (const row of data ?? []) {
    const contentId = String(row.content_id);

    const existing = map.get(contentId);

    if (existing) {
      existing.totalSeconds += Number(
        row.total_seconds || 0,
      );

      if (!existing.title && row.title) {
        existing.title = row.title;
      }
    } else {
      map.set(contentId, {
        contentId,
        category: row.category,
        title: row.title || contentId,
        totalSeconds: Number(
          row.total_seconds || 0,
        ),
      });
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => b.totalSeconds - a.totalSeconds,
  );
}

export async function fetchTotalWatchSeconds(): Promise<number> {
  const items = await fetchWatchedContent();

  return items.reduce(
    (sum, item) => sum + item.totalSeconds,
    0,
  );
}

/* ============================================================
   AGE CALCULATION
============================================================ */

export type AgeBreakdown = {
  years: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalSeconds: number;
};

/*
 * Calendar-accurate age: full years since birth (accounting
 * for whether this year's birthday has happened yet), then
 * days/hours/minutes/seconds since the most recent birthday.
 */
export function computeAge(
  birthDate: Date,
  now: Date,
): AgeBreakdown {
  let years =
    now.getFullYear() - birthDate.getFullYear();

  const anniversaryThisYear = new Date(
    now.getFullYear(),
    birthDate.getMonth(),
    birthDate.getDate(),
    birthDate.getHours(),
    birthDate.getMinutes(),
    birthDate.getSeconds(),
  );

  if (anniversaryThisYear > now) {
    years -= 1;
  }

  const lastAnniversary = new Date(
    birthDate.getFullYear() + years,
    birthDate.getMonth(),
    birthDate.getDate(),
    birthDate.getHours(),
    birthDate.getMinutes(),
    birthDate.getSeconds(),
  );

  const diffMs = Math.max(
    0,
    now.getTime() - lastAnniversary.getTime(),
  );

  const totalSecondsSinceBirthday = Math.floor(
    diffMs / 1000,
  );

  const days = Math.floor(
    totalSecondsSinceBirthday / 86400,
  );

  const hours = Math.floor(
    (totalSecondsSinceBirthday % 86400) / 3600,
  );

  const minutes = Math.floor(
    (totalSecondsSinceBirthday % 3600) / 60,
  );

  const seconds = totalSecondsSinceBirthday % 60;

  const totalSeconds = Math.max(
    0,
    Math.floor(
      (now.getTime() - birthDate.getTime()) /
        1000,
    ),
  );

  return {
    years,
    days,
    hours,
    minutes,
    seconds,
    totalSeconds,
  };
}

export function formatAge(
  age: AgeBreakdown,
): string {
  return `${age.years}y ${age.days}d ${age.hours}h ${age.minutes}m ${age.seconds}s`;
}

/* ============================================================
   WATCHLIST STATUS GROUPS (Watching / Hold / Completed / Dropped)

   Statuses match UniversalBrowser.tsx's ItemStatus values
   exactly ("watching", "on_hold", "completed", "dropped") so
   this reads the same watchlist_items rows that Browse/Anime
   already write, no new table or duplicate writes needed.
============================================================ */

export type ProfileWatchStatus =
  | "watchlist"
  | "watching"
  | "on_hold"
  | "completed"
  | "dropped";

export type WatchlistItem = {
  contentId: string;
  category: string;
  title: string;
  imageUrl: string | null;
  status: ProfileWatchStatus;
  currentEpisode: number | null;
  totalEpisodes: number | null;
};

export type GroupedProfileWatchlist = Record<
  ProfileWatchStatus,
  WatchlistItem[]
>;

const PROFILE_STATUSES: ProfileWatchStatus[] = [
  "watchlist",
  "watching",
  "on_hold",
  "completed",
  "dropped",
];

/*
 * ONE query, filtered to only the 5 statuses this page shows
 * (skips "rewatch" rows entirely — fewer bytes read, not just
 * fewer round trips) and grouped client-side. Tab switching
 * after this never re-hits Supabase.
 */
export async function fetchGroupedProfileWatchlist(): Promise<GroupedProfileWatchlist> {
  const empty: GroupedProfileWatchlist = {
    watchlist: [],
    watching: [],
    on_hold: [],
    completed: [],
    dropped: [],
  };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return empty;
  }

  const { data, error } = await supabase
    .from("watchlist_items")
    .select(
      "content_id,category,title,image_url,status,current_episode,total_episodes",
    )
    .eq("user_id", user.id)
    .in("status", PROFILE_STATUSES)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error(
      "Failed to load profile watchlist:",
      error,
    );

    return empty;
  }

  const grouped: GroupedProfileWatchlist = {
    watchlist: [],
    watching: [],
    on_hold: [],
    completed: [],
    dropped: [],
  };

  for (const row of data ?? []) {
    const status = row.status as ProfileWatchStatus;

    if (!grouped[status]) {
      continue; // ignore anything unexpected
    }

    grouped[status].push({
      contentId: row.content_id,
      category: row.category,
      title: row.title,
      imageUrl: row.image_url,
      status,
      currentEpisode: row.current_episode ?? null,
      totalEpisodes: row.total_episodes ?? null,
    });
  }

  return grouped;
}

/*
 * Moves one watchlist_items row to a new status (used by the
 * click-to-update menu on each card in the Watchlist/Watching/
 * Hold/Completed/Dropped tabs).
 *
 * Deliberately a single UPDATE with no follow-up SELECT — the
 * caller already has the item locally and moves it between
 * status buckets optimistically, so this doesn't cost any
 * extra Supabase reads beyond the one write.
 */
export async function updateWatchlistItemStatus(
  contentId: string,
  status: ProfileWatchStatus,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Please login first.");
  }

  const { error } = await supabase
    .from("watchlist_items")
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("content_id", contentId);

  if (error) {
    throw error;
  }
}