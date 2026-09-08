import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { uploadVideoToTelegram } from "../../../lib/telegramStorage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    // Supabase login session থেকে access token নেওয়া
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Please login before uploading." },
        { status: 401 },
      );
    }

    const accessToken = authorization.slice("Bearer ".length).trim();

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      },
    );

    // Logged-in user verify
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Invalid or expired login session." },
        { status: 401 },
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

    // 1️⃣ Telegram Storage
    const telegram = await uploadVideoToTelegram(
      file,
      typeof caption === "string" ? caption : undefined,
    );

    // 2️⃣ Supabase Metadata
    const { data: socialVideo, error: dbError } = await supabase
      .from("social_videos")
      .insert({
        user_id: user.id,

        title:
          typeof title === "string"
            ? title.trim().slice(0, 180) || null
            : null,

        caption:
          typeof caption === "string"
            ? caption.trim().slice(0, 1024) || null
            : null,

        telegram_file_id: telegram.telegramFileId,
        telegram_message_id: telegram.telegramMessageId,
        telegram_chat_id: telegram.chatId,

        mime_type: file.type,
        original_filename: file.name,
        file_size: telegram.fileSize ?? file.size,

        width: telegram.width ?? null,
        height: telegram.height ?? null,
        duration_seconds: telegram.duration ?? null,
      })
      .select("*")
      .single();

    if (dbError) {
      console.error("social_videos insert failed:", dbError);

      return NextResponse.json(
        {
          error: "Video uploaded to Telegram, but database save failed.",
          details: dbError.message,
          telegram: telegram,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Video uploaded to Telegram and saved to Supabase.",
      storage: telegram,
      database: socialVideo,
    });
  } catch (error) {
    console.error("Telegram storage test error:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Telegram storage upload failed.";

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}