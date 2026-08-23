"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { supabase } from "../lib/supabase";
import RatingStars from "./RatingStars";
import EpisodeTracker from "./EpisodeTracker";
import { fetchAllRatings, upsertRating } from "../lib/ratings";
import RecommendModal from "./RecommendModal";

/* ============================================================
   TYPES
============================================================ */

type ContentType =
  | "Anime"
  | "TV"
  | "Movies"
  | "YouTube";

const CONTENT_TYPES: ContentType[] = [
  "Anime",
  "TV",
  "Movies",
  "YouTube",
];

type YouTubeSearchType =
  | "Videos"
  | "Channels"
  | "Playlists"
  | "Link";

const YOUTUBE_SEARCH_TYPES: YouTubeSearchType[] = [
  "Videos",
  "Channels",
  "Playlists",
  "Link",
];

type ContentItem = {
  id: string | number;
  title: string;
  subtitle?: string | null;
  image?: string | null;
  synopsis?: string | null;
  rating?: number | null;
  year?: number | null;
  date?: string | null;
  episodes?: number | null;
  episodeRuntime?: number | null;
  duration?: string | null;
  runtime?: number | null;
  runtimeSeconds?: number | null;
  youtubeUrlType?: "video" | "playlist" | "channel" | null;
  metaCount?: number | null;
};

type ItemStatus =
  | "watchlist"
  | "watching"
  | "completed"
  | "rewatch"
  | "on_hold"
  | "dropped";

const STATUS_LABELS: Record<ItemStatus, string> = {
  watchlist: "Watchlist",
  watching: "Watching",
  completed: "Completed",
  rewatch: "Rewatch",
  on_hold: "On Hold",
  dropped: "Drop",
};

const STATUS_ICONS: Record<ItemStatus, string> = {
  watchlist: "🔖",
  watching: "▶",
  completed: "✓",
  rewatch: "↻",
  on_hold: "⏸",
  dropped: "✕",
};

const STATUS_COLORS: Record<ItemStatus, string> = {
  watchlist:
    "border-blue-400/60 bg-blue-500/10 text-blue-300",
  watching:
    "border-cyan-400/60 bg-cyan-500/10 text-cyan-300",
  completed:
    "border-emerald-400/70 bg-emerald-500/10 text-emerald-300",
  rewatch:
    "border-purple-400/70 bg-purple-500/10 text-purple-300",
  on_hold:
    "border-yellow-400/70 bg-yellow-500/10 text-yellow-300",
  dropped:
    "border-red-400/70 bg-red-500/10 text-red-300",
};

const STATUS_ORDER: ItemStatus[] = [
  "watchlist",
  "watching",
  "completed",
  "rewatch",
  "on_hold",
  "dropped",
];

const STORAGE_KEY = "universal_browser_status_v1";

/*
 * How many videos are shown per page inside the
 * "Channel Videos" browser. The backend loads every
 * video the channel has (looping through the uploads
 * playlist), and this constant only controls how many
 * of those get displayed on screen at once.
 */
const CHANNEL_VIDEOS_PAGE_SIZE = 25;

/* ============================================================
   LOCAL STORAGE
============================================================ */

function getStoredStatuses(): Record<
  string,
  ItemStatus
> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

function saveStoredStatuses(
  statuses: Record<string, ItemStatus>,
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(statuses),
    );
  } catch {
    // Ignore localStorage errors.
  }
}

/* ============================================================
   RUNTIME HELPERS
   (shared logic, matches Dashboard.tsx conventions so
   watch_sessions stay consistent across the app)
============================================================ */

function parseDurationToMinutes(
  duration?: string | null,
) {
  if (!duration) {
    return null;
  }

  const text = duration.toLowerCase();

  const hourMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:hour|hours|hr|hrs|h)/,
  );

  const minuteMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:minute|minutes|min|mins|m)/,
  );

  let totalMinutes = 0;

  if (hourMatch) {
    totalMinutes += Number(hourMatch[1]) * 60;
  }

  if (minuteMatch) {
    totalMinutes += Number(minuteMatch[1]);
  }

  if (totalMinutes > 0) {
    return Math.round(totalMinutes);
  }

  const plainNumber = Number(text);

  if (Number.isFinite(plainNumber) && plainNumber > 0) {
    return Math.round(plainNumber);
  }

  return null;
}

/*
 * Anime uses a flat 24-min/episode estimate (matches the
 * previous AnimeBrowser behaviour exactly, so existing
 * saved anime watch time stays consistent).
 *
 * Movies/TV/YouTube use actual runtime/duration data
 * returned by the API when available.
 */
function getWatchTimeSeconds(
  item: ContentItem,
  type: ContentType,
): number {
  if (type === "Anime") {
    const episodes = Math.max(
      1,
      Number(item.episodes || 1),
    );

    const minutesPerEpisode = 24;

    return episodes * minutesPerEpisode * 60;
  }

  if (
    typeof item.runtimeSeconds === "number" &&
    item.runtimeSeconds > 0
  ) {
    return Math.round(item.runtimeSeconds);
  }

  if (
    typeof item.runtime === "number" &&
    item.runtime > 0
  ) {
    if (item.runtime > 10000) {
      return Math.round(item.runtime);
    }

    return Math.round(item.runtime * 60);
  }

  if (
    typeof item.episodes === "number" &&
    item.episodes > 0
  ) {
    let episodeMinutes =
      typeof item.episodeRuntime === "number"
        ? item.episodeRuntime
        : null;

    if (!episodeMinutes) {
      episodeMinutes = parseDurationToMinutes(
        item.duration,
      );
    }

    if (
      typeof episodeMinutes === "number" &&
      episodeMinutes > 0
    ) {
      return Math.round(
        item.episodes * episodeMinutes * 60,
      );
    }
  }

  const parsedDuration = parseDurationToMinutes(
    item.duration,
  );

  if (
    typeof parsedDuration === "number" &&
    parsedDuration > 0
  ) {
    return Math.round(parsedDuration * 60);
  }

  return 0;
}

function formatWatchTime(seconds: number): string {
  const totalMinutes = Math.max(
    0,
    Math.round(Number(seconds || 0) / 60),
  );

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h`;
  }

  return `${minutes}m`;
}

/* ============================================================
   CONTENT ID
   Matches Dashboard.tsx's getContentId() convention exactly:
   `${type.toLowerCase()}-${id}` so watch_sessions rows line
   up between this browser and the Dashboard search box.
============================================================ */

function getContentId(
  item: ContentItem,
  type: ContentType,
) {
  return `${type.toLowerCase()}-${String(item.id)}`;
}

/*
 * Fetches accurate runtime for a single movie or TV
 * item from the *-details API routes (search results
 * don't include runtime). Returns seconds, or 0 if
 * unavailable/failed.
 */
async function fetchAccurateRuntimeSeconds(
  item: ContentItem,
  type: ContentType,
): Promise<number> {
  try {
    if (type === "Movies") {
      const res = await fetch(
        `/api/tmdb/movie-details?id=${encodeURIComponent(
          String(item.id),
        )}`,
        { cache: "no-store" },
      );

      if (!res.ok) {
        return 0;
      }

      const data = await res.json();

      const runtime = Number(data?.runtime);

      return Number.isFinite(runtime) && runtime > 0
        ? Math.round(runtime * 60)
        : 0;
    }

    if (type === "TV") {
      const res = await fetch(
        `/api/tmdb/tv-details?id=${encodeURIComponent(
          String(item.id),
        )}`,
        { cache: "no-store" },
      );

      if (!res.ok) {
        return 0;
      }

      const data = await res.json();

      const episodeRuntime = Number(
        data?.episodeRuntime,
      );

      const episodes =
        Number(data?.numberOfEpisodes) ||
        Number(item.episodes) ||
        0;

      if (
        Number.isFinite(episodeRuntime) &&
        episodeRuntime > 0 &&
        episodes > 0
      ) {
        return Math.round(
          episodes * episodeRuntime * 60,
        );
      }

      return 0;
    }

    return 0;
  } catch (err) {
    console.warn(
      `Failed to fetch runtime for ${type} #${item.id}:`,
      err,
    );

    return 0;
  }
}

