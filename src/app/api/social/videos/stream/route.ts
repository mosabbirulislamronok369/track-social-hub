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

    const fileResponse = await fetch(
      `https://api.telegram.org/file/bot${token}/${telegramData.result.file_path}`,
      { cache: "no-store" },
    );

    if (!fileResponse.ok || !fileResponse.body) {
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

    const length = fileResponse.headers.get("content-length");
    if (length) headers.set("Content-Length", length);

    headers.set("Cache-Control", "private, max-age=300");

    return new Response(fileResponse.body, {
      status: 200,
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
