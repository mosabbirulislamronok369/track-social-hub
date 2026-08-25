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