"use client";

import { useEffect, useRef, useState } from "react";

/* ============================================================
   EVENT COUNTDOWN — 100% client-side, no Supabase.

   Every event (title, optional thumbnail, target date/time)
   lives in the browser's localStorage under STORAGE_KEY.
   Nothing here ever calls the network, so it costs zero
   Supabase reads/writes/storage.

   Thumbnails: pick "Image URL" to just link an image (0 bytes
   stored locally), or "Upload" to embed a small image as a
   base64 data URL directly in localStorage. Uploads are capped
   at 400KB so a few events don't blow past the ~5MB
   localStorage limit most browsers give a site.
============================================================ */

const STORAGE_KEY = "track-social-hub:countdown-events";
const MAX_UPLOAD_BYTES = 400 * 1024; // 400KB

type CountdownEvent = {
  id: string;
  title: string;
  targetDate: string; // ISO string
  thumbnailUrl: string | null;
};

function loadEvents(): CountdownEvent[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Failed to read countdown events:", err);
    return [];
  }
}

function saveEvents(events: CountdownEvent[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(events),
    );
  } catch (err) {
    // Most likely quota exceeded from an embedded thumbnail.
    console.error("Failed to save countdown events:", err);

    alert(
      "Couldn't save — local storage is full. Try a smaller thumbnail or an image URL instead of an upload.",
    );
  }
}

/* ============================================================
   CALENDAR-ACCURATE COUNTDOWN BREAKDOWN

   Same borrowing technique as computeAge() in lib/profile.ts,
   just measured forward (target - now) instead of backward.
============================================================ */

type CountdownBreakdown = {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isPast: boolean;
};

function computeCountdown(
  target: Date,
  now: Date,
): CountdownBreakdown {
  if (target.getTime() <= now.getTime()) {
    return {
      years: 0,
      months: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      isPast: true,
    };
  }

  let years = target.getFullYear() - now.getFullYear();
  let months = target.getMonth() - now.getMonth();
  let days = target.getDate() - now.getDate();
  let hours = target.getHours() - now.getHours();
  let minutes = target.getMinutes() - now.getMinutes();
  let seconds = target.getSeconds() - now.getSeconds();

  if (seconds < 0) {
    seconds += 60;
    minutes -= 1;
  }

  if (minutes < 0) {
    minutes += 60;
    hours -= 1;
  }

  if (hours < 0) {
    hours += 24;
    days -= 1;
  }

  if (days < 0) {
    // Days in the month just before target's month.
    const prevMonthLastDay = new Date(
      target.getFullYear(),
      target.getMonth(),
      0,
    ).getDate();

    days += prevMonthLastDay;
    months -= 1;
  }

  if (months < 0) {
    months += 12;
    years -= 1;
  }

  return { years, months, days, hours, minutes, seconds, isPast: false };
}

function formatCountdown(b: CountdownBreakdown) {
  if (b.isPast) {
    return "Happened!";
  }

  return `${b.years}y ${b.months}m ${b.days}d ${b.hours}h ${b.minutes}m ${b.seconds}s`;
}

/* ============================================================
   CINEMATIC UNIT DISPLAY

   Instead of always printing all six units (which reads badly
   — "months" and "minutes" both shorten to "m"), we drop any
   leading units that are still zero. A countdown that's 20
   days out shows Days/Hours/Min/Sec; one that's 40 seconds out
   shows just Seconds, big.
============================================================ */

type CountUnit = { key: keyof CountdownBreakdown; label: string };

const COUNT_UNITS: CountUnit[] = [
  { key: "years", label: "Years" },
  { key: "months", label: "Months" },
  { key: "days", label: "Days" },
  { key: "hours", label: "Hours" },
  { key: "minutes", label: "Minutes" },
  { key: "seconds", label: "Seconds" },
];

function getVisibleUnits(
  b: CountdownBreakdown,
): { label: string; value: number }[] {
  const firstNonZero = COUNT_UNITS.findIndex(
    (u) => (b[u.key] as number) > 0,
  );

  // -1 means everything (incl. seconds) is 0 — still show Seconds.
  const startIndex =
    firstNonZero === -1 ? COUNT_UNITS.length - 1 : firstNonZero;

  return COUNT_UNITS.slice(startIndex).map((u) => ({
    label: u.label,
    value: b[u.key] as number,
  }));
}

/*
 * Renders the labeled, colon-separated digit row shared by the
 * card and the fullscreen view. `size` controls scale.
 */
