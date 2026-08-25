"use client";

import { useEffect, useRef, useState } from "react";
import {
  fetchPrayerTimes,
  getBrowserLocation,
  getNextPrayer,
  pruneOldPrayerTimesCache,
  type PrayerTimings,
} from "../lib/prayerTimes";
import { fetchTodayQuranLog, upsertTodayQuranLog } from "../lib/quranTrack";

const PRAYER_LABELS: Record<keyof PrayerTimings, string> = {
  Fajr: "Fajr",
  Sunrise: "Sunrise",
  Dhuhr: "Dhuhr",
  Asr: "Asr",
  Maghrib: "Maghrib (Iftar)",
  Isha: "Isha",
};

const SYNC_INTERVAL_MS = 60000; // at most one Supabase write per minute
const LOCAL_KEY_PREFIX = "islamicTrack:quranSeconds:";

function todayLocalKey() {
  const now = new Date();
  return `${LOCAL_KEY_PREFIX}${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function formatDuration(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }

  if (m > 0) {
    return `${m}m ${s}s`;
  }

  return `${s}s`;
}

export default function IslamicTrack() {
  /* ---------------- Prayer times (no Supabase at all) ---------------- */
  const [timings, setTimings] = useState<PrayerTimings | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [loadingTimes, setLoadingTimes] = useState(true);

  useEffect(() => {
    pruneOldPrayerTimesCache();

    getBrowserLocation()
      .then((coords) => fetchPrayerTimes(coords.latitude, coords.longitude))
      .then((result) => {
        setTimings(result.timings);
        setLoadingTimes(false);
      })
      .catch((error) => {
        console.error("Prayer times error:", error);
        setLocationError(
          "Location access দরকার prayer time দেখানোর জন্য। Browser permission চেক করুন।",
        );
        setLoadingTimes(false);
      });
  }, []);

  const nextPrayer = timings ? getNextPrayer(timings) : null;

  /* ---------------- Quran reading timer ---------------- */
  const [seconds, setSeconds] = useState(0);
  const [isReading, setIsReading] = useState(false);
  const [goalMinutes, setGoalMinutes] = useState<number>(30);
  const [loadedFromServer, setLoadedFromServer] = useState(false);

  const secondsRef = useRef(0);
  const lastSyncRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    secondsRef.current = seconds;
  }, [seconds]);

  // Restore today's progress: take the higher of (last synced
  // value from Supabase) vs (unsynced local value), so switching
  // devices mid-day never loses progress either way.
  useEffect(() => {
    async function restore() {
      const localRaw = localStorage.getItem(todayLocalKey());
      const localSeconds = localRaw ? Number(localRaw) || 0 : 0;

      const serverLog = await fetchTodayQuranLog();
      const serverSeconds = serverLog?.totalSeconds ?? 0;

      if (serverLog?.goalMinutes) {
        setGoalMinutes(serverLog.goalMinutes);
      }

      const restored = Math.max(localSeconds, serverSeconds);

      setSeconds(restored);
      localStorage.setItem(todayLocalKey(), String(restored));
      setLoadedFromServer(true);
    }

    restore();
  }, []);

  async function syncNow(force = false) {
    const now = Date.now();

    if (!force && now - lastSyncRef.current < SYNC_INTERVAL_MS) {
      return;
    }

    lastSyncRef.current = now;

    try {
      await upsertTodayQuranLog(secondsRef.current, goalMinutes);
    } catch (error) {
      console.error("Failed to sync Quran log:", error);
    }
  }

  function toggleReading() {
    if (isReading) {
      setIsReading(false);
      syncNow(true); // always sync on pause — this is a rare, intentional action
    } else {
      setIsReading(true);
    }
  }

  // Local 1s ticker — writes to localStorage only, never to Supabase.
  useEffect(() => {
    if (!isReading) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }

    tickRef.current = setInterval(() => {
      setSeconds((previous) => {
        const next = previous + 1;
        localStorage.setItem(todayLocalKey(), String(next));
        return next;
      });
    }, 1000);

    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [isReading]);

  // Throttled background sync while actively reading — bounded
  // to at most one Supabase write per SYNC_INTERVAL_MS, regardless
  // of session length.
  useEffect(() => {
    if (!isReading) {
      if (syncCheckRef.current) {
        clearInterval(syncCheckRef.current);
        syncCheckRef.current = null;
      }
      return;
    }

    syncCheckRef.current = setInterval(() => {
      syncNow();
    }, SYNC_INTERVAL_MS);

    return () => {
      if (syncCheckRef.current) {
        clearInterval(syncCheckRef.current);
        syncCheckRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReading, goalMinutes]);

  // Final sync on unmount / tab close, so nothing is lost.
  useEffect(() => {
    function handleBeforeUnload() {
      syncNow(true);
    }

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      syncNow(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleGoalChange(minutes: number) {
    setGoalMinutes(minutes);
  }

  const goalSeconds = goalMinutes * 60;
  const progressPercent = Math.min(100, (seconds / goalSeconds) * 100);
  const goalReached = seconds >= goalSeconds;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Islamic Track</h1>
      <p className="mt-2 text-white/50">
        Namaz er shomoy, Iftar, ar dainik Quran reading — ek jaygay.
      </p>

      {/* PRAYER TIMES */}
      <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-lg font-semibold text-white">Prayer Times</h2>

        {loadingTimes && (
          <p className="mt-3 text-sm text-white/40">Loading location...</p>
        )}

        {locationError && (
          <p className="mt-3 text-sm text-yellow-400">{locationError}</p>
        )}

        {timings && (
          <>
            {nextPrayer && (
              <div className="mt-4 rounded-xl bg-[var(--accent-soft)] px-4 py-3">
                <span className="text-xs uppercase tracking-wide text-white/50">
                  Next: {PRAYER_LABELS[nextPrayer.name]}
                </span>
                <div className="text-2xl font-bold text-white">
                  {nextPrayer.time}{" "}
                  <span className="text-sm font-normal text-white/50">
                    ({nextPrayer.minutesUntil} min baki)
                  </span>
                </div>
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(Object.keys(timings) as (keyof PrayerTimings)[]).map(
                (name) => (
                  <div
                    key={name}
                    className={`rounded-lg border px-3 py-2 ${
                      name === "Maghrib"
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-white/10 bg-white/[0.02]"
                    }`}
                  >
                    <div className="text-xs text-white/45">
                      {PRAYER_LABELS[name]}
                    </div>
                    <div className="text-sm font-semibold text-white">
                      {timings[name].split(" ")[0]}
                    </div>
                  </div>
                ),
              )}
            </div>
          </>
        )}
      </section>

      {/* QURAN READING TIMER */}
      <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="text-lg font-semibold text-white">
          Daily Quran Reading
        </h2>

        <div className="mt-3 flex gap-2">
          {[30, 60].map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => handleGoalChange(minutes)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                goalMinutes === minutes
                  ? "bg-[var(--accent)] text-white"
                  : "bg-white/[0.05] text-white/50 hover:text-white"
              }`}
            >
              {minutes === 60 ? "1 hr" : `${minutes} min`} goal
            </button>
          ))}
        </div>

        <div className="mt-5 text-center">
          <div className="text-4xl font-bold text-white">
            {formatDuration(seconds)}
          </div>

          <div className="mt-1 text-xs text-white/40">
            Goal: {goalMinutes} min{" "}
            {goalReached && (
              <span className="text-green-400">• Goal complete! Alhamdulillah</span>
            )}
          </div>

          <div className="mx-auto mt-3 h-2 w-full max-w-sm overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-[linear-gradient(90deg,var(--accent)_0%,var(--accent-2)_100%)] transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <button
            type="button"
            onClick={toggleReading}
            disabled={!loadedFromServer}
            className="mt-6 rounded-lg bg-white px-6 py-2 font-semibold text-black hover:bg-white/90 disabled:opacity-40"
          >
            {isReading ? "Pause" : "Start Reading"}
          </button>
        </div>
      </section>
    </div>
  );
}