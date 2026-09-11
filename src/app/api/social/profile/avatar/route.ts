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

    // Use the logged-in user's JWT so Supabase RLS can
    // evaluate auth.uid() and only allow updating their own row.
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

    const {
      data: { user },
      error: userError,
    } = await userSupabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        {
          error: "Invalid session.",
        },
        { status: 401 },
      );
    }

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

    const { data, error } = await userSupabase
      .from("profiles")
      .update({
        avatar_telegram_chat_id:
          storage.telegram_chat_id ??
          process.env.TELEGRAM_STORAGE_CHAT_ID ??
          null,

        avatar_telegram_file_id: storage.telegram_file_id,

        avatar_mime_type: storage.mime_type ?? null,
      })
      .eq("id", user.id)
      .select("*")
      .single();

    if (error) {
      console.error("Avatar metadata update error:", error);

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
      profile: data,
    });
  } catch (error) {
    console.error("Avatar metadata error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Avatar update failed.",
      },
      { status: 500 },
    );
  }
}