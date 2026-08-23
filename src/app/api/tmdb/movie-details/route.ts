import { NextResponse } from "next/server";

const TMDB_API_URL = "https://api.themoviedb.org/3";

/*
 * TMDB's /search/movie endpoint does NOT include
 * `runtime`. Runtime is only available on the
 * movie details endpoint: /movie/{id}
 *
 * This route fetches just that, so the UI can show
 * accurate estimated watch time and let "Completed"
 * work correctly.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const id = searchParams.get("id")?.trim();

    if (!id) {
      return NextResponse.json(
        {
          error: "Movie id is required",
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

    const url = `${TMDB_API_URL}/movie/${encodeURIComponent(id)}`;

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

      console.error("TMDB Movie Details API Error:", errorText);

      return NextResponse.json(
        {
          error: "TMDB movie details request failed.",
          details: errorText,
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      success: true,
      id: data.id,
      runtime: data.runtime ?? null,
    });
  } catch (error) {
    console.error("TMDB movie details error:", error);

    return NextResponse.json(
      {
        error: "Failed to fetch movie details.",
      },
      { status: 500 }
    );
  }
}