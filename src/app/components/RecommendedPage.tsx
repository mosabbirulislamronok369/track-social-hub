"use client";

import { useEffect, useState } from "react";
import {
  listRecommendationsForMe,
  markRecommendationWatched,
  deleteRecommendation,
  type Recommendation,
} from "../lib/recommendations";

export default function RecommendedPage() {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);

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

  async function handleMarkWatched(id: string) {
    await markRecommendationWatched(id);
    load();
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
                    disabled={rec.isWatched}
                    onClick={() => handleMarkWatched(rec.id)}
                    className="h-9 rounded-lg border border-emerald-400/30 bg-emerald-500/10 text-xs font-semibold text-emerald-300 disabled:opacity-40"
                  >
                    {rec.isWatched ? "✓ Watched" : "Mark Watched"}
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