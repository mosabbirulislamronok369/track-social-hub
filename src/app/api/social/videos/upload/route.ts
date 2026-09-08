import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { uploadVideoToTelegram } from "../../../../lib/telegramStorage";
export const runtime = "nodejs";

function getServerSupabase(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) throw new Error("Supabase environment variables are missing.");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "You must be logged in to upload a Social video." },
        { status: 401 },
      );
    }

    const accessToken = authorization.slice("Bearer ".length).trim();
    const supabase = getServerSupabase(accessToken);

    const { data: { user }, error: userError } =
      await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Your login session is invalid or expired." },
        { status: 401 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("video");
    const title = formData.get("title");
    const caption = formData.get("caption");

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

    const telegram = await uploadVideoToTelegram(
      file,
      typeof caption === "string" ? caption : undefined,
    );

    const { data: socialVideo, error: insertError } = await supabase
      .from("social_videos")
      .insert({
        user_id: user.id,
        title: typeof title === "string" ? title.trim().slice(0, 180) || null : null,
        caption: typeof caption === "string" ? caption.trim().slice(0, 1024) || null : null,
        telegram_file_id: telegram.telegramFileId,
        telegram_message_id: telegram.telegramMessageId,
        telegram_chat_id: telegram.chatId,
        mime_type: file.type,
        original_filename: file.name,
        file_size: telegram.fileSize ?? file.size,
        width: telegram.width,
        height: telegram.height,
        duration_seconds: telegram.duration,
      })
      .select("*")
      .single();

    if (insertError) {
      console.error("Supabase social_videos insert error:", insertError);
      return NextResponse.json(
        {
          error: "Video reached Telegram, but saving its metadata failed.",
          details: insertError.message,
          telegram: {
            fileId: telegram.telegramFileId,
            messageId: telegram.telegramMessageId,
          },
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, video: socialVideo });
  } catch (error) {
    console.error("Social video upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Social video upload failed." },
      { status: 500 },
    );
  }
}
