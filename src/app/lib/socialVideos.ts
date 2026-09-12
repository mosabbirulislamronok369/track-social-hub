import { supabase } from "./supabase";

export type SocialVideo = {
  id: string;
  user_id: string;
  title: string | null;
  caption: string | null;

  telegram_file_id: string;
  telegram_message_id: number | null;
  telegram_chat_id: string | null;

  mime_type: string | null;
  original_filename: string | null;
  file_size: number | null;

  width: number | null;
  height: number | null;
  duration_seconds: number | null;

  created_at: string;
};

export async function createSocialVideo(params: {
  title?: string | null;
  caption?: string | null;

  telegramFileId: string;
  telegramMessageId?: number | null;
  telegramChatId?: string | null;

  mimeType?: string | null;
  originalFilename?: string | null;
  fileSize?: number | null;

  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
}) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error(
      "Please login before uploading a Social video.",
    );
  }

  const { data, error } = await supabase
    .from("social_videos")
    .insert({
      user_id: user.id,

      title:
        params.title?.trim().slice(0, 180) ||
        null,

      caption:
        params.caption?.trim().slice(0, 1024) ||
        null,

      telegram_file_id: params.telegramFileId,

      telegram_message_id:
        params.telegramMessageId ?? null,

      telegram_chat_id:
        params.telegramChatId ?? null,

      mime_type:
        params.mimeType ?? null,

      original_filename:
        params.originalFilename ?? null,

      file_size:
        params.fileSize ?? null,

      width:
        params.width ?? null,

      height:
        params.height ?? null,

      duration_seconds:
        params.durationSeconds ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as SocialVideo;
}