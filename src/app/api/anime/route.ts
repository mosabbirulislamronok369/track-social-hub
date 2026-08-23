import { NextRequest, NextResponse } from "next/server";

const ANILIST_URL = "https://graphql.anilist.co";

const query = `
  query (
    $page: Int
    $perPage: Int
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
        isAdult: false
        sort: [POPULARITY_DESC, SCORE_DESC]
      ) {
        id
        idMal

        title {
          romaji
          english
          native
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
      }
    }
  }
`;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const search = searchParams.get("q")?.trim() || "";
    const page = Math.max(
      1,
      Number(searchParams.get("page") || "1")
    );

    const requestedLimit = Number(
      searchParams.get("limit") || "24"
    );

    const perPage = Math.min(
      50,
      Math.max(1, requestedLimit)
    );

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 15000);

    try {
      const response = await fetch(ANILIST_URL, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
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
      });

      clearTimeout(timeout);

      const json = await response.json();

      if (!response.ok) {
        console.error(
          "AniList HTTP error:",
          response.status,
          json
        );

        return NextResponse.json(
          {
            error: "AniList API request failed",
            status: response.status,
            message:
              json?.errors?.[0]?.message ||
              "AniList API returned an error.",
          },
          {
            status: 502,
          }
        );
      }

      if (json.errors && json.errors.length > 0) {
        console.error("AniList GraphQL error:", json.errors);

        return NextResponse.json(
          {
            error: "AniList GraphQL error",
            message:
              json.errors[0]?.message ||
              "AniList returned a GraphQL error.",
          },
          {
            status: 502,
          }
        );
      }

      const pageData = json?.data?.Page;

      if (!pageData) {
        return NextResponse.json(
          {
            error: "Invalid AniList response",
          },
          {
            status: 502,
          }
        );
      }

      /*
       * Convert AniList format to the format
       * already used by AnimeBrowser.tsx.
       */
      const anime = (pageData.media || []).map(
        (item: any) => {
          const title =
            item.title?.romaji ||
            item.title?.english ||
            item.title?.native ||
            "Unknown Anime";

          const englishTitle =
            item.title?.english ||
            item.title?.romaji ||
            item.title?.native ||
            title;

          const year =
            item.seasonYear ||
            item.startDate?.year ||
            null;

          const image =
            item.coverImage?.extraLarge ||
            item.coverImage?.large ||
            item.coverImage?.medium ||
            "";

          return {
            mal_id: item.idMal || item.id,

            id: item.id,

            title,

            title_english: englishTitle,

            title_japanese:
              item.title?.native || null,

            images: {
              jpg: {
                image_url: image,
                large_image_url: image,
              },
            },

            score:
              item.averageScore
                ? Number(
                    (item.averageScore / 10).toFixed(2)
                  )
                : null,

            episodes: item.episodes || null,

            year,

            status: item.status || null,

            type:
              item.format ||
              item.type ||
              null,

            duration: item.duration
              ? `${item.duration} min`
              : null,

            synopsis: item.description
              ? item.description
                  .replace(/<br\s*\/?>/gi, "\n")
                  .replace(/<[^>]*>/g, "")
              : null,

            genres: (item.genres || []).map(
              (genre: string) => ({
                name: genre,
              })
            ),

            popularity:
              item.popularity || 0,

            favourites:
              item.favourites || 0,

            bannerImage:
              item.bannerImage || null,

            trailer:
              item.trailer || null,
          };
        }
      );

      return NextResponse.json(
        {
          data: anime,

          pagination: {
            current_page:
              pageData.pageInfo?.currentPage || page,

            last_visible_page:
              pageData.pageInfo?.lastPage || page,

            has_next_page:
              Boolean(
                pageData.pageInfo?.hasNextPage
              ),

            total:
              pageData.pageInfo?.total || anime.length,
          },
        },
        {
          status: 200,
        }
      );
    } catch (error) {
      clearTimeout(timeout);

      console.error(
        "AniList request error:",
        error
      );

      if (
        error instanceof Error &&
        error.name === "AbortError"
      ) {
        return NextResponse.json(
          {
            error: "AniList API timed out",
            message:
              "Anime API timed out. Please try again.",
          },
          {
            status: 504,
          }
        );
      }

      return NextResponse.json(
        {
          error: "Anime API request failed",
          message:
            error instanceof Error
              ? error.message
              : "Unknown API error",
        },
        {
          status: 502,
        }
      );
    }
  } catch (error) {
    console.error(
      "Anime route error:",
      error
    );

    return NextResponse.json(
      {
        error: "Internal server error",
      },
      {
        status: 500,
      }
    );
  }
}