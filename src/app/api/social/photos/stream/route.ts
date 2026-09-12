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

    // 1. Ask Telegram for the real file path.
    const fileInfoResponse = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(
        fileId,
      )}`,
      {
        cache: "no-store",
      },
    );

    const fileInfo = await fileInfoResponse.json();

    if (
      !fileInfoResponse.ok ||
      !fileInfo?.ok ||
      !fileInfo?.result?.file_path
    ) {
      console.error(
        "Telegram getFile photo error:",
        fileInfo,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            fileInfo?.description ||
            "Telegram photo lookup failed.",
        },
        { status: 502 },
      );
    }

    // 2. Fetch the actual image from Telegram.
    const telegramFileUrl =
      `https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`;

    const mediaResponse = await fetch(
      telegramFileUrl,
      {
        cache: "no-store",
      },
    );

    if (!mediaResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to fetch photo from Telegram.",
        },
        { status: 502 },
      );
    }

    if (!mediaResponse.body) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Telegram returned an empty photo.",
        },
        { status: 502 },
      );
    }

    const headers = new Headers();

    headers.set(
      "Content-Type",
      mediaResponse.headers.get("content-type") ||
        "image/jpeg",
    );

    const contentLength =
      mediaResponse.headers.get("content-length");

    if (contentLength) {
      headers.set(
        "Content-Length",
        contentLength,
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

    return new Response(
      mediaResponse.body,
      {
        status: 200,
        headers,
      },
    );
  } catch (error) {
    console.error(
      "Telegram photo stream error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Photo stream failed.",
      },
      { status: 500 },
    );
  }
}