function CinematicDigits({
  units,
  size = "card",
}: {
  units: { label: string; value: number }[];
  size?: "card" | "full";
}) {
  const soloMode = units.length === 1;

  if (soloMode) {
    const unit = units[0];

    return (
      <div className="text-center">
        <p
          className={
            size === "full"
              ? "text-sm font-semibold uppercase tracking-[0.3em] text-white/40"
              : "text-[10px] font-semibold uppercase tracking-[0.25em] text-white/30"
          }
        >
          {unit.label}
        </p>
        <p
          className={
            size === "full"
              ? "mt-2 text-[9rem] font-black leading-none tabular-nums text-white sm:text-[13rem]"
              : "mt-1 text-5xl font-black leading-none tabular-nums text-purple-300"
          }
        >
          {unit.value}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`flex items-end justify-center ${
        size === "full" ? "gap-2 sm:gap-4" : "gap-1"
      }`}
    >
      {units.map((unit, index) => (
        <div key={unit.label} className="flex items-end">
          <div className="flex flex-col items-center">
            <span
              className={
                size === "full"
                  ? "text-[11px] font-semibold uppercase tracking-widest text-white/40 sm:text-sm"
                  : "text-[8px] font-semibold uppercase tracking-widest text-white/30"
              }
            >
              {unit.label}
            </span>
            <span
              className={
                size === "full"
                  ? "mt-1 text-4xl font-black tabular-nums text-white sm:text-6xl"
                  : "mt-0.5 text-lg font-bold tabular-nums text-purple-300"
              }
            >
              {String(unit.value).padStart(2, "0")}
            </span>
          </div>

          {index < units.length - 1 && (
            <span
              className={
                size === "full"
                  ? "mx-1 pb-1 text-4xl font-black text-white/20 sm:text-6xl"
                  : "mx-0.5 pb-0.5 text-lg font-bold text-white/20"
              }
            >
              :
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/*
 * Converts a File to a base64 data URL for local-only storage
 * (no upload endpoint, no Supabase Storage bucket used).
 */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);

    reader.readAsDataURL(file);
  });
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ============================================================
   TICK-TOCK SOUND ENGINE

   Generated with the Web Audio API (no audio files to load/
   host). A single shared AudioContext is created lazily on
   first user interaction (browsers block audio until then).
============================================================ */

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  const AudioCtor =
    window.AudioContext ||
    (window as any).webkitAudioContext;

  if (!AudioCtor) {
    return null;
  }

  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtor();
  }

  if (sharedAudioCtx.state === "suspended") {
    sharedAudioCtx.resume();
  }

  return sharedAudioCtx;
}

// Alternates a slightly higher "tick" and lower "tock" pitch,
// like a clock — pass true for the "tick" beat.
function playTick(isTickBeat: boolean) {
  const ctx = getAudioContext();

  if (!ctx) {
    return;
  }

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "square";
  osc.frequency.value = isTickBeat ? 1000 : 700;

  const now = ctx.currentTime;

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.07);
}

// Little ascending chime played once when a countdown hits zero.
function playDoneChime() {
  const ctx = getAudioContext();

  if (!ctx) {
    return;
  }

  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  const start = ctx.currentTime;

  notes.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = freq;

    const t = start + index * 0.12;

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.32);
  });
}

function IconSoundOn() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M4 9.5v5h3.2L12 18V6L7.2 9.5H4z"
        fill="currentColor"
      />
      <path
        d="M16 9c1 .9 1.6 2 1.6 3.3S17 14.7 16 15.6M18.4 6.6c1.7 1.5 2.7 3.5 2.7 5.7s-1 4.2-2.7 5.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSoundOff() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path
        d="M4 9.5v5h3.2L12 18V6L7.2 9.5H4z"
        fill="currentColor"
      />
      <path
        d="M16 9.5l4.5 4.5M20.5 9.5L16 14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ============================================================
   FULLSCREEN CINEMATIC COUNTDOWN

   Opens when an event card is tapped — black letterbox bars
   top & bottom (movie-theater feel), the event's thumbnail as
   a blurred backdrop, and a big centered countdown.
============================================================ */

