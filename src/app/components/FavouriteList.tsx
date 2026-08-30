"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_FAVOURITES,
  FAVOURITES_CHANGED_EVENT,
  FavouriteContentType,
  FavouriteItem,
  addFavourite,
  fetchFavourites,
  removeFavourite,
  reorderFavourites,
} from "../lib/favourites";

/* ============================================================
   TYPES
============================================================ */

type SearchResult = {
  id: string | number;
  title: string;
  subtitle?: string | null;
  image?: string | null;
};

const SEARCH_TYPES: FavouriteContentType[] = [
  "Anime",
  "TV",
  "Movies",
];

/* ============================================================
   RANK STYLING
   Ranks 1–3 get a special medal treatment, everything else
   is a plain numbered row.
============================================================ */

const MEDAL_STYLES: Record<
  number,
  { ring: string; badge: string; glow: string; label: string }
> = {
  1: {
    ring: "border-yellow-400/60",
    badge:
      "bg-[linear-gradient(135deg,#f5d271_0%,#c9932b_100%)] text-black",
    glow: "shadow-[0_0_24px_-4px_rgba(245,210,113,0.45)]",
    label: "🥇",
  },
  2: {
    ring: "border-slate-300/50",
    badge:
      "bg-[linear-gradient(135deg,#e6e9ee_0%,#9aa3af_100%)] text-black",
    glow: "shadow-[0_0_20px_-6px_rgba(203,213,225,0.4)]",
    label: "🥈",
  },
  3: {
    ring: "border-orange-400/50",
    badge:
      "bg-[linear-gradient(135deg,#e8a768_0%,#a85f2a_100%)] text-black",
    glow: "shadow-[0_0_20px_-6px_rgba(232,167,104,0.4)]",
    label: "🥉",
  },
};

/* ============================================================
   MINIMAL SEARCH NORMALIZERS
   (only the fields the add-to-favourites flow needs — full
   normalization lives in UniversalBrowser.tsx)
============================================================ */

function normalizeMovieResults(data: any): SearchResult[] {
  const results = data?.results || [];

  return results.map((movie: any) => ({
    id: movie.tmdb_id ?? movie.id,
    title: movie.title || movie.name || "Untitled Movie",
    subtitle: movie.original_title || "Movie",
    image: movie.poster_path
      ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
      : null,
  }));
}

function normalizeTVResults(data: any): SearchResult[] {
  const results = data?.results || [];

  return results.map((show: any) => ({
    id: show.tmdb_id ?? show.id,
    title: show.name || show.original_name || "Untitled TV Show",
    subtitle: show.original_name || "TV Show",
    image: show.poster_path
      ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
      : null,
  }));
}

function normalizeAnimeResults(data: any): SearchResult[] {
  const results = data?.data || data?.anime || data?.results || [];

  return (Array.isArray(results) ? results : []).map(
    (anime: any) => ({
      id: anime.mal_id ?? anime.id,
      title:
        anime.title_english || anime.title || "Untitled Anime",
      subtitle: anime.title || null,
      image:
        anime?.images?.jpg?.large_image_url ||
        anime?.images?.jpg?.image_url ||
        anime?.poster_path ||
        anime?.image ||
        null,
    }),
  );
}

function getContentId(
  id: string | number,
  type: FavouriteContentType,
) {
  return `${type.toLowerCase()}-${String(id)}`;
}

