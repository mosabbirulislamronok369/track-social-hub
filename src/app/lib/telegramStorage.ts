const TELEGRAM_API_BASE = "https://api.telegram.org";

function getConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_STORAGE_CHAT_ID;

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing in .env.local");
  }

  if (!chatId) {
    throw new Error("TELEGRAM_STORAGE_CHAT_ID is missing in .env.local");
  }

  return { token, chatId };
}

export type TelegramUploadResult = {
  telegramFileId: string;
  telegramMessageId: number;
  chatId: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  fileSize: number | null;
};

/**
 * Uploads a video to the private Telegram storage channel.
 * This function must only run on the server.
 */
export async function uploadVideoToTelegram(
  file: File,
  caption?: string,
): Promise<TelegramUploadResult> {
  const { token, chatId } = getConfig();

  if (!file.type.startsWith("video/")) {
    throw new Error("Only video files are allowed.");
  }

  // Conservative limit for Telegram Bot API cloud uploads.
  const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error("Video is too large. Maximum allowed size is 50 MB.");
  }

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("video", file, file.name);

  if (caption?.trim()) {
    form.append("caption", caption.trim().slice(0, 1024));
  }

  form.append("supports_streaming", "true");

  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${token}/sendVideo`,
    {
      method: "POST",
      body: form,
      cache: "no-store",
    },
  );

  const data = (await response.json()) as {
    ok?: boolean;
    description?: string;
    result?: {
      message_id?: number;
      video?: {
        file_id?: string;
        width?: number;
        height?: number;
        duration?: number;
        file_size?: number;
      };
    };
  };

  if (!response.ok || !data.ok || !data.result?.video?.file_id) {
    console.error("Telegram upload error:", data);

    throw new Error(
      data.description || "Telegram video upload failed.",
    );
  }

  const video = data.result.video;

  return {
    telegramFileId: video.file_id!,
    telegramMessageId: data.result.message_id!,
    chatId,
    width: video.width ?? null,
    height: video.height ?? null,
    duration: video.duration ?? null,
    fileSize: video.file_size ?? null,
  };
}
