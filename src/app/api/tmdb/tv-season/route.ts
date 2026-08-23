import { NextResponse } from "next/server";

const TMDB_API_URL = "https://api.themoviedb.org/3";

/*
 * Returns the episode list for ONE season of a TV show —
 * episode_number, name, runtime (minutes, may be null for
 * unaired/very new episodes), and air_date.
 *
 * Used by the episode tracker (EpisodeTracker.tsx) to render
 * a checklist per season and compute accurate watch time per
 * episode instead of an averaged estimate.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const id = searchParams.get("id")?.trim();
    const seasonNumber = searchParams.get("season")?.trim();

    if (!id || !seasonNumber) {
      return NextResponse.json(
        {
          error: "TV show id and season are required",
        },
        { status: 400 }
      );
    }

    const accessToken = process.env.TMDB_ACCESS_TOKEN;

    if (!accessToken) {
      return NextResponse.json(
        {
          error: "TMDB_ACCESS_TOKEN is missing in .env.local",
        },
        { status: 500 }
      );
    }

    const url = `${TMDB_API_URL}/tv/${encodeURIComponent(
      id
    )}/season/${encodeURIComponent(seasonNumber)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();

      console.error("TMDB TV Season API Error:", errorText);

      return NextResponse.json(
        {
          error: "TMDB TV season request failed.",
          details: errorText,
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    const episodes = (data?.episodes || []).map((ep: any) => ({
      episodeNumber: ep.episode_number,
      name: ep.name || `Episode ${ep.episode_number}`,
      runtime:
        typeof ep.runtime === "number" && ep.runtime > 0
          ? ep.runtime
          : null,
      airDate: ep.air_date || null,
    }));

    return NextResponse.json({
      success: true,
      seasonNumber: data.season_number ?? Number(seasonNumber),
      episodes,
    });
  } catch (error) {
    console.error("TMDB TV season error:", error);

    return NextResponse.json(
      {
        error: "Failed to fetch TV season.",
      },
      { status: 500 }
    );
  }
}