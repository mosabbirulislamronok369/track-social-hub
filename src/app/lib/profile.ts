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
  image: string | null;
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
      "content_id,category,title,image,total_seconds",
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

      if (!existing.image && row.image) {
        existing.image = row.image;
      }
    } else {
      map.set(contentId, {
        contentId,
        category: row.category,
        title: row.title || contentId,
        image: row.image || null,
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