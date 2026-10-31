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
import {
  fetchAllRatings,
  fetchRatingStats,
  RatingStats,
  upsertRating,
} from "../lib/ratings";
import RatingDistribution from "./RatingDistribution";
import RecommendModal from "./RecommendModal";
import {
  MAX_FAVOURITES,
  FAVOURITES_CHANGED_EVENT,
  FavouriteContentType,
  addFavourite,
  fetchFavourites,
  removeFavourite,
} from "../lib/favourites";

type ContentType = "Anime" | "TV" | "Movies" | "YouTube";
const CONTENT_TYPES: ContentType[] = ["Anime", "TV", "Movies", "YouTube"];

type YouTubeSearchType = "Videos" | "Channels" | "Playlists" | "Link";
const YOUTUBE_SEARCH_TYPES: YouTubeSearchType[] = ["Videos", "Channels", "Playlists", "Link"];

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

type ItemStatus = "watchlist" | "watching" | "completed" | "rewatch" | "on_hold" | "dropped";

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
  watchlist: "border-blue-400/60 bg-blue-500/10 text-blue-300",
  watching: "border-cyan-400/60 bg-cyan-500/10 text-cyan-300",
  completed: "border-emerald-400/70 bg-emerald-500/10 text-emerald-300",
  rewatch: "border-purple-400/70 bg-purple-500/10 text-purple-300",
  on_hold: "border-yellow-400/70 bg-yellow-500/10 text-yellow-300",
  dropped: "border-red-400/70 bg-red-500/10 text-red-300",
};

const STATUS_ORDER: ItemStatus[] = ["watchlist", "watching", "completed", "rewatch", "on_hold", "dropped"];
const STORAGE_KEY = "universal_browser_status_v1";
const CHANNEL_VIDEOS_PAGE_SIZE = 25;

function getStoredStatuses(): Record<string, ItemStatus> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

function saveStoredStatuses(statuses: Record<string, ItemStatus>) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(statuses)); } catch {}
}

function parseDurationToMinutes(duration?: string | null) {
  if (!duration) return null;
  const text = duration.toLowerCase();
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hour|hours|hr|hrs|h)/);
  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:minute|minutes|min|mins|m)/);
  let totalMinutes = 0;
  if (hourMatch) totalMinutes += Number(hourMatch[1]) * 60;
  if (minuteMatch) totalMinutes += Number(minuteMatch[1]);
  if (totalMinutes > 0) return Math.round(totalMinutes);
  const plainNumber = Number(text);
  if (Number.isFinite(plainNumber) && plainNumber > 0) return Math.round(plainNumber);
  return null;
}

function getWatchTimeSeconds(item: ContentItem, type: ContentType): number {
  if (type === "Anime") return Math.max(1, Number(item.episodes || 1)) * 24 * 60;
  if (typeof item.runtimeSeconds === "number" && item.runtimeSeconds > 0) return Math.round(item.runtimeSeconds);
  if (typeof item.runtime === "number" && item.runtime > 0) return item.runtime > 10000 ? Math.round(item.runtime) : Math.round(item.runtime * 60);
  if (typeof item.episodes === "number" && item.episodes > 0) {
    let episodeMinutes = typeof item.episodeRuntime === "number" ? item.episodeRuntime : null;
    if (!episodeMinutes) episodeMinutes = parseDurationToMinutes(item.duration);
    if (typeof episodeMinutes === "number" && episodeMinutes > 0) return Math.round(item.episodes * episodeMinutes * 60);
  }
  const parsedDuration = parseDurationToMinutes(item.duration);
  if (typeof parsedDuration === "number" && parsedDuration > 0) return Math.round(parsedDuration * 60);
  return 0;
}