export default function FavouriteList() {
  const [favourites, setFavourites] = useState<FavouriteItem[]>(
    [],
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchType, setSearchType] =
    useState<FavouriteContentType>("Anime");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    SearchResult[]
  >([]);

  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const [addingId, setAddingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(
    null,
  );

  const [reordering, setReordering] = useState(false);

  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<
    number | null
  >(null);

  const loadFavourites = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await fetchFavourites();
      setFavourites(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load Favourite List.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFavourites();

    function handleExternalChange() {
      loadFavourites();
    }

    window.addEventListener(
      FAVOURITES_CHANGED_EVENT,
      handleExternalChange,
    );

    return () =>
      window.removeEventListener(
        FAVOURITES_CHANGED_EVENT,
        handleExternalChange,
      );
  }, [loadFavourites]);

  const favouriteIds = new Set(
    favourites.map((f) => f.contentId),
  );

  /* ============================================================
     SEARCH
  ============================================================ */

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();

    if (!searchQuery.trim()) {
      return;
    }

    setSearching(true);
    setSearchError("");
    setSearchResults([]);

    try {
      let results: SearchResult[] = [];

      if (searchType === "Movies") {
        const res = await fetch(
          `/api/tmdb/movies?query=${encodeURIComponent(
            searchQuery.trim(),
          )}&page=1`,
          { cache: "no-store" },
        );

        const data = await res.json();

        if (!res.ok) {
          throw new Error(
            data?.error || "Movie search failed.",
          );
        }

        results = normalizeMovieResults(data);
      } else if (searchType === "TV") {
        const res = await fetch(
          `/api/tmdb/tv?query=${encodeURIComponent(
            searchQuery.trim(),
          )}&page=1`,
          { cache: "no-store" },
        );

        const data = await res.json();

        if (!res.ok) {
          throw new Error("TV search failed.");
        }

        results = normalizeTVResults(data);
      } else {
        const params = new URLSearchParams({
          q: searchQuery.trim(),
          page: "1",
          limit: "24",
        });

        const res = await fetch(`/api/anime?${params.toString()}`, {
          cache: "no-store",
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error("Anime search failed.");
        }

        results = normalizeAnimeResults(data);
      }

      setSearchResults(results.slice(0, 12));
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : "Search failed.",
      );
    } finally {
      setSearching(false);
    }
  }

  /* ============================================================
     ADD
  ============================================================ */

  async function handleAdd(result: SearchResult) {
    const contentId = getContentId(result.id, searchType);

    if (favouriteIds.has(contentId)) {
      return;
    }

    if (favourites.length >= MAX_FAVOURITES) {
      alert(
        `Favourite List is full (max ${MAX_FAVOURITES}). Remove something first.`,
      );
      return;
    }

    setAddingId(contentId);

    const optimisticItem: FavouriteItem = {
      contentId,
      contentType: searchType,
      title: result.title,
      subtitle: result.subtitle ?? null,
      image: result.image ?? null,
      rank: favourites.length + 1,
    };

    setFavourites((current) => [...current, optimisticItem]);

    try {
      await addFavourite({
        contentId,
        contentType: searchType,
        title: result.title,
        subtitle: result.subtitle,
        image: result.image,
      });
    } catch (err) {
      setFavourites((current) =>
        current.filter((f) => f.contentId !== contentId),
      );

      alert(
        err instanceof Error
          ? err.message
          : "Failed to add to Favourite List.",
      );
    } finally {
      setAddingId(null);
    }
  }

  /* ============================================================
     REMOVE
  ============================================================ */

  async function handleRemove(item: FavouriteItem) {
    const confirmed = window.confirm(
      `Remove "${item.title}" from your Favourite List?`,
    );

    if (!confirmed) {
      return;
    }

    setRemovingId(item.contentId);

    const previous = favourites;

    setFavourites((current) =>
      current
        .filter((f) => f.contentId !== item.contentId)
        .map((f, idx) => ({ ...f, rank: idx + 1 })),
    );

    try {
      await removeFavourite(item.contentId);
    } catch (err) {
      setFavourites(previous);

      alert(
        err instanceof Error
          ? err.message
          : "Failed to remove item.",
      );
    } finally {
      setRemovingId(null);
    }
  }

  /* ============================================================
     REORDER (drag & drop + up/down arrows share this)
  ============================================================ */

  async function persistOrder(nextList: FavouriteItem[]) {
    const reranked = nextList.map((f, idx) => ({
      ...f,
      rank: idx + 1,
    }));

    const previous = favourites;

    setFavourites(reranked);
    setReordering(true);

    try {
      await reorderFavourites(reranked.map((f) => f.contentId));
    } catch (err) {
      setFavourites(previous);

      alert(
        err instanceof Error
          ? err.message
          : "Failed to save the new order.",
      );
    } finally {
      setReordering(false);
    }
  }

  function moveByOffset(index: number, offset: number) {
    const targetIndex = index + offset;

    if (targetIndex < 0 || targetIndex >= favourites.length) {
      return;
    }

    const next = [...favourites];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);

    persistOrder(next);
  }

  function handleDragStart(index: number) {
    dragIndex.current = index;
  }

  function handleDragOver(
    e: React.DragEvent,
    index: number,
  ) {
    e.preventDefault();
    setDragOverIndex(index);
  }

  function handleDrop(index: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    setDragOverIndex(null);

    if (from === null || from === index) {
      return;
    }

    const next = [...favourites];
    const [moved] = next.splice(from, 1);
    next.splice(index, 0, moved);

    persistOrder(next);
  }

  /* ============================================================
     RENDER
  ============================================================ */

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            My Favourite List
          </h1>
          <p className="mt-2 text-white/50">
            Rank your all-time favourite Anime, TV shows and
            Movies. Top 3 get a special spot.
          </p>
        </div>

        <div className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-sm font-semibold text-white/60">
          {favourites.length} / {MAX_FAVOURITES}
        </div>
      </div>

      {/* ADD VIA SEARCH */}
      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex gap-2 border-b border-white/10 pb-3">
          {SEARCH_TYPES.map((type) => {
            const isActive = searchType === type;

            return (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setSearchType(type);
                  setSearchResults([]);
                }}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
                  isActive
                    ? "bg-[var(--accent-soft)] text-white"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                {type}
              </button>
            );
          })}
        </div>

        <form
          onSubmit={handleSearch}
          className="mt-3 flex gap-2"
        >
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${searchType} to add to your Favourite List...`}
            className="h-11 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-white placeholder:text-white/30 focus:border-[var(--accent)] focus:outline-none"
          />

          <button
            type="submit"
            disabled={searching || !searchQuery.trim()}
            className="h-11 rounded-xl bg-white px-5 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {searching ? "Searching..." : "Search"}
          </button>
        </form>

        {searchError && (
          <p className="mt-3 text-sm text-red-300">
            {searchError}
          </p>
        )}

        {searchResults.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {searchResults.map((result) => {
              const contentId = getContentId(
                result.id,
                searchType,
              );

              const already = favouriteIds.has(contentId);
              const isAdding = addingId === contentId;

              return (
                <div
                  key={contentId}
                  className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]"
                >
                  <div className="aspect-[2/3] w-full bg-white/5">
                    {result.image ? (
                      <img
                        src={result.image}
                        alt={result.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-white/20">
                        No image
                      </div>
                    )}
                  </div>

                  <div className="p-2">
                    <p className="truncate text-xs font-semibold text-white/85">
                      {result.title}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={already || isAdding}
                    onClick={() => handleAdd(result)}
                    className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold shadow-lg transition ${
                      already
                        ? "bg-emerald-500/90 text-white"
                        : "bg-white text-black hover:bg-white/90"
                    } disabled:cursor-not-allowed disabled:opacity-70`}
                    title={
                      already
                        ? "Already in Favourite List"
                        : "Add to Favourite List"
                    }
                  >
                    {already ? "✓" : isAdding ? "…" : "+"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* RANKED LIST */}
      <div className="mt-8">
        {loading ? (
          <p className="text-white/40">Loading your Favourite List...</p>
        ) : error ? (
          <p className="text-red-300">{error}</p>
        ) : favourites.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center text-white/40">
            No favourites yet. Search above and tap{" "}
            <span className="font-bold text-white/70">+</span>{" "}
            to add your first one.
          </div>
        ) : (
          <div className="space-y-2.5">
            {favourites.map((item, index) => {
              const rank = index + 1;
              const medal = MEDAL_STYLES[rank];
              const isRemoving = removingId === item.contentId;
              const isDragOver = dragOverIndex === index;

              return (
                <div
                  key={item.contentId}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={() =>
                    setDragOverIndex((current) =>
                      current === index ? null : current,
                    )
                  }
                  onDrop={() => handleDrop(index)}
                  className={`flex items-center gap-3 rounded-2xl border p-3 transition ${
                    medal
                      ? `${medal.ring} bg-white/[0.04] ${medal.glow}`
                      : "border-white/10 bg-white/[0.02]"
                  } ${isDragOver ? "border-[var(--accent)]" : ""} ${
                    reordering ? "opacity-70" : ""
                  }`}
                >
                  {/* DRAG HANDLE */}
                  <span
                    className="cursor-grab select-none px-1 text-white/25 hover:text-white/60 active:cursor-grabbing"
                    title="Drag to reorder"
                  >
                    ⠿
                  </span>

                  {/* RANK BADGE */}
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-black ${
                      medal
                        ? medal.badge
                        : "bg-white/[0.06] text-white/60"
                    }`}
                  >
                    {medal ? medal.label : rank}
                  </div>

                  {/* POSTER */}
                  <div className="h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-white/5">
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-white/20">
                        —
                      </div>
                    )}
                  </div>

                  {/* TITLE */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-white/90">
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-xs text-white/40">
                      {item.contentType}
                      {item.subtitle ? ` · ${item.subtitle}` : ""}
                    </p>
                  </div>

                  {/* UP / DOWN ARROWS */}
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      disabled={index === 0 || reordering}
                      onClick={() => moveByOffset(index, -1)}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-white/40 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                      title="Move up"
                    >
                      ▲
                    </button>

                    <button
                      type="button"
                      disabled={
                        index === favourites.length - 1 ||
                        reordering
                      }
                      onClick={() => moveByOffset(index, 1)}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-white/40 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                      title="Move down"
                    >
                      ▼
                    </button>
                  </div>

                  {/* REMOVE */}
                  <button
                    type="button"
                    disabled={isRemoving}
                    onClick={() => handleRemove(item)}
                    className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/30 transition hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Remove"
                  >
                    {isRemoving ? "…" : "✕"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}