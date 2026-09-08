import { supabase } from "./supabase";

export type SocialVideo = {
  id: string;
  user_id: string;
  title: string | null;
  caption: string | null;
  telegram_file_id: string;
  telegram_message_id: number;
  telegram_chat_id: string;
  mime_type: string;
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
  telegramMessageId: number;
  telegramChatId: string;
  mimeType: string;
  originalFilename?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
}) {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Please login before uploading a Social video.");
  }

  const { data, error } = await supabase
    .from("social_videos")
    .insert({
      user_id: user.id,
      title: params.title?.trim() || null,
      caption: params.caption?.trim() || null,
      telegram_file_id: params.telegramFileId,
      telegram_message_id: params.telegramMessageId,
      telegram_chat_id: params.telegramChatId,
      mime_type: params.mimeType,
      original_filename: params.originalFilename || null,
      file_size: params.fileSize ?? null,
      width: params.width ?? null,
      height: params.height ?? null,
      duration_seconds: params.durationSeconds ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as SocialVideo;
}
