import { NextResponse } from "next/server";

const TMDB_BASE = "https://api.themoviedb.org/3";

function getApiKey(): string | null {
  return process.env.TMDB_API_KEY || process.env.NEXT_PUBLIC_TMDB_API_KEY || null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tmdbId = searchParams.get("malId")?.trim() || ""; // সামঞ্জস্য বজায় রাখতে malId প্যারামিটার নাম ব্যবহার
    const rawRuntime = Number(searchParams.get("runtime") || "0");
    const fallbackRuntimeSeconds = Number.isFinite(rawRuntime) && rawRuntime > 0 ? Math.round(rawRuntime) : 1440; // ডিফল্ট 24 মিনিট

    const apiKey = getApiKey();
    if (!apiKey) {
      return NextResponse.json({ error: "TMDB API key missing", data: [] }, { status: 500 });
    }

    if (!tmdbId) {
      return NextResponse.json({ error: "Missing TMDB ID", data: [] }, { status: 400 });
    }

    // প্রথমে টিভি সিরিজের বিস্তারিত তথ্য আনুন, সিজন নম্বর জানতে
    const detailUrl = new URL(`${TMDB_BASE}/tv/${tmdbId}`);
    detailUrl.searchParams.set("api_key", apiKey);
    detailUrl.searchParams.set("language", "en-US");

    const detailRes = await fetch(detailUrl.toString(), { cache: "no-store" });
    if (!detailRes.ok) {
      return NextResponse.json({ error: "TV show not found", data: [] }, { status: 404 });
    }

    const detail = await detailRes.json();
    const seasons = detail.seasons || [];
    // ডিফল্ট সিজন 1, বিশেষ পর্ব (সিজন 0) বাদ দিন
    const targetSeason = seasons.find((s: any) => s.season_number === 1) || seasons[0];

    if (!targetSeason) {
      return NextResponse.json({ error: "No seasons found", data: [] }, { status: 404 });
    }

    // সিজনের পর্বের তালিকা আনুন
    const seasonUrl = new URL(`${TMDB_BASE}/tv/${tmdbId}/season/${targetSeason.season_number}`);
    seasonUrl.searchParams.set("api_key", apiKey);
    seasonUrl.searchParams.set("language", "en-US");

    const seasonRes = await fetch(seasonUrl.toString(), { cache: "no-store" });
    if (!seasonRes.ok) {
      return NextResponse.json({ error: "Season not found", data: [] }, { status: 404 });
    }

    const seasonData = await seasonRes.json();
    const episodes = (seasonData.episodes || []).map((ep: any) => ({
      episodeNumber: ep.episode_number,
      name: ep.name || `Episode ${ep.episode_number}`,
      runtimeSeconds: ep.runtime ? Math.round(ep.runtime * 60) : fallbackRuntimeSeconds,
      airDate: ep.air_date || null,
    }));

    return NextResponse.json({
      data: episodes,
      source: "tmdb",
      seasonNumber: targetSeason.season_number,
      seasonName: targetSeason.name,
    });
  } catch (error) {
    console.error("TMDB episodes route error:", error);
    return NextResponse.json(
      { error: "Episode list temporarily unavailable", data: [] },
      { status: 500 }
    );
  }
}