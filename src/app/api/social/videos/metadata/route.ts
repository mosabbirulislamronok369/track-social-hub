import { NextResponse } from "next/server";
import { supabase } from "../../../../lib/supabase";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await request.json();
    const storage = body?.storage;

    if (!storage?.telegram_file_id) {
      return NextResponse.json({ error: "Telegram storage data is required." }, { status: 400 });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);

    if (userError || !userData.user) {
      return NextResponse.json({ error: "Invalid session." }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("social_videos")
      .insert({
        user_id: userData.user.id,
        title: typeof body.title === "string" ? body.title : null,
        caption: typeof body.caption === "string" ? body.caption : null,
        telegram_file_id: storage.telegram_file_id,
        telegram_message_id: storage.telegram_message_id ?? null,
        mime_type: storage.mime_type ?? null,
        original_filename: storage.original_filename ?? null,
        file_size: storage.file_size ?? null,
        width: storage.width ?? null,
        height: storage.height ?? null,
        duration_seconds: storage.duration_seconds ?? null,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Social metadata insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, video: data });
  } catch (error) {
    console.error("Social metadata error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Metadata save failed." },
      { status: 500 },
    );
  }
}
