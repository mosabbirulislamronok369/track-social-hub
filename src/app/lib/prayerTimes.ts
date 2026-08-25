/* ============================================================
   PRAYER TIMES (Aladhan API — free, no key, no Supabase)

   Location comes from the browser's Geolocation API. Results
   are cached in localStorage per day + rounded coordinates, so
   a user reopening the app on the same day makes zero network
   calls, and this NEVER touches Supabase.
============================================================ */

export type PrayerTimings = {
  Fajr: string;
  Sunrise: string;
  Dhuhr: string;
  Asr: string;
  Maghrib: string; // Iftar time
  Isha: string;
};

export type PrayerTimesResult = {
  timings: PrayerTimings;
  date: string; // "DD-MM-YYYY" as returned by the API
  location: { latitude: number; longitude: number };
};

const CACHE_PREFIX = "islamicTrack:prayerTimes:";

function todayKey(latitude: number, longitude: number) {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;

  // Round to ~1km precision — plenty for prayer time calculation,
  // and keeps the cache key stable for minor GPS jitter.
  const lat = latitude.toFixed(2);
  const lon = longitude.toFixed(2);

  return `${CACHE_PREFIX}${dateStr}:${lat}:${lon}`;
}

export function getBrowserLocation(): Promise<{
  latitude: number;
  longitude: number;
}> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation is not supported in this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        reject(error);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 3600000 },
    );
  });
}

/*
 * method=1 (University of Islamic Sciences, Karachi) + school=1
 * (Hanafi Asr) — the common convention across Bangladesh/South
 * Asia. Change these two query params if a different convention
 * is needed for your users.
 */
export async function fetchPrayerTimes(
  latitude: number,
  longitude: number,
): Promise<PrayerTimesResult> {
  const cacheKey = todayKey(latitude, longitude);

  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    try {
      return JSON.parse(cached) as PrayerTimesResult;
    } catch {
      // fall through and refetch on parse failure
    }
  }

  const url = `https://api.aladhan.com/v1/timings?latitude=${latitude}&longitude=${longitude}&method=1&school=1`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Failed to fetch prayer times.");
  }

  const payload = await response.json();

  const result: PrayerTimesResult = {
    timings: payload.data.timings,
    date: payload.data.date.gregorian.date,
    location: { latitude, longitude },
  };

  localStorage.setItem(cacheKey, JSON.stringify(result));

  return result;
}

/*
 * Prunes any cached prayer-time entries from previous days so
 * localStorage doesn't grow forever.
 */
export function pruneOldPrayerTimesCache() {
  const today = new Date();
  const todayPrefix = `${CACHE_PREFIX}${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}:`;

  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);

    if (key && key.startsWith(CACHE_PREFIX) && !key.startsWith(todayPrefix)) {
      localStorage.removeItem(key);
    }
  }
}

const PRAYER_ORDER: (keyof PrayerTimings)[] = [
  "Fajr",
  "Sunrise",
  "Dhuhr",
  "Asr",
  "Maghrib",
  "Isha",
];

export type NextPrayer = {
  name: keyof PrayerTimings;
  time: string; // "HH:mm"
  minutesUntil: number;
};

/*
 * Finds the next upcoming prayer from now. If all of today's
 * prayers have passed, wraps to Fajr (labeled as "tomorrow" by
 * the caller if desired — this function only reports minutes
 * until midnight + Fajr's clock time, not a real cross-day calc,
 * since a fresh fetch happens tomorrow anyway).
 */
export function getNextPrayer(
  timings: PrayerTimings,
  now: Date = new Date(),
): NextPrayer | null {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  for (const name of PRAYER_ORDER) {
    const raw = timings[name].split(" ")[0]; // strip timezone suffix if present
    const [h, m] = raw.split(":").map(Number);
    const prayerMinutes = h * 60 + m;

    if (prayerMinutes >= nowMinutes) {
      return {
        name,
        time: raw,
        minutesUntil: prayerMinutes - nowMinutes,
      };
    }
  }

  return null;
}