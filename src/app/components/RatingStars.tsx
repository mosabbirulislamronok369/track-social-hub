"use client";

import { useState } from "react";
import {
  RATING_LEVELS,
  getRatingLabel,
} from "../lib/ratings";

export default function RatingStars({
  value,
  onRate,
  size = "compact",
  disabled = false,
}: {
  value: number | null;
  onRate: (
    rating: number,
  ) => void | Promise<void>;
  size?: "compact" | "large";
  disabled?: boolean;
}) {
  const [hover, setHover] = useState<
    number | null
  >(null);

  const displayValue = hover ?? value ?? 0;

  const activeLevel =
    displayValue > 0
      ? getRatingLabel(displayValue)
      : null;

  const starSizeClass =
    size === "large" ? "text-2xl" : "text-base";

  return (
    <div
      onMouseLeave={() => setHover(null)}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex flex-wrap gap-0.5">
        {RATING_LEVELS.map((level) => {
          const filled = displayValue >= level.value;

          return (
            <button
              key={level.value}
              type="button"
              disabled={disabled}
              onMouseEnter={() =>
                setHover(level.value)
              }
              onClick={(event) => {
                event.stopPropagation();

                onRate(level.value);
              }}
              aria-label={`Rate ${level.value} out of 10 — ${level.en}`}
              className={`${starSizeClass} leading-none transition disabled:cursor-not-allowed ${
                filled
                  ? "text-yellow-300"
                  : "text-white/15 hover:text-white/30"
              }`}
            >
              ★
            </button>
          );
        })}
      </div>

      <p
        className={`mt-1 text-white/40 ${
          size === "large" ? "text-sm" : "text-[11px]"
        }`}
      >
        {activeLevel
          ? `${displayValue}/10 — ${
              activeLevel.bn
                ? `${activeLevel.bn} / `
                : ""
            }${activeLevel.en}`
          : "Not rated yet"}
      </p>
    </div>
  );
}