"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type DayData = {
  day: string;
  hours: number;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/*
 * Builds the last 7 days (oldest -> newest, ending today) as
 * empty buckets, keyed by local YYYY-MM-DD date string.
 */
function buildEmptyWeek(): { key: string; day: string }[] {
  const days: { key: string; day: string }[] = [];

  const today = new Date();

  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);

    const key = date.toISOString().slice(0, 10);
    const day = DAY_LABELS[date.getDay()];

    days.push({ key, day });
  }

  return days;
}

export default function WatchTimeChart() {
  const [watchTime, setWatchTime] = useState<DayData[]>(
    buildEmptyWeek().map(({ day }) => ({ day, hours: 0 })),
  );

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadWeeklyWatchTime() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          if (isMounted) setLoading(false);
          return;
        }

        const emptyWeek = buildEmptyWeek();

        // Start of the earliest day in the window, in UTC ISO.
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - 6);
        sinceDate.setHours(0, 0, 0, 0);

        const { data, error } = await supabase
          .from("watch_sessions")
          .select("total_seconds,created_at")
          .eq("user_id", user.id)
          .gte("created_at", sinceDate.toISOString());

        if (error) {
          console.error("Failed to load weekly watch time:", error);
          if (isMounted) setLoading(false);
          return;
        }

        const secondsByDay: Record<string, number> = {};

        emptyWeek.forEach(({ key }) => {
          secondsByDay[key] = 0;
        });

        (data ?? []).forEach((row: any) => {
          if (!row.created_at) return;

          const key = new Date(row.created_at)
            .toISOString()
            .slice(0, 10);

          if (key in secondsByDay) {
            secondsByDay[key] += Number(row.total_seconds ?? 0);
          }
        });

        const nextWatchTime: DayData[] = emptyWeek.map(
          ({ key, day }) => ({
            day,
            hours: Math.round((secondsByDay[key] / 3600) * 10) / 10,
          }),
        );

        if (isMounted) {
          setWatchTime(nextWatchTime);
        }
      } catch (err) {
        console.error("Weekly watch time error:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadWeeklyWatchTime();

    const channel = supabase
      .channel("watch-time-chart")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "watch_sessions" },
        () => {
          loadWeeklyWatchTime();
        },
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const total = watchTime.reduce((sum, item) => sum + item.hours, 0);

  const average = total / watchTime.length;

  const highestDay = watchTime.reduce((highest, item) =>
    item.hours > highest.hours ? item : highest,
  );

  const maxHours = Math.max(...watchTime.map((item) => item.hours), 1);

  return (
    <section className="glass-panel mt-10 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow">Analytics</p>

          <h3 className="mt-1 text-xl font-semibold text-white">
            Watch Time This Week
          </h3>
        </div>

        <div className="flex gap-6">
          <div>
            <p className="text-xs text-white/30">Total</p>
            <p className="gradient-text mt-1 font-bold">
              {loading ? "..." : `${total.toFixed(1)}h`}
            </p>
          </div>

          <div>
            <p className="text-xs text-white/30">Average</p>
            <p className="mt-1 font-semibold text-white">
              {loading ? "..." : `${average.toFixed(1)}h`}
            </p>
          </div>

          <div>
            <p className="text-xs text-white/30">Best Day</p>
            <p className="mt-1 font-semibold text-white">
              {loading ? "..." : highestDay.day}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-8 flex h-64 items-end justify-between gap-3">
        {watchTime.map((item, index) => {
          const height = `${(item.hours / maxHours) * 100}%`;

          return (
            <div
              key={`${item.day}-${index}`}
              className="group flex h-full flex-1 flex-col items-center justify-end"
            >
              <div className="relative flex h-full w-full items-end justify-center">
                <div className="absolute bottom-0 mb-2 hidden rounded-lg border border-white/10 bg-[#12121c] px-2 py-1 text-xs text-white shadow-xl group-hover:block">
                  {item.hours}h
                </div>

                <div
                  className="w-full max-w-10 rounded-t-xl bg-[linear-gradient(180deg,var(--accent-2)_0%,var(--accent)_100%)] opacity-80 transition-all duration-500 group-hover:opacity-100"
                  style={{ height: item.hours > 0 ? height : "2px" }}
                />
              </div>

              <span className="mt-3 text-xs text-white/40">
                {item.day}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}