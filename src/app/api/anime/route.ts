import { NextRequest, NextResponse } from "next/server";

const ANILIST_URL = "https://graphql.anilist.co";

const query = `
  query (
    $page: Int!
    $perPage: Int!
    $search: String
  ) {
    Page(
      page: $page
      perPage: $perPage
    ) {
      pageInfo {
        currentPage
        lastPage
        hasNextPage
        total
      }

      media(
        type: ANIME
        search: $search
        sort: [POPULARITY_DESC, SCORE_DESC]
      ) {
        id
        idMal

        title {
          romaji
          english
          native
          userPreferred
        }

        type
        format
        status

        description

        startDate {
          year
          month
          day
        }

        endDate {
          year
          month
          day
        }

        season
        seasonYear

        episodes
        duration

        genres

        averageScore
        popularity
        favourites

        coverImage {
          extraLarge
          large
          medium
        }

        bannerImage

        trailer {
          id
          site
          thumbnail
        }

        nextAiringEpisode {
          airingAt
          timeUntilAiring
          episode
        }
      }
    }
  }
`;

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

function getYear(item: any): number | null {
  const year =
    item?.seasonYear ??
    item?.startDate?.year ??
    null;

  return typeof year === "number" && year > 0
    ? year
    : null;
}

function getImage(item: any): string {
  return (
    item?.coverImage?.extraLarge ||
    item?.coverImage?.large ||
    item?.coverImage?.medium ||
    ""
  );
}

function getTitle(item: any): string {
  return (
    item?.title?.english ||
    item?.title?.romaji ||
    item?.title?.native ||
    item?.title?.userPreferred ||
    "Unknown Anime"
  );
}

function getEnglishTitle(item: any): string {
  return (
    item?.title?.english ||
    item?.title?.romaji ||
    item?.title?.native ||
    "Unknown Anime"
  );
}

function getDate(item: any): string | null {
  const year = item?.startDate?.year;
  const month = item?.startDate?.month;
  const day = item?.startDate?.day;

  if (
    typeof year !== "number" ||
    typeof month !== "number" ||
    typeof day !== "number"
  ) {
    return null;
  }

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");

  return `${year}-${mm}-${dd}`;
}

function getScore(item: any): number | null {
  if (typeof item?.averageScore !== "number") {
    return null;
  }

  return Number((item.averageScore / 10).toFixed(2));
}

function getEpisodes(item: any): number | null {
  /*
   * AniList's `episodes` is the total number of episodes
   * when AniList knows the total.
   *
   * IMPORTANT:
   * Do not replace a real episode count with nextAiringEpisode.episode.
   * nextAiringEpisode.episode means the NEXT episode number,
   * not the total episode count.
   */

  if (
    typeof item?.episodes === "number" &&
    item.episodes > 0
  ) {
    return item.episodes;
  }

  return null;
}

function getDuration(item: any): string | null {
  if (
    typeof item?.duration === "number" &&
    item.duration > 0
  ) {
    return `${item.duration} min`;
  }

  return null;
}

