"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { supabase } from "../lib/supabase";
import {
  RatingEntry,
  deleteRating,
  fetchAllRatingRows,
  getRatingLabel,
} from "../lib/ratings";

export default function RatingBoard() {
  const [entries, setEntries] = useState<
    RatingEntry[]
  >([]);

  const [loading, setLoading] = useState(true);

  const [removingId, setRemovingId] = useState<
    string | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);

    const rows = await fetchAllRatingRows();

    setEntries(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();

    /*
     * Keep this page in sync if a rating is
     * added/changed from a card elsewhere.
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
          load();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  async function handleRemove(contentId: string) {
    setRemovingId(contentId);

    try {
      await deleteRating(contentId);

      await load();
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
      <div className="mb-8">
        <h1 className="text-4xl font-bold tracking-tight">
          Rating Board
        </h1>

        <p className="mt-2 text-white/50">
          Everything you've rated — best to worst.
        </p>
      </div>

      {loading && (
        <p className="text-white/40">
          Loading ratings...
        </p>
      )}

      {!loading && entries.length === 0 && (
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