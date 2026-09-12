import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const fileId = new URL(request.url).searchParams
      .get("fileId")
      ?.trim();

    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!fileId) {
      return NextResponse.json(
        {
          success: false,
          error: "fileId is required.",
        },
        { status: 400 },
      );
    }

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          error: "Telegram bot token is missing.",
        },
        { status: 500 },
      );
    }

    // --------------------------------------------------
    // 1. Get Telegram file path
    // --------------------------------------------------

    const fileInfoResponse = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(
        fileId,
      )}`,
      {
        cache: "no-store",
      },
    );

    const fileInfo =
      await fileInfoResponse.json();

    if (
      !fileInfoResponse.ok ||
      !fileInfo?.ok ||
      !fileInfo?.result?.file_path
    ) {
      console.error(
        "Telegram getFile video error:",
        fileInfo,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            fileInfo?.description ||
            "Telegram video lookup failed.",
        },
        { status: 502 },
      );
    }

    // --------------------------------------------------
    // 2. Fetch video from Telegram
    // --------------------------------------------------

    const telegramFileUrl =
      `https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`;

    /*
     * Forward browser Range requests.
     *
     * This is important for:
     * - video seeking
     * - mobile playback
     * - browser buffering
     * - reels-style playback
     */
    const range = request.headers.get("range");

    const telegramHeaders: HeadersInit = {};

    if (range) {
      telegramHeaders.Range = range;
    }

    const mediaResponse = await fetch(
      telegramFileUrl,
      {
        cache: "no-store",
        headers: telegramHeaders,
      },
    );

    if (
      !mediaResponse.ok &&
      mediaResponse.status !== 206
    ) {
      console.error(
        "Telegram video download failed:",
        mediaResponse.status,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to fetch video from Telegram.",
        },
        { status: 502 },
      );
    }

    if (!mediaResponse.body) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Telegram returned an empty video.",
        },
        { status: 502 },
      );
    }

    // --------------------------------------------------
    // 3. Forward video headers to browser
    // --------------------------------------------------

    const headers = new Headers();

    headers.set(
      "Content-Type",
      mediaResponse.headers.get(
        "content-type",
      ) || "video/mp4",
    );

    headers.set(
      "Accept-Ranges",
      "bytes",
    );

    const contentLength =
      mediaResponse.headers.get(
        "content-length",
      );

    if (contentLength) {
      headers.set(
        "Content-Length",
        contentLength,
      );
    }

    const contentRange =
      mediaResponse.headers.get(
        "content-range",
      );

    if (contentRange) {
      headers.set(
        "Content-Range",
        contentRange,
      );
    }

    headers.set(
      "Cache-Control",
      "public, max-age=31536000, immutable",
    );

    headers.set(
      "X-Content-Type-Options",
      "nosniff",
    );

    /*
     * IMPORTANT:
     *
     * Use Telegram's actual response status.
     * Do not blindly return 206 just because the browser
     * sent a Range header.
     */
    const status =
      mediaResponse.status === 206
        ? 206
        : 200;

    return new Response(
      mediaResponse.body,
      {
        status,
        headers,
      },
    );
  } catch (error) {
    console.error(
      "Telegram video stream error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Video stream failed.",
      },
      { status: 500 },
    );
  }
}