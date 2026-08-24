"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { supabase } from "../lib/supabase";
import {
  RatingEntry,
  deleteRating,
  fetchTopRatings,
  getRatingLabel,
  searchRatings,
} from "../lib/ratings";

const TOP_LIMIT = 10;
const SEARCH_DEBOUNCE_MS = 350;

export default function RatingBoard() {
  const [entries, setEntries] = useState<
    RatingEntry[]
  >([]);

  const [loading, setLoading] = useState(true);

  const [removingId, setRemovingId] = useState<
    string | null
  >(null);

  /*
   * Two view modes, kept deliberately separate from the
   * Supabase-cost point of view:
   *  - "top": default view, loads once (capped) — this is
   *    what renders on page load and after any add/remove.
   *  - "search": only fires a query when the user actually
   *    types something; an empty box never hits the table.
   */
  const [searchQuery, setSearchQuery] = useState("");
  const isSearching = searchQuery.trim().length > 0;

  const debounceRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const loadTop = useCallback(async () => {
    setLoading(true);

    const rows = await fetchTopRatings(TOP_LIMIT);

    setEntries(rows);
    setLoading(false);
  }, []);

  const runSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      return;
    }

    setLoading(true);

    const rows = await searchRatings(query);

    setEntries(rows);
    setLoading(false);
  }, []);

  // Initial load — top rated only.
  useEffect(() => {
    loadTop();
  }, [loadTop]);

  // Debounced search — only queries once typing settles.
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!searchQuery.trim()) {
      // Back to the idle/top view — no query fired.
      loadTop();
      return;
    }

    debounceRef.current = setTimeout(() => {
      runSearch(searchQuery);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  useEffect(() => {
    /*
     * Keep this page in sync if a rating is
     * added/changed from a card elsewhere. Re-runs
     * whichever view (top or search) is currently active
     * instead of always pulling the full table.
     */
    const channel = supabase
      .channel("rating-board")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ratings",
        },
        () => {
          if (searchQuery.trim()) {
            runSearch(searchQuery);
          } else {
            loadTop();
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  async function handleRemove(contentId: string) {
    setRemovingId(contentId);

    try {
      await deleteRating(contentId);

      if (searchQuery.trim()) {
        await runSearch(searchQuery);
      } else {
        await loadTop();
      }
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Failed to remove rating.",
      );
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-10 text-white">
      <div className="mb-6">
        <h1 className="text-4xl font-bold tracking-tight">
          Rating Board
        </h1>

        <p className="mt-2 text-white/50">
          {isSearching
            ? "Search results — matching titles."
            : `Your top ${TOP_LIMIT} rated — best first. Search below to find anything else.`}
        </p>
      </div>

      <div className="mb-8">
        <input
          value={searchQuery}
          onChange={(event) =>
            setSearchQuery(event.target.value)
          }
          placeholder="Search your rated titles..."
          className="h-11 w-full max-w-md rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-purple-400/60"
        />
      </div>

      {loading && (
        <p className="text-white/40">
          Loading ratings...
        </p>
      )}

      {!loading && entries.length === 0 && isSearching && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-12 text-center">
          <p className="text-lg font-semibold">
            No matches
          </p>

          <p className="mt-2 text-sm text-white/40">
            Nothing you've rated matches "{searchQuery.trim()}".
          </p>
        </div>
      )}

      {!loading && entries.length === 0 && !isSearching && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-12 text-center">
          <p className="text-lg font-semibold">
            No ratings yet
          </p>

          <p className="mt-2 text-sm text-white/40">
            Rate something from Browse or Anime to
            see it here.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {entries.map((entry) => {
          const label = getRatingLabel(
            entry.rating,
          );

          return (
            <div
              key={entry.content_id}
              className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-3"
            >
              <div className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-black">
                {entry.image ? (
                  <img
                    src={entry.image}
                    alt={entry.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-white/30">
                    No Image
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {entry.title}
                </p>

                <p className="text-xs text-white/40">
                  {entry.category}
                </p>
              </div>

              <div className="shrink-0 text-right">
                <p className="text-xl font-bold text-yellow-300">
                  {entry.rating}/10
                </p>

                <p className="max-w-[10rem] text-xs text-white/50">
                  {label
                    ? `${
                        label.bn
                          ? `${label.bn} / `
                          : ""
                      }${label.en}`
                    : ""}
                </p>
              </div>

              <button
                type="button"
                disabled={
                  removingId ===
                  entry.content_id
                }
                onClick={() =>
                  handleRemove(entry.content_id)
                }
                className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}