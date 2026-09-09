import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_STORAGE_CHAT_ID ||
  process.env.TELEGRAM_CHANNEL_ID ||
  process.env.YOUR_CHANNEL_ID;

export async function POST(request: Request) {
  try {
    // --------------------------------------------------
    // Environment
    // --------------------------------------------------

    if (!TELEGRAM_CHAT_ID) {
      return NextResponse.json(
        {
          error:
            "TELEGRAM_STORAGE_CHAT_ID environment variable is missing.",
        },
        { status: 500 },
      );
    }

    // --------------------------------------------------
    // Authentication
    // --------------------------------------------------

    const authorization =
      request.headers.get("authorization");

    const token =
      authorization?.startsWith("Bearer ")
        ? authorization.slice(7)
        : null;

    if (!token) {
      return NextResponse.json(
        {
          error: "Authentication required.",
        },
        { status: 401 },
      );
    }

    const {
      data: userData,
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !userData.user) {
      return NextResponse.json(
        {
          error: "Invalid session.",
        },
        { status: 401 },
      );
    }

    // --------------------------------------------------
    // Request body
    // --------------------------------------------------

    const body = await request.json();

    const storage = body?.storage;

    if (!storage?.telegram_file_id) {
      return NextResponse.json(
        {
          error:
            "Telegram storage data is required.",
        },
        { status: 400 },
      );
    }

    // --------------------------------------------------
    // Determine media type
    // --------------------------------------------------

    const mediaType =
      storage?.media_type === "photo"
        ? "photo"
        : "video";

    const userId = userData.user.id;

    const title =
      typeof body.title === "string"
        ? body.title.trim() || null
        : null;

    const caption =
      typeof body.caption === "string"
        ? body.caption.trim() || null
        : null;

    // --------------------------------------------------
    // Common metadata
    // --------------------------------------------------

    const metadata = {
      user_id: userId,

      title,

      caption,

      telegram_chat_id:
        TELEGRAM_CHAT_ID,

      telegram_file_id:
        storage.telegram_file_id,

      telegram_message_id:
        storage.telegram_message_id ?? null,

      mime_type:
        storage.mime_type ?? null,

      original_filename:
        storage.original_filename ?? null,

      file_size:
        storage.file_size ?? null,

      width:
        storage.width ?? null,

      height:
        storage.height ?? null,
    };

    // --------------------------------------------------
    // PHOTO
    // --------------------------------------------------

    if (mediaType === "photo") {
      const {
        data,
        error,
      } = await supabase
        .from("social_photos")
        .insert(metadata)
        .select("*")
        .single();

      if (error) {
        console.error(
          "Social photo metadata insert error:",
          error,
        );

        return NextResponse.json(
          {
            error: error.message,
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,

        media_type: "photo",

        message:
          "Photo metadata saved successfully.",

        photo: data,
      });
    }

    // --------------------------------------------------
    // VIDEO
    // --------------------------------------------------

    const {
      data,
      error,
    } = await supabase
      .from("social_videos")
      .insert({
        ...metadata,

        duration_seconds:
          storage.duration_seconds ?? null,
      })
      .select("*")
      .single();

    if (error) {
      console.error(
        "Social video metadata insert error:",
        error,
      );

      return NextResponse.json(
        {
          error: error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,

      media_type: "video",

      message:
        "Video metadata saved successfully.",

      video: data,
    });
  } catch (error) {
    console.error(
      "Social metadata error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Metadata save failed.",
      },
      { status: 500 },
    );
  }
}