function normalizeAnime(item: any) {
  const episodes = getEpisodes(item);

  return {
    /*
     * Keep MAL id when available because the existing
     * AnimeBrowser normalizer expects mal_id.
     */
    mal_id: item?.idMal || item?.id,

    /*
     * AniList ID is also preserved.
     */
    id: item?.id,

    title: getTitle(item),

    title_english: getEnglishTitle(item),

    title_japanese:
      item?.title?.native || null,

    images: {
      jpg: {
        image_url: getImage(item),
        large_image_url: getImage(item),
      },
    },

    synopsis: cleanDescription(
      item?.description,
    ),

    score: getScore(item),

    episodes,

    /*
     * This is the full episode duration,
     * not total anime watch time.
     */
    duration: getDuration(item),

    /*
     * Keep the numeric duration too.
     * Existing frontend can use this for calculations.
     */
    duration_minutes:
      typeof item?.duration === "number" &&
      item.duration > 0
        ? item.duration
        : null,

    year: getYear(item),

    date: getDate(item),

    status: item?.status || null,

    type:
      item?.format ||
      item?.type ||
      null,

    format: item?.format || null,

    season: item?.season || null,

    seasonYear:
      typeof item?.seasonYear === "number"
        ? item.seasonYear
        : null,

    genres: Array.isArray(item?.genres)
      ? item.genres.map((genre: string) => ({
          name: genre,
        }))
      : [],

    popularity:
      typeof item?.popularity === "number"
        ? item.popularity
        : 0,

    favourites:
      typeof item?.favourites === "number"
        ? item.favourites
        : 0,

    bannerImage:
      item?.bannerImage || null,

    trailer: item?.trailer || null,

    /*
     * Useful for currently airing anime.
     * This does NOT replace `episodes`.
     */
    nextAiringEpisode:
      item?.nextAiringEpisode
        ? {
            episode:
              typeof item.nextAiringEpisode.episode ===
              "number"
                ? item.nextAiringEpisode.episode
                : null,

            airingAt:
              typeof item.nextAiringEpisode.airingAt ===
              "number"
                ? item.nextAiringEpisode.airingAt
                : null,

            timeUntilAiring:
              typeof item.nextAiringEpisode
                .timeUntilAiring === "number"
                ? item.nextAiringEpisode
                    .timeUntilAiring
                : null,
          }
        : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(
      request.url,
    );

    const search =
      searchParams.get("q")?.trim() || "";

    const rawPage = Number(
      searchParams.get("page") || "1",
    );

    const page =
      Number.isFinite(rawPage) && rawPage > 0
        ? Math.floor(rawPage)
        : 1;

    const rawLimit = Number(
      searchParams.get("limit") || "24",
    );

    /*
     * AniList allows up to 50 items per page.
     */
    const perPage = Math.min(
      50,
      Math.max(
        1,
        Number.isFinite(rawLimit)
          ? Math.floor(rawLimit)
          : 24,
      ),
    );

    const controller =
      new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 20000);

    try {
      const response = await fetch(
        ANILIST_URL,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
            Accept:
              "application/json",
          },

          body: JSON.stringify({
            query,
            variables: {
              page,
              perPage,
              search: search || null,
            },
          }),

          signal: controller.signal,

          cache: "no-store",
        },
      );

      clearTimeout(timeout);

      /*
       * Read response safely.
       */
      let json: any = null;

      try {
        json = await response.json();
      } catch {
        return NextResponse.json(
          {
            error:
              "AniList returned an invalid response",
            status: response.status,
            message:
              "AniList did not return valid JSON.",
          },
          {
            status: 502,
          },
        );
      }

      /*
       * HTTP-level error.
       */
      if (!response.ok) {
        console.error(
          "AniList HTTP error:",
          response.status,
          json,
        );

        return NextResponse.json(
          {
            error:
              "AniList API request failed",
            status: response.status,
            message:
              json?.errors?.[0]?.message ||
              json?.message ||
              "AniList API returned an HTTP error.",
          },
          {
            status: 502,
          },
        );
      }

      /*
       * GraphQL-level error.
       */
      if (
        Array.isArray(json?.errors) &&
        json.errors.length > 0
      ) {
        console.error(
          "AniList GraphQL error:",
          json.errors,
        );

        return NextResponse.json(
          {
            error:
              "AniList GraphQL error",
            message:
              json.errors[0]?.message ||
              "AniList returned a GraphQL error.",
          },
          {
            status: 502,
          },
        );
      }

      const pageData =
        json?.data?.Page;

      if (!pageData) {
        console.error(
          "Invalid AniList response:",
          json,
        );

        return NextResponse.json(
          {
            error:
              "Invalid AniList response",
            message:
              "AniList did not return Page data.",
          },
          {
            status: 502,
          },
        );
      }

      const media = Array.isArray(
        pageData.media,
      )
        ? pageData.media
        : [];

      const anime = media.map(
        normalizeAnime,
      );

      const pageInfo =
        pageData.pageInfo || {};

      return NextResponse.json(
        {
          data: anime,

          /*
           * Keep this compatible with
           * UniversalBrowser.tsx.
           */
          pagination: {
            current_page:
              pageInfo.currentPage ||
              page,

            last_visible_page:
              pageInfo.lastPage ||
              page,

            has_next_page:
              Boolean(
                pageInfo.hasNextPage,
              ),

            total:
              typeof pageInfo.total ===
              "number"
                ? pageInfo.total
                : anime.length,
          },

          /*
           * Also expose these aliases so future
           * frontend code can use either format.
           */
          page: pageInfo.currentPage || page,

          hasNextPage:
            Boolean(
              pageInfo.hasNextPage,
            ),

          total:
            typeof pageInfo.total ===
            "number"
              ? pageInfo.total
              : anime.length,
        },
        {
          status: 200,
        },
      );
    } catch (error) {
      clearTimeout(timeout);

      console.error(
        "AniList request error:",
        error,
      );

      if (
        error instanceof Error &&
        error.name === "AbortError"
      ) {
        return NextResponse.json(
          {
            error:
              "AniList API timed out",
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
              : "Unknown API error",
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
            : "Unknown server error",
      },
      {
        status: 500,
      },
    );
  }
}