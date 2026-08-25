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
  GroupedProfileWatchlist,
  Profile as ProfileType,
  ProfileWatchStatus,
  WatchedItem,
  computeAge,
  fetchGroupedProfileWatchlist,
  fetchProfile,
  fetchWatchedContent,
  formatAge,
  saveProfile,
  uploadAvatar,
} from "../lib/profile";

const STATUS_TABS: { id: ProfileWatchStatus; label: string }[] = [
  { id: "watching", label: "Watching" },
  { id: "on_hold", label: "Hold" },
  { id: "completed", label: "Completed" },
  { id: "dropped", label: "Dropped" },
];

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

/*
 * Colors match the WatchCategory palette used elsewhere in
 * the app (Dashboard cards, WatchEngine's category prop).
 */
const CATEGORY_COLORS: Record<string, string> = {
  Anime: "#a855f7",
  TV: "#3b82f6",
  Movies: "#ec4899",
  YouTube: "#ef4444",
  Social: "#22c55e",
  Private: "#6b7280",
};

const FALLBACK_SLICE_COLOR = "#94a3b8";

/*
 * Pie chart showing what percentage of total watch time went
 * to each content category (Anime / TV / Movies / YouTube /
 * etc). Pure SVG — one <path> arc per category, no charting
 * library needed.
 */
