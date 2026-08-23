import { NextResponse } from "next/server";

const YOUTUBE_SEARCH_URL =
  "https://www.googleapis.com/youtube/v3/search";
const YOUTUBE_VIDEOS_URL =
  "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_CHANNELS_URL =
  "https://www.googleapis.com/youtube/v3/channels";
const YOUTUBE_PLAYLISTS_URL =
  "https://www.googleapis.com/youtube/v3/playlists";

/*
 * Converts YouTube's ISO 8601 duration format
 * (e.g. "PT4M13S") into total seconds.
 */
function parseISO8601DurationToSeconds(
  duration?: string | null,
): number {
  if (!duration) {
    return 0;
  }

  const match = duration.match(
    /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/,
  );

  if (!match) {
    return 0;
  }

  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);

  return hours * 3600 + minutes * 60 + seconds;
}

/*
 * Extracts a video / playlist / channel id (or handle)
 * from a pasted YouTube URL, for the "Link" search type.
 */
function parseYoutubeLink(rawUrl: string): {
  kind: "video" | "playlist" | "channel" | "handle";
  id: string;
} | null {
  try {
    const url = new URL(rawUrl.trim());

    const videoId = url.searchParams.get("v");

    if (videoId) {
      return { kind: "video", id: videoId };
    }

    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.replace("/", "");

      if (id) {
        return { kind: "video", id };
      }
    }

    const playlistId = url.searchParams.get("list");

    if (playlistId) {
      return { kind: "playlist", id: playlistId };
    }

    const channelMatch = url.pathname.match(
      /\/channel\/([^/]+)/,
    );

    if (channelMatch) {
      return { kind: "channel", id: channelMatch[1] };
    }

    const handleMatch = url.pathname.match(/\/@([^/]+)/);

    if (handleMatch) {
      return { kind: "handle", id: handleMatch[1] };
    }

    return null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const apiKey = process.env.YOUTUBE_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "YOUTUBE_API_KEY is missing in .env.local",
        },
        { status: 500 },
      );
    }

    const link = searchParams.get("link")?.trim();
    const query = searchParams.get("query")?.trim();

    const searchType = (searchParams
      .get("type")
      ?.trim() || "video") as
      | "video"
      | "channel"
      | "playlist";

    /* ============================================
       LINK MODE — fetch a single item directly,
       no search call needed.
    ============================================ */
    if (link) {
      const parsed = parseYoutubeLink(link);

      if (!parsed) {
        return NextResponse.json(
          {
            error:
              "Couldn't recognize that YouTube link.",
          },
          { status: 400 },
        );
      }

      if (parsed.kind === "video") {
        const url = new URL(YOUTUBE_VIDEOS_URL);

        url.searchParams.set(
          "part",
          "snippet,contentDetails",
        );
        url.searchParams.set("id", parsed.id);
        url.searchParams.set("key", apiKey);

        const res = await fetch(url.toString(), {
          cache: "no-store",
        });

        const data = await res.json();

        if (!res.ok) {
          return NextResponse.json(
            {
              error: "YouTube video lookup failed.",
              details: data,
            },
            { status: res.status },
          );
        }

        const item = data.items?.[0];

        if (!item) {
          return NextResponse.json({ results: [] });
        }

        return NextResponse.json({
          results: [
            {
              id: {
                kind: "youtube#video",
                videoId: item.id,
              },
              snippet: item.snippet,
              runtime_seconds:
                parseISO8601DurationToSeconds(
                  item.contentDetails?.duration,
                ),
            },
          ],
        });
      }

      if (parsed.kind === "playlist") {
        const url = new URL(YOUTUBE_PLAYLISTS_URL);

        url.searchParams.set(
          "part",
          "snippet,contentDetails",
        );
        url.searchParams.set("id", parsed.id);
        url.searchParams.set("key", apiKey);

        const res = await fetch(url.toString(), {
          cache: "no-store",
        });

        const data = await res.json();

        if (!res.ok) {
          return NextResponse.json(
            {
              error:
                "YouTube playlist lookup failed.",
              details: data,
            },
            { status: res.status },
          );
        }

        const item = data.items?.[0];

        if (!item) {
          return NextResponse.json({ results: [] });
        }

        return NextResponse.json({
          results: [
            {
              id: {
                kind: "youtube#playlist",
                playlistId: item.id,
              },
              snippet: item.snippet,
              item_count:
                item.contentDetails?.itemCount ??
                null,
            },
          ],
        });
      }

      // channel or @handle
      const url = new URL(YOUTUBE_CHANNELS_URL);

      url.searchParams.set("part", "snippet,statistics");

      if (parsed.kind === "handle") {
        url.searchParams.set("forHandle", parsed.id);
      } else {
        url.searchParams.set("id", parsed.id);
      }

      url.searchParams.set("key", apiKey);

      const res = await fetch(url.toString(), {
        cache: "no-store",
      });

      const data = await res.json();

      if (!res.ok) {
        return NextResponse.json(
          {
            error: "YouTube channel lookup failed.",
            details: data,
          },
          { status: res.status },
        );
      }

      const item = data.items?.[0];

      if (!item) {
        return NextResponse.json({ results: [] });
      }

      return NextResponse.json({
        results: [
          {
            id: {
              kind: "youtube#channel",
              channelId: item.id,
            },
            snippet: item.snippet,
            subscriber_count:
              item.statistics?.subscriberCount ??
              null,
          },
        ],
      });
    }

    /* ============================================
       SEARCH MODE
    ============================================ */
    if (!query) {
      return NextResponse.json(
        { error: "Search query is required" },
        { status: 400 },
      );
    }

    const searchUrl = new URL(YOUTUBE_SEARCH_URL);

    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("type", searchType);
    searchUrl.searchParams.set("maxResults", "24");
    searchUrl.searchParams.set("key", apiKey);

    const searchRes = await fetch(
      searchUrl.toString(),
      { cache: "no-store" },
    );

    if (!searchRes.ok) {
      const errorText = await searchRes.text();

      console.error(
        "YouTube Search API Error:",
        errorText,
      );

      return NextResponse.json(
        {
          error: "YouTube search request failed.",
          details: errorText,
        },
        { status: searchRes.status },
      );
    }

    const searchData = await searchRes.json();
    const items = searchData.items || [];

    /* Videos: batch-fetch real durations */
    if (searchType === "video") {
      const videoIds = items
        .map((item: any) => item.id?.videoId)
        .filter(Boolean);

      let durations: Record<string, number> = {};

      if (videoIds.length > 0) {
        const detailsUrl = new URL(
          YOUTUBE_VIDEOS_URL,
        );

        detailsUrl.searchParams.set(
          "part",
          "contentDetails",
        );
        detailsUrl.searchParams.set(
          "id",
          videoIds.join(","),
        );
        detailsUrl.searchParams.set("key", apiKey);

        const detailsRes = await fetch(
          detailsUrl.toString(),
          { cache: "no-store" },
        );

        if (detailsRes.ok) {
          const detailsData =
            await detailsRes.json();

          durations = (
            detailsData.items || []
          ).reduce(
            (
              acc: Record<string, number>,
              video: any,
            ) => {
              acc[video.id] =
                parseISO8601DurationToSeconds(
                  video.contentDetails?.duration,
                );

              return acc;
            },
            {},
          );
        }
      }

      const results = items.map((item: any) => ({
        ...item,
        runtime_seconds:
          durations[item.id?.videoId] ?? 0,
      }));

      return NextResponse.json({ results });
    }

    /* Playlists: batch-fetch item counts */
    if (searchType === "playlist") {
      const playlistIds = items
        .map((item: any) => item.id?.playlistId)
        .filter(Boolean);

      let counts: Record<string, number | null> = {};

      if (playlistIds.length > 0) {
        const detailsUrl = new URL(
          YOUTUBE_PLAYLISTS_URL,
        );

        detailsUrl.searchParams.set(
          "part",
          "contentDetails",
        );
        detailsUrl.searchParams.set(
          "id",
          playlistIds.join(","),
        );
        detailsUrl.searchParams.set("key", apiKey);

        const detailsRes = await fetch(
          detailsUrl.toString(),
          { cache: "no-store" },
        );

        if (detailsRes.ok) {
          const detailsData =
            await detailsRes.json();

          counts = (
            detailsData.items || []
          ).reduce(
            (
              acc: Record<string, number | null>,
              playlist: any,
            ) => {
              acc[playlist.id] =
                playlist.contentDetails
                  ?.itemCount ?? null;

              return acc;
            },
            {},
          );
        }
      }

      const results = items.map((item: any) => ({
        ...item,
        item_count:
          counts[item.id?.playlistId] ?? null,
      }));

      return NextResponse.json({ results });
    }

    /* Channels: batch-fetch subscriber counts */
    if (searchType === "channel") {
      const channelIds = items
        .map((item: any) => item.id?.channelId)
        .filter(Boolean);

      let subs: Record<string, string | null> = {};

      if (channelIds.length > 0) {
        const detailsUrl = new URL(
          YOUTUBE_CHANNELS_URL,
        );

        detailsUrl.searchParams.set(
          "part",
          "statistics",
        );
        detailsUrl.searchParams.set(
          "id",
          channelIds.join(","),
        );
        detailsUrl.searchParams.set("key", apiKey);

        const detailsRes = await fetch(
          detailsUrl.toString(),
          { cache: "no-store" },
        );

        if (detailsRes.ok) {
          const detailsData =
            await detailsRes.json();

          subs = (detailsData.items || []).reduce(
            (
              acc: Record<string, string | null>,
              channel: any,
            ) => {
              acc[channel.id] =
                channel.statistics
                  ?.subscriberCount ?? null;

              return acc;
            },
            {},
          );
        }
      }

      const results = items.map((item: any) => ({
        ...item,
        subscriber_count:
          subs[item.id?.channelId] ?? null,
      }));

      return NextResponse.json({ results });
    }

    return NextResponse.json({ results: items });
  } catch (error) {
    console.error("YouTube route error:", error);

    return NextResponse.json(
      { error: "Failed to search YouTube." },
      { status: 500 },
    );
  }
}