function FullscreenCountdown({
  event,
  target,
  breakdown,
  visibleUnits,
  soundOn,
  onToggleSound,
  onClose,
}: {
  event: CountdownEvent;
  target: Date;
  breakdown: CountdownBreakdown;
  visibleUnits: { label: string; value: number }[];
  soundOn: boolean;
  onToggleSound: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black">
      {/* TOP LETTERBOX BAR */}
      <div className="h-10 shrink-0 bg-black sm:h-16" />

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {event.thumbnailUrl && (
          <img
            src={event.thumbnailUrl}
            alt=""
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-3xl"
          />
        )}

        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/70 to-black/90" />

        {/* CONTROLS */}
        <div className="absolute right-4 top-4 z-20 flex gap-2 sm:right-8 sm:top-8">
          <button
            type="button"
            onClick={onToggleSound}
            title={soundOn ? "Mute tick sound" : "Enable tick sound"}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 backdrop-blur-md transition hover:bg-white/10 hover:text-white"
          >
            {soundOn ? <IconSoundOn /> : <IconSoundOff />}
          </button>

          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 backdrop-blur-md transition hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* CONTENT */}
        <div className="relative z-10 flex flex-col items-center px-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-white/40">
            Counting down to
          </p>

          <h2 className="mt-3 max-w-3xl text-3xl font-black tracking-tight text-white sm:text-5xl">
            {event.title}
          </h2>

          <p className="mt-3 text-sm text-white/50 sm:text-base">
            {target.toLocaleString(undefined, {
              dateStyle: "full",
              timeStyle: "short",
            })}
          </p>

          <div className="mt-10 sm:mt-14">
            {breakdown.isPast ? (
              <p className="text-4xl font-black text-green-400 sm:text-6xl">
                🎉 It&apos;s here!
              </p>
            ) : (
              <CinematicDigits units={visibleUnits} size="full" />
            )}
          </div>
        </div>
      </div>

      {/* BOTTOM LETTERBOX BAR */}
      <div className="h-10 shrink-0 bg-black sm:h-16" />
    </div>
  );
}

/*
 * One event card — owns its own 1-second ticker so unrelated
 * events don't all re-render every second's worth of state
 * changes in the parent.
 */
