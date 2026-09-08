import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.YOUR_CHANNEL_ID || process.env.TELEGRAM_CHANNEL_ID;

export async function POST(request: Request) {
  try {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
      return NextResponse.json(
        { error: "Telegram storage environment variables are missing." },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("video");
    const caption = formData.get("caption");
    const title = formData.get("title");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "A video file is required." },
        { status: 400 },
      );
    }

    if (!file.type.startsWith("video/")) {
      return NextResponse.json(
        { error: "Only video files are allowed." },
        { status: 400 },
      );
    }

    /*
     * The browser sends the file directly to this Node.js route, and this route
     * streams it to Telegram without putting the binary into Supabase Storage.
     *
     * This avoids any Supabase Storage usage. Vercel's request/body limits still
     * apply to this architecture; for truly large files, use a signed/direct
     * client-to-Telegram upload flow in a future phase.
     */

    const telegramForm = new FormData();
    telegramForm.append("chat_id", TELEGRAM_CHAT_ID);
    telegramForm.append(
      "caption",
      typeof caption === "string" && caption.trim()
        ? caption.trim()
        : typeof title === "string" && title.trim()
          ? title.trim()
          : file.name,
    );
    telegramForm.append("supports_streaming", "true");
    telegramForm.append("video", file, file.name);

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendVideo`,
      {
        method: "POST",
        body: telegramForm,
        cache: "no-store",
      },
    );

    const telegramData = await telegramResponse.json();

    if (!telegramResponse.ok || !telegramData?.ok) {
      console.error("Telegram sendVideo error:", telegramData);

      return NextResponse.json(
        {
          error:
            telegramData?.description ||
            "Telegram rejected the video upload.",
        },
        { status: 502 },
      );
    }

    const message = telegramData.result;
    const telegramFileId =
      message?.video?.file_id ||
      message?.document?.file_id ||
      null;

    if (!telegramFileId) {
      return NextResponse.json(
        { error: "Telegram upload succeeded but no file_id was returned." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Video uploaded to Telegram successfully.",
      storage: {
        provider: "telegram",
        telegram_file_id: telegramFileId,
        telegram_message_id: message.message_id ?? null,
        mime_type: file.type,
        original_filename: file.name,
        file_size: file.size,
        duration_seconds: message.video?.duration ?? null,
        width: message.video?.width ?? null,
        height: message.video?.height ?? null,
      },
    });
  } catch (error) {
    console.error("Telegram video upload error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Telegram storage upload failed.",
      },
      { status: 500 },
    );
  }
}
