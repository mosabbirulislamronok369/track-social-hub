import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";

type MALStatus =
  | "watching"
  | "completed"
  | "on_hold"
  | "dropped"
  | "plan_to_watch";

function normalizeStatus(status: unknown): MALStatus {
  switch (status) {
    case "watching":
      return "watching";

    case "completed":
      return "completed";

    case "on_hold":
      return "on_hold";

    case "dropped":
      return "dropped";

    case "plan_to_watch":
      return "plan_to_watch";

    default:
      return "plan_to_watch";
  }
}

/*
 * watchlist_items.status doesn't use MAL's vocabulary —
 * it uses whatever Dashboard.tsx / UniversalBrowser already
 * write there ("watchlist", "watching", "on_hold", "rewatch",
 * "completed"). Map MAL's 5 statuses onto that set so
 * imported anime shows up correctly in "Continue Watching"
 * (which only reads watching/watchlist/on_hold/rewatch —
 * completed and dropped are intentionally excluded from that
 * card, same as anything else marked complete).
 */
function mapToWatchlistStatus(malStatus: MALStatus): string {
  switch (malStatus) {
    case "watching":
      return "watching";

    case "completed":
      return "completed";

    case "on_hold":
      return "on_hold";

    case "dropped":
      return "dropped";

    case "plan_to_watch":
      return "watchlist";
  }
}

/*
 * Same contentId convention Dashboard.tsx / UniversalBrowser
 * already use elsewhere in the app (`${category}-${id}`, e.g.
 * "tv-12345") — so imported rows line up with the rest of the
 * app instead of creating a parallel id scheme.
 */
function buildContentId(malId: number) {
  return `anime-${malId}`;
}

/*
 * MAL/Jikan doesn't reliably give us per-episode runtime, so
 * this is a rough estimate only (used for the "estimated
 * seconds" stat on Dashboard) — 24 min/episode is the typical
 * anime episode length.
 */
const FALLBACK_EPISODE_SECONDS = 24 * 60;

/*
 * This route accepts the anime list the frontend already has
 * in hand — either fetched from a live MAL account or parsed
 * from an uploaded MAL XML export — and saves it into
 * watchlist_items, the same table Dashboard's "Continue
 * Watching" section and UniversalBrowser already read/write.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const requestStatus = normalizeStatus(body?.status);
    const animeItems = Array.isArray(body?.anime)
      ? body.anime
      : [];

    if (animeItems.length === 0) {
      return NextResponse.json(
        { error: "No anime provided to import." },
        { status: 400 },
      );
    }

    /*
     * Identify the logged-in Track Social Hub user.
     * Prefer a bearer token sent from the client (the
     * current Supabase session's access_token) — this is
     * what actually works server-side.
     */
    const authHeader =
      request.headers.get("authorization") || "";

    const bearerToken = authHeader
      .toLowerCase()
      .startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null;

    const {
      data: { user },
      error: authError,
    } = bearerToken
      ? await supabase.auth.getUser(bearerToken)
      : await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          error:
            "Please login to Track Social Hub first.",
        },
        { status: 401 },
      );
    }

    const now = new Date().toISOString();

    const rows = animeItems
      .map((anime: any) => {
        const malId = Number(anime?.mal_id);

        if (!Number.isFinite(malId) || malId <= 0) {
          return null;
        }

        const itemMalStatus = normalizeStatus(
          anime?.my_list_status?.status ??
            requestStatus,
        );

        const totalEpisodes =
          Number(anime?.num_episodes) || 0;

        const currentEpisode = Number(
          anime?.my_list_status
            ?.num_episodes_watched ?? 0,
        );

        const estimatedSeconds =
          totalEpisodes > 0
            ? totalEpisodes * FALLBACK_EPISODE_SECONDS
            : 0;

        return {
          user_id: user.id,
          content_id: buildContentId(malId),
          category: "Anime",
          title: anime?.title || "Unknown Anime",

          image_url:
            anime?.main_picture?.large ??
            anime?.main_picture?.medium ??
            null,

          status: mapToWatchlistStatus(itemMalStatus),

          estimated_seconds: estimatedSeconds,
          current_episode: currentEpisode,
          total_episodes:
            totalEpisodes > 0 ? totalEpisodes : null,

          updated_at: now,
          created_at: now,
        };
      })
      .filter(Boolean) as Record<string, any>[];

    if (rows.length === 0) {
      return NextResponse.json(
        {
          error:
            "None of the selected anime had a valid MAL ID.",
        },
        { status: 400 },
      );
    }

    /*
     * De-dupe by (user_id, content_id) in case the same
     * anime got selected twice.
     */
    const uniqueRows = Array.from(
      new Map(
        rows.map((row) => [
          `${row.user_id}-${row.content_id}`,
          row,
        ]),
      ).values(),
    );

    /*
     * Upsert. Same user + same content_id → status/episode
     * progress/etc get updated instead of creating a
     * duplicate row.
     */
    const { data, error } = await supabase
      .from("watchlist_items")
      .upsert(uniqueRows, {
        onConflict: "user_id,content_id",
      })
      .select();

    if (error) {
      console.error(
        "MAL import database error:",
        error,
      );

      return NextResponse.json(
        {
          error: "Failed to save imported anime.",
          details: error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      imported: data?.length ?? uniqueRows.length,
      skipped: Math.max(
        0,
        rows.length - uniqueRows.length,
      ),
      total: uniqueRows.length,
      category: "Anime",
      message: `${
        data?.length ?? uniqueRows.length
      } anime imported to Anime.`,
      anime: data ?? uniqueRows,
    });
  } catch (error) {
    console.error("MAL import error:", error);

    return NextResponse.json(
      {
        error: "MAL import failed.",
        details:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      { status: 500 },
    );
  }
}