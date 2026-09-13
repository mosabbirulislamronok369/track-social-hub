import { NextRequest, NextResponse } from "next/server";

const JIKAN_URL = "https://api.jikan.moe/v4/anime";

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

function getYear(anime: any): number | null {
  if (
    typeof anime?.year === "number" &&
    anime.year > 0
  ) {
    return anime.year;
  }

  const date = anime?.aired?.from;

  if (typeof date === "string") {
    const year = Number(date.slice(0, 4));

    if (
      Number.isFinite(year) &&
      year > 0
    ) {
      return year;
    }
  }

  return null;
}

function getDate(anime: any): string | null {
  const date = anime?.aired?.from;

  if (
    typeof date === "string" &&
    date.length >= 10
  ) {
    return date.slice(0, 10);
  }

  return null;
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

function getScore(anime: any): number | null {
  if (typeof anime?.score !== "number") {
    return null;
  }

  return anime.score;
}

function getEpisodes(anime: any): number | null {
  /*
   * IMPORTANT:
   *
   * Jikan's `episodes` is the total known episode count.
   *
   * Do NOT use aired.episodes here as a replacement when
   * episodes is missing because aired.episodes may represent
   * currently aired episodes, not necessarily the final total.
   */

  if (
    typeof anime?.episodes === "number" &&
    anime.episodes > 0
  ) {
    return anime.episodes;
  }

  /*
   * If total episodes are genuinely unknown, return null.
   * This prevents showing a wrong episode number.
   */
  return null;
}

function getDurationMinutes(anime: any): number | null {
  if (
    typeof anime?.duration === "string"
  ) {
    const match = anime.duration.match(
      /(\d+)\s*min/i,
    );

    if (match) {
      const minutes = Number(match[1]);

      if (
        Number.isFinite(minutes) &&
        minutes > 0
      ) {
        return minutes;
      }
    }
  }

  return null;
}

function normalizeAnime(anime: any) {
  const image = getImage(anime);
  const episodes = getEpisodes(anime);
  const durationMinutes =
    getDurationMinutes(anime);

  const title =
    anime?.title_english ||
    anime?.title ||
    anime?.title_japanese ||
    "Unknown Anime";

  const englishTitle =
    anime?.title_english ||
    anime?.title ||
    anime?.title_japanese ||
    title;

  return {
    /*
     * MAL ID
     *
     * Your existing frontend already supports mal_id.
     */
    mal_id:
      typeof anime?.mal_id === "number"
        ? anime.mal_id
        : anime?.mal_id ?? anime?.id,

    /*
     * Keep an id as well.
     */
    id:
      anime?.mal_id ??
      anime?.id ??
      null,

    title,

    title_english: englishTitle,

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

    synopsis: cleanDescription(
      anime?.synopsis,
    ),

    score: getScore(anime),

    /*
     * FULL TOTAL EPISODE COUNT
     */
    episodes,

    /*
     * Keep the original Jikan duration string.
     */
    duration:
      typeof anime?.duration === "string"
        ? anime.duration
        : null,

    /*
     * Numeric duration for the frontend.
     */
    duration_minutes:
      durationMinutes,

    /*
     * Existing frontend uses this field too.
     */
    episodeRuntime:
      durationMinutes,

    year:
      getYear(anime),

    date:
      getDate(anime),

    status:
      anime?.status || null,

    type:
      anime?.type ||
      anime?.format ||
      null,

    format:
      anime?.type || null,

    source:
      anime?.source || null,

    rating:
      anime?.rating || null,

    season:
      anime?.season || null,

    seasonYear:
      typeof anime?.year === "number"
        ? anime.year
        : null,

    genres: Array.isArray(
      anime?.genres,
    )
      ? anime.genres.map(
          (genre: any) => ({
            name:
              genre?.name ||
              "",
          }),
        )
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
      anime?.images?.jpg
        ?.large_image_url ||
      null,

    trailer:
      anime?.trailer || null,

    /*
     * Additional useful fields.
     */
    aired: anime?.aired || null,

    broadcast:
      anime?.broadcast || null,

    studios: Array.isArray(
      anime?.studios,
    )
      ? anime.studios.map(
          (studio: any) => ({
            name:
              studio?.name ||
              "",
          }),
        )
      : [],
  };
}

export async function GET(
  request: NextRequest,
) {
  try {
    const { searchParams } =
      new URL(request.url);

    const search =
      searchParams
        .get("q")
        ?.trim() || "";

    const rawPage = Number(
      searchParams.get("page") || "1",
    );

    const page =
      Number.isFinite(rawPage) &&
      rawPage > 0
        ? Math.floor(rawPage)
        : 1;

    const rawLimit = Number(
      searchParams.get("limit") || "24",
    );

    /*
     * Jikan supports pagination.
     *
     * Keep our frontend request at 24,
     * but never allow an invalid value.
     */
    const limit =
      Number.isFinite(rawLimit) &&
      rawLimit > 0
        ? Math.min(
            25,
            Math.floor(rawLimit),
          )
        : 24;

    /*
     * Build Jikan URL.
     */
    const params =
      new URLSearchParams();

    if (search) {
      params.set("q", search);
    }

    params.set(
      "page",
      String(page),
    );

    params.set(
      "limit",
      String(limit),
    );

    /*
     * Safe-for-work results.
     *
     * This is Jikan's equivalent of keeping
     * adult content out of normal search.
     */
    params.set("sfw", "true");

    const url =
      `${JIKAN_URL}?${params.toString()}`;

    const controller =
      new AbortController();

    const timeout =
      setTimeout(() => {
        controller.abort();
      }, 20000);

    try {
      const response =
        await fetch(url, {
          method: "GET",

          headers: {
            Accept:
              "application/json",
          },

          signal:
            controller.signal,

          cache: "no-store",
        });

      clearTimeout(timeout);

      let json: any = null;

      try {
        json =
          await response.json();
      } catch {
        return NextResponse.json(
          {
            error:
              "Jikan returned an invalid response",

            message:
              "Anime API did not return valid JSON.",

            status:
              response.status,
          },
          {
            status: 502,
          },
        );
      }

      /*
       * Handle Jikan errors.
       */
      if (!response.ok) {
        console.error(
          "Jikan HTTP error:",
          response.status,
          json,
        );

        /*
         * Jikan commonly uses 429 for
         * rate limiting.
         */
        if (
          response.status === 429
        ) {
          return NextResponse.json(
            {
              error:
                "Anime API rate limited",

              message:
                "Anime search is temporarily rate limited. Please wait a few seconds and try again.",

              status: 429,
            },
            {
              status: 429,
              headers: {
                "Retry-After": "3",
              },
            },
          );
        }

        return NextResponse.json(
          {
            error:
              "Jikan API request failed",

            status:
              response.status,

            message:
              json?.message ||
              json?.error ||
              "Jikan API returned an error.",
          },
          {
            status: 502,
          },
        );
      }

      /*
       * Validate data.
       */
      if (
        !json ||
        !Array.isArray(json.data)
      ) {
        console.error(
          "Invalid Jikan response:",
          json,
        );

        return NextResponse.json(
          {
            error:
              "Invalid Jikan response",

            message:
              "Jikan did not return an anime data array.",
          },
          {
            status: 502,
          },
        );
      }

      /*
       * Normalize all anime results.
       */
      const anime =
        json.data.map(
          normalizeAnime,
        );

      const pagination =
        json.pagination || {};

      const currentPage =
        Number(
          pagination.current_page,
        ) || page;

      const lastVisiblePage =
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

      /*
       * Return the exact shape that
       * UniversalBrowser.tsx already expects.
       */
      return NextResponse.json(
        {
          data: anime,

          pagination: {
            current_page:
              currentPage,

            last_visible_page:
              lastVisiblePage,

            has_next_page:
              hasNextPage,

            total,
          },

          /*
           * Extra aliases for compatibility.
           */
          page:
            currentPage,

          hasNextPage:
            hasNextPage,

          total,
        },
        {
          status: 200,
        },
      );
    } catch (error) {
      clearTimeout(timeout);

      console.error(
        "Jikan request error:",
        error,
      );

      if (
        error instanceof Error &&
        error.name === "AbortError"
      ) {
        return NextResponse.json(
          {
            error:
              "Jikan API timed out",

            message:
              "Anime API timed out. Please try again.",
          },
          {
            status: 504,
          },
        );
      }

      return NextResponse.json(
        {
          error:
            "Anime API request failed",

          message:
            error instanceof Error
              ? error.message
              : "Unknown Jikan API error.",
        },
        {
          status: 502,
        },
      );
    }
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
            : "Unknown server error.",
      },
      {
        status: 500,
      },
    );
  }
}