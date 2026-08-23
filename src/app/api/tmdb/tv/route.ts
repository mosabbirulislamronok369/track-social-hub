import { NextResponse } from "next/server";

const TMDB_API_URL = "https://api.themoviedb.org/3";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const query = searchParams.get("query")?.trim();
    const page = searchParams.get("page")?.trim() || "1";

    if (!query) {
      return NextResponse.json(
        { error: "Search query is required" },
        { status: 400 }
      );
    }

    const accessToken = process.env.TMDB_ACCESS_TOKEN;

    if (!accessToken) {
      return NextResponse.json(
        { error: "TMDB_ACCESS_TOKEN is missing in .env.local" },
        { status: 500 }
      );
    }

    const url = `${TMDB_API_URL}/search/tv?query=${encodeURIComponent(
      query
    )}&page=${page}`;

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
      console.error("TMDB TV Search API Error:", errorText);

      return NextResponse.json(
        { error: "TMDB TV search request failed.", details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json(data);
  } catch (error) {
    console.error("TMDB TV search error:", error);

    return NextResponse.json(
      { error: "Failed to search TV shows." },
      { status: 500 }
    );
  }
}