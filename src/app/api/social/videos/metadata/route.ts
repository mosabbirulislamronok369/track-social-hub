import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function POST(request: Request) {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return NextResponse.json(
        {
          error: "Supabase environment variables are missing.",
        },
        { status: 500 },
      );
    }

    // ---------------------------------------------
    // Get user's Supabase access token
    // ---------------------------------------------

    const authorization =
      request.headers.get("authorization") || "";

    const token = authorization.startsWith("Bearer ")
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

    // ---------------------------------------------
    // Create Supabase client WITH user's JWT
    // This is important for RLS.
    // ---------------------------------------------

    const userSupabase = createClient(
      SUPABASE_URL,
      SUPABASE_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    );

    // ---------------------------------------------
    // Verify user
    // ---------------------------------------------

    const {
      data: { user },
      error: userError,
    } = await userSupabase.auth.getUser(token);

    if (userError || !user) {
      console.error("Supabase auth error:", userError);

      return NextResponse.json(
        {
          error: "Invalid session.",
        },
        { status: 401 },
      );
    }

    // ---------------------------------------------
    // Read request body
    // ---------------------------------------------

    const body = await request.json();

    const storage = body?.storage;

    if (!storage?.telegram_file_id) {
      return NextResponse.json(
        {
          error: "Telegram storage data is required.",
        },
        { status: 400 },
      );
    }

    // ---------------------------------------------
    // Insert metadata
    // RLS now sees auth.uid() correctly.
    // ---------------------------------------------

    const { data, error } = await userSupabase
      .from("social_videos")
      .insert({
        user_id: user.id,

        title:
          typeof body.title === "string"
            ? body.title
            : null,

        caption:
          typeof body.caption === "string"
            ? body.caption
            : null,

        telegram_chat_id:
          storage.telegram_chat_id ??
          process.env.TELEGRAM_STORAGE_CHAT_ID ??
          null,

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
          details: error.details ?? null,
          hint: error.hint ?? null,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      video: data,
    });
  } catch (error) {
    console.error(
      "Social video metadata error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Video metadata save failed.",
      },
      { status: 500 },
    );
  }
}