function formatWatchTime(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(Number(seconds || 0) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function getContentId(item: ContentItem, type: ContentType) {
  return `${type.toLowerCase()}-${String(item.id)}`;
}

function yearFromDate(date?: string | null) {
  if (!date) return null;
  const year = Number(String(date).slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : null;
}

async function fetchJson(url: string) {
  const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    await response.text();
    throw new Error(response.status === 404 ? `API route not found: ${url}` : `Server returned non-JSON response (${response.status}).`);
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || data?.message || `Request failed with status ${response.status}.`);
  return data;
}

function normalizeMovies(data: any) {
  const results = data?.results || [];
  const items: ContentItem[] = results.map((movie: any) => ({
    id: movie.tmdb_id ?? movie.id,
    title: movie.title || movie.name || "Untitled Movie",
    subtitle: movie.original_title || "Movie",
    image: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
    synopsis: movie.overview || null,
    rating: typeof movie.vote_average === "number" ? movie.vote_average : null,
    date: movie.release_date || null,
    year: yearFromDate(movie.release_date),
    runtimeSeconds: typeof movie.runtime_seconds === "number" ? movie.runtime_seconds : null,
    runtime: typeof movie.runtime === "number" ? movie.runtime : null,
  }));
  const totalPages = Number(data?.total_pages) || 0;
  const currentPage = Number(data?.page) || 1;
  return { items, hasNextPage: totalPages ? currentPage < totalPages : items.length >= 20 };
}

function normalizeTV(data: any) {
  const results = data?.results || [];
  const items: ContentItem[] = results.map((show: any) => ({
    id: show.tmdb_id ?? show.id,
    title: show.name || show.original_name || "Untitled TV Show",
    subtitle: show.original_name || "TV Show",
    image: show.poster_path ? `https://image.tmdb.org/t/p/w500${show.poster_path}` : null,
    synopsis: show.overview || null,
    rating: typeof show.vote_average === "number" ? show.vote_average : null,
    date: show.first_air_date || null,
    year: yearFromDate(show.first_air_date),
    runtimeSeconds: typeof show.runtime_seconds === "number" ? show.runtime_seconds : null,
    runtime: typeof show.runtime === "number" ? show.runtime : null,
    episodes: typeof show.number_of_episodes === "number" ? show.number_of_episodes : null,
    episodeRuntime: Array.isArray(show.episode_run_time) && typeof show.episode_run_time[0] === "number" ? show.episode_run_time[0] : null,
  }));
  const totalPages = Number(data?.total_pages) || 0;
  const currentPage = Number(data?.page) || 1;
  return { items, hasNextPage: totalPages ? currentPage < totalPages : items.length >= 20 };
}

function normalizeAnime(data: any) {
  const results = data?.data || data?.anime || data?.results || [];
  const items: ContentItem[] = (Array.isArray(results) ? results : []).map((anime: any) => {
    const image = anime?.images?.jpg?.large_image_url || anime?.images?.jpg?.image_url || anime?.poster_path || anime?.image || null;
    return {
      id: anime.mal_id ?? anime.id,
      title: anime.title_english || anime.title || "Untitled Anime",
      subtitle: anime.title || null,
      image,
      synopsis: anime.synopsis || null,
      rating: typeof anime.score === "number" ? anime.score : null,
      year: anime.year ?? yearFromDate(anime.aired?.from),
      date: anime.aired?.from ? String(anime.aired.from).slice(0, 10) : null,
      episodes: typeof anime.episodes === "number" ? anime.episodes : null,
      episodeRuntime: typeof anime.duration_minutes === "number" ? anime.duration_minutes : null,
      duration: anime.duration || null,
    };
  });
  return { items, hasNextPage: Boolean(data?.pagination?.has_next_page ?? data?.hasNextPage ?? false) };
}

function normalizeYouTube(data: any) {
  const results = data?.results || data?.items || data?.videos || [];
  const items: ContentItem[] = results.map((video: any) => {
    const snippet = video?.snippet || {};
    const kind: string = video?.id?.kind || video?.kind || "youtube#video";
    let youtubeUrlType: "video" | "playlist" | "channel" = "video";
    let resolvedId: string | number = Math.random().toString(36);
    if (kind.includes("channel") || video?.id?.channelId) {
      youtubeUrlType = "channel";
      resolvedId = video?.id?.channelId || video?.channelId || video?.id;
    } else if (kind.includes("playlist") || video?.id?.playlistId) {
      youtubeUrlType = "playlist";
      resolvedId = video?.id?.playlistId || video?.playlistId || video?.id;
    } else {
      youtubeUrlType = "video";
      resolvedId = video?.id?.videoId || video?.videoId || video?.id || Math.random().toString(36);
    }
    const thumbnail = snippet?.thumbnails?.high?.url || snippet?.thumbnails?.medium?.url || snippet?.thumbnails?.default?.url || video?.thumbnail || null;
    const metaCount = youtubeUrlType === "channel" ? Number(video.subscriber_count) || null : youtubeUrlType === "playlist" ? Number(video.item_count) || null : null;
    return {
      id: resolvedId,
      title: snippet?.title || video?.title || "YouTube",
      subtitle: youtubeUrlType === "video" ? snippet?.channelTitle || video?.channelTitle || "YouTube" : youtubeUrlType === "channel" ? "YouTube Channel" : "YouTube Playlist",
      image: thumbnail,
      synopsis: snippet?.description || video?.description || null,
      rating: null,
      date: snippet?.publishedAt ? String(snippet.publishedAt).slice(0, 10) : null,
      year: yearFromDate(snippet?.publishedAt),
      runtimeSeconds: youtubeUrlType === "video" && typeof video.runtime_seconds === "number" ? video.runtime_seconds : null,
      youtubeUrlType,
      metaCount,
    };
  });
  return { items, hasNextPage: false };
}

export default function UniversalBrowser() {
  const [contentType, setContentType] = useState<ContentType>("Anime");
  const [searchQuery, setSearchQuery] = useState("");
  const [youtubeSearchType, setYoutubeSearchType] = useState<YouTubeSearchType>("Videos");
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);

  const [statuses, setStatuses] = useState<Record<string, ItemStatus>>({});
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [ratingStats, setRatingStats] = useState<Record<string, RatingStats>>({});
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [showRecommendModal, setShowRecommendModal] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [favourites, setFavourites] = useState<Record<string, number>>({});
  const [favouriteBusyId, setFavouriteBusyId] = useState<string | null>(null);
  const [runtimeOverrides, setRuntimeOverrides] = useState<Record<string, number>>({});

  const [activeChannel, setActiveChannel] = useState<{ id: string; title: string } | null>(null);
  const [channelVideos, setChannelVideos] = useState<ContentItem[]>([]);
  const [channelVideosLoading, setChannelVideosLoading] = useState(false);
  const [channelVideosError, setChannelVideosError] = useState("");
  const [channelPage, setChannelPage] = useState(1);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());
  const [markingSelected, setMarkingSelected] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setStatuses(getStoredStatuses());
    fetchAllRatings().then(setRatings);
    function loadFavourites() {
      fetchFavourites().then((list) => {
        const map: Record<string, number> = {};
        for (const item of list) map[item.contentId] = item.rank;
        setFavourites(map);
      }).catch((err) => console.warn("Failed to load favourites:", err));
    }
    loadFavourites();
    window.addEventListener(FAVOURITES_CHANGED_EVENT, loadFavourites);
    return () => window.removeEventListener(FAVOURITES_CHANGED_EVENT, loadFavourites);
  }, []);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(null);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const loadContent = useCallback(async (type: ContentType, query: string, currentPage: number, ytType: YouTubeSearchType) => {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setMenuOpen(null);
    try {
      let result: { items: ContentItem[]; hasNextPage: boolean };
      if (type === "Movies") {
        result = normalizeMovies(await fetchJson(`/api/tmdb/movies?query=${encodeURIComponent(query)}&page=${currentPage}`));
      } else if (type === "TV") {
        result = normalizeTV(await fetchJson(`/api/tmdb/tv?query=${encodeURIComponent(query)}&page=${currentPage}`));
      } else if (type === "YouTube") {
        const params = new URLSearchParams();
        if (ytType === "Link") params.set("link", query.trim());
        else {
          params.set("query", query.trim());
          params.set("type", ytType === "Channels" ? "channel" : ytType === "Playlists" ? "playlist" : "video");
        }
        result = normalizeYouTube(await fetchJson(`/api/youtube?${params.toString()}`));
      } else {
        const params = new URLSearchParams({ q: query.trim(), page: String(currentPage), limit: "24" });
        result = normalizeAnime(await fetchJson(`/api/anime?${params.toString()}`));
      }
      setItems(result.items);
      setHasNextPage(result.hasNextPage);
      if (result.items.length > 0) {
        fetchRatingStats(result.items.map((resultItem) => getContentId(resultItem, type))).then((stats) => setRatingStats((current) => ({ ...current, ...stats })));
      }
      if (result.items.length === 0) setError(`No ${type} results found for "${query}".`);
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : `Failed to load ${type}.`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    loadContent(contentType, searchQuery, 1, youtubeSearchType);
  }, [contentType]);

  async function toggleFavourite(item: ContentItem, type: ContentType) {
    if (type === "YouTube") return;
    const id = getContentId(item, type);
    if (favouriteBusyId === id) return;
    setFavouriteBusyId(id);
    const alreadyFavourite = Boolean(favourites[id]);
    try {
      if (alreadyFavourite) {
        const next = { ...favourites };
        delete next[id];
        setFavourites(next);
        await removeFavourite(id);
      } else {
        if (Object.keys(favourites).length >= MAX_FAVOURITES) throw new Error(`Favourite List is full (max ${MAX_FAVOURITES}).`);
        setFavourites((current) => ({ ...current, [id]: Object.keys(current).length + 1 }));
        await addFavourite({ contentId: id, contentType: type as FavouriteContentType, title: item.title || "Untitled", subtitle: item.subtitle, image: item.image });
      }
    } catch (err) {
      fetchFavourites().then((list) => {
        const map: Record<string, number> = {};
        for (const favItem of list) map[favItem.contentId] = favItem.rank;
        setFavourites(map);
      }).catch(() => {});
      alert(err instanceof Error ? err.message : "Failed to update Favourite List.");
    } finally {
      setFavouriteBusyId(null);
    }
  }

  async function handleRateItem(item: ContentItem, type: ContentType, ratingValue: number) {
    const contentId = getContentId(item, type);
    const previous = ratings[contentId];
    setRatings((current) => ({ ...current, [contentId]: ratingValue }));
    try {
      await upsertRating({ contentId, category: type, title: item.title, image: item.image, rating: ratingValue });
    } catch (err) {
      setRatings((current) => {
        const rollback = { ...current };
        if (typeof previous === "number") rollback[contentId] = previous;
        else delete rollback[contentId];
        return rollback;
      });
      alert(err instanceof Error ? err.message : "Failed to save rating.");
    }
  }

  async function syncCompletedWatchTime(item: ContentItem, type: ContentType) {
    const contentId = getContentId(item, type);
    let estimatedSeconds = resolveWatchTimeSeconds(item, type);
    if (estimatedSeconds <= 0 && (type === "Movies" || type === "TV")) {
      const freshSeconds = await fetchAccurateRuntimeSeconds(item, type);
      if (freshSeconds > 0) {
        estimatedSeconds = freshSeconds;
        setRuntimeOverrides((current) => ({ ...current, [contentId]: freshSeconds }));
      }
    }
    const skipsRuntimeCheck = type === "YouTube" && item.youtubeUrlType !== "video" && item.youtubeUrlType != null;
    if (estimatedSeconds <= 0 && !skipsRuntimeCheck) throw new Error(`Runtime is not available for "${item.title}".`);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (!user) throw new Error("Please login before saving watch status.");
    const { data: existingSessions, error: findError } = await supabase.from("watch_sessions").select("id,total_seconds,content_id,category,is_active").eq("user_id", user.id).eq("content_id", contentId).order("created_at", { ascending: false }).limit(1);
    if (findError) throw findError;
    const existing = existingSessions?.[0];
    if (existing) {
      const finalSeconds = Math.max(Math.max(0, Number(existing.total_seconds || 0)), estimatedSeconds);
      const { error: updateError } = await supabase.from("watch_sessions").update({ total_seconds: finalSeconds, is_active: false, category: type, last_heartbeat: new Date().toISOString() }).eq("id", existing.id).eq("user_id", user.id);
      if (updateError) throw updateError;
      return;
    }
    const now = new Date().toISOString();
    const { error: insertError } = await supabase.from("watch_sessions").insert({ user_id: user.id, content_id: contentId, started_at: now, last_heartbeat: now, is_active: false, total_seconds: estimatedSeconds, category: type });
    if (insertError) throw insertError;
  }

  async function syncWatchlistItem(item: ContentItem, type: ContentType, newStatus: ItemStatus) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const contentId = getContentId(item, type);
      const estimatedSeconds = resolveWatchTimeSeconds(item, type);
      let totalEpisodes = typeof item.episodes === "number" && item.episodes > 0 ? item.episodes : null;
      if (!totalEpisodes && type === "TV") totalEpisodes = await fetchAccurateEpisodeCount(item);
      await supabase.from("watchlist_items").upsert({ user_id: user.id, content_id: contentId, category: type, title: item.title, image_url: item.image ?? null, status: newStatus, estimated_seconds: estimatedSeconds, total_episodes: totalEpisodes, updated_at: new Date().toISOString() }, { onConflict: "user_id,content_id" });
    } catch (err) {
      console.error("Failed to sync watchlist item:", err);
    }
  }

  async function saveItemStatus(item: ContentItem, type: ContentType, newStatus: ItemStatus) {
    const id = getContentId(item, type);
    if (savingId === id) return;
    const previousStatus = statuses[id] || null;
    setSavingId(id);
    const nextStatuses = { ...statuses, [id]: newStatus };
    setStatuses(nextStatuses);
    saveStoredStatuses(nextStatuses);
    try {
      if (newStatus === "completed") await syncCompletedWatchTime(item, type);
      await syncWatchlistItem(item, type, newStatus);
      setMenuOpen(null);
      setSelectedItem(null);
      window.dispatchEvent(new CustomEvent("universal-browser-status-changed", { detail: { contentId: id, type, title: item.title, status: newStatus } }));
    } catch (err) {
      const rollback = { ...statuses };
      if (previousStatus) rollback[id] = previousStatus;
      else delete rollback[id];
      setStatuses(rollback);
      saveStoredStatuses(rollback);
      alert(err instanceof Error ? err.message : "Failed to save status.");
    } finally {
      setSavingId(null);
    }
  }

  async function removeItem(item: ContentItem, type: ContentType) {
    const id = getContentId(item, type);
    if (savingId === id) return;
    if (!window.confirm(`Remove "${item.title}" completely? This also deletes its saved watch time.`)) return;
    setSavingId(id);
    const previousStatus = statuses[id] || null;
    const nextStatuses = { ...statuses };
    delete nextStatuses[id];
    setStatuses(nextStatuses);
    saveStoredStatuses(nextStatuses);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Please login before removing items.");
      await supabase.from("watchlist_items").delete().eq("user_id", user.id).eq("content_id", id);
      await supabase.from("watch_sessions").delete().eq("user_id", user.id).eq("content_id", id);
      setMenuOpen(null);
      setSelectedItem(null);
      window.dispatchEvent(new CustomEvent("universal-browser-status-changed", { detail: { contentId: id, type, title: item.title, status: null } }));
    } catch (err) {
      const rollback = { ...statuses };
      if (previousStatus) rollback[id] = previousStatus;
      setStatuses(rollback);
      saveStoredStatuses(rollback);
      alert(err instanceof Error ? err.message : "Failed to remove item.");
    } finally {
      setSavingId(null);
    }
  }

  async function fetchAccurateRuntimeSeconds(item: ContentItem, type: ContentType): Promise<number> {
    try {
      if (type === "Movies") {
        const res = await fetch(`/api/tmdb/movie-details?id=${encodeURIComponent(String(item.id))}`, { cache: "no-store" });
        if (!res.ok) return 0;
        const data = await res.json();
        return Number.isFinite(Number(data?.runtime)) && Number(data?.runtime) > 0 ? Math.round(Number(data?.runtime) * 60) : 0;
      }
      if (type === "TV") {
        const res = await fetch(`/api/tmdb/tv-details?id=${encodeURIComponent(String(item.id))}`, { cache: "no-store" });
        if (!res.ok) return 0;
        const data = await res.json();
        const episodeRuntime = Number(data?.episodeRuntime);
        const episodes = Number(data?.numberOfEpisodes) || Number(item.episodes) || 0;
        if (Number.isFinite(episodeRuntime) && episodeRuntime > 0 && episodes > 0) return Math.round(episodes * episodeRuntime * 60);
      }
      return 0;
    } catch { return 0; }
  }

  async function fetchAccurateEpisodeCount(item: ContentItem): Promise<number | null> {
    try {
      const res = await fetch(`/api/tmdb/tv-details?id=${encodeURIComponent(String(item.id))}`, { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      const episodes = Number(data?.numberOfEpisodes);
      return Number.isFinite(episodes) && episodes > 0 ? episodes : null;
    } catch { return null; }
  }

  function resolveWatchTimeSeconds(item: ContentItem, type: ContentType): number {
    const contentId = getContentId(item, type);
    const override = runtimeOverrides[contentId];
    return typeof override === "number" && override > 0 ? override : getWatchTimeSeconds(item, type);
  }

  function resolveFallbackRuntimeMinutes(item: ContentItem): number | null {
    return typeof item.episodeRuntime === "number" && item.episodeRuntime > 0 ? item.episodeRuntime : parseDurationToMinutes(item.duration);
  }

  const handleSearch = () => { setPage(1); loadContent(contentType, searchQuery, 1, youtubeSearchType); };
  const handleNextPage = () => { if (!hasNextPage || loading) return; const next = page + 1; setPage(next); loadContent(contentType, searchQuery, next, youtubeSearchType); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const handlePreviousPage = () => { if (page <= 1 || loading) return; const prev = page - 1; setPage(prev); loadContent(contentType, searchQuery, prev, youtubeSearchType); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const getStatus = (item: ContentItem, type: ContentType) => statuses[getContentId(item, type)] || null;
  const getImage = (item: ContentItem) => item.image || "https://placehold.co/600x900/111827/ffffff?text=No+Image";
  const getTitle = (item: ContentItem) => item.title || "Untitled";

  if (activeChannel) {
    const totalChannelPages = Math.max(1, Math.ceil(channelVideos.length / CHANNEL_VIDEOS_PAGE_SIZE));
    const channelPageItems = channelVideos.slice((channelPage - 1) * CHANNEL_VIDEOS_PAGE_SIZE, channelPage * CHANNEL_VIDEOS_PAGE_SIZE);
    return (
      <section className="min-h-screen bg-[#070711] px-4 py-8 text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <button type="button" onClick={() => { setActiveChannel(null); setChannelVideos([]); setChannelPage(1); setSelectedVideoIds(new Set()); }} className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/50 transition hover:text-white">← Back to search</button>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{activeChannel.title}</h1>
              <p className="mt-2 text-white/50">{channelVideosLoading ? "Loading every video for this channel..." : `${channelVideos.length} videos loaded`}</p>
            </div>
          </div>
          {channelVideos.length > 0 && (
            <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <span className="text-sm text-white/60">{selectedVideoIds.size} selected</span>
              <button type="button" onClick={() => { const next = new Set(selectedVideoIds); channelPageItems.forEach(v => next.add(String(v.id))); setSelectedVideoIds(next); }} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold transition hover:bg-white/10">Select all on this page</button>
              <button type="button" disabled={selectedVideoIds.size === 0} onClick={() => setSelectedVideoIds(new Set())} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold transition hover:bg-white/10 disabled:opacity-40">Clear selection</button>
            </div>
          )}
          {!channelVideosLoading && channelPageItems.length > 0 && (
            <>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {channelPageItems.map(video => {
                  const videoId = String(video.id);
                  const isSelected = selectedVideoIds.has(videoId);
                  const status = getStatus(video, "YouTube");
                  const watchSeconds = resolveWatchTimeSeconds(video, "YouTube");
                  return (
                    <article key={videoId} className={`group relative overflow-hidden rounded-2xl border bg-[#11111a]/50 shadow-xl shadow-black/20 transition hover:-translate-y-1 ${isSelected ? "border-emerald-400/70" : "border-white/10 hover:border-white/20"}`}>
                      <div className="relative aspect-video overflow-hidden bg-black">
                        <img src={getImage(video)} alt={getTitle(video)} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" />
                        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/90 to-transparent" />
                        <button type="button" onClick={() => { const next = new Set(selectedVideoIds); if (next.has(videoId)) next.delete(videoId); else next.add(videoId); setSelectedVideoIds(next); }} className={`absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border text-sm font-bold backdrop-blur-md transition ${isSelected ? "border-emerald-400 bg-emerald-500 text-black" : "border-white/30 bg-black/60 text-transparent hover:border-white/60"}`}>✓</button>
                        {watchSeconds > 0 && (
                          <span className="absolute bottom-2 right-2 rounded bg-black/80 px-2 py-0.5 text-xs font-semibold">
                            {formatWatchTime(watchSeconds)}
                          </span>
                        )}
                        
                                   {status && (
                          <div className={`absolute right-2 top-2 rounded-full border px-2 py-0.5 text-xs font-semibold backdrop-blur-md ${STATUS_COLORS[status]}`}>
                            {STATUS_ICONS[status]}
                          </div>
                        )}
                      </div>

                      <div className="p-3">
                        <h2 className="line-clamp-2 min-h-[2.75rem] text-sm font-bold leading-6">
                          {getTitle(video)}
                        </h2>
                        {video.date && <p className="mt-1 text-xs text-white/40">{video.date}</p>}

                        <div className="mt-2">
                          <RatingStars value={ratings[getContentId(video, "YouTube")] ?? null} onRate={(value) => handleRateItem(video, "YouTube", value)} />
                        </div>

                        <div className="mt-1.5">
                          <RatingDistribution stats={ratingStats[getContentId(video, "YouTube")]} />
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => saveItemStatus(video, "YouTube", "completed")} className={`h-9 rounded-lg text-xs font-semibold transition ${status === "completed" ? "border border-emerald-400/30 bg-emerald-500/10 text-emerald-300" : "bg-white text-black hover:bg-white/90"}`}>
                            {status === "completed" ? "✓ Done" : "Mark Complete"}
                          </button>

                          <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer" className="flex h-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-xs font-semibold text-white transition hover:bg-white/10">
                            Watch
                          </a>
                        </div>

                        {status && (
                          <button type="button" disabled={savingId === getContentId(video, "YouTube")} onClick={() => removeItem(video, "YouTube")} className="mt-2 h-8 w-full rounded-lg border border-red-400/30 bg-red-500/10 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50">
                            🗑 Remove
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="mt-8 flex items-center justify-center gap-3">
                <button type="button" disabled={channelPage <= 1} onClick={() => setChannelPage((current) => Math.max(1, current - 1))} className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30">
                  ← Previous
                </button>
                <span className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm text-white/60">
                  Page {channelPage} of {totalChannelPages}
                </span>
                <button type="button" disabled={channelPage >= totalChannelPages} onClick={() => setChannelPage((current) => Math.min(totalChannelPages, current + 1))} className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30">
                  Next →
                </button>
              </div>
            </>
          )}

          {!channelVideosLoading && !channelVideosError && channelVideos.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-12 text-center">
              <p className="text-lg font-semibold">No videos found</p>
              <p className="mt-2 text-sm text-white/40">This channel doesn't have any videos yet.</p>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-[#070711] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Browse</h1>
          <p className="mt-2 text-white/50">Search Movies, TV, Anime or YouTube</p>
        </div>

        <div className="mb-8 flex flex-col gap-3 sm:flex-row">
          <select value={contentType} onChange={(e) => setContentType(e.target.value as ContentType)} className="h-14 rounded-xl border border-white/10 bg-[#14141d] px-4 text-base text-white outline-none transition focus:border-purple-400/60 sm:w-40">
            {CONTENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>

          {contentType === "YouTube" && (
            <select value={youtubeSearchType} onChange={(e) => setYoutubeSearchType(e.target.value as YouTubeSearchType)} className="h-14 rounded-xl border border-white/10 bg-[#14141d] px-4 text-base text-white outline-none transition focus:border-purple-400/60 sm:w-40">
              {YOUTUBE_SEARCH_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          )}

          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }} placeholder={contentType === "YouTube" && youtubeSearchType === "Link" ? "Paste a YouTube link..." : `Search ${contentType}...`} className="h-14 flex-1 rounded-xl border border-white/10 bg-[#14141d] px-4 text-base text-white outline-none transition placeholder:text-white/30 focus:border-purple-400/60" />
          <button type="button" onClick={handleSearch} disabled={loading} className="h-14 rounded-xl bg-white px-8 font-semibold text-black transition hover:bg-white/90 disabled:opacity-50">
            {loading ? "Searching..." : "Search"}
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/50 bg-red-500/10 p-5">
            <p className="font-semibold text-red-300">{contentType} search</p>
            <p className="mt-1 text-red-200/80">{error}</p>
          </div>
        )}

        {loading && (
          <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl border border-white/10 bg-[#11111a]">
                <div className="aspect-[2/3] animate-pulse bg-white/5" />
                <div className="space-y-3 p-4"><div className="h-5 animate-pulse rounded bg-white/5" /><div className="h-4 w-2/3 animate-pulse rounded bg-white/5" /></div>
              </div>
            ))}
          </div>
        )}

        {!loading && items.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((item) => {
                const contentId = getContentId(item, contentType);
                const status = getStatus(item, contentType);
                const watchSeconds = resolveWatchTimeSeconds(item, contentType);
                const isSaving = savingId === contentId;

                return (
                  <article key={contentId} className="glass-panel group relative overflow-visible rounded-2xl border border-white/10 bg-[#11111a] shadow-xl shadow-black/20 transition hover:-translate-y-1 hover:border-white/20">
                    <div className="relative aspect-[2/3] overflow-hidden rounded-t-2xl bg-black">
                      <img src={getImage(item)} alt={getTitle(item)} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" />
                      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/90 to-transparent" />
                      {status && (
                        <div className={`absolute left-3 top-3 rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur-md ${STATUS_COLORS[status]}`}>
                          {STATUS_ICONS[status]} {STATUS_LABELS[status]}
                        </div>
                      )}
                      <div className="absolute right-3 top-3" ref={menuOpen === contentId ? menuRef : undefined}>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === contentId ? null : contentId); }} className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/60 text-xl backdrop-blur-md transition hover:bg-black/80">⋮</button>
                        {menuOpen === contentId && (
                          <div className="absolute right-0 top-12 z-[200] w-56 overflow-hidden rounded-xl border border-white/10 bg-[#171720] p-1 shadow-2xl">
                            {STATUS_ORDER.map((opt) => (
                              <button key={opt} type="button" onClick={(e) => { e.stopPropagation(); saveItemStatus(item, contentType, opt); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-white/70 hover:bg-white/5 hover:text-white">
                                <span className="w-5 text-center">{STATUS_ICONS[opt]}</span><span>{STATUS_LABELS[opt]}</span>
                              </button>
                            ))}
                            {status && (
                              <><div className="my-1 h-px bg-white/10" /><button type="button" onClick={(e) => { e.stopPropagation(); removeItem(item, contentType); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-red-300 hover:bg-red-500/10"><span className="w-5 text-center">🗑</span><span>Remove</span></button></>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="p-4">
                      <h2 className="line-clamp-2 min-h-[3.5rem] text-lg font-bold leading-7">{getTitle(item)}</h2>
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 text-sm text-white/50">
                        {item.rating != null && <span>⭐ {Number(item.rating).toFixed(1)}</span>}
                        {item.year && <span>{item.year}</span>}
                        {item.episodes && <span>{item.episodes} eps</span>}
                      </div>
                      <p className="mt-4 text-xs text-white/40">Watch time: <span className="font-semibold text-white/70">{watchSeconds > 0 ? formatWatchTime(watchSeconds) : "N/A"}</span></p>
                      <div className="mt-3"><RatingStars value={ratings[contentId] ?? null} onRate={(v) => handleRateItem(item, contentType, v)} /></div>
                      <div className="mt-2"><RatingDistribution stats={ratingStats[contentId]} /></div>
                      <div className="mt-4 grid gap-2">
                        {status === "completed" ? (
                          <button type="button" onClick={() => saveItemStatus(item, contentType, "completed")} className="h-11 rounded-xl border border-emerald-400/30 bg-emerald-500/10 font-semibold text-emerald-300">✓ Completed</button>
                        ) : (
                          <button type="button" onClick={() => saveItemStatus(item, contentType, "watchlist")} className="h-11 rounded-xl bg-white font-semibold text-black hover:bg-white/90">+ Add to Watchlist</button>
                        )}
                        <button type="button" onClick={() => setSelectedItem(item)} className="h-11 rounded-xl border border-white/10 bg-white/5 font-semibold text-white hover:bg-white/10">Details</button>
                        {status && <button type="button" onClick={() => removeItem(item, contentType)} className="h-11 rounded-xl border border-red-400/30 bg-red-500/10 font-semibold text-red-300">🗑 Remove</button>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="mt-8 flex items-center justify-center gap-3">
              <button type="button" disabled={page <= 1 || loading} onClick={handlePreviousPage} className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold disabled:opacity-30">← Previous</button>
              <span className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm">Page {page}</span>
              <button type="button" disabled={!hasNextPage || loading} onClick={handleNextPage} className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold disabled:opacity-30">Next →</button>
            </div>
          </>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-12 text-center">
            <p className="text-lg font-semibold">No results found</p>
            <p className="mt-2 text-sm text-white/40">Try another search.</p>
          </div>
        )}
      </div>

      {selectedItem && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => setSelectedItem(null)}>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-[#11111a] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="grid md:grid-cols-[220px_1fr]">
              <div className="relative aspect-[2/3] md:aspect-auto">
                <img src={getImage(selectedItem)} alt={getTitle(selectedItem)} className="h-full w-full object-cover" />
              </div>
              <div className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-2xl font-bold">{getTitle(selectedItem)}</h2>
                  <button type="button" onClick={() => setSelectedItem(null)} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70">✕</button>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  {selectedItem.year && <span className="rounded-full bg-white/5 px-3 py-1 text-sm text-white/60">{selectedItem.year}</span>}
                  {getStatus(selectedItem, contentType) && (
                    <span className={`rounded-full border px-3 py-1 text-sm ${STATUS_COLORS[getStatus(selectedItem, contentType) as ItemStatus]}`}>
                      {STATUS_ICONS[getStatus(selectedItem, contentType) as ItemStatus]} {STATUS_LABELS[getStatus(selectedItem, contentType) as ItemStatus]}
                    </span>
                  )}
                </div>
                <div className="mt-6"><RatingStars value={ratings[getContentId(selectedItem, contentType)] ?? null} onRate={(v) => handleRateItem(selectedItem, contentType, v)} size="large" /></div>
                <div className="mt-4"><RatingDistribution stats={ratingStats[getContentId(selectedItem, contentType)]} size="large" /></div>
                <p className="mt-6 text-sm text-white/60">{selectedItem.synopsis || "No description available."}</p>
                {(contentType === "Anime" || contentType === "TV") && (
                  <EpisodeTracker contentId={getContentId(selectedItem, contentType)} category={contentType} tmdbId={selectedItem.id} fallbackRuntimeMinutes={resolveFallbackRuntimeMinutes(selectedItem)} />
                )}
                <button type="button" onClick={() => setSelectedItem(null)} className="mt-6 w-full rounded-xl bg-white py-3 font-semibold text-black">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}             