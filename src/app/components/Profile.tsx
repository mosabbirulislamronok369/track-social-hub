"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AgeBreakdown,
  Profile as ProfileType,
  WatchedItem,
  computeAge,
  fetchProfile,
  fetchWatchedContent,
  formatAge,
  saveProfile,
  uploadAvatar,
} from "../lib/profile";

function formatWatchTime(totalSeconds: number) {
  const seconds = Math.max(
    0,
    Math.floor(Number(totalSeconds) || 0),
  );

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(
    (seconds % 3600) / 60,
  );

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${seconds}s`;
}

function formatPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0%";
  }

  if (value < 0.01) {
    return `${value.toFixed(4)}%`;
  }

  if (value < 1) {
    return `${value.toFixed(3)}%`;
  }

  return `${value.toFixed(2)}%`;
}

/*
 * Circular "goal chart" showing what fraction of the
 * person's life has been spent watching things.
 */
function GoalRing({
  percent,
}: {
  percent: number;
}) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  const clamped = Math.min(
    100,
    Math.max(0, percent),
  );

  const offset =
    circumference -
    (clamped / 100) * circumference;

  return (
    <div className="relative flex h-32 w-32 shrink-0 items-center justify-center">
      <svg
        viewBox="0 0 120 120"
        className="h-32 w-32 -rotate-90"
      >
        <circle
          cx="60"
          cy="60"
          r={radius}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="10"
          fill="none"
        />

        <circle
          cx="60"
          cy="60"
          r={radius}
          stroke="url(#goalRingGradient)"
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition:
              "stroke-dashoffset 0.6s ease",
          }}
        />

        <defs>
          <linearGradient
            id="goalRingGradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop
              offset="0%"
              stopColor="#a855f7"
            />
            <stop
              offset="100%"
              stopColor="#ec4899"
            />
          </linearGradient>
        </defs>
      </svg>

      <div className="absolute flex flex-col items-center">
        <span className="text-lg font-bold text-white">
          {formatPercent(percent)}
        </span>

        <span className="text-[10px] uppercase tracking-wider text-white/40">
          of life
        </span>
      </div>
    </div>
  );
}

export default function Profile() {
  const [profile, setProfile] =
    useState<ProfileType | null>(null);

  const [loading, setLoading] = useState(true);

  const [watchedItems, setWatchedItems] =
    useState<WatchedItem[]>([]);

  const [watchedLoading, setWatchedLoading] =
    useState(true);

  const [now, setNow] = useState(() => new Date());

  const [editing, setEditing] = useState(false);

  const [saving, setSaving] = useState(false);

  const [uploadingAvatar, setUploadingAvatar] =
    useState(false);

  const [formName, setFormName] = useState("");
  const [formBio, setFormBio] = useState("");
  const [formDob, setFormDob] = useState("");
  const [
    formAvatarUrl,
    setFormAvatarUrl,
  ] = useState<string | null>(null);

  const fileInputRef =
    useRef<HTMLInputElement | null>(null);

  /*
   * Load profile + watched content.
   */
  const loadProfile = useCallback(async () => {
    setLoading(true);

    const data = await fetchProfile();

    setProfile(data);
    setLoading(false);
  }, []);

  const loadWatched = useCallback(async () => {
    setWatchedLoading(true);

    const items = await fetchWatchedContent();

    setWatchedItems(items);
    setWatchedLoading(false);
  }, []);

  useEffect(() => {
    loadProfile();
    loadWatched();
  }, [loadProfile, loadWatched]);

  /*
   * Live-ticking clock for the age display.
   */
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  function openEditor() {
    setFormName(profile?.name || "");
    setFormBio(profile?.bio || "");
    setFormDob(profile?.date_of_birth || "");
    setFormAvatarUrl(
      profile?.avatar_url || null,
    );
    setEditing(true);
  }

  async function handleAvatarPick(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setUploadingAvatar(true);

    try {
      const url = await uploadAvatar(file);

      setFormAvatarUrl(url);
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Failed to upload photo.",
      );
    } finally {
      setUploadingAvatar(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleSave() {
    setSaving(true);

    try {
      await saveProfile({
        name: formName.trim() || null,
        bio: formBio.trim() || null,
        date_of_birth: formDob || null,
        avatar_url: formAvatarUrl,
      });

      await loadProfile();

      setEditing(false);
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Failed to save profile.",
      );
    } finally {
      setSaving(false);
    }
  }

  const birthDate = useMemo(() => {
    if (!profile?.date_of_birth) {
      return null;
    }

    const parsed = new Date(
      `${profile.date_of_birth}T00:00:00`,
    );

    return Number.isNaN(parsed.getTime())
      ? null
      : parsed;
  }, [profile?.date_of_birth]);

  const age: AgeBreakdown | null = useMemo(() => {
    if (!birthDate) {
      return null;
    }

    return computeAge(birthDate, now);
  }, [birthDate, now]);

  const totalWatchSeconds = useMemo(() => {
    return watchedItems.reduce(
      (sum, item) => sum + item.totalSeconds,
      0,
    );
  }, [watchedItems]);

  const lifePercentWatched = useMemo(() => {
    if (!age || age.totalSeconds <= 0) {
      return 0;
    }

    return (
      (totalWatchSeconds / age.totalSeconds) *
      100
    );
  }, [age, totalWatchSeconds]);

  if (loading) {
    return (
      <section className="mx-auto w-full max-w-4xl px-4 py-10 text-white">
        <p className="text-white/40">
          Loading profile...
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-10 text-white">
      {/* HEADER CARD */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-5">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full border border-white/10 bg-black">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={
                    profile.name || "Profile"
                  }
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-white/30">
                  {(
                    profile?.name?.[0] || "U"
                  ).toUpperCase()}
                </div>
              )}
            </div>

            <div>
              <h1 className="text-2xl font-bold">
                {profile?.name || "Unnamed"}
              </h1>

              {age ? (
                <p className="mt-1 font-mono text-sm text-purple-300">
                  {formatAge(age)}
                </p>
              ) : (
                <p className="mt-1 text-sm text-white/40">
                  Add your date of birth to see
                  your age here.
                </p>
              )}

              <p className="mt-2 text-sm text-white/50">
                Total watch time:{" "}
                <span className="font-semibold text-white/80">
                  {watchedLoading
                    ? "..."
                    : formatWatchTime(
                        totalWatchSeconds,
                      )}
                </span>
              </p>

              {profile?.bio && (
                <p className="mt-3 max-w-md text-sm text-white/60">
                  {profile.bio}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            {age && (
              <GoalRing
                percent={lifePercentWatched}
              />
            )}

            <button
              type="button"
              onClick={openEditor}
              className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Edit Profile
            </button>
          </div>
        </div>
      </div>

      {age && (
        <p className="mt-3 text-center text-xs text-white/40 sm:text-left">
          You've spent{" "}
          <span className="font-semibold text-purple-300">
            {formatPercent(lifePercentWatched)}
          </span>{" "}
          of your life watching things.
        </p>
      )}

      {/* WATCHED CONTENT */}
      <div className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">
            Watched Content
          </h2>

          <span className="text-xs text-white/40">
            {watchedItems.length} items
          </span>
        </div>

        {watchedLoading && (
          <p className="text-white/40">
            Loading watched content...
          </p>
        )}

        {!watchedLoading &&
          watchedItems.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
              <p className="font-semibold">
                Nothing watched yet
              </p>

              <p className="mt-2 text-sm text-white/40">
                Mark something as Completed in
                Browse or Anime to see it here.
              </p>
            </div>
          )}

        {!watchedLoading &&
          watchedItems.length > 0 && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {watchedItems.map((item) => (
                <div
                  key={item.contentId}
                  className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]"
                >
                  <div className="aspect-[2/3] w-full bg-black">
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-white/30">
                        No Image
                      </div>
                    )}
                  </div>

                  <div className="p-2.5">
                    <p className="line-clamp-2 text-xs font-semibold leading-4">
                      {item.title}
                    </p>

                    <p className="mt-1.5 text-[11px] text-white/40">
                      {item.category} ·{" "}
                      {formatWatchTime(
                        item.totalSeconds,
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* EDIT MODAL */}
      {editing && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setEditing(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#11111a] p-6 shadow-2xl"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">
                Edit Profile
              </h2>

              <button
                type="button"
                onClick={() => setEditing(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10"
              >
                ✕
              </button>
            </div>

            {/* AVATAR */}
            <div className="mt-5 flex items-center gap-4">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-white/10 bg-black">
                {formAvatarUrl ? (
                  <img
                    src={formAvatarUrl}
                    alt="Avatar preview"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-lg font-bold text-white/30">
                    {(
                      formName?.[0] || "U"
                    ).toUpperCase()}
                  </div>
                )}
              </div>

              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarPick}
                />

                <button
                  type="button"
                  disabled={uploadingAvatar}
                  onClick={() =>
                    fileInputRef.current?.click()
                  }
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
                >
                  {uploadingAvatar
                    ? "Uploading..."
                    : "Change Photo"}
                </button>
              </div>
            </div>

            {/* NAME */}
            <div className="mt-5">
              <label className="mb-1.5 block text-xs font-semibold text-white/50">
                Name
              </label>

              <input
                value={formName}
                onChange={(event) =>
                  setFormName(
                    event.target.value,
                  )
                }
                placeholder="Your name"
                className="h-11 w-full rounded-xl border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-purple-400/60"
              />
            </div>

            {/* BIO */}
            <div className="mt-4">
              <label className="mb-1.5 block text-xs font-semibold text-white/50">
                Bio
              </label>

              <textarea
                value={formBio}
                onChange={(event) =>
                  setFormBio(
                    event.target.value,
                  )
                }
                placeholder="A short bio..."
                rows={3}
                className="w-full resize-none rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-purple-400/60"
              />
            </div>

            {/* DATE OF BIRTH */}
            <div className="mt-4">
              <label className="mb-1.5 block text-xs font-semibold text-white/50">
                Date of Birth
              </label>

              <input
                type="date"
                value={formDob}
                onChange={(event) =>
                  setFormDob(
                    event.target.value,
                  )
                }
                className="h-11 w-full rounded-xl border border-white/10 bg-black px-3 text-sm text-white outline-none focus:border-purple-400/60"
              />
            </div>

            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="h-11 flex-1 rounded-xl border border-white/10 bg-white/5 font-semibold text-white transition hover:bg-white/10"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={
                  saving || uploadingAvatar
                }
                onClick={handleSave}
                className="h-11 flex-1 rounded-xl bg-white font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}