/*
 * TV search results don't include episode count either
 * (only the tv-details route does). Used as a fallback in
 * syncWatchlistItem when item.episodes is missing.
 */
async function fetchAccurateEpisodeCount(
  item: ContentItem,
): Promise<number | null> {
  try {
    const res = await fetch(
      `/api/tmdb/tv-details?id=${encodeURIComponent(
        String(item.id),
      )}`,
      { cache: "no-store" },
    );

    if (!res.ok) {
      return null;
    }

    const data = await res.json();

    const episodes = Number(data?.numberOfEpisodes);

    return Number.isFinite(episodes) && episodes > 0
      ? episodes
      : null;
  } catch (err) {
    console.warn(
      `Failed to fetch episode count for TV #${item.id}:`,
      err,
    );

    return null;
  }
}

/* ============================================================
   API FETCH + NORMALIZERS
============================================================ */

async function fetchJson(url: string) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const contentType =
    response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    await response.text();

    throw new Error(
      response.status === 404
        ? `API route not found: ${url}`
        : `Server returned non-JSON response (${response.status}).`,
    );
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error ||
        data?.message ||
        `Request failed with status ${response.status}.`,
    );
  }

  return data;
}

function yearFromDate(date?: string | null) {
  if (!date) {
    return null;
  }

  const year = Number(String(date).slice(0, 4));

  return Number.isFinite(year) && year > 0
    ? year
    : null;
}

function normalizeMovies(data: any): {
  items: ContentItem[];
  hasNextPage: boolean;
} {
  const results = data?.results || [];

  const items: ContentItem[] = results.map(
    (movie: any) => ({
      id: movie.tmdb_id ?? movie.id,
      title:
        movie.title ||
        movie.name ||
        "Untitled Movie",
      subtitle: movie.original_title || "Movie",
      image: movie.poster_path
        ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
        : null,
      synopsis: movie.overview || null,
      rating:
        typeof movie.vote_average === "number"
          ? movie.vote_average
          : null,
      date: movie.release_date || null,
      year: yearFromDate(movie.release_date),
      runtimeSeconds:
        typeof movie.runtime_seconds === "number"
          ? movie.runtime_seconds
          : null,
      runtime:
        typeof movie.runtime === "number"
          ? movie.runtime
          : null,
    }),
  );

  const totalPages = Number(data?.total_pages) || 0;
  const currentPage = Number(data?.page) || 1;

  return {
    items,
    hasNextPage: totalPages
      ? currentPage < totalPages
      : items.length >= 20,
  };
}

function normalizeTV(data: any): {
  items: ContentItem[];
  hasNextPage: boolean;
} {
  const results = data?.results || [];

  const items: ContentItem[] = results.map(
    (show: any) => ({
      id: show.tmdb_id ?? show.id,
      title:
        show.name ||
        show.original_name ||
        "Untitled TV Show",
      subtitle: show.original_name || "TV Show",
      image: show.poster_path
        ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
        : null,
      synopsis: show.overview || null,
      rating:
        typeof show.vote_average === "number"
          ? show.vote_average
          : null,
      date: show.first_air_date || null,
      year: yearFromDate(show.first_air_date),
      runtimeSeconds:
        typeof show.runtime_seconds === "number"
          ? show.runtime_seconds
          : null,
      runtime:
        typeof show.runtime === "number"
          ? show.runtime
          : null,
      episodes:
        typeof show.number_of_episodes === "number"
          ? show.number_of_episodes
          : null,
      episodeRuntime:
        Array.isArray(show.episode_run_time) &&
        typeof show.episode_run_time[0] === "number"
          ? show.episode_run_time[0]
          : null,
    }),
  );

  const totalPages = Number(data?.total_pages) || 0;
  const currentPage = Number(data?.page) || 1;

  return {
    items,
    hasNextPage: totalPages
      ? currentPage < totalPages
      : items.length >= 20,
  };
}

function normalizeAnime(data: any): {
  items: ContentItem[];
  hasNextPage: boolean;
} {
  const results =
    data?.data || data?.anime || data?.results || [];

  const items: ContentItem[] = (
    Array.isArray(results) ? results : []
  ).map((anime: any) => {
    const image =
      anime?.images?.jpg?.large_image_url ||
      anime?.images?.jpg?.image_url ||
      anime?.poster_path ||
      anime?.image ||
      null;

    return {
      id: anime.mal_id ?? anime.id,
      title:
        anime.title_english ||
        anime.title ||
        "Untitled Anime",
      subtitle: anime.title || null,
      image,
      synopsis: anime.synopsis || null,
      rating:
        typeof anime.score === "number"
          ? anime.score
          : null,
      year:
        anime.year ??
        yearFromDate(anime.aired?.from),
      date: anime.aired?.from
        ? String(anime.aired.from).slice(0, 10)
        : null,
      episodes:
        typeof anime.episodes === "number"
          ? anime.episodes
          : null,
      episodeRuntime:
        typeof anime.duration_minutes === "number"
          ? anime.duration_minutes
          : null,
      duration: anime.duration || null,
    };
  });

  return {
    items,
    hasNextPage: Boolean(
      data?.pagination?.has_next_page ??
        data?.hasNextPage ??
        false,
    ),
  };
}

function normalizeYouTube(data: any): {
  items: ContentItem[];
  hasNextPage: boolean;
} {
  const results =
    data?.results || data?.items || data?.videos || [];

  const items: ContentItem[] = results.map(
    (video: any) => {
      const snippet = video?.snippet || {};

      const kind: string =
        video?.id?.kind ||
        video?.kind ||
        "youtube#video";

      let youtubeUrlType:
        | "video"
        | "playlist"
        | "channel" = "video";

      let resolvedId: string | number =
        Math.random().toString(36);

      if (
        kind.includes("channel") ||
        video?.id?.channelId
      ) {
        youtubeUrlType = "channel";
        resolvedId =
          video?.id?.channelId ||
          video?.channelId ||
          video?.id;
      } else if (
        kind.includes("playlist") ||
        video?.id?.playlistId
      ) {
        youtubeUrlType = "playlist";
        resolvedId =
          video?.id?.playlistId ||
          video?.playlistId ||
          video?.id;
      } else {
        youtubeUrlType = "video";
        resolvedId =
          video?.id?.videoId ||
          video?.videoId ||
          video?.id ||
          Math.random().toString(36);
      }

      const thumbnail =
        snippet?.thumbnails?.high?.url ||
        snippet?.thumbnails?.medium?.url ||
        snippet?.thumbnails?.default?.url ||
        video?.thumbnail ||
        null;

      const metaCount =
        youtubeUrlType === "channel"
          ? Number(video.subscriber_count) || null
          : youtubeUrlType === "playlist"
            ? Number(video.item_count) || null
            : null;

      return {
        id: resolvedId,
        title:
          snippet?.title || video?.title || "YouTube",
        subtitle:
          youtubeUrlType === "video"
            ? snippet?.channelTitle ||
              video?.channelTitle ||
              "YouTube"
            : youtubeUrlType === "channel"
              ? "YouTube Channel"
              : "YouTube Playlist",
        image: thumbnail,
        synopsis:
          snippet?.description ||
          video?.description ||
          null,
        rating: null,
        date: snippet?.publishedAt
          ? String(snippet.publishedAt).slice(0, 10)
          : null,
        year: yearFromDate(snippet?.publishedAt),
        runtimeSeconds:
          youtubeUrlType === "video" &&
          typeof video.runtime_seconds === "number"
            ? video.runtime_seconds
            : null,
        youtubeUrlType,
        metaCount,
      };
    },
  );

  return {
    items,
    // YouTube pagination (pageToken) isn't wired up yet;
    // showing a single page of results/lookup for now.
    hasNextPage: false,
  };
}

