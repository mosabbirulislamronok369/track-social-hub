import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Supabase Admin Client (Service Role Key ব্যবহার করে RLS বাইপাস নিশ্চিত করতে)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    // 1. Authorization Header থেকে User Auth Token বের করা
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, error: "Unauthorized access" },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    // 2. Request Body থেকে তথ্য গ্রহণ
    const body = await req.json();
    const { title, text_content, media_type, storage } = body;

    let telegramMessageId: number | null = null;
    let targetChatId = storage?.telegram_chat_id || TELEGRAM_CHAT_ID;

    // 3. যদি টেক্সট পোস্ট থাকে, তবে টেলিগ্রামে Message পাঠানো
    if (text_content && TELEGRAM_BOT_TOKEN && targetChatId) {
      const messageText = title
        ? `📌 *${title}*\n\n${text_content}`
        : text_content;

      try {
        const tgRes = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: targetChatId,
              text: messageText,
              parse_mode: "Markdown",
            }),
          }
        );

        const tgData = await tgRes.json();
        if (tgData.ok) {
          telegramMessageId = tgData.result.message_id;
        }
      } catch (tgError) {
        console.error("Telegram SendMessage Error:", tgError);
      }
    }

    // 4. Supabase - এ শুধুমাত্র Metadata সেভ করা (কোনো মূল ফাইল সুপাবেসে যাবে না)
    const { data, error: insertError } = await supabaseAdmin
      .from("social_texts")
      .insert({
        user_id: user.id,
        title: title || null,
        text_content: text_content || null,
        media_type: media_type || null,
        telegram_chat_id: targetChatId || null,
        telegram_file_id: storage?.telegram_file_id || null, // 👈 Telegram File ID
        telegram_message_id: storage?.telegram_message_id || telegramMessageId,
        mime_type: storage?.mime_type || null,
        original_filename: storage?.original_filename || null,
        file_size: storage?.file_size || null,
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    return NextResponse.json({
      success: true,
      message: "Post metadata saved successfully",
      data,
    });
  } catch (err: any) {
    console.error("API Route Error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}