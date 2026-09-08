import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export async function POST(request: Request) {
  try {
    // Check Supabase environment variables
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      console.error("Missing Supabase environment variables.");

      return NextResponse.json(
        {
          error:
            "Supabase environment variables are missing. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
        },
        { status: 500 },
      );
    }

    // Get user's Supabase access token
    const authorization = request.headers.get("authorization") || "";

    if (!authorization.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    }

    const token = authorization.slice(7).trim();

    if (!token) {
      return NextResponse.json(
        { error: "Authentication token is missing." },
        { status: 401 },
      );
    }

    /*
     * Create a Supabase client with the logged-in user's JWT.
     *
     * This is required because social_videos RLS uses:
     *
     * auth.uid() = user_id
     */
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

    // Verify the logged-in user
    const {
      data: { user },
      error: userError,
    } = await userSupabase.auth.getUser();

    if (userError || !user) {
      console.error("Supabase authentication error:", userError);

      return NextResponse.json(
        { error: "Invalid or expired session. Please login again." },
        { status: 401 },
      );
    }

    // Read request body
    const body = await request.json();
    const storage = body?.storage;

    if (!storage || typeof storage !== "object") {
      return NextResponse.json(
        { error: "Telegram storage data is required." },
        { status: 400 },
      );
    }

    // Telegram file ID is required
    if (
      !storage.telegram_file_id ||
      typeof storage.telegram_file_id !== "string"
    ) {
      return NextResponse.json(
        { error: "Telegram file ID is missing." },
        { status: 400 },
      );
    }

    // Clean title
    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : null;

    // Clean caption
    const caption =
      typeof body.caption === "string" && body.caption.trim()
        ? body.caption.trim()
        : null;

    /*
     * IMPORTANT:
     * user_id comes directly from the verified Supabase session.
     * Do NOT trust a user_id sent from the browser.
     */
    const insertData = {
      user_id: user.id,

      title,
      caption,

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

    console.log("Saving social video metadata:", {
      user_id: user.id,
      telegram_file_id: storage.telegram_file_id,
      original_filename: storage.original_filename,
    });

    // Insert into Supabase
    const { data, error } = await userSupabase
      .from("social_videos")
      .insert(insertData)
      .select("*")
      .single();

    if (error) {
      console.error("Social video metadata insert error:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });

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
      message: "Video metadata saved successfully.",
      video: data,
    });
  } catch (error) {
    console.error("Social metadata route error:", error);

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