import { NextResponse } from "next/server";

const TMDB_API_URL = "https://api.themoviedb.org/3";

/*
 * TMDB's /search/tv endpoint does NOT include
 * `episode_run_time` or `number_of_episodes`.
 * Those are only available on the TV details
 * endpoint: /tv/{id}
 *
 * This route fetches just that, so the UI can show
 * accurate estimated watch time and let "Completed"
 * work correctly.
 *
 * NOTE: TMDB's `episode_run_time` field is deprecated
 * and often returns an empty array for shows that get
 * regularly updated (e.g. Stranger Things). When that
 * happens we fall back to:
 *   1. last_episode_to_air.runtime
 *   2. the average runtime across all seasons
 * before giving up.
 *
 * ADDED: this route now also returns a `seasons` list
 * (season_number, name, episode_count) so the client can
 * populate a season dropdown for the episode tracker
 * without a separate request. Everything else below is
 * unchanged from before.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const id = searchParams.get("id")?.trim();

    if (!id) {
      return NextResponse.json(
        {
          error: "TV show id is required",
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
    )}?append_to_response=aggregate_credits`;

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

      console.error("TMDB TV Details API Error:", errorText);

      return NextResponse.json(
        {
          error: "TMDB TV details request failed.",
          details: errorText,
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    /*
     * 1) Preferred: episode_run_time[0]
     * (works for older/stable shows)
     */
    let episodeRuntime =
      Array.isArray(data.episode_run_time) &&
      typeof data.episode_run_time[0] === "number" &&
      data.episode_run_time[0] > 0
        ? data.episode_run_time[0]
        : null;

    /*
     * 2) Fallback: last_episode_to_air.runtime
     * (usually present even when episode_run_time is empty)
     */
    if (!episodeRuntime) {
      const lastEpisodeRuntime =
        data?.last_episode_to_air?.runtime;

      if (
        typeof lastEpisodeRuntime === "number" &&
        lastEpisodeRuntime > 0
      ) {
        episodeRuntime = lastEpisodeRuntime;
      }
    }

    /*
     * 3) Fallback: next_episode_to_air.runtime
     * (rare, but covers upcoming/returning shows)
     */
    if (!episodeRuntime) {
      const nextEpisodeRuntime =
        data?.next_episode_to_air?.runtime;

      if (
        typeof nextEpisodeRuntime === "number" &&
        nextEpisodeRuntime > 0
      ) {
        episodeRuntime = nextEpisodeRuntime;
      }
    }

    /*
     * 4) Last resort: average runtime across seasons,
     * fetched from each season's episode list.
     * Only attempted if everything else came up empty,
     * since it costs extra requests.
     */
    if (
      !episodeRuntime &&
      Array.isArray(data.seasons) &&
      data.seasons.length > 0
    ) {
      const realSeasons = data.seasons.filter(
        (season: any) =>
          typeof season.season_number === "number" &&
          season.season_number > 0
      );

      const seasonToCheck =
        realSeasons[realSeasons.length - 1] ||
        data.seasons[data.seasons.length - 1];

      if (seasonToCheck) {
        try {
          const seasonUrl = `${TMDB_API_URL}/tv/${encodeURIComponent(
            id
          )}/season/${seasonToCheck.season_number}`;

          const seasonRes = await fetch(seasonUrl, {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            cache: "no-store",
          });

          if (seasonRes.ok) {
            const seasonData = await seasonRes.json();

            const runtimes = (
              seasonData?.episodes || []
            )
              .map((ep: any) => ep.runtime)
              .filter(
                (runtime: any) =>
                  typeof runtime === "number" &&
                  runtime > 0
              );

            if (runtimes.length > 0) {
              const average =
                runtimes.reduce(
                  (sum: number, runtime: number) =>
                    sum + runtime,
                  0
                ) / runtimes.length;

              episodeRuntime = Math.round(average);
            }
          }
        } catch (seasonError) {
          console.warn(
            "Failed to fetch season runtime fallback:",
            seasonError
          );
        }
      }
    }

    /*
     * Season list for the episode tracker's season
     * dropdown. Filters out "Specials" (season_number 0)
     * by default — the client can still request it
     * directly via /api/tmdb/tv-season?season=0 if needed.
     */
    const seasons = Array.isArray(data.seasons)
      ? data.seasons
          .filter(
            (season: any) =>
              typeof season.season_number === "number" &&
              season.season_number > 0
          )
          .map((season: any) => ({
            seasonNumber: season.season_number,
            name: season.name || `Season ${season.season_number}`,
            episodeCount: season.episode_count ?? null,
          }))
      : [];

    return NextResponse.json({
      success: true,
      id: data.id,
      episodeRuntime,
      numberOfEpisodes: data.number_of_episodes ?? null,
      seasons,
    });
  } catch (error) {
    console.error("TMDB TV details error:", error);

    return NextResponse.json(
      {
        error: "Failed to fetch TV details.",
      },
      { status: 500 }
    );
  }
}