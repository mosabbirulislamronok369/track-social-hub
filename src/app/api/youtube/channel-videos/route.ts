import { NextResponse } from "next/server";

/*
 * GET /api/youtube/channel-videos?channelId=<id>
 *
 * Returns EVERY video uploaded by a channel, not just one
 * page of results. YouTube's API has no direct "give me all
 * videos" endpoint, so this does it in three steps:
 *
 *   1. Look up the channel's "uploads" playlist id
 *      (every channel has one, it's just not shown in the UI).
 *   2. Page through that playlist with playlistItems.list,
 *      following nextPageToken until there isn't one, to
 *      collect every video id + basic snippet info.
 *   3. Batch-fetch videos.list (50 ids at a time, the API max)
 *      to get each video's real duration, then merge it in.
 *
 * Response shape:
 *   { items: [{ videoId, title, thumbnail, publishedAt,
 *               channelTitle, duration, runtimeSeconds }] }
 *
 * NOTE: uses process.env.YOUTUBE_API_KEY — rename this to
 * match whatever your existing /api/youtube/route.ts uses if
 * it's different (e.g. YT_API_KEY, GOOGLE_API_KEY, etc).
 */

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const API_BASE = "https://www.googleapis.com/youtube/v3";

type RawPlaylistItem = {
  videoId: string;
  title: string;
  thumbnail: string | null;
  publishedAt: string | null;
  channelTitle: string | null;
};

/*
 * Converts YouTube's ISO 8601 duration format
 * (e.g. "PT1H2M10S") into total seconds.
 */
function isoDurationToSeconds(duration: string): number {
  const match = duration.match(
    /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/,
  );

  if (!match) {
    return 0;
  }

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);

  return hours * 3600 + minutes * 60 + seconds;
}

function formatDurationLabel(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      seconds,
    ).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/*
 * Step 1: resolve the channel's uploads playlist id.
 */
async function getUploadsPlaylistId(
  channelId: string,
): Promise<string | null> {
  const url = `${API_BASE}/channels?part=contentDetails&id=${encodeURIComponent(
    channelId,
  )}&key=${YOUTUBE_API_KEY}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(
      `Failed to look up channel (status ${res.status}).`,
    );
  }

  const data = await res.json();

  const uploadsId =
    data?.items?.[0]?.contentDetails?.relatedPlaylists
      ?.uploads;

  return uploadsId || null;
}

/*
 * Step 2: page through the uploads playlist until every
 * video has been collected (no more nextPageToken).
 */
async function getAllPlaylistItems(
  playlistId: string,
): Promise<RawPlaylistItem[]> {
  const items: RawPlaylistItem[] = [];

  let pageToken = "";

  // Safety cap so a runaway channel can't loop forever.
  const MAX_PAGES = 200;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url =
      `${API_BASE}/playlistItems?part=snippet&maxResults=50` +
      `&playlistId=${encodeURIComponent(playlistId)}` +
      `&key=${YOUTUBE_API_KEY}` +
      (pageToken ? `&pageToken=${pageToken}` : "");

    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(
        `Failed to fetch playlist items (status ${res.status}).`,
      );
    }

    // eslint-disable-next-line no-await-in-loop
    const data = await res.json();

    const pageItems: RawPlaylistItem[] = (
      data?.items || []
    ).map((entry: any) => {
      const snippet = entry?.snippet || {};

      return {
        videoId:
          snippet?.resourceId?.videoId ||
          entry?.contentDetails?.videoId ||
          "",
        title: snippet?.title || "Untitled",
        thumbnail:
          snippet?.thumbnails?.medium?.url ||
          snippet?.thumbnails?.default?.url ||
          null,
        publishedAt: snippet?.publishedAt || null,
        channelTitle: snippet?.channelTitle || null,
      };
    }).filter((item: RawPlaylistItem) => item.videoId);

    items.push(...pageItems);

    pageToken = data?.nextPageToken || "";

    if (!pageToken) {
      break;
    }
  }

  return items;
}

/*
 * Step 3: batch-fetch real durations, 50 video ids per
 * request (the API's max), and merge them back in.
 */
async function attachDurations(
  playlistItems: RawPlaylistItem[],
): Promise<
  Array<
    RawPlaylistItem & {
      duration: string | null;
      runtimeSeconds: number | null;
    }
  >
> {
  const durationById = new Map<
    string,
    { duration: string; runtimeSeconds: number }
  >();

  const CHUNK_SIZE = 50;

  for (
    let start = 0;
    start < playlistItems.length;
    start += CHUNK_SIZE
  ) {
    const chunk = playlistItems.slice(
      start,
      start + CHUNK_SIZE,
    );

    const ids = chunk.map((item) => item.videoId).join(",");

    const url = `${API_BASE}/videos?part=contentDetails&id=${ids}&key=${YOUTUBE_API_KEY}`;

    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(
        `Failed to fetch video durations (status ${res.status}).`,
      );
    }

    // eslint-disable-next-line no-await-in-loop
    const data = await res.json();

    (data?.items || []).forEach((videoEntry: any) => {
      const isoDuration =
        videoEntry?.contentDetails?.duration;

      if (!isoDuration) {
        return;
      }

      const runtimeSeconds =
        isoDurationToSeconds(isoDuration);

      durationById.set(videoEntry.id, {
        duration: formatDurationLabel(runtimeSeconds),
        runtimeSeconds,
      });
    });
  }

  return playlistItems.map((item) => {
    const found = durationById.get(item.videoId);

    return {
      ...item,
      duration: found?.duration || null,
      runtimeSeconds: found?.runtimeSeconds ?? null,
    };
  });
}

export async function GET(request: Request) {
  try {
    if (!YOUTUBE_API_KEY) {
      return NextResponse.json(
        { error: "YouTube API key is not configured." },
        { status: 500 },
      );
    }

    const { searchParams } = new URL(request.url);
    const channelId = searchParams.get("channelId");

    if (!channelId) {
      return NextResponse.json(
        { error: "channelId is required." },
        { status: 400 },
      );
    }

    const uploadsPlaylistId =
      await getUploadsPlaylistId(channelId);

    if (!uploadsPlaylistId) {
      return NextResponse.json(
        { error: "Channel not found." },
        { status: 404 },
      );
    }

    const playlistItems = await getAllPlaylistItems(
      uploadsPlaylistId,
    );

    const items = await attachDurations(playlistItems);

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Channel videos route error:", error);

    return NextResponse.json(
      { error: "Failed to load channel videos." },
      { status: 500 },
    );
  }
}