function CategoryPieChart({
  data,
}: {
  data: { category: string; seconds: number }[];
}) {
  const total = data.reduce((sum, d) => sum + d.seconds, 0);

  if (total <= 0) {
    return (
      <div className="flex h-36 w-36 shrink-0 items-center justify-center rounded-full border border-dashed border-white/10 text-center text-xs text-white/30">
        No watch data yet
      </div>
    );
  }

  const cx = 60;
  const cy = 60;
  const r = 55;

  const nonZero = data.filter((d) => d.seconds > 0);

  // A single category at 100% degenerates the arc math below
  // (start point === end point), so just draw a full circle.
  if (nonZero.length === 1) {
    const only = nonZero[0];

    return (
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <svg viewBox="0 0 120 120" className="h-36 w-36 shrink-0">
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill={
              CATEGORY_COLORS[only.category] ||
              FALLBACK_SLICE_COLOR
            }
          />
        </svg>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{
                backgroundColor:
                  CATEGORY_COLORS[only.category] ||
                  FALLBACK_SLICE_COLOR,
              }}
            />
            <span className="text-white/70">
              {only.category}
            </span>
            <span className="font-semibold text-white/90">
              100%
            </span>
          </div>
        </div>
      </div>
    );
  }

  let cumulativeAngle = -90; // start at 12 o'clock

  const slices = data
    .filter((d) => d.seconds > 0)
    .map((d) => {
      const percent = (d.seconds / total) * 100;
      const angle = (d.seconds / total) * 360;

      const startAngle = cumulativeAngle;
      const endAngle = cumulativeAngle + angle;
      cumulativeAngle = endAngle;

      const largeArc = angle > 180 ? 1 : 0;

      const startRad = (startAngle * Math.PI) / 180;
      const endRad = (endAngle * Math.PI) / 180;

      const x1 = cx + r * Math.cos(startRad);
      const y1 = cy + r * Math.sin(startRad);
      const x2 = cx + r * Math.cos(endRad);
      const y2 = cy + r * Math.sin(endRad);

      const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;

      return {
        category: d.category,
        percent,
        path,
        color:
          CATEGORY_COLORS[d.category] || FALLBACK_SLICE_COLOR,
      };
    });

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <svg viewBox="0 0 120 120" className="h-36 w-36 shrink-0">
        {slices.map((slice) => (
          <path
            key={slice.category}
            d={slice.path}
            fill={slice.color}
            stroke="#0a0a12"
            strokeWidth="1.5"
          />
        ))}
      </svg>

      <div className="flex flex-col gap-2">
        {slices.map((slice) => (
          <div
            key={slice.category}
            className="flex items-center gap-2 text-sm"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: slice.color }}
            />
            <span className="text-white/70">
              {slice.category}
            </span>
            <span className="font-semibold text-white/90">
              {slice.percent.toFixed(1)}%
            </span>
          </div>
        ))}
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

  const [groupedWatchlist, setGroupedWatchlist] =
    useState<GroupedProfileWatchlist | null>(null);

  const [watchlistLoading, setWatchlistLoading] =
    useState(true);

  const [activeStatusTab, setActiveStatusTab] =
    useState<ProfileWatchStatus>("watching");

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

  /*
   * ONE query for Watching/Hold/Completed/Dropped, grouped
   * client-side (see fetchGroupedProfileWatchlist). Switching
   * tabs below only reads from this already-fetched state —
   * it never fires another Supabase call.
   */
  const loadGroupedWatchlist = useCallback(async () => {
    setWatchlistLoading(true);

    const grouped = await fetchGroupedProfileWatchlist();

    setGroupedWatchlist(grouped);
    setWatchlistLoading(false);
  }, []);

  useEffect(() => {
    loadProfile();
    loadWatched();
    loadGroupedWatchlist();
  }, [loadProfile, loadWatched, loadGroupedWatchlist]);

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

  /*
   * Groups watched content by category and sums watch time
   * per category, for the "what have I watched most" pie
   * chart. Sorted so the biggest slice comes first (both for
   * the legend and so the pie starts big-to-small at 12
   * o'clock).
   */
  const categoryBreakdown = useMemo(() => {
    const totals = new Map<string, number>();

    watchedItems.forEach((item) => {
      totals.set(
        item.category,
        (totals.get(item.category) || 0) + item.totalSeconds,
      );
    });

    return Array.from(totals.entries())
      .map(([category, seconds]) => ({ category, seconds }))
      .sort((a, b) => b.seconds - a.seconds);
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

      {/* CATEGORY BREAKDOWN PIE CHART */}
      {!watchedLoading && categoryBreakdown.length > 0 && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="mb-5 text-lg font-bold">
            Watch Breakdown
          </h2>

          <CategoryPieChart data={categoryBreakdown} />
        </div>
      )}

      {/* WATCHING / HOLD / COMPLETED / DROPPED */}
      <div className="mt-10">
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-1">
          {STATUS_TABS.map((tab) => {
            const count =
              groupedWatchlist?.[tab.id].length ?? 0;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveStatusTab(tab.id)}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
                  activeStatusTab === tab.id
                    ? "bg-white text-black"
                    : "text-white/50 hover:text-white/80"
                }`}
              >
                {tab.label}
                {count > 0 ? ` (${count})` : ""}
              </button>
            );
          })}
        </div>

        {watchlistLoading && (
          <p className="text-white/40">Loading...</p>
        )}

        {!watchlistLoading &&
          (groupedWatchlist?.[activeStatusTab].length ?? 0) ===
            0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
              <p className="text-sm text-white/40">
                Nothing in{" "}
                {
                  STATUS_TABS.find(
                    (tab) => tab.id === activeStatusTab,
                  )?.label
                }{" "}
                yet.
              </p>
            </div>
          )}

        {!watchlistLoading &&
          (groupedWatchlist?.[activeStatusTab].length ?? 0) >
            0 && (
            <div className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
              {groupedWatchlist![activeStatusTab].map(
                (item) => (
                  <div
                    key={item.contentId}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {item.imageUrl && (
                        <img
                          src={item.imageUrl}
                          alt={item.title}
                          className="h-12 w-9 shrink-0 rounded object-cover"
                        />
                      )}

                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {item.title}
                        </p>

                        <p className="mt-0.5 text-xs text-white/40">
                          {item.category}
                        </p>
                      </div>
                    </div>

                    {item.currentEpisode != null &&
                    item.totalEpisodes ? (
                      <span className="shrink-0 text-xs font-semibold text-white/60">
                        {item.currentEpisode}/
                        {item.totalEpisodes} ep
                      </span>
                    ) : null}
                  </div>
                ),
              )}
            </div>
          )}
      </div>

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
            <div className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
              {watchedItems.map((item) => (
                <div
                  key={item.contentId}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {item.title}
                    </p>

                    <p className="mt-0.5 text-xs text-white/40">
                      {item.category}
                    </p>
                  </div>

                  <span className="shrink-0 text-xs font-semibold text-white/60">
                    {formatWatchTime(item.totalSeconds)}
                  </span>
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