import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(
  request: Request,
) {
  try {
    const url =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const key =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key) {
      return NextResponse.json(
        {
          error:
            "Supabase environment variables are missing.",
        },
        { status: 500 },
      );
    }

    const authorization =
      request.headers.get("authorization");

    if (
      !authorization?.startsWith(
        "Bearer ",
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Authentication required.",
        },
        { status: 401 },
      );
    }

    const token =
      authorization.slice(7).trim();

    const supabase =
      createClient(
        url,
        key,
        {
          global: {
            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          },
        },
      );

    const {
      data: { user },
      error: authError,
    } =
      await supabase.auth.getUser(
        token,
      );

    if (authError || !user) {
      return NextResponse.json(
        {
          error:
            "Invalid session.",
        },
        { status: 401 },
      );
    }

    const body =
      await request.json();

    const storage =
      body?.storage;

    if (
      !storage?.telegram_file_id
    ) {
      return NextResponse.json(
        {
          error:
            "Telegram storage data is required.",
        },
        { status: 400 },
      );
    }

    const { data, error } =
      await supabase
        .from("social_videos")
        .insert({
          user_id: user.id,

          title:
            typeof body.title === "string"
              ? body.title.trim().slice(0, 180) || null
              : null,

          caption:
            typeof body.caption === "string"
              ? body.caption.trim().slice(0, 1024) || null
              : null,

          telegram_chat_id:
            storage.telegram_chat_id ??
            process.env
              .TELEGRAM_STORAGE_CHAT_ID ??
            null,

          telegram_file_id:
            storage.telegram_file_id,

          telegram_message_id:
            storage.telegram_message_id ??
            null,

          mime_type:
            storage.mime_type ??
            null,

          original_filename:
            storage.original_filename ??
            null,

          file_size:
            storage.file_size ??
            null,

          width:
            storage.width ??
            null,

          height:
            storage.height ??
            null,

          duration_seconds:
            storage.duration_seconds ??
            null,
        })
        .select("*")
        .single();

    if (error) {
      console.error(
        "Social video metadata error:",
        error,
      );

      return NextResponse.json(
        {
          error: error.message,
          details:
            error.details ?? null,
          hint:
            error.hint ?? null,
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