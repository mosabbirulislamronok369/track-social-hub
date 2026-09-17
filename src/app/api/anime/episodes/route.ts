import { NextRequest, NextResponse } from "next/server";

const JIKAN_EPISODES_URL = "https://api.jikan.moe/v4/anime";

const REQUEST_TIMEOUT = 12000;
const MAX_PAGES = 20;
const PAGE_LIMIT = 100;
const RETRIES = 2;

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
        "User-Agent": "track-social-hub/1.0",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const contentType =
      response.headers.get("content-type") || "";

    let json: any = null;

    try {
      if (contentType.includes("application/json")) {
        json = await response.json();
      } else {
        const text = await response.text();

        try {
          json = JSON.parse(text);
        } catch {
          json = {
            message: text,
          };
        }
      }
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

async function fetchJikanPage(
  malId: string,
  page: number,
) {
  const url =
    `${JIKAN_EPISODES_URL}/` +
    `${encodeURIComponent(malId)}/episodes` +
    `?page=${page}`;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const { response, json } =
        await fetchJson(url);

      if (response.ok) {
        if (
          json &&
          Array.isArray(json.data)
        ) {
          return {
            ok: true,
            data: json.data,
            pagination:
              json.pagination || {},
          };
        }

        lastError = new Error(
          "Jikan returned invalid episode data.",
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
         * Don't retry normal client errors.
         * 429, 5xx and network failures are retryable.
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

    if (attempt < RETRIES) {
      await sleep(800 * (attempt + 1));
    }
  }

  return {
    ok: false,
    error: lastError,
  };
}

function normalizeEpisode(
  episode: any,
  averageRuntimeSeconds: number,
) {
  const episodeNumber =
    typeof episode?.mal_id === "number"
      ? episode.mal_id
      : null;

  if (
    episodeNumber === null ||
    episodeNumber <= 0
  ) {
    return null;
  }

  return {
    episodeNumber,
    name:
      typeof episode?.title === "string" &&
      episode.title.trim()
        ? episode.title.trim()
        : `Episode ${episodeNumber}`,

    runtimeSeconds:
      averageRuntimeSeconds > 0
        ? averageRuntimeSeconds
        : 0,

    airDate:
      typeof episode?.aired === "string"
        ? episode.aired.slice(0, 10)
        : null,
  };
}

export async function GET(
  request: NextRequest,
) {
  try {
    const { searchParams } =
      new URL(request.url);

    const malId =
      searchParams.get("malId")?.trim() ||
      searchParams.get("id")?.trim() ||
      "";

    const runtimeRaw =
      Number(
        searchParams.get(
          "runtimeSeconds",
        ) || "0",
      );

    const averageRuntimeSeconds =
      Number.isFinite(runtimeRaw) &&
      runtimeRaw > 0
        ? Math.round(runtimeRaw)
        : 0;

    if (!malId) {
      return NextResponse.json(
        {
          error: "Missing MAL ID.",
          data: [],
        },
        { status: 400 },
      );
    }

    /*
     * Fetch every Jikan episode page.
     *
     * Jikan normally exposes up to 100
     * episodes per page.
     */
    const allEpisodes: any[] = [];

    let page = 1;
    let hasNextPage = true;

    while (
      hasNextPage &&
      page <= MAX_PAGES
    ) {
      const result =
        await fetchJikanPage(
          malId,
          page,
        );

      if (!result.ok) {
        /*
         * If page 1 fails, don't return
         * fake episode data.
         */
        if (page === 1) {
          const message =
            result.error instanceof Error
              ? result.error.message
              : "Jikan episode API failed.";

          console.error(
            "Jikan episode API failed:",
            message,
          );

          return NextResponse.json(
            {
              error:
                "Jikan episode API unavailable.",
              message,
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

        /*
         * If a later page fails, return
         * the episodes already collected.
         */
        break;
      }

      const normalized =
        result.data
          .map((episode: any) =>
            normalizeEpisode(
              episode,
              averageRuntimeSeconds,
            ),
          )
          .filter(Boolean);

      allEpisodes.push(
        ...normalized,
      );

      hasNextPage = Boolean(
        result.pagination
          ?.has_next_page,
      );

      page += 1;

      /*
       * Small delay between pages to avoid
       * Jikan rate-limit problems.
       */
      if (hasNextPage) {
        await sleep(450);
      }
    }

    /*
     * Remove accidental duplicate episode
     * numbers and sort numerically.
     */
    const uniqueEpisodes = Array.from(
      new Map(
        allEpisodes.map(
          (episode: any) => [
            episode.episodeNumber,
            episode,
          ],
        ),
      ).values(),
    ).sort(
      (a: any, b: any) =>
        a.episodeNumber -
        b.episodeNumber,
    );

    return NextResponse.json(
      {
        data: uniqueEpisodes,
        episodes: uniqueEpisodes,
        total: uniqueEpisodes.length,
        hasNextPage: false,
        source: "jikan",
      },
      {
        status: 200,
        headers: {
          /*
           * Short cache helps when the same
           * anime is opened repeatedly.
           */
          "Cache-Control":
            "public, max-age=60, s-maxage=300",
        },
      },
    );
  } catch (error) {
    console.error(
      "Anime episodes route error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Internal anime episode API error.",
        message:
          error instanceof Error
            ? error.message
            : "Unknown error.",
        data: [],
      },
      {
        status: 500,
      },
    );
  }
}