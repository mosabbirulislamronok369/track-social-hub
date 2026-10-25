import { NextRequest, NextResponse } from "next/server";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const MAX_LIMIT = 24;

function getApiKey(): string | null {
  return process.env.TMDB_API_KEY || process.env.NEXT_PUBLIC_TMDB_API_KEY || null;
}

async function fetchTmdb(path: string, params: Record<string, string> = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("TMDB API key missing");

  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("language", "en-US");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TMDB ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

function normalizeTmdbAnime(item: any, mediaType: "tv" | "movie") {
  const isMovie = mediaType === "movie";
  const title = isMovie ? item.title : item.name;
  const date = isMovie ? item.release_date : item.first_air_date;

  return {
    id: item.id,
    mal_id: item.id, // টাইপ সামঞ্জস্য বজায় রাখতে, আসলে TMDB ID
    title,
    title_english: title,
    images: {
      jpg: {
        image_url: item.poster_path ? `${TMDB_IMAGE_BASE}${item.poster_path}` : "",
        large_image_url: item.poster_path ? `${TMDB_IMAGE_BASE}${item.poster_path}` : "",
      },
    },
    synopsis: item.overview || null,
    score: item.vote_average || null,
    episodes: null, // বিস্তারিত API থেকে পূরণ করতে হবে
    duration_minutes: null,
    year: date ? Number(date.slice(0, 4)) : null,
    date: date || null,
    type: isMovie ? "Movie" : "TV",
    format: isMovie ? "Movie" : "TV",
    source: "TMDB",
    media_type: mediaType,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim() || "";
    const rawPage = Number(searchParams.get("page") || "1");
    const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

    if (!query) {
      return NextResponse.json({
        data: [],
        pagination: { current_page: 1, last_visible_page: 1, has_next_page: false, total: 0 },
        page: 1,
        hasNextPage: false,
        total: 0,
        source: "none",
      });
    }

    // TMDB search-এ সরাসরি অ্যানিমে ফিল্টার নেই, তাই discover ব্যবহার করে keyword search করতে হবে
    // সহজ পদ্ধতি: TV এবং Movie আলাদাভাবে discover করুন, query এর সাথে মিলিয়ে ফিল্টার করুন
    // আরও নির্ভুল পদ্ধতি: প্রথমে search/tv এবং search/movie, তারপর genre_ids যাচাই করুন

    // search/tv এবং search/movie একসাথে চালান
    const [tvSearch, movieSearch] = await Promise.all([
      fetchTmdb("/search/tv", { query, page: String(page) }),
      fetchTmdb("/search/movie", { query, page: String(page) }),
    ]);

    const allResults: any[] = [];

    // TV ফলাফল প্রক্রিয়া করুন, শুধু অ্যানিমেশন (genre 16) এবং জাপানি (ja) রাখুন
    for (const item of tvSearch.results || []) {
      if (item.genre_ids?.includes(16) && item.original_language === "ja") {
        allResults.push(normalizeTmdbAnime(item, "tv"));
      }
    }

    // Movie ফলাফল প্রক্রিয়া করুন
    for (const item of movieSearch.results || []) {
      if (item.genre_ids?.includes(16) && item.original_language === "ja") {
        allResults.push(normalizeTmdbAnime(item, "movie"));
      }
    }

    // TMDB এর discover আরও সঠিক, কিন্তু search দিয়ে keyword মেলানো যায়
    // যদি search ফলাফল খুব কম হয়, discover দিয়ে জনপ্রিয় অ্যানিমে আনুন
    if (allResults.length === 0) {
      const [discoverTv, discoverMovie] = await Promise.all([
        fetchTmdb("/discover/tv", {
          with_genres: "16",
          with_original_language: "ja",
          sort_by: "popularity.desc",
          page: String(page),
        }),
        fetchTmdb("/discover/movie", {
          with_genres: "16",
          with_original_language: "ja",
          sort_by: "popularity.desc",
          page: String(page),
        }),
      ]);

      for (const item of discoverTv.results || []) {
        allResults.push(normalizeTmdbAnime(item, "tv"));
      }
      for (const item of discoverMovie.results || []) {
        allResults.push(normalizeTmdbAnime(item, "movie"));
      }
    }

    const start = 0;
    const end = Math.min(allResults.length, MAX_LIMIT);
    const pageData = allResults.slice(start, end);

    return NextResponse.json({
      data: pageData,
      pagination: {
        current_page: page,
        last_visible_page: page + 1,
        has_next_page: allResults.length >= MAX_LIMIT,
        total: allResults.length,
      },
      page,
      hasNextPage: allResults.length >= MAX_LIMIT,
      total: allResults.length,
      source: "tmdb",
    });
  } catch (error) {
    console.error("TMDB anime route error:", error);
    return NextResponse.json(
      {
        error: "Anime search temporarily unavailable",
        message: error instanceof Error ? error.message : "Unknown error",
        data: [],
      },
      { status: 500 }
    );
  }
}