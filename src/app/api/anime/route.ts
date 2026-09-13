import { NextRequest, NextResponse } from "next/server";

const JIKAN_URL = "https://api.jikan.moe/v4/anime";
const TVMAZE_SEARCH_URL = "https://api.tvmaze.com/search/shows";

const MAX_LIMIT = 24;
const JIKAN_RETRIES = 2;
const REQUEST_TIMEOUT = 12000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanDescription(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function getImage(anime: any): string {
  return (
    anime?.images?.jpg?.large_image_url ||
    anime?.images?.jpg?.image_url ||
    anime?.images?.webp?.large_image_url ||
    anime?.images?.webp?.image_url ||
    ""
  );
}

function getYear(anime: any): number | null {
  if (typeof anime?.year === "number" && anime.year > 0) {
    return anime.year;
  }

  const date = anime?.aired?.from;

  if (typeof date === "string") {
    const year = Number(date.slice(0, 4));

    if (Number.isFinite(year) && year > 0) {
      return year;
    }
  }

  return null;
}

function getDate(anime: any): string | null {
  const date = anime?.aired?.from;

  if (typeof date === "string" && date.length >= 10) {
    return date.slice(0, 10);
  }

  return null;
}

function getDurationMinutes(anime: any): number | null {
  if (typeof anime?.duration !== "string") {
    return null;
  }

  const match = anime.duration.match(/(\d+)\s*min/i);

  if (!match) {
    return null;
  }

  const minutes = Number(match[1]);

  return Number.isFinite(minutes) && minutes > 0
    ? minutes
    : null;
}

function getEpisodes(anime: any): number | null {
  if (
    typeof anime?.episodes === "number" &&
    anime.episodes > 0
  ) {
    return anime.episodes;
  }

  return null;
}

function normalizeJikanAnime(anime: any) {
  const image = getImage(anime);
  const durationMinutes = getDurationMinutes(anime);

  const title =
    anime?.title_english ||
    anime?.title ||
    anime?.title_japanese ||
    "Unknown Anime";

  return {
    mal_id:
      typeof anime?.mal_id === "number"
        ? anime.mal_id
        : anime?.mal_id ?? anime?.id ?? null,

    id:
      anime?.mal_id ??
      anime?.id ??
      null,

    title,

    title_english:
      anime?.title_english ||
      anime?.title ||
      anime?.title_japanese ||
      title,

    title_japanese:
      anime?.title_japanese || null,

    images: {
      jpg: {
        image_url:
          anime?.images?.jpg?.image_url ||
          image,

        large_image_url:
          anime?.images?.jpg?.large_image_url ||
          image,
      },
    },

    synopsis: cleanDescription(anime?.synopsis),

    score:
      typeof anime?.score === "number"
        ? anime.score
        : null,

    episodes: getEpisodes(anime),

    duration:
      typeof anime?.duration === "string"
        ? anime.duration
        : null,

    duration_minutes: durationMinutes,

    episodeRuntime: durationMinutes,

    year: getYear(anime),

    date: getDate(anime),

    status: anime?.status || null,

    type:
      anime?.type ||
      anime?.format ||
      null,

    format:
      anime?.type ||
      anime?.format ||
      null,

    source: anime?.source || null,

    rating: anime?.rating || null,

    season: anime?.season || null,

    seasonYear:
      typeof anime?.year === "number"
        ? anime.year
        : null,

    genres: Array.isArray(anime?.genres)
      ? anime.genres.map((genre: any) => ({
          name: genre?.name || "",
        }))
      : [],

    popularity:
      typeof anime?.popularity === "number"
        ? anime.popularity
        : 0,

    favourites:
      typeof anime?.favorites === "number"
        ? anime.favorites
        : 0,

    bannerImage:
      anime?.images?.jpg?.large_image_url ||
      null,

    trailer:
      anime?.trailer || null,

    aired:
      anime?.aired || null,

    broadcast:
      anime?.broadcast || null,

    studios: Array.isArray(anime?.studios)
      ? anime.studios.map((studio: any) => ({
          name: studio?.name || "",
        }))
      : [],
  };
}

function normalizeTvMazeShow(show: any) {
  const image =
    show?.image?.original ||
    show?.image?.medium ||
    "";

  const premiered =
    typeof show?.premiered === "string"
      ? show.premiered
      : null;

  const year = premiered
    ? Number(premiered.slice(0, 4))
    : null;

  const genres = Array.isArray(show?.genres)
    ? show.genres.map((name: string) => ({
        name,
      }))
    : [];

  return {
    mal_id:
      typeof show?.id === "number"
        ? `tvmaze-${show.id}`
        : null,

    id:
      typeof show?.id === "number"
        ? `tvmaze-${show.id}`
        : null,

    title:
      show?.name ||
      "Unknown Anime",

    title_english:
      show?.name ||
      "Unknown Anime",

    title_japanese: null,

    images: {
      jpg: {
        image_url: image,
        large_image_url: image,
      },
    },

    synopsis:
      cleanDescription(show?.summary),

    score:
      typeof show?.rating?.average === "number"
        ? show.rating.average
        : null,

    episodes: null,

    duration:
      typeof show?.runtime === "number"
        ? `${show.runtime} min`
        : null,

    duration_minutes:
      typeof show?.runtime === "number"
        ? show.runtime
        : null,

    episodeRuntime:
      typeof show?.runtime === "number"
        ? show.runtime
        : null,

    year:
      typeof year === "number" &&
      Number.isFinite(year) &&
      year > 0
        ? year
        : null,

    date: premiered,

    status:
      show?.status || null,

    type:
      show?.type || null,

    format:
      show?.type || null,

    source: "TVMaze",

    rating:
      show?.rating?.average ?? null,

    season: null,

    seasonYear:
      typeof year === "number" &&
      Number.isFinite(year) &&
      year > 0
        ? year
        : null,

    genres,

    popularity: 0,

    favourites: 0,

    bannerImage:
      image || null,

    trailer: null,

    aired: {
      from: premiered,
      to:
        typeof show?.ended === "string"
          ? show.ended
          : null,
    },

    broadcast: null,

    studios: [],
  };
}

async function fetchJson(
  url: string,
  init: RequestInit = {},
  timeout = REQUEST_TIMEOUT,
) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });

    const contentType =
      response.headers.get("content-type") || "";

    let json: any = null;

    if (contentType.includes("application/json")) {
      try {
        json = await response.json();
      } catch {
        json = null;
      }
    } else {
      try {
        const text = await response.text();

        try {
          json = JSON.parse(text);
        } catch {
          json = {
            message: text,
          };
        }
      } catch {
        json = null;
      }
    }

    return {
      response,
      json,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJikan(
  search: string,
  page: number,
  limit: number,
) {
  const params = new URLSearchParams();

  if (search) {
    params.set("q", search);
  }

  params.set("page", String(page));
  params.set("limit", String(limit));
  params.set("sfw", "true");

  const url = `${JIKAN_URL}?${params.toString()}`;

  let lastError: unknown = null;

  for (
    let attempt = 0;
    attempt <= JIKAN_RETRIES;
    attempt++
  ) {
    try {
      const {
        response,
        json,
      } = await fetchJson(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (response.ok) {
        if (
          json &&
          Array.isArray(json.data)
        ) {
          return {
            ok: true,
            data: json.data,
            pagination: json.pagination || {},
          };
        }

        lastError = new Error(
          "Jikan returned an invalid data structure.",
        );
      } else {
        const status = response.status;

        lastError = new Error(
          `Jikan returned HTTP ${status}: ${
            json?.message ||
            json?.error ||
            "Unknown error"
          }`,
        );

        /*
         * Do not retry normal 4xx errors.
         * Retry 429 and 5xx only.
         */
        if (
          status >= 400 &&
          status < 500 &&
          status !== 429
        ) {
          break;
        }
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < JIKAN_RETRIES) {
      await sleep(700 * (attempt + 1));
    }
  }

  console.error(
    "Jikan unavailable:",
    lastError,
  );

  return {
    ok: false,
    error: lastError,
  };
}

/* ============================================================
   JIKAN EPISODES
============================================================ */

async function fetchJikanEpisodes(
  malId: string,
  page: number,
) {
  const url =
    `${JIKAN_URL}/${encodeURIComponent(malId)}/episodes` +
    `?page=${page}`;

  let lastError: unknown = null;

  for (
    let attempt = 0;
    attempt <= JIKAN_RETRIES;
    attempt++
  ) {
    try {
      const {
        response,
        json,
      } = await fetchJson(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (response.ok) {
        if (
          json &&
          Array.isArray(json.data)
        ) {
          const episodes = json.data.map(
            (ep: any) => ({
              episodeNumber:
                typeof ep?.mal_id === "number"
                  ? ep.mal_id
                  : null,

              name:
                ep?.title ||
                `Episode ${ep?.mal_id ?? ""}`,

              runtimeSeconds: 0,

              airDate:
                typeof ep?.aired === "string"
                  ? ep.aired
                  : null,
            }),
          );

          return {
            ok: true,
            data: episodes,
            pagination:
              json.pagination || {},
          };
        }

        lastError = new Error(
          "Jikan returned an invalid episode response.",
        );
      } else {
        const status = response.status;

        lastError = new Error(
          `Jikan episode API returned HTTP ${status}: ${
            json?.message ||
            json?.error ||
            "Unknown error"
          }`,
        );

        if (
          status >= 400 &&
          status < 500 &&
          status !== 429
        ) {
          break;
        }
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

  return {
    ok: false,
    error: lastError,
  };
}

async function fetchTvMazeFallback(
  search: string,
) {
  if (!search) {
    return {
      ok: false,
      data: [],
    };
  }

  const params = new URLSearchParams();

  params.set("q", search);

  const url =
    `${TVMAZE_SEARCH_URL}?${params.toString()}`;

  try {
    const {
      response,
      json,
    } = await fetchJson(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      console.error(
        "TVMaze fallback error:",
        response.status,
        json,
      );

      return {
        ok: false,
        data: [],
      };
    }

    if (!Array.isArray(json)) {
      return {
        ok: false,
        data: [],
      };
    }

    const data = json
      .map((item: any) => item?.show)
      .filter(Boolean)
      .map(normalizeTvMazeShow);

    return {
      ok: true,
      data,
    };
  } catch (error) {
    console.error(
      "TVMaze fallback request failed:",
      error,
    );

    return {
      ok: false,
      data: [],
    };
  }
}

export async function GET(
  request: NextRequest,
) {
  try {
    const { searchParams } =
      new URL(request.url);

    /*
     * ========================================================
     * ANIME EPISODES
     * /api/anime?malId=20&episodes=true&page=1
     * ========================================================
     */

    const malId =
      searchParams.get("malId")?.trim() || "";

    const episodes =
      searchParams.get("episodes") === "true";

    if (episodes) {
      if (!malId) {
        return NextResponse.json(
          {
            error:
              "Missing MAL ID",
            message:
              "malId is required when loading anime episodes.",
            data: [],
          },
          { status: 400 },
        );
      }

      const rawEpisodePage =
        Number(
          searchParams.get("page") || "1",
        );

      const episodePage =
        Number.isFinite(rawEpisodePage) &&
        rawEpisodePage > 0
          ? Math.floor(rawEpisodePage)
          : 1;

      const result =
        await fetchJikanEpisodes(
          malId,
          episodePage,
        );

      if (!result.ok) {
        const errorMessage =
          result.error instanceof Error
            ? result.error.message
            : "Jikan episode service is unavailable.";

        return NextResponse.json(
          {
            error:
              "Anime episode service is temporarily unavailable",
            message: errorMessage,
            data: [],
            source: "jikan",
          },
          {
            status: 502,
            headers: {
              "Cache-Control":
                "no-store",
            },
          },
        );
      }

      const pagination =
        result.pagination || {};

      return NextResponse.json(
        {
          data: result.data,

          pagination: {
            current_page:
              Number(
                pagination.current_page,
              ) || episodePage,

            last_visible_page:
              Number(
                pagination.last_visible_page,
              ) || episodePage,

            has_next_page:
              Boolean(
                pagination.has_next_page,
              ),

            total:
              typeof pagination.items?.total ===
              "number"
                ? pagination.items.total
                : result.data.length,
          },

          page:
            Number(
              pagination.current_page,
            ) || episodePage,

          hasNextPage:
            Boolean(
              pagination.has_next_page,
            ),

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
    }

    /*
     * ========================================================
     * NORMAL ANIME SEARCH
     * ========================================================
     */

    const search =
      searchParams
        .get("q")
        ?.trim() || "";

    const rawPage =
      Number(
        searchParams.get("page") || "1",
      );

    const rawLimit =
      Number(
        searchParams.get("limit") ||
          String(MAX_LIMIT),
      );

    const page =
      Number.isFinite(rawPage) &&
      rawPage > 0
        ? Math.floor(rawPage)
        : 1;

    const limit =
      Number.isFinite(rawLimit) &&
      rawLimit > 0
        ? Math.min(
            MAX_LIMIT,
            Math.floor(rawLimit),
          )
        : MAX_LIMIT;

    /*
     * Empty query
     */

    if (!search) {
      return NextResponse.json(
        {
          data: [],

          pagination: {
            current_page: 1,
            last_visible_page: 1,
            has_next_page: false,
            total: 0,
          },

          page: 1,
          hasNextPage: false,
          total: 0,
          source: "none",
        },
        {
          status: 200,
        },
      );
    }

    /*
     * ========================================================
     * PRIMARY: JIKAN
     * ========================================================
     */

    const jikan =
      await fetchJikan(
        search,
        page,
        limit,
      );

    if (jikan.ok) {
      const anime =
        jikan.data.map(
          normalizeJikanAnime,
        );

      const pagination =
        jikan.pagination || {};

      const currentPage =
        Number(
          pagination.current_page,
        ) || page;

      const lastPage =
        Number(
          pagination.last_visible_page,
        ) || currentPage;

      const hasNextPage =
        Boolean(
          pagination.has_next_page,
        );

      const total =
        typeof pagination.items?.total ===
        "number"
          ? pagination.items.total
          : typeof pagination.total ===
              "number"
            ? pagination.total
            : anime.length;

      return NextResponse.json(
        {
          data: anime,

          pagination: {
            current_page:
              currentPage,

            last_visible_page:
              lastPage,

            has_next_page:
              hasNextPage,

            total,
          },

          page: currentPage,

          hasNextPage,

          total,

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
    }

    /*
     * ========================================================
     * FALLBACK: TVMAZE
     * ========================================================
     */

    const fallback =
      await fetchTvMazeFallback(
        search,
      );

    if (
      fallback.ok &&
      fallback.data.length > 0
    ) {
      const start =
        (page - 1) * limit;

      const end =
        start + limit;

      const pageData =
        fallback.data.slice(
          start,
          end,
        );

      const hasNextPage =
        end <
        fallback.data.length;

      return NextResponse.json(
        {
          data: pageData,

          pagination: {
            current_page: page,

            last_visible_page:
              Math.max(
                1,
                Math.ceil(
                  fallback.data.length /
                    limit,
                ),
              ),

            has_next_page:
              hasNextPage,

            total:
              fallback.data.length,
          },

          page,

          hasNextPage,

          total:
            fallback.data.length,

          source: "tvmaze",

          warning:
            "Jikan is temporarily unavailable. Showing fallback results.",
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

    /*
     * Both providers failed.
     */

    return NextResponse.json(
      {
        error:
          "Anime search is temporarily unavailable",

        message:
          "The primary anime service is unavailable and the fallback service did not return results.",

        data: [],

        pagination: {
          current_page: page,
          last_visible_page: page,
          has_next_page: false,
          total: 0,
        },
      },
      {
        status: 503,
      },
    );
  } catch (error) {
    console.error(
      "Anime route error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Internal server error",

        message:
          error instanceof Error
            ? error.message
            : "Unknown anime API error.",

        data: [],
      },
      {
        status: 500,
      },
    );
  }
}