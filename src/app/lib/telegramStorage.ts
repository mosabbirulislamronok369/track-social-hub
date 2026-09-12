const TELEGRAM_API_BASE = "https://api.telegram.org";

function getConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_STORAGE_CHAT_ID;

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing.");
  }

  if (!chatId) {
    throw new Error("TELEGRAM_STORAGE_CHAT_ID is missing.");
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
 * Upload a video to Telegram.
 *
 * IMPORTANT:
 * This function runs server-side only.
 */
export async function uploadVideoToTelegram(
  file: File,
  caption?: string,
): Promise<TelegramUploadResult> {
  const { token, chatId } = getConfig();

  if (!file.type.startsWith("video/")) {
    throw new Error("Only video files are allowed.");
  }

  // Cloudflare Free allows request bodies up to 100 MB,
  // but Telegram Bot API upload is currently 50 MB.
  const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error(
      "Video is too large. Maximum allowed size is 50 MB.",
    );
  }

  const form = new FormData();

  form.append("chat_id", chatId);
  form.append("video", file, file.name);
  form.append("supports_streaming", "true");

  if (caption?.trim()) {
    form.append(
      "caption",
      caption.trim().slice(0, 1024),
    );
  }

  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${token}/sendVideo`,
    {
      method: "POST",
      body: form,
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

  if (
    !response.ok ||
    !data.ok ||
    !data.result?.video?.file_id
  ) {
    console.error("Telegram upload error:", data);

    throw new Error(
      data.description ||
        "Telegram video upload failed.",
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

/**
 * Upload an image/photo to Telegram.
 */
export async function uploadPhotoToTelegram(
  file: File,
  caption?: string,
) {
  const { token, chatId } = getConfig();

  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files are allowed.");
  }

  const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error(
      "Photo is too large. Maximum allowed size is 10 MB.",
    );
  }

  const form = new FormData();

  form.append("chat_id", chatId);
  form.append("photo", file, file.name);

  if (caption?.trim()) {
    form.append(
      "caption",
      caption.trim().slice(0, 1024),
    );
  }

  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${token}/sendPhoto`,
    {
      method: "POST",
      body: form,
    },
  );

  const data = await response.json();

  if (!response.ok || !data?.ok) {
    console.error("Telegram photo upload error:", data);

    throw new Error(
      data?.description ||
        "Telegram photo upload failed.",
    );
  }

  const message = data.result;
  const photos = message?.photo;

  if (!Array.isArray(photos) || photos.length === 0) {
    throw new Error(
      "Telegram returned no photo information.",
    );
  }

  const photo = photos[photos.length - 1];

  if (!photo?.file_id) {
    throw new Error(
      "Telegram photo file_id is missing.",
    );
  }

  return {
    telegramFileId: photo.file_id,
    telegramMessageId: message.message_id ?? null,
    chatId,
    mimeType: file.type || "image/jpeg",
    originalFilename: file.name,
    fileSize: file.size,
    width: photo.width ?? null,
    height: photo.height ?? null,
  };
}