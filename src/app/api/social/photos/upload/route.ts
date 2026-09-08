import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_STORAGE_CHAT_ID;

export async function POST(request: Request) {
  try {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
      return NextResponse.json(
        {
          error:
            "Telegram storage environment variables are missing.",
        },
        { status: 500 },
      );
    }

    const formData = await request.formData();

    const file = formData.get("photo");
    const title = formData.get("title");
    const caption = formData.get("caption");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "A photo file is required." },
        { status: 400 },
      );
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Only image files are allowed." },
        { status: 400 },
      );
    }

    const telegramForm = new FormData();

    telegramForm.append(
      "chat_id",
      TELEGRAM_CHAT_ID,
    );

    const finalCaption =
      typeof caption === "string" &&
      caption.trim()
        ? caption.trim()
        : typeof title === "string" &&
          title.trim()
          ? title.trim()
          : file.name;

    telegramForm.append(
      "caption",
      finalCaption,
    );

    telegramForm.append(
      "photo",
      file,
      file.name,
    );

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`,
      {
        method: "POST",
        body: telegramForm,
        cache: "no-store",
      },
    );

    const telegramData =
      await telegramResponse.json();

    if (
      !telegramResponse.ok ||
      !telegramData?.ok
    ) {
      console.error(
        "Telegram sendPhoto error:",
        telegramData,
      );

      return NextResponse.json(
        {
          error:
            telegramData?.description ||
            "Telegram rejected the photo upload.",
        },
        { status: 502 },
      );
    }

    const message = telegramData.result;

    const photos = message?.photo;

    if (
      !Array.isArray(photos) ||
      photos.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "Telegram succeeded but returned no photo.",
        },
        { status: 502 },
      );
    }

    // Telegram returns multiple sizes.
    // The last one is normally the largest.
    const photo =
      photos[photos.length - 1];

    if (!photo?.file_id) {
      return NextResponse.json(
        {
          error:
            "Telegram photo file_id is missing.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,

      message:
        "Photo uploaded to Telegram successfully.",

      storage: {
        provider: "telegram",

        telegram_chat_id:
          TELEGRAM_CHAT_ID,

        telegram_file_id:
          photo.file_id,

        telegram_message_id:
          message.message_id ?? null,

        mime_type:
          file.type || "image/jpeg",

        original_filename:
          file.name,

        file_size:
          file.size,

        width:
          photo.width ?? null,

        height:
          photo.height ?? null,
      },
    });
  } catch (error) {
    console.error(
      "Telegram photo upload error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Photo upload failed.",
      },
      { status: 500 },
    );
  }
}