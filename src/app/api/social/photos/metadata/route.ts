import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function POST(request: Request) {
  try {
    if (
      !SUPABASE_URL ||
      !SUPABASE_PUBLISHABLE_KEY
    ) {
      return NextResponse.json(
        {
          error:
            "Supabase environment variables are missing.",
        },
        { status: 500 },
      );
    }

    const authorization =
      request.headers.get("authorization") || "";

    if (!authorization.startsWith("Bearer ")) {
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

    if (!token) {
      return NextResponse.json(
        {
          error:
            "Authentication token is missing.",
        },
        { status: 401 },
      );
    }

    const supabase = createClient(
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

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        {
          error:
            "Invalid or expired session.",
        },
        { status: 401 },
      );
    }

    const body = await request.json();

    const storage = body?.storage;

    if (!storage?.telegram_file_id) {
      return NextResponse.json(
        {
          error:
            "Telegram photo storage data is required.",
        },
        { status: 400 },
      );
    }

    const telegramChatId =
      typeof storage.telegram_chat_id ===
      "string"
        ? storage.telegram_chat_id
        : process.env.TELEGRAM_STORAGE_CHAT_ID;

    if (!telegramChatId) {
      return NextResponse.json(
        {
          error:
            "Telegram storage chat ID is missing.",
        },
        { status: 500 },
      );
    }

    const title =
      typeof body.title === "string" &&
      body.title.trim()
        ? body.title.trim()
        : null;

    const caption =
      typeof body.caption === "string" &&
      body.caption.trim()
        ? body.caption.trim()
        : null;

    const insertData = {
      user_id: user.id,

      title,
      caption,

      telegram_chat_id:
        telegramChatId,

      telegram_file_id:
        storage.telegram_file_id,

      telegram_message_id:
        typeof storage.telegram_message_id ===
        "number"
          ? storage.telegram_message_id
          : null,

      mime_type:
        typeof storage.mime_type === "string"
          ? storage.mime_type
          : null,

      original_filename:
        typeof storage.original_filename ===
        "string"
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
    };

    const { data, error } =
      await supabase
        .from("social_photos")
        .insert(insertData)
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
          code: error.code ?? null,
          details: error.details ?? null,
          hint: error.hint ?? null,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message:
        "Photo metadata saved successfully.",
      photo: data,
    });
  } catch (error) {
    console.error(
      "Social photo metadata error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Photo metadata save failed.",
      },
      { status: 500 },
    );
  }
}