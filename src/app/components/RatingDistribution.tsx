"use client";

import { RatingStats } from "../lib/ratings";

/*
 * Small donut chart: each 1-10 rating value gets a color
 * (red -> green), sized by its share of all ratings for
 * this content. Center shows the average.
 *
 * Pure CSS conic-gradient — no charting library, so this
 * adds zero bundle weight. Pairs with fetchRatingStats,
 * which does the averaging in Postgres so only one summary
 * row per content_id ever reaches the client.
 */

function valueColor(value: number) {
  // 1 -> red, 10 -> green
  const hue = ((value - 1) / 9) * 120;
  return `hsl(${hue}, 70%, 50%)`;
}

export default function RatingDistribution({
  stats,
  size = "compact",
}: {
  stats: RatingStats | null | undefined;
  size?: "compact" | "large";
}) {
  if (!stats || stats.totalRatings === 0) {
    return (
      <p className="text-[10px] text-white/30">
        No ratings yet
      </p>
    );
  }

  let cumulative = 0;

  const segments = Object.entries(stats.distribution)
    .map(([value, count]) => ({
      value: Number(value),
      count: Number(count),
    }))
    .sort((a, b) => a.value - b.value)
    .map(({ value, count }) => {
      const start = cumulative;
      cumulative += (count / stats.totalRatings) * 100;

      return `${valueColor(value)} ${start}% ${cumulative}%`;
    });

  const gradient = `conic-gradient(${segments.join(", ")})`;

  const ringSizeClass =
    size === "large" ? "h-16 w-16" : "h-10 w-10";

  const centerTextClass =
    size === "large" ? "text-sm" : "text-[10px]";

  const labelTextClass =
    size === "large" ? "text-xs" : "text-[10px]";

  return (
    <div className="flex items-center gap-2">
      <div
        className={`relative ${ringSizeClass} shrink-0 rounded-full`}
        style={{ background: gradient }}
        title={`${stats.totalRatings} rating${
          stats.totalRatings > 1 ? "s" : ""
        } — avg ${stats.avgRating.toFixed(1)}/10`}
      >
        <div className="absolute inset-[3px] flex items-center justify-center rounded-full bg-black">
          <span
            className={`${centerTextClass} font-bold text-yellow-300`}
          >
            {stats.avgRating.toFixed(1)}
          </span>
        </div>
      </div>

      <p className={`${labelTextClass} text-white/40`}>
        {stats.totalRatings} rating
        {stats.totalRatings > 1 ? "s" : ""}
      </p>
    </div>
  );
}