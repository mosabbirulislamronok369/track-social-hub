"use client";

import { useEffect, useState } from "react";
import {
  listRecommendationsForMe,
  markRecommendationWatched,
  deleteRecommendation,
  addRecommendationToWatchlist,
  type Recommendation,
} from "../lib/recommendations";

export default function RecommendedPage() {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  function load() {
    setLoading(true);

    listRecommendationsForMe()
      .then((result) => {
        setRecs(result);
      })
      .finally(() => {
        setLoading(false);
      });
  }

  /*
   * Marking watched does two things now: flips the
   * recommendation's is_watched flag (as before) AND upserts
   * the title into watchlist_items — the same table Dashboard
   * reads from — so it actually shows up there instead of only
   * being marked read here.
   */
  async function handleMarkWatched(rec: Recommendation) {
    if (savingId === rec.id) {
      return;
    }

    setSavingId(rec.id);
    setError("");

    try {
      await addRecommendationToWatchlist(rec);
      await markRecommendationWatched(rec.id);
      load();
    } catch (err) {
      console.error(
        "Failed to mark recommendation watched:",
        err,
      );

      // Supabase/Postgrest errors are plain objects, not
      // Error instances — check both shapes so the real
      // reason (RLS, constraint, etc.) reaches the user.
      const message =
        err instanceof Error
          ? err.message
          : err &&
              typeof err === "object" &&
              "message" in err &&
              typeof (err as { message: unknown })
                .message === "string"
            ? (err as { message: string }).message
            : "Failed to mark as watched.";

      setError(message);
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string) {
    await deleteRecommendation(id);
    load();
  }

  return (
    <section className="min-h-screen bg-[#070711] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-4xl font-bold tracking-tight">
          Recommended to You
        </h1>

        <p className="mt-2 text-white/50">
          What your friends think you should watch
        </p>

        {error && (
          <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {loading ? (
          <p className="mt-8 text-white/40">Loading...</p>
        ) : recs.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-12 text-center">
            <p className="text-lg font-semibold">No recommendations yet</p>

            <p className="mt-2 text-sm text-white/40">
              When a friend recommends something, it'll show up here.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recs.map((rec) => (
              <div
                key={rec.id}
                className="rounded-2xl border border-white/10 bg-[#11111a] p-4"
              >
                <p className="text-xs text-white/40">
                  {rec.fromDisplayName} recommended
                </p>

                <h3 className="mt-1 font-bold">{rec.contentTitle}</h3>

                <p className="text-xs text-white/40">{rec.contentType}</p>

                {rec.message && (
                  <p className="mt-2 text-sm italic text-white/60">
                    &quot;{rec.message}&quot;
                  </p>
                )}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={
                      rec.isWatched ||
                      savingId === rec.id
                    }
                    onClick={() =>
                      handleMarkWatched(rec)
                    }
                    className="h-9 rounded-lg border border-emerald-400/30 bg-emerald-500/10 text-xs font-semibold text-emerald-300 disabled:opacity-40"
                  >
                    {rec.isWatched
                      ? "✓ Watched"
                      : savingId === rec.id
                        ? "Saving..."
                        : "Mark Watched"}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(rec.id)}
                    className="h-9 rounded-lg border border-red-400/30 bg-red-500/10 text-xs font-semibold text-red-300"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}