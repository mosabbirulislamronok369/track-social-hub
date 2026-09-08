import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TELEGRAM_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

export async function GET(
  request: Request,
) {
  try {
    if (!TELEGRAM_TOKEN) {
      return NextResponse.json(
        {
          error:
            "Telegram bot token is missing.",
        },
        { status: 500 },
      );
    }

    const url = new URL(request.url);

    const fileId =
      url.searchParams.get("fileId");

    if (!fileId) {
      return NextResponse.json(
        {
          error: "fileId is required.",
        },
        { status: 400 },
      );
    }

    const fileResponse =
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${encodeURIComponent(
          fileId,
        )}`,
        {
          cache: "no-store",
        },
      );

    const fileData =
      await fileResponse.json();

    if (
      !fileResponse.ok ||
      !fileData?.ok ||
      !fileData?.result?.file_path
    ) {
      return NextResponse.json(
        {
          error:
            fileData?.description ||
            "Telegram file lookup failed.",
        },
        { status: 502 },
      );
    }

    const telegramFileUrl =
      `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${fileData.result.file_path}`;

    const mediaResponse =
      await fetch(telegramFileUrl, {
        cache: "no-store",
      });

    if (!mediaResponse.ok) {
      return NextResponse.json(
        {
          error:
            "Unable to fetch photo from Telegram.",
        },
        { status: 502 },
      );
    }

    return new Response(
      mediaResponse.body,
      {
        status: 200,
        headers: {
          "Content-Type":
            mediaResponse.headers.get(
              "content-type",
            ) || "image/jpeg",

          "Cache-Control":
            "public, max-age=31536000, immutable",

          "Content-Length":
            mediaResponse.headers.get(
              "content-length",
            ) || "",
        },
      },
    );
  } catch (error) {
    console.error(
      "Telegram photo stream error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Photo stream failed.",
      },
      { status: 500 },
    );
  }
}