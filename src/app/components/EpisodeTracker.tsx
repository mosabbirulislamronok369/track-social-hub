"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type Arc,
  type EpisodeInfo,
  type TrackedCategory,
  createArc,
  fetchAnimeEpisodes,
  fetchArcs,
  fetchTvSeasonEpisodes,
  fetchWatchedEpisodes,
  groupEpisodesByArc,
  setEpisodeWatched,
  syncTotalWatchTimeFromEpisodes,
  syncWatchlistProgress,
} from "../lib/episodeProgress";

type SeasonMeta = {
  seasonNumber: number;
  name: string;
  episodeCount: number | null;
};

function formatMinutes(seconds: number) {
  if (!seconds) return "";
  const minutes = Math.round(seconds / 60);
  return `${minutes}m`;
}

export default function EpisodeTracker({
  contentId,
  category,
  tmdbId,
  fallbackRuntimeMinutes,
}: {
  contentId: string;
  category: TrackedCategory;
  /*
   * Anime: MAL id (Jikan). TV: TMDB id.
   * Same underlying id used to build contentId elsewhere.
   */
  tmdbId: string | number;
  /*
   * Per-episode runtime estimate (minutes) to use when the
   * API doesn't give us a specific episode's runtime — TV
   * falls back to this, Anime always uses this (Jikan has
   * no per-episode duration).
   */
  fallbackRuntimeMinutes: number | null;
}) {
  const [seasons, setSeasons] = useState<SeasonMeta[]>([]);
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [seasonsLoading, setSeasonsLoading] = useState(
    category === "TV",
  );

  const [episodes, setEpisodes] = useState<EpisodeInfo[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(true);
  const [episodesError, setEpisodesError] = useState("");

  const [watchedSet, setWatchedSet] = useState<Set<number>>(
    new Set(),
  );

  const [savingEpisode, setSavingEpisode] = useState<
    number | null
  >(null);

  const [arcs, setArcs] = useState<Arc[]>([]);

  const [showArcForm, setShowArcForm] = useState(false);
  const [arcName, setArcName] = useState("");
  const [arcStart, setArcStart] = useState("");
  const [arcEnd, setArcEnd] = useState("");
  const [savingArc, setSavingArc] = useState(false);

  /*
   * "Mark Episode Range" — for when you jumped straight to,
   * say, episode 89–90 without watching the ones before it.
   * Rather than scrolling through the whole list and clicking
   * each row, this marks any episode in [from, to] as watched
   * in one go, leaving everything outside that range alone
   * (so it's fine if 1–88 stay unwatched).
   */
  const [showMarkRangeForm, setShowMarkRangeForm] =
    useState(false);
  const [markRangeFrom, setMarkRangeFrom] = useState("");
  const [markRangeTo, setMarkRangeTo] = useState("");
  const [markingRange, setMarkingRange] = useState(false);

  /*
   * TV: load the season list once (from tv-details, which
   * now also returns `seasons`).
   */
  useEffect(() => {
    if (category !== "TV") {
      return;
    }

    let cancelled = false;

    setSeasonsLoading(true);

    fetch(
      `/api/tmdb/tv-details?id=${encodeURIComponent(
        String(tmdbId),
      )}`,
      { cache: "no-store" },
    )
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;

        const list: SeasonMeta[] = (data?.seasons || []).map(
          (s: any) => ({
            seasonNumber: s.seasonNumber,
            name: s.name,
            episodeCount: s.episodeCount,
          }),
        );

        setSeasons(list);

        if (list.length > 0) {
          setSelectedSeason(list[0].seasonNumber);
        }
      })
      .catch((err) => {
        console.error("Failed to load seasons:", err);
      })
      .finally(() => {
        if (!cancelled) setSeasonsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [category, tmdbId]);

  /*
   * Load episodes (+ watched state + arcs) whenever the
   * season changes (or once, for Anime).
   */
  const loadSeasonData = useCallback(async () => {
    setEpisodesLoading(true);
    setEpisodesError("");

    try {
      let episodeList: EpisodeInfo[];

      if (category === "TV") {
        episodeList = await fetchTvSeasonEpisodes(
          tmdbId,
          selectedSeason,
          fallbackRuntimeMinutes,
        );
      } else {
        const fallbackSeconds =
          typeof fallbackRuntimeMinutes === "number" &&
          fallbackRuntimeMinutes > 0
            ? Math.round(fallbackRuntimeMinutes * 60)
            : 24 * 60;

        episodeList = await fetchAnimeEpisodes(
          tmdbId,
          fallbackSeconds,
        );
      }

      setEpisodes(episodeList);

      const [watched, arcList] = await Promise.all([
        fetchWatchedEpisodes(contentId, selectedSeason),
        fetchArcs(contentId, selectedSeason),
      ]);

      setWatchedSet(watched);
      setArcs(arcList);
    } catch (err) {
      console.error("Failed to load episodes:", err);

      setEpisodesError(
        err instanceof Error
          ? err.message
          : "Failed to load episodes.",
      );
    } finally {
      setEpisodesLoading(false);
    }
  }, [category, tmdbId, selectedSeason, fallbackRuntimeMinutes, contentId]);

  useEffect(() => {
    // For TV, wait until we know which season to load.
    if (category === "TV" && seasonsLoading) {
      return;
    }

    loadSeasonData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, seasonsLoading, selectedSeason]);

  async function toggleEpisode(
    episode: EpisodeInfo,
    options?: { sync?: boolean },
  ) {
    if (savingEpisode === episode.episodeNumber) {
      return;
    }

    const isWatched = watchedSet.has(episode.episodeNumber);

    setSavingEpisode(episode.episodeNumber);

    // Optimistic UI.
    setWatchedSet((current) => {
      const next = new Set(current);

      if (isWatched) {
        next.delete(episode.episodeNumber);
      } else {
        next.add(episode.episodeNumber);
      }

      return next;
    });

    try {
      await setEpisodeWatched(
        contentId,
        category,
        selectedSeason,
        episode,
        !isWatched,
        options,
      );
    } catch (err) {
      console.error("Failed to save episode progress:", err);

      // Roll back on failure.
      setWatchedSet((current) => {
        const next = new Set(current);

        if (isWatched) {
          next.add(episode.episodeNumber);
        } else {
          next.delete(episode.episodeNumber);
        }

        return next;
      });

      alert(
        err instanceof Error
          ? err.message
          : "Failed to save episode.",
      );
    } finally {
      setSavingEpisode(null);
    }
  }

  /*
   * Runs the two "derived state" recomputes once — total watch
   * time and watchlist_items.current_episode — instead of once
   * per episode. Bulk flows (Mark all watched / Mark Episode
   * Range) pass { sync: false } into every toggleEpisode() call
   * and then call this a single time at the end, so a 12-episode
   * batch does 12 episode_progress writes but only ONE pair of
   * recomputes instead of 12 racing pairs of them (which is what
   * caused the Continue Watching card to briefly show a stale/
   * wrong episode count).
   */
  async function finalizeBatchSync() {
    try {
      await syncTotalWatchTimeFromEpisodes(contentId, category);
      await syncWatchlistProgress(contentId);
    } catch (err) {
      console.error("Failed to sync after bulk update:", err);
    }
  }

  async function handleMarkAll(watched: boolean) {
    const targets = episodes.filter(
      (episode) =>
        watchedSet.has(episode.episodeNumber) !== watched,
    );

    if (targets.length === 0) {
      return;
    }

    for (const episode of targets) {
      // eslint-disable-next-line no-await-in-loop
      await toggleEpisode(episode, { sync: false });
    }

    await finalizeBatchSync();
  }

  /*
   * Marks every episode whose number falls inside
   * [markRangeFrom, markRangeTo] as watched — and only those.
   * Episodes before, after, or already watched are left as-is,
   * so this is safe to use for "I only just watched 89–90"
   * without touching 1–88.
   */
  async function handleMarkRange() {
    const from = Number(markRangeFrom);
    const to = Number(markRangeTo);

    if (!from || !to || to < from) {
      alert(
        "Enter a valid episode range, e.g. From 89 to 90.",
      );
      return;
    }

    setMarkingRange(true);

    try {
      const targets = episodes.filter(
        (episode) =>
          episode.episodeNumber >= from &&
          episode.episodeNumber <= to &&
          !watchedSet.has(episode.episodeNumber),
      );

      for (const episode of targets) {
        // eslint-disable-next-line no-await-in-loop
        await toggleEpisode(episode, { sync: false });
      }

      if (targets.length > 0) {
        await finalizeBatchSync();
      }

      setMarkRangeFrom("");
      setMarkRangeTo("");
      setShowMarkRangeForm(false);
    } finally {
      setMarkingRange(false);
    }
  }

  async function handleCreateArc() {
    const start = Number(arcStart);
    const end = Number(arcEnd);

    if (!arcName.trim() || !start || !end || end < start) {
      alert("Enter a name and a valid episode range.");
      return;
    }

    setSavingArc(true);

    try {
      const arc = await createArc(
        contentId,
        category,
        selectedSeason,
        arcName.trim(),
        start,
        end,
      );

      setArcs((current) =>
        [...current, arc].sort(
          (a, b) => a.startEpisode - b.startEpisode,
        ),
      );

      setArcName("");
      setArcStart("");
      setArcEnd("");
      setShowArcForm(false);
    } catch (err) {
      console.error("Failed to create arc:", err);

      alert(
        err instanceof Error ? err.message : "Failed to save arc.",
      );
    } finally {
      setSavingArc(false);
    }
  }

  const watchedCount = episodes.filter((ep) =>
    watchedSet.has(ep.episodeNumber),
  ).length;

  const groups = groupEpisodesByArc(episodes, arcs);

  return (
    <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white/60">
          Episodes
          {episodes.length > 0 && (
            <span className="ml-2 text-white/30">
              {watchedCount}/{episodes.length} watched
            </span>
          )}
        </h3>

        <div className="flex flex-wrap items-center gap-2">
          {category === "TV" && seasons.length > 0 && (
            <select
              value={selectedSeason}
              onChange={(event) =>
                setSelectedSeason(Number(event.target.value))
              }
              className="h-9 rounded-lg border border-white/10 bg-[#14141d] px-3 text-xs text-white outline-none focus:border-purple-400/60"
            >
              {seasons.map((season) => (
                <option
                  key={season.seasonNumber}
                  value={season.seasonNumber}
                >
                  {season.name}
                  {season.episodeCount
                    ? ` (${season.episodeCount} ep)`
                    : ""}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() =>
              setShowMarkRangeForm((current) => !current)
            }
            disabled={episodesLoading || episodes.length === 0}
            className="h-9 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Mark Episode Range
          </button>

          <button
            type="button"
            onClick={() => handleMarkAll(true)}
            disabled={episodesLoading || episodes.length === 0}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-semibold text-white/60 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Mark all watched
          </button>

          <button
            type="button"
            onClick={() => handleMarkAll(false)}
            disabled={episodesLoading || watchedCount === 0}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-semibold text-white/60 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear season
          </button>

          <button
            type="button"
            onClick={() => setShowArcForm((current) => !current)}
            className="h-9 rounded-lg border border-purple-400/30 bg-purple-500/10 px-3 text-xs font-semibold text-purple-300 transition hover:bg-purple-500/20"
          >
            + Add Arc
          </button>
        </div>
      </div>

      {/* MARK EPISODE RANGE FORM */}
      {showMarkRangeForm && (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-emerald-400/20 bg-emerald-500/[0.04] p-3">
          <div className="w-24">
            <label className="mb-1 block text-[11px] text-white/40">
              From ep
            </label>
            <input
              type="number"
              value={markRangeFrom}
              onChange={(event) =>
                setMarkRangeFrom(event.target.value)
              }
              placeholder="89"
              className="h-9 w-full rounded-lg border border-white/10 bg-[#14141d] px-3 text-xs text-white outline-none focus:border-emerald-400/60"
            />
          </div>

          <div className="w-24">
            <label className="mb-1 block text-[11px] text-white/40">
              To ep
            </label>
            <input
              type="number"
              value={markRangeTo}
              onChange={(event) =>
                setMarkRangeTo(event.target.value)
              }
              placeholder="90"
              className="h-9 w-full rounded-lg border border-white/10 bg-[#14141d] px-3 text-xs text-white outline-none focus:border-emerald-400/60"
            />
          </div>

          <button
            type="button"
            onClick={handleMarkRange}
            disabled={markingRange}
            className="h-9 rounded-lg bg-emerald-500 px-4 text-xs font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {markingRange ? "Marking..." : "Mark watched"}
          </button>

          <p className="w-full text-[11px] text-white/30">
            Only episodes {markRangeFrom || "?"}–
            {markRangeTo || "?"} get marked watched — everything
            before or after is left alone.
          </p>
        </div>
      )}

      {/* ARC FORM */}
      {showArcForm && (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex-1 min-w-[140px]">
            <label className="mb-1 block text-[11px] text-white/40">
              Arc name
            </label>
            <input
              value={arcName}
              onChange={(event) => setArcName(event.target.value)}
              placeholder="e.g. Chunin Exams"
              className="h-9 w-full rounded-lg border border-white/10 bg-[#14141d] px-3 text-xs text-white outline-none focus:border-purple-400/60"
            />
          </div>

          <div className="w-20">
            <label className="mb-1 block text-[11px] text-white/40">
              Start ep
            </label>
            <input
              type="number"
              value={arcStart}
              onChange={(event) => setArcStart(event.target.value)}
              className="h-9 w-full rounded-lg border border-white/10 bg-[#14141d] px-3 text-xs text-white outline-none focus:border-purple-400/60"
            />
          </div>

          <div className="w-20">
            <label className="mb-1 block text-[11px] text-white/40">
              End ep
            </label>
            <input
              type="number"
              value={arcEnd}
              onChange={(event) => setArcEnd(event.target.value)}
              className="h-9 w-full rounded-lg border border-white/10 bg-[#14141d] px-3 text-xs text-white outline-none focus:border-purple-400/60"
            />
          </div>

          <button
            type="button"
            onClick={handleCreateArc}
            disabled={savingArc}
            className="h-9 rounded-lg bg-white px-4 text-xs font-semibold text-black transition hover:bg-white/90 disabled:opacity-50"
          >
            {savingArc ? "Saving..." : "Save"}
          </button>
        </div>
      )}

      {/* ERROR */}
      {episodesError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          {episodesError}
        </div>
      )}

      {/* LOADING */}
      {episodesLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="h-10 animate-pulse rounded-lg bg-white/5"
            />
          ))}
        </div>
      )}

      {/* EPISODE LIST (grouped by arc where applicable) */}
      {!episodesLoading && !episodesError && (
        <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
          {groups.map((group, groupIndex) => (
            <div key={groupIndex}>
              {group.arc && (
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-purple-300">
                  {group.arc.name}{" "}
                  <span className="text-white/30">
                    (Ep {group.arc.startEpisode}–
                    {group.arc.endEpisode})
                  </span>
                </p>
              )}

              <div className="space-y-1">
                {group.episodes.map((episode) => {
                  const watched = watchedSet.has(
                    episode.episodeNumber,
                  );

                  const isSaving =
                    savingEpisode === episode.episodeNumber;

                  return (
                    <button
                      key={episode.episodeNumber}
                      type="button"
                      disabled={isSaving}
                      onClick={() => toggleEpisode(episode)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs transition disabled:opacity-50 ${
                        watched
                          ? "bg-emerald-500/10 text-emerald-200"
                          : "bg-white/[0.02] text-white/70 hover:bg-white/[0.06]"
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
                          watched
                            ? "border-emerald-400 bg-emerald-500 text-black"
                            : "border-white/30 text-transparent"
                        }`}
                      >
                        {"\u2713"}
                      </span>

                      <span className="flex-1 truncate">
                        Ep {episode.episodeNumber}. {episode.name}
                      </span>

                      {episode.runtimeSeconds > 0 && (
                        <span className="shrink-0 text-white/30">
                          {formatMinutes(episode.runtimeSeconds)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {episodes.length === 0 && (
            <p className="py-4 text-center text-xs text-white/30">
              No episodes found for this{" "}
              {category === "TV" ? "season" : "title"}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}