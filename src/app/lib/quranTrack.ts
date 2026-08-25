import { supabase } from "./supabase";

/* ============================================================
   DAILY QURAN READING LOG (one row per user per day)

   Deliberately NOT a heartbeat table like watch_sessions — the
   running timer lives in React state + localStorage on the
   client, and this file only ever does an upsert against
   today's single row, throttled by the caller.
============================================================ */

export type QuranLog = {
  totalSeconds: number;
  goalMinutes: number | null;
};

function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

export async function fetchTodayQuranLog(): Promise<QuranLog | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("quran_reading_log")
    .select("total_seconds,goal_minutes")
    .eq("user_id", user.id)
    .eq("log_date", todayDateString())
    .maybeSingle();

  if (error) {
    console.error("Failed to load Quran log:", error);
    return null;
  }

  if (!data) {
    return { totalSeconds: 0, goalMinutes: null };
  }

  return {
    totalSeconds: data.total_seconds ?? 0,
    goalMinutes: data.goal_minutes ?? null,
  };
}

/*
 * Single UPSERT for today's row. The caller (IslamicTrack.tsx)
 * throttles how often this gets called — this function itself
 * does not rate-limit, it just performs one write per call.
 */
export async function upsertTodayQuranLog(
  totalSeconds: number,
  goalMinutes: number | null,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Please login first.");
  }

  const { error } = await supabase.from("quran_reading_log").upsert(
    {
      user_id: user.id,
      log_date: todayDateString(),
      total_seconds: totalSeconds,
      goal_minutes: goalMinutes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,log_date" },
  );

  if (error) {
    throw error;
  }
}

/* ============================================================
   LIFETIME QURAN TOTAL (Profile "Total Quran Reading" stat)

   Sums every quran_reading_log row for the user — the table
   is one row per user per day, so this is a plain client-side
   sum, same pattern as fetchTotalWatchSeconds in profile.ts.
============================================================ */

export async function fetchTotalQuranSeconds(): Promise<number> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return 0;
  }

  const { data, error } = await supabase
    .from("quran_reading_log")
    .select("total_seconds")
    .eq("user_id", user.id);

  if (error) {
    console.error("Failed to load total Quran time:", error);
    return 0;
  }

  return (data ?? []).reduce(
    (sum, row) => sum + Number(row.total_seconds ?? 0),
    0,
  );
}

/* ============================================================
   QURAN LEADERBOARD (Leaderboard.tsx "🕌 Quran" tab)

   Deliberately a standalone fetcher instead of running through
   lib/leaderboard.ts's get_leaderboard() RPC — that RPC sums
   watch_sessions by category, and quran_reading_log is a
   different table/shape. Aggregated client-side (fine: one row
   per user per day, small table) then joined against `profiles`
   for display names, same two-step join fetchWatchedContent /
   fetchProfile already use elsewhere in this codebase.
============================================================ */

export type QuranLeaderboardEntry = {
  userId: string;
  displayName: string;
  totalSeconds: number;
};

export async function fetchQuranLeaderboard(
  friendUserIds?: string[],
): Promise<QuranLeaderboardEntry[]> {
  // Friends scope with zero friends — nothing to query.
  if (friendUserIds && friendUserIds.length === 0) {
    return [];
  }

  let query = supabase
    .from("quran_reading_log")
    .select("user_id,total_seconds");

  if (friendUserIds) {
    query = query.in("user_id", friendUserIds);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Failed to load Quran leaderboard:", error);
    return [];
  }

  const totals = new Map<string, number>();

  for (const row of data ?? []) {
    const userId = String(row.user_id);

    totals.set(
      userId,
      (totals.get(userId) ?? 0) + Number(row.total_seconds ?? 0),
    );
  }

  const userIds = Array.from(totals.keys());

  if (userIds.length === 0) {
    return [];
  }

  const { data: profileRows, error: profileError } = await supabase
    .from("profiles")
    .select("id,name")
    .in("id", userIds);

  if (profileError) {
    console.error(
      "Failed to load profiles for Quran leaderboard:",
      profileError,
    );
  }

  const nameById = new Map<string, string>();

  for (const row of profileRows ?? []) {
    nameById.set(row.id, row.name || "Unnamed");
  }

  return Array.from(totals.entries())
    .map(([userId, totalSeconds]) => ({
      userId,
      displayName: nameById.get(userId) || "Unnamed",
      totalSeconds,
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
}