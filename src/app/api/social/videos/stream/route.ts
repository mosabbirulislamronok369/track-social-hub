import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("fileId")?.trim();
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!fileId || !token) {
    return NextResponse.json(
      { error: "Telegram file ID or bot token is missing." },
      { status: 400 },
    );
  }

  try {
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
      { cache: "no-store" },
    );

    const telegramData = await telegramResponse.json();

    if (!telegramResponse.ok || !telegramData?.ok || !telegramData?.result?.file_path) {
      return NextResponse.json(
        { error: telegramData?.description || "Telegram file lookup failed." },
        { status: 502 },
      );
    }

    /*
     * Forward the client's Range header so the browser can seek/scrub
     * and doesn't have to re-download the whole file on every request.
     * Without this, playback on mobile is much heavier than it needs
     * to be and can stall or hang the page.
     */
    const range = request.headers.get("range");

    const fileResponse = await fetch(
      `https://api.telegram.org/file/bot${token}/${telegramData.result.file_path}`,
      {
        cache: "no-store",
        headers: range ? { range } : undefined,
      },
    );

    if (!fileResponse.ok && fileResponse.status !== 206) {
      return NextResponse.json(
        { error: "Telegram video download failed." },
        { status: 502 },
      );
    }

    if (!fileResponse.body) {
      return NextResponse.json(
        { error: "Telegram video download failed." },
        { status: 502 },
      );
    }

    const headers = new Headers();

    headers.set(
      "Content-Type",
      fileResponse.headers.get("content-type") || "video/mp4",
    );

    headers.set("Accept-Ranges", "bytes");

    const contentRange = fileResponse.headers.get("content-range");
    if (contentRange) headers.set("Content-Range", contentRange);

    const length = fileResponse.headers.get("content-length");
    if (length) headers.set("Content-Length", length);

    // Telegram file bytes for a given file_id never change, so this is
    // safe to cache hard on the client/CDN instead of the old 5-minute TTL.
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    return new Response(fileResponse.body, {
      status: range ? 206 : 200,
      headers,
    });
  } catch (error) {
    console.error("Telegram video stream error:", error);
    return NextResponse.json(
      { error: "Unable to stream the Telegram video." },
      { status: 500 },
    );
  }
}