/* ============================================================
   UNIVERSAL BROWSER
============================================================ */

export default function UniversalBrowser() {
  const [contentType, setContentType] =
    useState<ContentType>("Anime");

  const [searchQuery, setSearchQuery] =
    useState("");

  const [youtubeSearchType, setYoutubeSearchType] =
    useState<YouTubeSearchType>("Videos");

  const [items, setItems] = useState<ContentItem[]>(
    [],
  );

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [page, setPage] = useState(1);

  const [hasNextPage, setHasNextPage] =
    useState(false);

  const [statuses, setStatuses] = useState<
    Record<string, ItemStatus>
  >({});

  /*
   * Ratings, keyed by contentId (e.g. "movies-1234").
   * Loaded once on mount, updated optimistically when
   * the user taps a star on a card or in the modal.
   */
  const [ratings, setRatings] = useState<
    Record<string, number>
  >({});

  const [menuOpen, setMenuOpen] = useState<
    string | null
  >(null);

  const [selectedItem, setSelectedItem] =
    useState<ContentItem | null>(null);
    const [showRecommendModal, setShowRecommendModal] = useState(false);

  const [savingId, setSavingId] = useState<
    string | null
  >(null);

  /*
   * TMDB's search endpoints don't include runtime
   * data. Once search results load, we fetch the
   * real runtime per item in the background and
   * store it here, keyed by contentId (seconds).
   */
  const [runtimeOverrides, setRuntimeOverrides] =
    useState<Record<string, number>>({});

  /*
   * CHANNEL VIDEOS BROWSER
   *
   * activeChannel: which channel the user drilled into
   * (null when browsing normal search results).
   *
   * channelVideos: EVERY video for that channel, loaded
   * once from the backend (which itself loops through
   * the channel's uploads playlist + pagination tokens
   * server-side, so by the time it reaches us it's the
   * full list, not just one API page).
   *
   * channelPage: which 25-video slice of channelVideos
   * we're currently displaying (client-side pagination
   * over data that's already fully loaded).
   *
   * selectedVideoIds: video ids the user has checked,
   * kept across page changes so "Mark Complete" can act
   * on selections spanning multiple pages at once.
   */
  const [activeChannel, setActiveChannel] = useState<{
    id: string;
    title: string;
  } | null>(null);

  const [channelVideos, setChannelVideos] = useState<
    ContentItem[]
  >([]);

  const [channelVideosLoading, setChannelVideosLoading] =
    useState(false);

  const [channelVideosError, setChannelVideosError] =
    useState("");

  const [channelPage, setChannelPage] = useState(1);

  const [selectedVideoIds, setSelectedVideoIds] = useState<
    Set<string>
  >(new Set());

  const [markingSelected, setMarkingSelected] =
    useState(false);

  const menuRef = useRef<HTMLDivElement | null>(null);

  /*
   * Load saved statuses.
   */
  useEffect(() => {
    setStatuses(getStoredStatuses());
  }, []);

  /*
   * Load saved ratings.
   */
  useEffect(() => {
    fetchAllRatings().then(setRatings);
  }, []);

  /*
   * Close 3-dot / actions menu when clicking outside.
   */
  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(
          event.target as Node,
        )
      ) {
        setMenuOpen(null);
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
   * Load content from the right API for the
   * selected content type.
   */
  const loadContent = useCallback(
    async (
      type: ContentType,
      query: string,
      currentPage: number,
      ytType: YouTubeSearchType,
    ) => {
      if (!query.trim()) {
        return;
      }

      setLoading(true);
      setError("");
      setMenuOpen(null);

      try {
        let result: {
          items: ContentItem[];
          hasNextPage: boolean;
        };

        if (type === "Movies") {
          const data = await fetchJson(
            `/api/tmdb/movies?query=${encodeURIComponent(
              query,
            )}&page=${currentPage}`,
          );

          result = normalizeMovies(data);
        } else if (type === "TV") {
          const data = await fetchJson(
            `/api/tmdb/tv?query=${encodeURIComponent(
              query,
            )}&page=${currentPage}`,
          );

          result = normalizeTV(data);
        } else if (type === "YouTube") {
          const params = new URLSearchParams();

          if (ytType === "Link") {
            params.set("link", query.trim());
          } else {
            params.set("query", query.trim());
            params.set(
              "type",
              ytType === "Channels"
                ? "channel"
                : ytType === "Playlists"
                  ? "playlist"
                  : "video",
            );
          }

          const data = await fetchJson(
            `/api/youtube?${params.toString()}`,
          );

          result = normalizeYouTube(data);
        } else {
          const params = new URLSearchParams({
            q: query.trim(),
            page: String(currentPage),
            limit: "24",
          });

          const data = await fetchJson(
            `/api/anime?${params.toString()}`,
          );

          result = normalizeAnime(data);
        }

        setItems(result.items);
        setHasNextPage(result.hasNextPage);

        if (result.items.length === 0) {
          setError(
            `No ${type} results found for "${query}".`,
          );
        }

        /*
         * Movies/TV search results don't include
         * runtime. Fetch the real runtime for each
         * item in the background (fire-and-forget)
         * and fill it in as it arrives, instead of
         * blocking the initial render.
         */
        if (type === "Movies" || type === "TV") {
          result.items.forEach((resultItem) => {
            const contentId = getContentId(
              resultItem,
              type,
            );

            fetchAccurateRuntimeSeconds(
              resultItem,
              type,
            ).then((seconds) => {
              if (seconds > 0) {
                setRuntimeOverrides((current) => ({
                  ...current,
                  [contentId]: seconds,
                }));
              }
            });
          });
        }
      } catch (err) {
        console.error(
          `Failed to load ${type}:`,
          err,
        );

        setItems([]);

        setError(
          err instanceof Error
            ? err.message
            : `Failed to load ${type}.`,
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  /*
   * Loads EVERY video for a channel in one shot.
   *
   * The backend route (/api/youtube/channel-videos)
   * resolves the channel's "uploads" playlist and pages
   * through it (nextPageToken) until there's nothing
   * left, fetching real durations along the way — so
   * this single request returns the channel's complete
   * video list already. We then paginate that list 25
   * at a time purely on the client (see channelPage).
   */
  const loadChannelVideos = useCallback(
    async (channelId: string) => {
      setChannelVideosLoading(true);
      setChannelVideosError("");
      setChannelVideos([]);
      setChannelPage(1);
      setSelectedVideoIds(new Set());

      try {
        const data = await fetchJson(
          `/api/youtube/channel-videos?channelId=${encodeURIComponent(
            channelId,
          )}`,
        );

        const rawItems =
          data?.items || data?.videos || data?.results || [];

        const videos: ContentItem[] = (
          Array.isArray(rawItems) ? rawItems : []
        ).map((video: any) => ({
          id:
            video.videoId ||
            video.id ||
            Math.random().toString(36),
          title: video.title || "Untitled",
          subtitle: video.channelTitle || null,
          image:
            video.thumbnail ||
            video?.snippet?.thumbnails?.medium?.url ||
            video?.snippet?.thumbnails?.default?.url ||
            null,
          synopsis: video.description || null,
          date: video.publishedAt
            ? String(video.publishedAt).slice(0, 10)
            : null,
          year: yearFromDate(video.publishedAt),
          duration: video.duration || null,
          runtimeSeconds:
            typeof video.runtimeSeconds === "number"
              ? video.runtimeSeconds
              : typeof video.runtime_seconds === "number"
                ? video.runtime_seconds
                : null,
          youtubeUrlType: "video",
        }));

        setChannelVideos(videos);

        if (videos.length === 0) {
          setChannelVideosError(
            "This channel has no videos, or they couldn't be loaded.",
          );
        }
      } catch (err) {
        console.error(
          "Failed to load channel videos:",
          err,
        );

        setChannelVideosError(
          err instanceof Error
            ? err.message
            : "Failed to load channel videos.",
        );
      } finally {
        setChannelVideosLoading(false);
      }
    },
    [],
  );

  function openChannel(item: ContentItem) {
    const channelId = String(item.id);

    setActiveChannel({
      id: channelId,
      title: item.title,
    });

    loadChannelVideos(channelId);
  }

  function closeChannel() {
    setActiveChannel(null);
    setChannelVideos([]);
    setChannelVideosError("");
    setChannelPage(1);
    setSelectedVideoIds(new Set());
  }

  /*
   * Initial + type-change search.
   */
  useEffect(() => {
    setPage(1);
    loadContent(contentType, searchQuery, 1, youtubeSearchType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentType]);

  /*
   * Rate an item (any content type, including channel
   * videos). Optimistic update, rolled back on failure.
   */
  async function handleRateItem(
    item: ContentItem,
    type: ContentType,
    ratingValue: number,
  ) {
    const contentId = getContentId(item, type);
    const previous = ratings[contentId];

    setRatings((current) => ({
      ...current,
      [contentId]: ratingValue,
    }));

    try {
      await upsertRating({
        contentId,
        category: type,
        title: item.title,
        image: item.image,
        rating: ratingValue,
      });
    } catch (err) {
      setRatings((current) => {
        const rollback = { ...current };

        if (typeof previous === "number") {
          rollback[contentId] = previous;
        } else {
          delete rollback[contentId];
        }

        return rollback;
      });

      alert(
        err instanceof Error
          ? err.message
          : "Failed to save rating.",
      );
    }
  }

  /*
   * COMPLETED -> watch_sessions
   *
   * We ONLY use total_seconds here (matches the
   * watch_sessions schema used across the app).
   *
   * Existing session:
   *   keep the larger of existing watch time vs.
   *   estimated full runtime.
   *
   * New session:
   *   create one completed session.
   *
   * content_id + category match Dashboard.tsx's
   * convention exactly, so the category cards on the
   * Dashboard reflect this correctly.
   *
   * If the background runtime fetch hasn't landed yet
   * (runtimeOverrides is still empty for this item),
   * we fetch it directly here and await it before
   * giving up — avoids a race condition where clicking
   * "Completed" right after search results load fails
   * with "Runtime is not available".
   */
  async function syncCompletedWatchTime(
    item: ContentItem,
    type: ContentType,
  ) {
    const contentId = getContentId(item, type);

    let estimatedSeconds = resolveWatchTimeSeconds(
      item,
      type,
    );

    if (
      estimatedSeconds <= 0 &&
      (type === "Movies" || type === "TV")
    ) {
      const freshSeconds =
        await fetchAccurateRuntimeSeconds(
          item,
          type,
        );

      if (freshSeconds > 0) {
        estimatedSeconds = freshSeconds;

        setRuntimeOverrides((current) => ({
          ...current,
          [contentId]: freshSeconds,
        }));
      }
    }

    const skipsRuntimeCheck =
      type === "YouTube" &&
      item.youtubeUrlType !== "video" &&
      item.youtubeUrlType != null;

    if (estimatedSeconds <= 0 && !skipsRuntimeCheck) {
      throw new Error(
        `Runtime is not available for "${item.title}".`,
      );
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    if (!user) {
      throw new Error(
        "Please login before saving watch status.",
      );
    }

    const {
      data: existingSessions,
      error: findError,
    } = await supabase
      .from("watch_sessions")
      .select(
        "id,total_seconds,content_id,category,is_active",
      )
      .eq("user_id", user.id)
      .eq("content_id", contentId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (findError) {
      throw findError;
    }

    const existing = existingSessions?.[0];

    if (existing) {
      const currentSeconds = Math.max(
        0,
        Number(existing.total_seconds || 0),
      );

      const finalSeconds = Math.max(
        currentSeconds,
        estimatedSeconds,
      );

      const { error: updateError } = await supabase
        .from("watch_sessions")
        .update({
          total_seconds: finalSeconds,
          is_active: false,
          category: type,
          last_heartbeat: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("user_id", user.id);

      if (updateError) {
        throw updateError;
      }

      return;
    }

    const now = new Date().toISOString();

    const { error: insertError } = await supabase
      .from("watch_sessions")
      .insert({
        user_id: user.id,
        content_id: contentId,
        started_at: now,
        last_heartbeat: now,
        is_active: false,
        total_seconds: estimatedSeconds,
        category: type,
      });

    if (insertError) {
      throw insertError;
    }
  }

  /*
   * WATCHLIST_ITEMS SYNC
   *
   * Upserts this item's metadata (title, image, status,
   * estimated runtime, total episode count) into
   * watchlist_items — for EVERY status, not just
   * "completed". This is what Dashboard's "Continue
   * Watching" section reads from, since localStorage
   * (statuses above) only has ids, no title/image to
   * render a card with.
   *
   * TV search results don't include episode count (only
   * the tv-details route does), so we fall back to
   * fetching it directly here when missing — this is what
   * lets the "Mark Next Episode" button on the Dashboard
   * show up for TV shows added straight from search
   * results.
   *
   * Failures here are logged but never thrown — the
   * status change itself already succeeded via
   * localStorage, and this is just an extra sync for the
   * Dashboard. Not logged in -> silently skipped.
   */
  async function syncWatchlistItem(
    item: ContentItem,
    type: ContentType,
    newStatus: ItemStatus,
  ) {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return;
      }

      const contentId = getContentId(item, type);
      const estimatedSeconds = resolveWatchTimeSeconds(
        item,
        type,
      );

      let totalEpisodes =
        typeof item.episodes === "number" &&
        item.episodes > 0
          ? item.episodes
          : null;

      if (!totalEpisodes && type === "TV") {
        totalEpisodes = await fetchAccurateEpisodeCount(
          item,
        );
      }

      const { error } = await supabase
        .from("watchlist_items")
        .upsert(
          {
            user_id: user.id,
            content_id: contentId,
            category: type,
            title: item.title,
            image_url: item.image ?? null,
            status: newStatus,
            estimated_seconds: estimatedSeconds,
            total_episodes: totalEpisodes,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,content_id" },
        );

      if (error) {
        console.error(
          "Failed to sync watchlist item:",
          error,
        );
      }
    } catch (err) {
      console.error(
        "Failed to sync watchlist item:",
        err,
      );
    }
  }

  /*
   * Save status for an item (any content type).
   */
  async function saveItemStatus(
    item: ContentItem,
    type: ContentType,
    newStatus: ItemStatus,
  ) {
    const id = getContentId(item, type);

    if (savingId === id) {
      return;
    }

    const previousStatus = statuses[id] || null;

    setSavingId(id);

    const nextStatuses = {
      ...statuses,
      [id]: newStatus,
    };

    setStatuses(nextStatuses);
    saveStoredStatuses(nextStatuses);

    try {
      if (newStatus === "completed") {
        await syncCompletedWatchTime(item, type);
      }

      await syncWatchlistItem(item, type, newStatus);

      setMenuOpen(null);
      setSelectedItem(null);

      window.dispatchEvent(
        new CustomEvent(
          "universal-browser-status-changed",
          {
            detail: {
              contentId: id,
              type,
              title: item.title,
              status: newStatus,
            },
          },
        ),
      );
    } catch (err) {
      console.error(
        "Failed to save status:",
        err,
      );

      const rollback = { ...statuses };

      if (previousStatus) {
        rollback[id] = previousStatus;
      } else {
        delete rollback[id];
      }

      setStatuses(rollback);
      saveStoredStatuses(rollback);

      alert(
        err instanceof Error
          ? err.message
          : "Failed to save status.",
      );
    } finally {
      setSavingId(null);
    }
  }

  /*
   * REMOVE ITEM
   *
   * Fully removes an item — not just clearing its status.
   * Deletes the watchlist_items row AND any matching
   * watch_sessions rows for this content, so watch time
   * totals (Dashboard cards, weekly chart, Continue
   * Watching) all update correctly, not just the status
   * badge on this card.
   */
  async function removeItem(
    item: ContentItem,
    type: ContentType,
  ) {
    const id = getContentId(item, type);

    if (savingId === id) {
      return;
    }

    const confirmed = window.confirm(
      `Remove "${item.title}" completely? This also deletes its saved watch time.`,
    );

    if (!confirmed) {
      return;
    }

    setSavingId(id);

    const previousStatus = statuses[id] || null;

    const nextStatuses = { ...statuses };
    delete nextStatuses[id];

    setStatuses(nextStatuses);
    saveStoredStatuses(nextStatuses);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        throw new Error(
          "Please login before removing items.",
        );
      }

      const { error: watchlistError } = await supabase
        .from("watchlist_items")
        .delete()
        .eq("user_id", user.id)
        .eq("content_id", id);

      if (watchlistError) {
        throw watchlistError;
      }

      const { error: sessionsError } = await supabase
        .from("watch_sessions")
        .delete()
        .eq("user_id", user.id)
        .eq("content_id", id);

      if (sessionsError) {
        throw sessionsError;
      }

      setMenuOpen(null);
      setSelectedItem(null);

      window.dispatchEvent(
        new CustomEvent(
          "universal-browser-status-changed",
          {
            detail: {
              contentId: id,
              type,
              title: item.title,
              status: null,
            },
          },
        ),
      );
    } catch (err) {
      console.error("Failed to remove item:", err);

      const rollback = { ...statuses };

      if (previousStatus) {
        rollback[id] = previousStatus;
      }

      setStatuses(rollback);
      saveStoredStatuses(rollback);

      alert(
        err instanceof Error
          ? err.message
          : "Failed to remove item.",
      );
    } finally {
      setSavingId(null);
    }
  }

  /*
   * Selection stays keyed by raw video id (not the
   * "youtube-<id>" contentId) so it lines up with
   * whatever the checkboxes render against.
   */
  function toggleVideoSelected(videoId: string) {
    setSelectedVideoIds((current) => {
      const next = new Set(current);

      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }

      return next;
    });
  }

  function selectAllOnCurrentPage(
    pageItems: ContentItem[],
  ) {
    setSelectedVideoIds((current) => {
      const next = new Set(current);

      pageItems.forEach((video) => {
        next.add(String(video.id));
      });

      return next;
    });
  }

  function clearSelectedVideos() {
    setSelectedVideoIds(new Set());
  }

  /*
   * Marks every selected video (which may span several
   * pages of the channel's video list) as "completed",
   * one at a time, reusing the same saveItemStatus path
   * normal search results use — so it writes to
   * watch_sessions and shows up on the Dashboard the
   * same way.
   */
  async function markSelectedVideosComplete() {
    if (selectedVideoIds.size === 0 || markingSelected) {
      return;
    }

    setMarkingSelected(true);

    const targets = channelVideos.filter((video) =>
      selectedVideoIds.has(String(video.id)),
    );

    for (const video of targets) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await saveItemStatus(
          video,
          "YouTube",
          "completed",
        );
      } catch (err) {
        console.error(
          `Failed to mark video ${video.id} complete:`,
          err,
        );
      }
    }

    setMarkingSelected(false);
    clearSelectedVideos();
  }

  function handleSearch() {
    setPage(1);
    loadContent(contentType, searchQuery, 1, youtubeSearchType);
  }

  function handleNextPage() {
    if (!hasNextPage || loading) {
      return;
    }

    const nextPage = page + 1;

    setPage(nextPage);
    loadContent(contentType, searchQuery, nextPage, youtubeSearchType);

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handlePreviousPage() {
    if (page <= 1 || loading) {
      return;
    }

    const previousPage = page - 1;

    setPage(previousPage);
    loadContent(
      contentType,
      searchQuery,
      previousPage,
      youtubeSearchType,
    );

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /*
   * Prefers the accurate runtime fetched from the
   * *-details routes (runtimeOverrides) when
   * available, otherwise falls back to the estimate
   * derived from search-result data.
   */
  function resolveWatchTimeSeconds(
    item: ContentItem,
    type: ContentType,
  ): number {
    const contentId = getContentId(item, type);

    const override = runtimeOverrides[contentId];

    if (typeof override === "number" && override > 0) {
      return override;
    }

    return getWatchTimeSeconds(item, type);
  }

  function getStatus(
    item: ContentItem,
    type: ContentType,
  ): ItemStatus | null {
    return statuses[getContentId(item, type)] || null;
  }

  function getImage(item: ContentItem) {
    return (
      item.image ||
      "https://placehold.co/600x900/111827/ffffff?text=No+Image"
    );
  }

  function getTitle(item: ContentItem) {
    return item.title || "Untitled";
  }

  /*
   * Per-episode runtime estimate (minutes) to hand to
   * EpisodeTracker for a given item — prefers the item's
   * own episodeRuntime (TV: episode_run_time[0], Anime:
   * duration_minutes from Jikan), falls back to parsing
   * the free-text `duration` string.
   */
  function resolveFallbackRuntimeMinutes(
    item: ContentItem,
  ): number | null {
    if (
      typeof item.episodeRuntime === "number" &&
      item.episodeRuntime > 0
    ) {
      return item.episodeRuntime;
    }

    return parseDurationToMinutes(item.duration);
  }

  /*
   * CHANNEL VIDEOS SCREEN
   * Rendered instead of the normal browser whenever the
   * user has drilled into a channel. All of the channel's
   * videos are already loaded (channelVideos); this just
   * slices out 25 at a time for display.
   */
  if (activeChannel) {
    const totalChannelPages = Math.max(
      1,
      Math.ceil(
        channelVideos.length / CHANNEL_VIDEOS_PAGE_SIZE,
      ),
    );

    const channelPageItems = channelVideos.slice(
      (channelPage - 1) * CHANNEL_VIDEOS_PAGE_SIZE,
      channelPage * CHANNEL_VIDEOS_PAGE_SIZE,
    );

    return (
      <section className="min-h-screen bg-[#070711] px-4 py-8 text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          {/* HEADER */}
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <button
                type="button"
                onClick={closeChannel}
                className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/50 transition hover:text-white"
              >
                ← Back to search
              </button>

              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                {activeChannel.title}
              </h1>

              <p className="mt-2 text-white/50">
                {channelVideosLoading
                  ? "Loading every video for this channel..."
                  : `${channelVideos.length} video${
                      channelVideos.length === 1
                        ? ""
                        : "s"
                    } loaded`}
              </p>
            </div>
          </div>

          {/* SELECTION BAR */}
          {channelVideos.length > 0 && (
            <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <span className="text-sm text-white/60">
                {selectedVideoIds.size} selected
              </span>

              <button
                type="button"
                onClick={() =>
                  selectAllOnCurrentPage(
                    channelPageItems,
                  )
                }
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold transition hover:bg-white/10"
              >
                Select all on this page
              </button>

              <button
                type="button"
                disabled={selectedVideoIds.size === 0}
                onClick={clearSelectedVideos}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear selection
              </button>

              <button
                type="button"
                disabled={
                  selectedVideoIds.size === 0 ||
                  markingSelected
                }
                onClick={markSelectedVideosComplete}
                className="ml-auto rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {markingSelected
                  ? "Marking complete..."
                  : `✓ Mark ${selectedVideoIds.size || ""} Complete`}
              </button>
            </div>
          )}

          {/* ERROR */}
          {channelVideosError && (
            <div className="mb-6 rounded-2xl border border-red-500/50 bg-red-500/10 p-5">
              <p className="font-semibold text-red-300">
                Channel videos
              </p>

              <p className="mt-1 text-red-200/80">
                {channelVideosError}
              </p>

              <button
                type="button"
                onClick={() =>
                  loadChannelVideos(activeChannel.id)
                }
                className="mt-4 rounded-lg border border-red-400/30 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/10"
              >
                Try Again
              </button>
            </div>
          )}

          {/* LOADING */}
          {channelVideosLoading && (
            <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map(
                (_, index) => (
                  <div
                    key={index}
                    className="overflow-hidden rounded-2xl border border-white/10 bg-[#11111a]"
                  >
                    <div className="aspect-video animate-pulse bg-white/5" />

                    <div className="space-y-3 p-4">
                      <div className="h-5 animate-pulse rounded bg-white/5" />
                      <div className="h-4 w-2/3 animate-pulse rounded bg-white/5" />
                    </div>
                  </div>
                ),
              )}
            </div>
          )}

          {/* VIDEO GRID */}
          {!channelVideosLoading &&
            channelPageItems.length > 0 && (
              <>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {channelPageItems.map((video) => {
                    const videoId = String(video.id);

                    const isSelected =
                      selectedVideoIds.has(videoId);

                    const status = getStatus(
                      video,
                      "YouTube",
                    );

                    const watchSeconds =
                      resolveWatchTimeSeconds(
                        video,
                        "YouTube",
                      );

                    const videoContentId = getContentId(
                      video,
                      "YouTube",
                    );

                    return (
                      <article
                        key={videoId}
                        className={`group relative overflow-hidden rounded-2xl border bg-[#11111a] shadow-xl shadow-black/20 transition ${
                          isSelected
                            ? "border-emerald-400/70"
                            : "border-white/10 hover:border-white/20"
                        }`}
                      >
                        {/* THUMBNAIL */}
                        <div className="relative aspect-video overflow-hidden bg-black">
                          <img
                            src={getImage(video)}
                            alt={getTitle(video)}
                            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                            loading="lazy"
                          />

                          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/90 to-transparent" />

                          {/* SELECT CHECKBOX */}
                          <button
                            type="button"
                            onClick={() =>
                              toggleVideoSelected(
                                videoId,
                              )
                            }
                            aria-pressed={isSelected}
                            aria-label={
                              isSelected
                                ? `Deselect ${getTitle(video)}`
                                : `Select ${getTitle(video)}`
                            }
                            className={`absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border text-sm font-bold backdrop-blur-md transition ${
                              isSelected
                                ? "border-emerald-400 bg-emerald-500 text-black"
                                : "border-white/30 bg-black/60 text-transparent hover:border-white/60"
                            }`}
                          >
                            ✓
                          </button>

                          {/* RUNTIME */}
                          {watchSeconds > 0 && (
                            <span className="absolute bottom-2 right-2 rounded bg-black/80 px-2 py-0.5 text-xs font-semibold">
                              {formatWatchTime(
                                watchSeconds,
                              )}
                            </span>
                          )}

                          {status && (
                            <div
                              className={`absolute right-2 top-2 rounded-full border px-2 py-0.5 text-xs font-semibold backdrop-blur-md ${STATUS_COLORS[status]}`}
                            >
                              {STATUS_ICONS[status]}
                            </div>
                          )}
                        </div>

                        {/* BODY */}
                        <div className="p-3">
                          <h2 className="line-clamp-2 min-h-[2.75rem] text-sm font-bold leading-6">
                            {getTitle(video)}
                          </h2>

                          {video.date && (
                            <p className="mt-1 text-xs text-white/40">
                              {video.date}
                            </p>
                          )}

                          <div className="mt-2">
                            <RatingStars
                              value={
                                ratings[videoContentId] ??
                                null
                              }
                              onRate={(value) =>
                                handleRateItem(
                                  video,
                                  "YouTube",
                                  value,
                                )
                              }
                            />
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                saveItemStatus(
                                  video,
                                  "YouTube",
                                  "completed",
                                )
                              }
                              className={`h-9 rounded-lg text-xs font-semibold transition ${
                                status === "completed"
                                  ? "border border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                                  : "bg-white text-black hover:bg-white/90"
                              }`}
                            >
                              {status === "completed"
                                ? "✓ Done"
                                : "Mark Complete"}
                            </button>

                            <a
                              href={`https://www.youtube.com/watch?v=${video.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex h-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-xs font-semibold text-white transition hover:bg-white/10"
                            >
                              Watch
                            </a>
                          </div>

                          {status && (
                            <button
                              type="button"
                              disabled={
                                savingId ===
                                videoContentId
                              }
                              onClick={() =>
                                removeItem(
                                  video,
                                  "YouTube",
                                )
                              }
                              className="mt-2 h-8 w-full rounded-lg border border-red-400/30 bg-red-500/10 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              🗑 Remove
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>

                {/* CHANNEL PAGINATION */}
                <div className="mt-8 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    disabled={channelPage <= 1}
                    onClick={() =>
                      setChannelPage((current) =>
                        Math.max(1, current - 1),
                      )
                    }
                    className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    ← Previous
                  </button>

                  <span className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm text-white/60">
                    Page {channelPage} of{" "}
                    {totalChannelPages}
                  </span>

                  <button
                    type="button"
                    disabled={
                      channelPage >= totalChannelPages
                    }
                    onClick={() =>
                      setChannelPage((current) =>
                        Math.min(
                          totalChannelPages,
                          current + 1,
                        ),
                      )
                    }
                    className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Next →
                  </button>
                </div>
              </>
            )}

          {/* EMPTY */}
          {!channelVideosLoading &&
            !channelVideosError &&
            channelVideos.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-12 text-center">
                <p className="text-lg font-semibold">
                  No videos found
                </p>

                <p className="mt-2 text-sm text-white/40">
                  This channel doesn't have any videos yet.
                </p>
              </div>
            )}
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-[#070711] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        {/* HEADER */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Browse
          </h1>

          <p className="mt-2 text-white/50">
            Search Movies, TV, Anime or YouTube
          </p>
        </div>

        {/* TYPE + SEARCH */}
        <div className="mb-8 flex flex-col gap-3 sm:flex-row">
          <select
            value={contentType}
            onChange={(event) =>
              setContentType(
                event.target.value as ContentType,
              )
            }
            className="h-14 rounded-xl border border-white/10 bg-[#14141d] px-4 text-base text-white outline-none transition focus:border-purple-400/60 sm:w-40"
          >
            {CONTENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>

          {contentType === "YouTube" && (
            <select
              value={youtubeSearchType}
              onChange={(event) =>
                setYoutubeSearchType(
                  event.target.value as YouTubeSearchType,
                )
              }
              className="h-14 rounded-xl border border-white/10 bg-[#14141d] px-4 text-base text-white outline-none transition focus:border-purple-400/60 sm:w-40"
            >
              {YOUTUBE_SEARCH_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          )}

          <input
            value={searchQuery}
            onChange={(event) =>
              setSearchQuery(event.target.value)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleSearch();
              }
            }}
            placeholder={
              contentType === "YouTube" &&
              youtubeSearchType === "Link"
                ? "Paste a YouTube video, playlist or channel link..."
                : `Search ${contentType}...`
            }
            className="h-14 flex-1 rounded-xl border border-white/10 bg-[#14141d] px-4 text-base text-white outline-none transition placeholder:text-white/30 focus:border-purple-400/60"
          />

          <button
            type="button"
            onClick={handleSearch}
            disabled={loading}
            className="h-14 rounded-xl bg-white px-8 font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>

        {/* ERROR */}
        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/50 bg-red-500/10 p-5">
            <p className="font-semibold text-red-300">
              {contentType} search
            </p>

            <p className="mt-1 text-red-200/80">
              {error}
            </p>

            <button
              type="button"
              onClick={() =>
                loadContent(
                  contentType,
                  searchQuery,
                  page,
                  youtubeSearchType,
                )
              }
              className="mt-4 rounded-lg border border-red-400/30 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-500/10"
            >
              Try Again
            </button>
          </div>
        )}

        {/* LOADING */}
        {loading && (
          <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map(
              (_, index) => (
                <div
                  key={index}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-[#11111a]"
                >
                  <div className="aspect-[2/3] animate-pulse bg-white/5" />

                  <div className="space-y-3 p-4">
                    <div className="h-5 animate-pulse rounded bg-white/5" />
                    <div className="h-4 w-2/3 animate-pulse rounded bg-white/5" />
                    <div className="h-10 animate-pulse rounded bg-white/5" />
                  </div>
                </div>
              ),
            )}
          </div>
        )}

        {/* RESULTS */}
        {!loading && items.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((item) => {
                const contentId = getContentId(
                  item,
                  contentType,
                );

                const status = getStatus(
                  item,
                  contentType,
                );

                const watchSeconds =
                  resolveWatchTimeSeconds(
                    item,
                    contentType,
                  );

                const isSaving =
                  savingId === contentId;

                return (
                  <article
                    key={contentId}
                    className="group relative overflow-visible rounded-2xl border border-white/10 bg-[#11111a] shadow-xl shadow-black/20 transition hover:-translate-y-1 hover:border-white/20"
                  >
                    {/* POSTER / THUMBNAIL */}
                    <div className="relative aspect-[2/3] overflow-hidden rounded-t-2xl bg-black">
                      <img
                        src={getImage(item)}
                        alt={getTitle(item)}
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                        loading="lazy"
                      />

                      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/90 to-transparent" />

                      {/* RUNTIME BADGE (YouTube) */}
                      {contentType === "YouTube" &&
                        watchSeconds > 0 && (
                          <span className="absolute bottom-2 right-2 rounded bg-black/80 px-2 py-0.5 text-xs font-semibold text-white">
                            {formatWatchTime(watchSeconds)}
                          </span>
                        )}

                      {/* STATUS BADGE */}
                      {status && (
                        <div
                          className={`absolute left-3 top-3 rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur-md ${STATUS_COLORS[status]}`}
                        >
                          {STATUS_ICONS[status]}{" "}
                          {STATUS_LABELS[status]}
                        </div>
                      )}

                      {/* ACTIONS MENU */}
                      <div
                        className="absolute right-3 top-3"
                        ref={
                          menuOpen === contentId
                            ? menuRef
                            : undefined
                        }
                      >
                        <button
                          type="button"
                          aria-label={`Change status for ${getTitle(item)}`}
                          aria-expanded={
                            menuOpen === contentId
                          }
                          disabled={isSaving}
                          onClick={(event) => {
                            event.stopPropagation();

                            setMenuOpen((current) =>
                              current === contentId
                                ? null
                                : contentId,
                            );
                          }}
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/60 text-xl backdrop-blur-md transition hover:bg-black/80 disabled:opacity-50"
                        >
                          ⋮
                        </button>

                        {menuOpen === contentId && (
                          <div className="absolute right-0 top-12 z-[200] w-56 overflow-hidden rounded-xl border border-white/10 bg-[#171720] p-1 shadow-2xl shadow-black/50">
                            {STATUS_ORDER.map(
                              (statusOption) => {
                                const active =
                                  status ===
                                  statusOption;

                                return (
                                  <button
                                    key={statusOption}
                                    type="button"
                                    disabled={isSaving}
                                    onClick={(
                                      event,
                                    ) => {
                                      event.stopPropagation();

                                      saveItemStatus(
                                        item,
                                        contentType,
                                        statusOption,
                                      );
                                    }}
                                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                                      active
                                        ? "bg-white/10 text-white"
                                        : "text-white/70 hover:bg-white/5 hover:text-white"
                                    } disabled:cursor-not-allowed disabled:opacity-50`}
                                  >
                                    <span className="w-5 text-center">
                                      {
                                        STATUS_ICONS[
                                          statusOption
                                        ]
                                      }
                                    </span>

                                    <span>
                                      {
                                        STATUS_LABELS[
                                          statusOption
                                        ]
                                      }
                                    </span>

                                    {active && (
                                      <span className="ml-auto text-emerald-400">
                                        ✓
                                      </span>
                                    )}
                                  </button>
                                );
                              },
                            )}

                            {/* REMOVE — only shown once the item
                                actually has a status set */}
                            {status && (
                              <>
                                <div className="my-1 h-px bg-white/10" />

                                <button
                                  type="button"
                                  disabled={isSaving}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    removeItem(
                                      item,
                                      contentType,
                                    );
                                  }}
                                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <span className="w-5 text-center">
                                    🗑
                                  </span>
                                  <span>Remove</span>
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* CARD BODY */}
                    <div className="p-4">
                      <h2 className="line-clamp-2 min-h-[3.5rem] text-lg font-bold leading-7">
                        {getTitle(item)}
                      </h2>

                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/50">
                        {item.rating != null && (
                          <span>
                            ⭐{" "}
                            {Number(
                              item.rating,
                            ).toFixed(1)}
                          </span>
                        )}

                        {item.year && (
                          <span>{item.year}</span>
                        )}

                        {item.episodes && (
                          <span>
                            {item.episodes} episodes
                          </span>
                        )}

                        {item.metaCount != null &&
                          item.youtubeUrlType ===
                            "channel" && (
                            <span>
                              {item.metaCount.toLocaleString()}{" "}
                              subscribers
                            </span>
                          )}

                        {item.metaCount != null &&
                          item.youtubeUrlType ===
                            "playlist" && (
                            <span>
                              {item.metaCount} videos
                            </span>
                          )}
                      </div>

                      <p className="mt-4 text-xs text-white/40">
                        Estimated watch time:{" "}
                        <span className="font-semibold text-white/70">
                          {watchSeconds > 0
                            ? formatWatchTime(
                                watchSeconds,
                              )
                            : "Not available"}
                        </span>
                      </p>

                      {/* YOUR RATING */}
                      <div className="mt-3">
                        <RatingStars
                          value={
                            ratings[contentId] ?? null
                          }
                          onRate={(value) =>
                            handleRateItem(
                              item,
                              contentType,
                              value,
                            )
                          }
                        />
                      </div>

                      {/* ACTIONS */}
                      <div className="mt-4 grid gap-2">
                        {status === "completed" ? (
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() =>
                              saveItemStatus(
                                item,
                                contentType,
                                "completed",
                              )
                            }
                            className="h-11 rounded-xl border border-emerald-400/30 bg-emerald-500/10 font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
                          >
                            {isSaving
                              ? "Saving..."
                              : "✓ Completed"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() =>
                              saveItemStatus(
                                item,
                                contentType,
                                "watchlist",
                              )
                            }
                            className="h-11 rounded-xl bg-white font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isSaving
                              ? "Saving..."
                              : status === "watchlist"
                                ? "✓ In Watchlist"
                                : "+ Add to Watchlist"}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            setSelectedItem(item)
                          }
                          className="h-11 rounded-xl border border-white/10 bg-white/5 font-semibold text-white transition hover:bg-white/10"
                        >
                          Details
                        </button>

                        {contentType === "YouTube" &&
                          item.youtubeUrlType ===
                            "channel" && (
                            <button
                              type="button"
                              onClick={() =>
                                openChannel(item)
                              }
                              className="h-11 rounded-xl border border-red-400/30 bg-red-500/10 font-semibold text-red-300 transition hover:bg-red-500/20"
                            >
                              Browse Channel Videos
                            </button>
                          )}

                        {contentType === "YouTube" &&
                          item.youtubeUrlType !==
                            "channel" && (
                            <a
                              href={`https://www.youtube.com/watch?v=${item.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="h-11 rounded-xl border border-white/10 bg-white/5 text-center font-semibold leading-[2.75rem] text-white transition hover:bg-white/10"
                            >
                              Watch on YouTube
                            </a>
                          )}

                        {status && (
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() =>
                              removeItem(
                                item,
                                contentType,
                              )
                            }
                            className="h-11 rounded-xl border border-red-400/30 bg-red-500/10 font-semibold text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            🗑 Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* PAGINATION */}
            <div className="mt-8 flex items-center justify-center gap-3">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={handlePreviousPage}
                className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
              >
                ← Previous
              </button>

              <span className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm text-white/60">
                Page {page}
              </span>

              <button
                type="button"
                disabled={!hasNextPage || loading}
                onClick={handleNextPage}
                className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          </>
        )}

        {/* EMPTY */}
        {!loading && !error && items.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-12 text-center">
            <p className="text-lg font-semibold">
              No results found
            </p>

            <p className="mt-2 text-sm text-white/40">
              Try another search.
            </p>
          </div>
        )}
      </div>

      {/* DETAILS MODAL */}
      {selectedItem && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setSelectedItem(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-[#11111a] shadow-2xl"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div className="grid md:grid-cols-[220px_1fr]">
              {/* MODAL IMAGE */}
              <div className="relative aspect-[2/3] md:aspect-auto">
                <img
                  src={getImage(selectedItem)}
                  alt={getTitle(selectedItem)}
                  className="h-full w-full object-cover"
                />
              </div>

              {/* MODAL CONTENT */}
              <div className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold">
                      {getTitle(selectedItem)}
                    </h2>

                    {selectedItem.subtitle &&
                      selectedItem.subtitle !==
                        selectedItem.title && (
                        <p className="mt-1 text-sm text-white/40">
                          {selectedItem.subtitle}
                        </p>
                      )}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setSelectedItem(null)
                    }
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:bg-white/10"
                  >
                    ✕
                  </button>
                </div>

                {/* META */}
                <div className="mt-5 flex flex-wrap gap-2">
                  {selectedItem.rating != null && (
                    <span className="rounded-full bg-yellow-500/10 px-3 py-1 text-sm text-yellow-300">
                      ⭐{" "}
                      {Number(
                        selectedItem.rating,
                      ).toFixed(1)}
                    </span>
                  )}

                  {selectedItem.year && (
                    <span className="rounded-full bg-white/5 px-3 py-1 text-sm text-white/60">
                      {selectedItem.year}
                    </span>
                  )}

                  {selectedItem.episodes && (
                    <span className="rounded-full bg-white/5 px-3 py-1 text-sm text-white/60">
                      {selectedItem.episodes} episodes
                    </span>
                  )}

                  {getStatus(
                    selectedItem,
                    contentType,
                  ) && (
                    <span
                      className={`rounded-full border px-3 py-1 text-sm ${
                        STATUS_COLORS[
                          getStatus(
                            selectedItem,
                            contentType,
                          ) as ItemStatus
                        ]
                      }`}
                    >
                      {
                        STATUS_ICONS[
                          getStatus(
                            selectedItem,
                            contentType,
                          ) as ItemStatus
                        ]
                      }{" "}
                      {
                        STATUS_LABELS[
                          getStatus(
                            selectedItem,
                            contentType,
                          ) as ItemStatus
                        ]
                      }
                    </span>
                  )}
                </div>

                {/* WATCH TIME */}
                <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-wider text-white/30">
                    Estimated Watch Time
                  </p>

                  <p className="mt-1 text-xl font-bold">
                    {(() => {
                      const seconds =
                        resolveWatchTimeSeconds(
                          selectedItem,
                          contentType,
                        );

                      return seconds > 0
                        ? formatWatchTime(seconds)
                        : "Not available";
                    })()}
                  </p>
                </div>

                {/* YOUR RATING */}
                <div className="mt-6">
                  <h3 className="mb-2 text-sm font-semibold text-white/60">
                    Your Rating
                  </h3>

                  <RatingStars
                    value={
                      ratings[
                        getContentId(
                          selectedItem,
                          contentType,
                        )
                      ] ?? null
                    }
                    onRate={(value) =>
                      handleRateItem(
                        selectedItem,
                        contentType,
                        value,
                      )
                    }
                    size="large"
                  />
                </div>

                {/* SYNOPSIS / DESCRIPTION */}
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-white/60">
                    {contentType === "YouTube"
                      ? "Description"
                      : "Synopsis"}
                  </h3>

                  <p className="mt-2 whitespace-pre-line text-sm leading-7 text-white/60">
                    {selectedItem.synopsis ||
                      "No description available."}
                  </p>
                </div>

                {/* EPISODES — Anime/TV only. Lets you tick off
                    specific episodes (e.g. just 89–90) as
                    watched straight from this modal, same
                    component the standalone details page uses,
                    so episode_progress / watch_sessions stay
                    in sync everywhere. */}
                {(contentType === "Anime" ||
                  contentType === "TV") && (
                  <EpisodeTracker
                    contentId={getContentId(
                      selectedItem,
                      contentType,
                    )}
                    category={contentType}
                    tmdbId={selectedItem.id}
                    fallbackRuntimeMinutes={resolveFallbackRuntimeMinutes(
                      selectedItem,
                    )}
                  />
                )}

                {contentType === "YouTube" && (
                  <a
                    href={`https://www.youtube.com/watch?v=${selectedItem.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-6 block w-full rounded-xl bg-red-500 py-3 text-center font-semibold text-white transition hover:bg-red-400"
                  >
                    Watch on YouTube
                  </a>
                )}

{/* RECOMMEND TO FRIEND */}
<button
  type="button"
  onClick={() => setShowRecommendModal(true)}
  className="mt-6 h-11 w-full rounded-xl border border-purple-400/30 bg-purple-500/10 font-semibold text-purple-300 transition hover:bg-purple-500/20"
>
  🎁 Recommend to Friend
</button>

{showRecommendModal && (
  <RecommendModal
    contentType={contentType}
    contentId={getContentId(selectedItem, contentType)}
    contentTitle={getTitle(selectedItem)}
    posterPath={selectedItem.image}
    onClose={() => setShowRecommendModal(false)}
  />
)}

                {/* STATUS BUTTONS */}
                <div className="mt-6">
                  <h3 className="mb-3 text-sm font-semibold text-white/60">
                    Change Status
                  </h3>

                  <div className="flex flex-wrap gap-2">
                    {STATUS_ORDER.map(
                      (statusOption) => {
                        const active =
                          getStatus(
                            selectedItem,
                            contentType,
                          ) === statusOption;

                        const isSaving =
                          savingId ===
                          getContentId(
                            selectedItem,
                            contentType,
                          );

                        return (
                          <button
                            key={statusOption}
                            type="button"
                            disabled={isSaving}
                            onClick={() =>
                              saveItemStatus(
                                selectedItem,
                                contentType,
                                statusOption,
                              )
                            }
                            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                              active
                                ? STATUS_COLORS[
                                    statusOption
                                  ]
                                : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                            } disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            {
                              STATUS_ICONS[
                                statusOption
                              ]
                            }{" "}
                            {
                              STATUS_LABELS[
                                statusOption
                              ]
                            }
                          </button>
                        );
                      },
                    )}
                  </div>
                </div>

                {/* REMOVE COMPLETELY */}
                {getStatus(
                  selectedItem,
                  contentType,
                ) && (
                  <button
                    type="button"
                    disabled={
                      savingId ===
                      getContentId(
                        selectedItem,
                        contentType,
                      )
                    }
                    onClick={() =>
                      removeItem(
                        selectedItem,
                        contentType,
                      )
                    }
                    className="mt-3 h-11 w-full rounded-xl border border-red-400/30 bg-red-500/10 font-semibold text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    🗑 Remove Completely
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    setSelectedItem(null)
                  }
                  className="mt-6 w-full rounded-xl bg-white py-3 font-semibold text-black transition hover:bg-white/90"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}