import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const supabaseKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    const telegramToken =
      process.env.TELEGRAM_BOT_TOKEN;

    const telegramChatId =
      process.env.TELEGRAM_STORAGE_CHAT_ID;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Supabase environment variables are missing.",
        },
        { status: 500 },
      );
    }

    if (!telegramToken || !telegramChatId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Telegram storage environment variables are missing.",
        },
        { status: 500 },
      );
    }

    const authorization =
      request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Please login before uploading.",
        },
        { status: 401 },
      );
    }

    const accessToken =
      authorization.slice(7).trim();

    if (!accessToken) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Login access token is missing.",
        },
        { status: 401 },
      );
    }

    const supabase = createClient(
      supabaseUrl,
      supabaseKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        global: {
          headers: {
            Authorization:
              `Bearer ${accessToken}`,
          },
        },
      },
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid or expired login session.",
        },
        { status: 401 },
      );
    }

    const formData =
      await request.formData();

    const file =
      formData.get("video");

    const title =
      formData.get("title");

    const caption =
      formData.get("caption");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "A video file is required.",
        },
        { status: 400 },
      );
    }

    if (!file.type.startsWith("video/")) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Only video files are allowed.",
        },
        { status: 400 },
      );
    }

    // ------------------------------------------
    // Caption
    // ------------------------------------------

    const finalCaption =
      typeof caption === "string" &&
      caption.trim()
        ? caption.trim()
        : typeof title === "string" &&
          title.trim()
          ? title.trim()
          : file.name;

    // ------------------------------------------
    // Telegram upload
    // ------------------------------------------

    const telegramForm =
      new FormData();

    telegramForm.append(
      "chat_id",
      telegramChatId,
    );

    telegramForm.append(
      "caption",
      finalCaption,
    );

    telegramForm.append(
      "supports_streaming",
      "true",
    );

    telegramForm.append(
      "video",
      file,
      file.name,
    );

    const telegramResponse =
      await fetch(
        `https://api.telegram.org/bot${telegramToken}/sendVideo`,
        {
          method: "POST",
          body: telegramForm,
        },
      );

    const telegramData: any =
      await telegramResponse.json();

    if (
      !telegramResponse.ok ||
      !telegramData?.ok
    ) {
      console.error(
        "Telegram sendVideo error:",
        telegramData,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            telegramData?.description ||
            "Telegram rejected the video upload.",
        },
        { status: 502 },
      );
    }

    const message =
      telegramData.result;

    const telegramVideo =
      message?.video;

    if (!telegramVideo?.file_id) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Telegram video file_id is missing.",
        },
        { status: 502 },
      );
    }

    // ------------------------------------------
    // Supabase database
    // ------------------------------------------

    const { data, error } =
      await supabase
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

          telegram_file_id:
            telegramVideo.file_id,

          telegram_message_id:
            message.message_id ?? null,

          telegram_chat_id:
            telegramChatId,

          mime_type:
            file.type,

          original_filename:
            file.name,

          file_size:
            file.size,

          width:
            telegramVideo.width ?? null,

          height:
            telegramVideo.height ?? null,

          duration_seconds:
            telegramVideo.duration ?? null,
        })
        .select("*")
        .single();

    if (error) {
      console.error(
        "social_videos insert failed:",
        error,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Video uploaded to Telegram, but database save failed.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,

      message:
        "Video uploaded successfully.",

      storage: {
        provider: "telegram",
        media_type: "video",

        telegram_chat_id:
          telegramChatId,

        telegram_file_id:
          telegramVideo.file_id,

        telegram_message_id:
          message.message_id ?? null,

        mime_type:
          file.type,

        original_filename:
          file.name,

        file_size:
          file.size,

        width:
          telegramVideo.width ?? null,

        height:
          telegramVideo.height ?? null,

        duration_seconds:
          telegramVideo.duration ?? null,
      },

      database: data,
    });
  } catch (error) {
    console.error(
      "Video upload error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Video upload failed.",
      },
      { status: 500 },
    );
  }
}