function EventCard({
  event,
  onDelete,
}: {
  event: CountdownEvent;
  onDelete: (id: string) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [soundOn, setSoundOn] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const tickBeatRef = useRef(true);
  const wasPastRef = useRef(false);

  const target = new Date(event.targetDate);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const breakdown = computeCountdown(target, now);
  const visibleUnits = getVisibleUnits(breakdown);

  // Tick every second while running, alternating tick/tock —
  // and fire the completion chime exactly once when it hits zero.
  useEffect(() => {
    if (!soundOn) {
      return;
    }

    if (breakdown.isPast) {
      if (!wasPastRef.current) {
        playDoneChime();
      }
    } else {
      tickBeatRef.current = !tickBeatRef.current;
      playTick(tickBeatRef.current);
    }

    wasPastRef.current = breakdown.isPast;
  }, [now, soundOn, breakdown.isPast]);

  return (
    <>
      <div
        onClick={() => setIsFullscreen(true)}
        role="button"
        tabIndex={0}
        className="group relative cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] transition hover:border-white/20"
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSoundOn((current) => !current);
          }}
          title={soundOn ? "Mute tick sound" : "Enable tick sound"}
          className="absolute right-12 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white/70 backdrop-blur-md transition hover:bg-black/80 hover:text-white"
        >
          {soundOn ? <IconSoundOn /> : <IconSoundOff />}
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(event.id);
          }}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-sm text-white/70 backdrop-blur-md transition hover:bg-black/80 hover:text-white"
          title="Remove event"
        >
          ✕
        </button>

        <div className="relative h-36 w-full overflow-hidden">
          {event.thumbnailUrl ? (
            <img
              src={event.thumbnailUrl}
              alt={event.title}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-purple-500/20 to-pink-500/20 text-3xl font-bold text-white/20">
              {event.title.slice(0, 1).toUpperCase() || "?"}
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

          <div className="absolute bottom-3 left-4 right-4">
            <h4 className="truncate font-semibold text-white">
              {event.title}
            </h4>

            <p className="mt-0.5 text-xs text-white/50">
              {target.toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          </div>
        </div>

        <div className="p-4">
          {breakdown.isPast ? (
            <p className="text-center text-lg font-bold text-green-400">
              Happened!
            </p>
          ) : (
            <CinematicDigits units={visibleUnits} size="card" />
          )}
        </div>
      </div>

      {isFullscreen && (
        <FullscreenCountdown
          event={event}
          target={target}
          breakdown={breakdown}
          visibleUnits={visibleUnits}
          soundOn={soundOn}
          onToggleSound={() => setSoundOn((current) => !current)}
          onClose={() => setIsFullscreen(false)}
        />
      )}
    </>
  );
}

export default function EventCountdown() {
  const [events, setEvents] = useState<CountdownEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [thumbnailMode, setThumbnailMode] = useState<
    "none" | "url" | "upload"
  >("none");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [uploadedThumbnail, setUploadedThumbnail] = useState<
    string | null
  >(null);
  const [uploadError, setUploadError] = useState<string | null>(
    null,
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load once on mount (client only — localStorage doesn't
  // exist during server render).
  useEffect(() => {
    setEvents(loadEvents());
    setLoaded(true);
  }, []);

  // Persist any time the list changes, after the initial load.
  useEffect(() => {
    if (loaded) {
      saveEvents(events);
    }
  }, [events, loaded]);

  function resetForm() {
    setTitle("");
    setTargetDate("");
    setThumbnailMode("none");
    setThumbnailUrl("");
    setUploadedThumbnail(null);
    setUploadError(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleFilePick(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(
        "Image too large — please use one under 400KB, or use an Image URL instead.",
      );
      return;
    }

    setUploadError(null);

    try {
      const dataUrl = await fileToDataUrl(file);
      setUploadedThumbnail(dataUrl);
    } catch (err) {
      setUploadError("Couldn't read that image, please try another.");
    }
  }

  function handleAddEvent() {
    if (!title.trim() || !targetDate) {
      return;
    }

    const thumbnail =
      thumbnailMode === "url"
        ? thumbnailUrl.trim() || null
        : thumbnailMode === "upload"
          ? uploadedThumbnail
          : null;

    const newEvent: CountdownEvent = {
      id: makeId(),
      title: title.trim(),
      targetDate: new Date(targetDate).toISOString(),
      thumbnailUrl: thumbnail,
    };

    setEvents((current) =>
      [...current, newEvent].sort(
        (a, b) =>
          new Date(a.targetDate).getTime() -
          new Date(b.targetDate).getTime(),
      ),
    );

    resetForm();
    setShowForm(false);
  }

  function handleDelete(id: string) {
    setEvents((current) => current.filter((e) => e.id !== id));
  }

  return (
    <section className="mt-10">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-white/30">
            Saved locally on this device
          </p>

          <h3 className="mt-1 text-xl font-semibold">
            Event Countdown
          </h3>
        </div>

        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90"
        >
          + Add Event
        </button>
      </div>

      {events.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
          <p className="text-sm text-white/40">
            No events yet. Add one to start the countdown.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-3">
          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* ADD EVENT MODAL */}
      {showForm && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => {
            setShowForm(false);
            resetForm();
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#11111a] p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">New Event</h2>

              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10"
              >
                ✕
              </button>
            </div>

            {/* TITLE */}
            <div className="mt-5">
              <label className="mb-1.5 block text-xs font-semibold text-white/50">
                Title
              </label>

              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Graduation Day"
                className="h-11 w-full rounded-xl border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-purple-400/60"
              />
            </div>

            {/* DATE + TIME */}
            <div className="mt-4">
              <label className="mb-1.5 block text-xs font-semibold text-white/50">
                Target Date &amp; Time
              </label>

              <input
                type="datetime-local"
                value={targetDate}
                onChange={(event) =>
                  setTargetDate(event.target.value)
                }
                className="h-11 w-full rounded-xl border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-purple-400/60"
              />
            </div>

            {/* THUMBNAIL (optional) */}
            <div className="mt-4">
              <label className="mb-1.5 block text-xs font-semibold text-white/50">
                Thumbnail (optional)
              </label>

              <div className="flex gap-2">
                {(
                  [
                    { id: "none", label: "None" },
                    { id: "url", label: "Image URL" },
                    { id: "upload", label: "Upload" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setThumbnailMode(option.id)}
                    className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
                      thumbnailMode === option.id
                        ? "bg-white text-black"
                        : "border border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {thumbnailMode === "url" && (
                <input
                  value={thumbnailUrl}
                  onChange={(event) =>
                    setThumbnailUrl(event.target.value)
                  }
                  placeholder="https://..."
                  className="mt-3 h-11 w-full rounded-xl border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-purple-400/60"
                />
              )}

              {thumbnailMode === "upload" && (
                <div className="mt-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFilePick}
                    className="block w-full text-xs text-white/60 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-white/20"
                  />

                  <p className="mt-1.5 text-[11px] text-white/30">
                    Stored on this device only. Keep it under 400KB.
                  </p>

                  {uploadError && (
                    <p className="mt-1.5 text-[11px] text-red-400">
                      {uploadError}
                    </p>
                  )}

                  {uploadedThumbnail && (
                    <img
                      src={uploadedThumbnail}
                      alt="Preview"
                      className="mt-2 h-20 w-full rounded-lg object-cover"
                    />
                  )}
                </div>
              )}
            </div>

            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="h-11 flex-1 rounded-xl border border-white/10 bg-white/5 font-semibold text-white transition hover:bg-white/10"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={!title.trim() || !targetDate}
                onClick={handleAddEvent}
                className="h-11 flex-1 rounded-xl bg-white font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}