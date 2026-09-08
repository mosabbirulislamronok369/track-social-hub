import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_CHANNEL_ID ||
  process.env.YOUR_CHANNEL_ID;

export async function POST(request: Request) {
  try {
    // --------------------------------------------------
    // Environment check
    // --------------------------------------------------

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      return NextResponse.json(
        {
          error:
            "Supabase environment variables are missing.",
        },
        { status: 500 },
      );
    }

    if (!TELEGRAM_CHAT_ID) {
      return NextResponse.json(
        {
          error:
            "Telegram channel ID is missing. Configure TELEGRAM_CHANNEL_ID or YOUR_CHANNEL_ID in Vercel.",
        },
        { status: 500 },
      );
    }

    // --------------------------------------------------
    // Authentication
    // --------------------------------------------------

    const authorization =
      request.headers.get("authorization") || "";

    if (!authorization.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          error: "Authentication required.",
        },
        { status: 401 },
      );
    }

    const token = authorization.slice(7).trim();

    if (!token) {
      return NextResponse.json(
        {
          error: "Authentication token is missing.",
        },
        { status: 401 },
      );
    }

    // --------------------------------------------------
    // Supabase client using user's JWT
    // --------------------------------------------------

    const userSupabase = createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    );

    // --------------------------------------------------
    // Verify user
    // --------------------------------------------------

    const {
      data: { user },
      error: userError,
    } = await userSupabase.auth.getUser();

    if (userError || !user) {
      console.error(
        "Supabase authentication error:",
        userError,
      );

      return NextResponse.json(
        {
          error:
            "Invalid or expired session. Please login again.",
        },
        { status: 401 },
      );
    }

    // --------------------------------------------------
    // Request body
    // --------------------------------------------------

    const body = await request.json();
    const storage = body?.storage;

    if (!storage || typeof storage !== "object") {
      return NextResponse.json(
        {
          error: "Telegram storage data is required.",
        },
        { status: 400 },
      );
    }

    // --------------------------------------------------
    // Telegram file ID
    // --------------------------------------------------

    if (
      !storage.telegram_file_id ||
      typeof storage.telegram_file_id !== "string"
    ) {
      return NextResponse.json(
        {
          error: "Telegram file ID is missing.",
        },
        { status: 400 },
      );
    }

    // --------------------------------------------------
    // Title
    // --------------------------------------------------

    const title =
      typeof body.title === "string" &&
      body.title.trim()
        ? body.title.trim()
        : null;

    // --------------------------------------------------
    // Caption
    // --------------------------------------------------

    const caption =
      typeof body.caption === "string" &&
      body.caption.trim()
        ? body.caption.trim()
        : null;

    // --------------------------------------------------
    // Build database row
    // --------------------------------------------------

    const insertData = {
      user_id: user.id,

      title,
      caption,

      // Telegram storage information
      telegram_chat_id: TELEGRAM_CHAT_ID,

      telegram_file_id: storage.telegram_file_id,

      telegram_message_id:
        typeof storage.telegram_message_id === "number"
          ? storage.telegram_message_id
          : null,

      mime_type:
        typeof storage.mime_type === "string"
          ? storage.mime_type
          : null,

      original_filename:
        typeof storage.original_filename === "string"
          ? storage.original_filename
          : null,

      file_size:
        typeof storage.file_size === "number"
          ? storage.file_size
          : null,

      width:
        typeof storage.width === "number"
          ? storage.width
          : null,

      height:
        typeof storage.height === "number"
          ? storage.height
          : null,

      duration_seconds:
        typeof storage.duration_seconds === "number"
          ? storage.duration_seconds
          : null,
    };

    console.log(
      "Saving social video metadata:",
      {
        user_id: user.id,
        telegram_chat_id: TELEGRAM_CHAT_ID,
        telegram_file_id:
          storage.telegram_file_id,
        original_filename:
          storage.original_filename,
      },
    );

    // --------------------------------------------------
    // Insert into social_videos
    // --------------------------------------------------

    const { data, error } = await userSupabase
      .from("social_videos")
      .insert(insertData)
      .select("*")
      .single();

    if (error) {
      console.error(
        "Social video metadata insert error:",
        {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        },
      );

      return NextResponse.json(
        {
          error: error.message,
          code: error.code ?? null,
          details: error.details ?? null,
          hint: error.hint ?? null,
        },
        { status: 500 },
      );
    }

    // --------------------------------------------------
    // Success
    // --------------------------------------------------

    return NextResponse.json({
      success: true,
      message:
        "Video metadata saved successfully.",
      video: data,
    });
  } catch (error) {
    console.error(
      "Social metadata route error:",
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