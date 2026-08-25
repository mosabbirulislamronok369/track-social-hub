"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { supabase } from "../lib/supabase";

type PrivateStatus =
  | "watching"
  | "hold"
  | "dropped"
  | "completed";

type PrivateItem = {
  id: string;
  title: string;
  runtimeMinutes: number;
  watchedSeconds: number;
  status: PrivateStatus;
  createdAt: string;
  totalWatchSeconds: number;
};

const STORAGE_KEY =
  "track_social_hub_private_watchlist_v1";

function formatTime(totalSeconds: number) {
  const seconds = Math.max(
    0,
    Math.floor(Number(totalSeconds || 0)),
  );

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(
    (seconds % 3600) / 60,
  );

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h`;
  }

  return `${minutes}m`;
}

/*
 * Supabase/Postgrest errors are plain objects ({ message,
 * details, hint, code }) — NOT instances of the native Error
 * class. `error instanceof Error` is always false for them,
 * so code that only checked that missed the real reason a
 * query failed (RLS policy, check constraint, bad column,
 * etc.) and always fell back to a generic message instead.
 * This checks both shapes so the actual message reaches the
 * user.
 */
function getErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message ===
      "string"
  ) {
    return (error as { message: string }).message;
  }

  return fallback;
}

function getStoredItems(): PrivateItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((item) => ({
      ...item,
      watchedSeconds: Number(
        item.watchedSeconds || 0,
      ),
      totalWatchSeconds: Number(
        item.totalWatchSeconds || 0,
      ),
      status:
        item.status || "watching",
    }));
  } catch {
    return [];
  }
}

function saveStoredItems(items: PrivateItem[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(items),
    );
  } catch {
    // Ignore localStorage errors.
  }
}

function statusLabel(status: PrivateStatus) {
  switch (status) {
    case "watching":
      return "Watching";

    case "hold":
      return "Hold";

    case "dropped":
      return "Dropped";

    case "completed":
      return "Completed";

    default:
      return "Watching";
  }
}

function statusClass(status: PrivateStatus) {
  switch (status) {
    case "watching":
      return "text-blue-300 bg-blue-500/10 border-blue-400/20";

    case "hold":
      return "text-yellow-300 bg-yellow-500/10 border-yellow-400/20";

    case "dropped":
      return "text-red-300 bg-red-500/10 border-red-400/20";

    case "completed":
      return "text-emerald-300 bg-emerald-500/10 border-emerald-400/20";

    default:
      return "text-white/60 bg-white/5 border-white/10";
  }
}

export default function PrivateWatchlist() {
  const [items, setItems] = useState<PrivateItem[]>([]);
  const [title, setTitle] = useState("");
  const [runtime, setRuntime] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [openMenuId, setOpenMenuId] =
    useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement | null>(
    null,
  );

  /*
   * Load old localStorage data first.
   */
  useEffect(() => {
    setItems(getStoredItems());
  }, []);

  /*
   * Close 3-dot menu when clicking outside.
   */
  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(
          event.target as Node,
        )
      ) {
        setOpenMenuId(null);
      }
    }

    document.addEventListener(
      "mousedown",
      handleOutsideClick,
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        handleOutsideClick,
      );
    };
  }, []);

  /*
   * Get current logged-in user.
   */
  const getUser = useCallback(async () => {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      throw error;
    }

    if (!user) {
      throw new Error(
        "Please login before using Private Watchlist.",
      );
    }

    return user;
  }, []);

  /*
   * Find the private watch session.
   */
  const getPrivateSession = useCallback(
    async (itemId: string) => {
      const user = await getUser();

      const contentId = `private:${itemId}`;

      const { data, error } = await supabase
        .from("watch_sessions")
        .select(
          "id,total_seconds,content_id,category,is_active",
        )
        .eq("user_id", user.id)
        .eq("content_id", contentId)
        .eq("category", "Private")
        .order("created_at", {
          ascending: false,
        })
        .limit(1);

      if (error) {
        throw error;
      }

      return {
        user,
        contentId,
        session: data?.[0] || null,
      };
    },
    [getUser],
  );

  /*
   * Add seconds to Private total watch time.
   */
  const addSecondsToWatchSession = useCallback(
    async (
      item: PrivateItem,
      secondsToAdd: number,
    ) => {
      if (secondsToAdd <= 0) {
        return 0;
      }

      const {
        user,
        contentId,
        session,
      } = await getPrivateSession(item.id);

      if (session) {
        const currentSeconds = Number(
          session.total_seconds || 0,
        );

        const finalSeconds =
          currentSeconds + secondsToAdd;

        const { error } = await supabase
          .from("watch_sessions")
          .update({
            total_seconds: finalSeconds,
            is_active: false,
            last_heartbeat:
              new Date().toISOString(),
          })
          .eq("id", session.id)
          .eq("user_id", user.id);

        if (error) {
          throw error;
        }

        return finalSeconds;
      }

      const now = new Date().toISOString();

      const { error } = await supabase
        .from("watch_sessions")
        .insert({
          user_id: user.id,
          content_id: contentId,
          started_at: now,
          last_heartbeat: now,
          is_active: false,
          total_seconds: secondsToAdd,
          category: "Private",
        });

      if (error) {
        throw error;
      }

      return secondsToAdd;
    },
    [getPrivateSession],
  );

  /*
   * Get current total watch seconds.
   */
  const getTotalWatchSeconds = useCallback(
    async (item: PrivateItem) => {
      const { session } =
        await getPrivateSession(item.id);

      return Number(
        session?.total_seconds || 0,
      );
    },
    [getPrivateSession],
  );

  /*
   * Add new Private item.
   */
  async function handleAdd() {
    setMessage("");

    const cleanTitle = title.trim();

    const runtimeMinutes = Number(runtime);

    if (!cleanTitle) {
      setMessage("Please enter a title.");
      return;
    }

    if (
      !Number.isFinite(runtimeMinutes) ||
      runtimeMinutes <= 0
    ) {
      setMessage(
        "Runtime must be greater than 0 minutes.",
      );
      return;
    }

    if (runtimeMinutes > 100000) {
      setMessage("Runtime is too large.");
      return;
    }

    setSaving(true);

    try {
      const user = await getUser();

      const runtimeSeconds =
        Math.floor(runtimeMinutes * 60);

      const now = new Date().toISOString();

      /*
       * Save to Supabase private_watchlist.
       */
      const { data, error } = await supabase
        .from("private_watchlist")
        .insert({
          user_id: user.id,
          title: cleanTitle,
          runtime_seconds: runtimeSeconds,
          watched_seconds: 0,
          status: "watching",
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      const newItem: PrivateItem = {
        id: data.id,
        title: cleanTitle,
        runtimeMinutes,
        watchedSeconds: 0,
        status: "watching",
        createdAt: now,
        totalWatchSeconds: 0,
      };

      const nextItems = [
        newItem,
        ...items,
      ];

      setItems(nextItems);

      saveStoredItems(nextItems);

      setTitle("");
      setRuntime("");

      setMessage(
        `${cleanTitle} added to Private Watchlist.`,
      );

      window.dispatchEvent(
        new CustomEvent(
          "private-watch-time-changed",
        ),
      );
    } catch (error) {
      console.error(
        "Failed to add private content:",
        error,
      );

      setMessage(
        getErrorMessage(
          error,
          "Failed to save private content.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  /*
   * Change status.
   */
  async function updateStatus(
    item: PrivateItem,
    status: PrivateStatus,
  ) {
    setMessage("");
    setOpenMenuId(null);

    try {
      const user = await getUser();

      /*
       * Completed:
       * Add ONLY the remaining time.
       *
       * Example:
       * Runtime = 60 min
       * Already watched = 20 min
       * Complete = +40 min
       *
       * So total becomes exactly 60 min.
       */
      if (status === "completed") {
        const runtimeSeconds =
          Math.floor(
            Number(item.runtimeMinutes || 0) * 60,
          );

        const watchedSeconds = Math.min(
          runtimeSeconds,
          Math.max(
            0,
            Number(item.watchedSeconds || 0),
          ),
        );

        const remainingSeconds =
          Math.max(
            0,
            runtimeSeconds - watchedSeconds,
          );

        if (remainingSeconds > 0) {
          await addSecondsToWatchSession(
            item,
            remainingSeconds,
          );
        }

        const totalSeconds =
          await getTotalWatchSeconds(item);

        const userNow =
          new Date().toISOString();

        const { error } = await supabase
          .from("private_watchlist")
          .update({
            watched_seconds: runtimeSeconds,
            status: "completed",
            updated_at: userNow,
          })
          .eq("id", item.id)
          .eq("user_id", user.id);

        if (error) {
          throw error;
        }

        const nextItems = items.map(
          (current) =>
            current.id === item.id
              ? {
                  ...current,
                  watchedSeconds:
                    runtimeSeconds,
                  status: "completed" as const,
                  totalWatchSeconds:
                    totalSeconds,
                }
              : current,
        );

        setItems(nextItems);
        saveStoredItems(nextItems);

        setMessage(
          `${item.title} completed. ${formatTime(
            remainingSeconds,
          )} added to total watch time.`,
        );

        window.dispatchEvent(
          new CustomEvent(
            "private-watch-time-changed",
          ),
        );

        return;
      }

      /*
       * Normal status update:
       * Watching / Hold / Dropped
       */
      const userNow =
        new Date().toISOString();

      const { error } = await supabase
        .from("private_watchlist")
        .update({
          status,
          updated_at: userNow,
        })
        .eq("id", item.id)
        .eq("user_id", user.id);

      if (error) {
        throw error;
      }

      const nextItems = items.map(
        (current) =>
          current.id === item.id
            ? {
                ...current,
                status,
              }
            : current,
      );

      setItems(nextItems);
      saveStoredItems(nextItems);

      setMessage(
        `${item.title} → ${statusLabel(status)}`,
      );
    } catch (error) {
      console.error(
        "Failed to update private status:",
        error,
      );

      setMessage(
        getErrorMessage(
          error,
          "Failed to update status.",
        ),
      );
    }
  }

  /*
   * Rewatch +1
   *
   * Every Rewatch click:
   *
   * Runtime 60m
   *
   * First completion:
   * total = 60m
   * rewatched = 0
   *
   * Rewatch:
   * total = 120m
   * rewatched = 1
   *
   * Rewatch again:
   * total = 180m
   * rewatched = 2
   */
  async function handleRewatch(
    item: PrivateItem,
  ) {
    setMessage("");
    setOpenMenuId(null);

    try {
      const user = await getUser();

      const runtimeSeconds =
        Math.floor(
          Number(item.runtimeMinutes || 0) * 60,
        );

      if (runtimeSeconds <= 0) {
        throw new Error(
          "Runtime must be greater than 0.",
        );
      }

      /*
       * Add one full runtime.
       */
      const totalSeconds =
        await addSecondsToWatchSession(
          item,
          runtimeSeconds,
        );

      /*
       * Rewatch starts from zero watched progress
       * but the historical total time remains.
       */
      const { error } = await supabase
        .from("private_watchlist")
        .update({
          watched_seconds: 0,
          status: "watching",
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", item.id)
        .eq("user_id", user.id);

      if (error) {
        throw error;
      }

      const rewatchCount = Math.max(
        0,
        Math.floor(
          totalSeconds / runtimeSeconds,
        ) - 1,
      );

      const nextItems = items.map(
        (current) =>
          current.id === item.id
            ? {
                ...current,
                watchedSeconds: 0,
                status:
                  "watching" as const,
                totalWatchSeconds:
                  totalSeconds,
              }
            : current,
      );

      setItems(nextItems);
      saveStoredItems(nextItems);

      setMessage(
        `${item.title} rewatched +1. Rewatched ${rewatchCount} time${
          rewatchCount === 1
            ? ""
            : "s"
        }. Total: ${formatTime(
          totalSeconds,
        )}.`,
      );

      window.dispatchEvent(
        new CustomEvent(
          "private-watch-time-changed",
        ),
      );
    } catch (error) {
      console.error(
        "Failed to rewatch private content:",
        error,
      );

      setMessage(
        getErrorMessage(
          error,
          "Failed to rewatch content.",
        ),
      );
    }
  }

  /*
   * Actual delete.
   */
  async function removeItem(
    item: PrivateItem,
  ) {
    setMessage("");
    setOpenMenuId(null);

    try {
      const user = await getUser();

      const { error } = await supabase
        .from("private_watchlist")
        .delete()
        .eq("id", item.id)
        .eq("user_id", user.id);

      if (error) {
        throw error;
      }

      const nextItems = items.filter(
        (current) =>
          current.id !== item.id,
      );

      setItems(nextItems);
      saveStoredItems(nextItems);

      setMessage(
        `${item.title} removed from Private Watchlist.`,
      );
    } catch (error) {
      console.error(
        "Failed to remove private item:",
        error,
      );

      setMessage(
        getErrorMessage(
          error,
          "Failed to remove item.",
        ),
      );
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.04] p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-white/40">
            Track your personal content
          </p>

          <h2 className="mt-1 text-2xl font-bold">
            Private
          </h2>
        </div>

        <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/60">
          {items.length}{" "}
          {items.length === 1
            ? "item"
            : "items"}
        </div>
      </div>

      {/* Add Private Content */}
      <div className="mt-6 rounded-2xl border border-white/10 bg-black/10 p-5">
        <h3 className="text-lg font-semibold">
          Add Private Content
        </h3>

        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_180px_auto]">
          <input
            type="text"
            value={title}
            onChange={(event) =>
              setTitle(event.target.value)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleAdd();
              }
            }}
            placeholder="e.g. My Course, Movie, Book..."
            className="h-12 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
          />

          <input
            type="number"
            min="1"
            value={runtime}
            onChange={(event) =>
              setRuntime(event.target.value)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleAdd();
              }
            }}
            placeholder="Runtime (min)"
            className="h-12 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/20"
          />

          <button
            type="button"
            onClick={handleAdd}
            disabled={saving}
            className="h-12 rounded-xl bg-white px-6 font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving
              ? "Saving..."
              : "+ Add"}
          </button>
        </div>

        {message && (
          <p className="mt-3 text-sm text-emerald-300">
            {message}
          </p>
        )}

        <p className="mt-3 text-xs text-white/30">
          Use the ⋮ menu on each item to change
          status, complete, rewatch, or remove it.
        </p>
      </div>

      {/* Watchlist */}
      <div className="mt-7">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            Private Watchlist
          </h3>

          <span className="text-xs text-white/30">
            {items.length} items
          </span>
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
            <p className="text-sm text-white/40">
              No private content yet.
            </p>

            <p className="mt-1 text-xs text-white/25">
              Add something above to start your
              private watchlist.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const runtimeSeconds =
                Math.max(
                  1,
                  Math.floor(
                    item.runtimeMinutes * 60,
                  ),
                );

              const totalSeconds =
                Math.max(
                  0,
                  Number(
                    item.totalWatchSeconds ||
                      0,
                  ),
                );

              /*
               * Rewatch count is calculated from
               * total historical watch time.
               */
              const rewatchCount = Math.max(
                0,
                Math.floor(
                  totalSeconds /
                    runtimeSeconds,
                ) - 1,
              );

              const progress =
                Math.min(
                  100,
                  Math.round(
                    (Number(
                      item.watchedSeconds ||
                        0,
                    ) /
                      runtimeSeconds) *
                      100,
                  ),
                );

              return (
                <div
                  key={item.id}
                  className="relative rounded-2xl border border-white/10 bg-white/[0.025] p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate font-semibold">
                        {item.title}
                      </h4>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(
                            item.status,
                          )}`}
                        >
                          {statusLabel(
                            item.status,
                          )}
                        </span>

                        <span className="text-xs text-white/35">
                          Runtime:{" "}
                          {item.runtimeMinutes}m
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/40">
                        <span>
                          Watched:{" "}
                          {formatTime(
                            item.watchedSeconds,
                          )}
                        </span>

                        <span>
                          Total:{" "}
                          {formatTime(
                            totalSeconds,
                          )}
                        </span>

                        <span className="text-purple-300/80">
                          Rewatched:{" "}
                          {rewatchCount}
                        </span>
                      </div>

                      {/* Progress */}
                      <div className="mt-3">
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                          <div
                            className="h-full rounded-full bg-emerald-400 transition-all"
                            style={{
                              width: `${progress}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* 3-dot menu */}
                    <div
                      ref={
                        openMenuId === item.id
                          ? menuRef
                          : undefined
                      }
                      className="relative shrink-0"
                    >
                      <button
                        type="button"
                        aria-label={`Actions for ${item.title}`}
                        aria-expanded={
                          openMenuId === item.id
                        }
                        onClick={() =>
                          setOpenMenuId(
                            openMenuId ===
                              item.id
                              ? null
                              : item.id,
                          )
                        }
                        className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-lg text-white/70 transition hover:bg-white/10 hover:text-white"
                      >
                        ⋮
                      </button>

                      {openMenuId ===
                        item.id && (
                        <div className="absolute right-0 top-12 z-50 w-52 overflow-hidden rounded-xl border border-white/10 bg-[#15151b] p-1 shadow-2xl">
                          <button
                            type="button"
                            onClick={() =>
                              updateStatus(
                                item,
                                "watching",
                              )
                            }
                            className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm text-white/80 transition hover:bg-white/10"
                          >
                            ▶ Watching
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              updateStatus(
                                item,
                                "hold",
                              )
                            }
                            className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm text-yellow-300 transition hover:bg-white/10"
                          >
                            ⏸ Hold
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              updateStatus(
                                item,
                                "dropped",
                              )
                            }
                            className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm text-red-300 transition hover:bg-white/10"
                          >
                            ✕ Drop
                          </button>

                          <div className="my-1 border-t border-white/10" />

                          <button
                            type="button"
                            onClick={() =>
                              updateStatus(
                                item,
                                "completed",
                              )
                            }
                            className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm text-emerald-300 transition hover:bg-white/10"
                          >
                            ✓ Completed
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              handleRewatch(
                                item,
                              )
                            }
                            className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm text-purple-300 transition hover:bg-white/10"
                          >
                            ↻ Rewatch +1
                          </button>

                          <div className="my-1 border-t border-white/10" />

                          <button
                            type="button"
                            onClick={() =>
                              removeItem(
                                item,
                              )
                            }
                            className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm text-red-400 transition hover:bg-red-500/10"
                          >
                            🗑 Remove
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}