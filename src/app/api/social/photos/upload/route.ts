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
      formData.get("photo");

    const title =
      formData.get("title");

    const caption =
      formData.get("caption");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "A photo file is required.",
        },
        { status: 400 },
      );
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Only image files are allowed.",
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
      "photo",
      file,
      file.name,
    );

    const telegramResponse =
      await fetch(
        `https://api.telegram.org/bot${telegramToken}/sendPhoto`,
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
        "Telegram sendPhoto error:",
        telegramData,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            telegramData?.description ||
            "Telegram rejected the photo upload.",
        },
        { status: 502 },
      );
    }

    const message =
      telegramData.result;

    const photos =
      message?.photo;

    if (
      !Array.isArray(photos) ||
      photos.length === 0
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Telegram succeeded but returned no photo.",
        },
        { status: 502 },
      );
    }

    const telegramPhoto =
      photos[photos.length - 1];

    if (!telegramPhoto?.file_id) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Telegram photo file_id is missing.",
        },
        { status: 502 },
      );
    }

    // ------------------------------------------
    // Supabase database
    // ------------------------------------------

    const { data, error } =
      await supabase
        .from("social_photos")
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
            telegramPhoto.file_id,

          telegram_message_id:
            message.message_id ?? null,

          telegram_chat_id:
            telegramChatId,

          mime_type:
            file.type || "image/jpeg",

          original_filename:
            file.name,

          file_size:
            file.size,

          width:
            telegramPhoto.width ?? null,

          height:
            telegramPhoto.height ?? null,
        })
        .select("*")
        .single();

    if (error) {
      console.error(
        "social_photos insert failed:",
        error,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Photo uploaded to Telegram, but database save failed.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,

      message:
        "Photo uploaded successfully.",

      storage: {
        provider: "telegram",
        media_type: "photo",

        telegram_chat_id:
          telegramChatId,

        telegram_file_id:
          telegramPhoto.file_id,

        telegram_message_id:
          message.message_id ?? null,

        mime_type:
          file.type || "image/jpeg",

        original_filename:
          file.name,

        file_size:
          file.size,

        width:
          telegramPhoto.width ?? null,

        height:
          telegramPhoto.height ?? null,
      },

      database: data,
    });
  } catch (error) {
    console.error(
      "Photo upload error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Photo upload failed.",
      },
      { status: 500 },
    );
  }
}