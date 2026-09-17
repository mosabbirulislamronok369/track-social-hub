import { NextRequest, NextResponse } from "next/server";

const JIKAN_EPISODES_URL = "https://api.jikan.moe/v4/anime";
const TVMAZE_SEARCH_URL = "https://api.tvmaze.com/search/shows";
const TVMAZE_SHOW_URL = "https://api.tvmaze.com/shows";

const REQUEST_TIMEOUT = 12000;
const JIKAN_RETRIES = 2;

type EpisodeInfo = {
  episodeNumber: number;
  name: string;
  runtimeSeconds: number;
  airDate?: string | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(
  url: string,
  timeout = REQUEST_TIMEOUT,
) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    let json: any = null;

    try {
      json = await response.json();
    } catch {
      json = null;
    }

    return {
      response,
      json,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ============================================================
   JIKAN
============================================================ */

async function fetchJikanEpisodes(
  malId: string,
  averageRuntimeSeconds: number,
): Promise<EpisodeInfo[]> {
  let lastError: unknown = null;

  for (
    let attempt = 0;
    attempt <= JIKAN_RETRIES;
    attempt++
  ) {
    try {
      const url =
        `${JIKAN_EPISODES_URL}/` +
        `${encodeURIComponent(malId)}/episodes`;

      const { response, json } = await fetchJson(url);

      if (response.ok) {
        const items = Array.isArray(json?.data)
          ? json.data
          : [];

        const episodes: EpisodeInfo[] = items
          .filter(
            (ep: any) =>
              typeof ep?.mal_id === "number",
          )
          .map((ep: any) => ({
            episodeNumber: ep.mal_id,
            name:
              typeof ep?.title === "string" &&
              ep.title.trim()
                ? ep.title
                : `Episode ${ep.mal_id}`,
            runtimeSeconds:
              averageRuntimeSeconds,
            airDate:
              typeof ep?.aired === "string"
                ? ep.aired.slice(0, 10)
                : null,
          }));

        return episodes;
      }

      lastError = new Error(
        `Jikan returned HTTP ${response.status}: ${
          json?.message ||
          json?.error ||
          "Unknown error"
        }`,
      );

      /*
       * Don't retry normal 4xx errors,
       * except 429 rate-limit.
       */
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 429
      ) {
        break;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < JIKAN_RETRIES) {
      await sleep(700 * (attempt + 1));
    }
  }

  console.error(
    "Jikan episode API unavailable:",
    lastError,
  );

  throw lastError instanceof Error
    ? lastError
    : new Error("Jikan episode API unavailable.");
}

/* ============================================================
   TVMAZE SEARCH
============================================================ */

async function findTvMazeShow(
  title: string,
): Promise<number | null> {
  if (!title.trim()) {
    return null;
  }

  try {
    const url =
      `${TVMAZE_SEARCH_URL}?q=${encodeURIComponent(title)}`;

    const { response, json } =
      await fetchJson(url);

    if (!response.ok || !Array.isArray(json)) {
      return null;
    }

    /*
     * Prefer an exact title match.
     */
    const exact = json.find(
      (item: any) =>
        item?.show?.name?.toLowerCase() ===
        title.toLowerCase(),
    );

    if (
      typeof exact?.show?.id === "number"
    ) {
      return exact.show.id;
    }

    const first = json.find(
      (item: any) =>
        typeof item?.show?.id === "number",
    );

    return first?.show?.id ?? null;
  } catch (error) {
    console.error(
      "TVMaze search failed:",
      error,
    );

    return null;
  }
}

/* ============================================================
   TVMAZE EPISODES
============================================================ */

async function fetchTvMazeEpisodes(
  showId: number,
  averageRuntimeSeconds: number,
): Promise<EpisodeInfo[]> {
  const url =
    `${TVMAZE_SHOW_URL}/${showId}/episodes`;

  const { response, json } =
    await fetchJson(url);

  if (!response.ok) {
    throw new Error(
      `TVMaze returned HTTP ${response.status}.`,
    );
  }

  if (!Array.isArray(json)) {
    throw new Error(
      "TVMaze returned invalid episode data.",
    );
  }

  return json
    .filter(
      (ep: any) =>
        typeof ep?.number === "number",
    )
    .map((ep: any) => ({
      episodeNumber: ep.number,
      name:
        typeof ep?.name === "string" &&
        ep.name.trim()
          ? ep.name
          : `Episode ${ep.number}`,
      runtimeSeconds:
        typeof ep?.runtime === "number" &&
        ep.runtime > 0
          ? Math.round(ep.runtime * 60)
          : averageRuntimeSeconds,
      airDate:
        typeof ep?.airdate === "string"
          ? ep.airdate
          : null,
    }));
}

/* ============================================================
   GET
============================================================ */

export async function GET(
  request: NextRequest,
) {
  try {
    const { searchParams } =
      new URL(request.url);

    const malId =
      searchParams.get("malId")?.trim() || "";

    const title =
      searchParams.get("title")?.trim() || "";

    const rawRuntime =
      Number(
        searchParams.get("runtime") || "0",
      );

    const averageRuntimeSeconds =
      Number.isFinite(rawRuntime) &&
      rawRuntime > 0
        ? Math.round(rawRuntime)
        : 0;

    if (!malId && !title) {
      return NextResponse.json(
        {
          error: "Missing anime identifier.",
          data: [],
        },
        { status: 400 },
      );
    }

    /*
     * --------------------------------------------------------
     * 1. JIKAN PRIMARY
     * --------------------------------------------------------
     *
     * Only use Jikan when we have a real MAL ID.
     */
    if (
      malId &&
      !malId.startsWith("tvmaze-")
    ) {
      try {
        const episodes =
          await fetchJikanEpisodes(
            malId,
            averageRuntimeSeconds,
          );

        return NextResponse.json(
          {
            data: episodes,
            source: "jikan",
          },
          {
            status: 200,
            headers: {
              "Cache-Control":
                "public, max-age=30, s-maxage=60",
            },
          },
        );
      } catch (error) {
        console.warn(
          "Jikan failed. Trying TVMaze fallback.",
          error,
        );
      }
    }

    /*
     * --------------------------------------------------------
     * 2. TVMAZE FALLBACK
     * --------------------------------------------------------
     */

    let tvMazeId: number | null = null;

    if (malId.startsWith("tvmaze-")) {
      const parsed = Number(
        malId.replace("tvmaze-", ""),
      );

      if (
        Number.isFinite(parsed) &&
        parsed > 0
      ) {
        tvMazeId = parsed;
      }
    }

    if (!tvMazeId && title) {
      tvMazeId =
        await findTvMazeShow(title);
    }

    if (tvMazeId) {
      try {
        const episodes =
          await fetchTvMazeEpisodes(
            tvMazeId,
            averageRuntimeSeconds,
          );

        if (episodes.length > 0) {
          return NextResponse.json(
            {
              data: episodes,
              source: "tvmaze",
              warning:
                "Jikan is temporarily unavailable. Showing fallback episode data.",
            },
            {
              status: 200,
              headers: {
                "Cache-Control":
                  "public, max-age=30, s-maxage=60",
              },
            },
          );
        }
      } catch (error) {
        console.error(
          "TVMaze episode fallback failed:",
          error,
        );
      }
    }

    /*
     * --------------------------------------------------------
     * 3. BOTH FAILED
     * --------------------------------------------------------
     */

    return NextResponse.json(
      {
        error:
          "Episode list is temporarily unavailable.",
        message:
          "Jikan is unavailable and no fallback episode list could be loaded.",
        data: [],
      },
      {
        status: 503,
      },
    );
  } catch (error) {
    console.error(
      "Anime episodes route error:",
      error,
    );

    return NextResponse.json(
      {
        error: "Internal server error.",
        message:
          error instanceof Error
            ? error.message
            : "Unknown episode API error.",
        data: [],
      },
      {
        status: 500,
      },
    );
  }
}