export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHANNEL_ID: string;
  UPLOAD_SECRET: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
}

function getCaption(
  file: File,
  caption: FormDataEntryValue | null,
  title: FormDataEntryValue | null,
) {
  if (typeof caption === "string" && caption.trim()) {
    return caption.trim();
  }

  if (typeof title === "string" && title.trim()) {
    return title.trim();
  }

  return file.name;
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (request.method !== "POST") {
      return json(
        {
          success: false,
          error: "Method not allowed.",
        },
        405,
      );
    }

    if (
      !env.TELEGRAM_BOT_TOKEN ||
      !env.TELEGRAM_CHANNEL_ID ||
      !env.UPLOAD_SECRET
    ) {
      return json(
        {
          success: false,
          error: "Worker environment is incomplete.",
        },
        500,
      );
    }

    const authorization =
      request.headers.get("authorization") || "";

    if (
      authorization !==
      `Bearer ${env.UPLOAD_SECRET}`
    ) {
      return json(
        {
          success: false,
          error: "Unauthorized upload request.",
        },
        401,
      );
    }

    try {
      const incoming = await request.formData();

      const video = incoming.get("video");
      const photo = incoming.get("photo");

      const caption = incoming.get("caption");
      const title = incoming.get("title");

      if (
        video instanceof File &&
        photo instanceof File
      ) {
        return json(
          {
            success: false,
            error:
              "Please upload either a photo or a video.",
          },
          400,
        );
      }

      // ==================================================
      // PHOTO
      // ==================================================

      if (photo instanceof File) {
        if (!photo.type.startsWith("image/")) {
          return json(
            {
              success: false,
              error: "Only image files are allowed.",
            },
            400,
          );
        }

        const telegramForm = new FormData();

        telegramForm.append(
          "chat_id",
          env.TELEGRAM_CHANNEL_ID,
        );

        telegramForm.append(
          "caption",
          getCaption(photo, caption, title),
        );

        telegramForm.append(
          "photo",
          photo,
          photo.name,
        );

        const telegramResponse = await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`,
          {
            method: "POST",
            body: telegramForm,
          },
        );

        const telegramData: any =
          await telegramResponse.json();

        if (
          !telegramResponse.ok ||
          !telegramData?.ok
        ) {
          console.error(
            "Telegram photo error:",
            telegramData,
          );

          return json(
            {
              success: false,
              error:
                telegramData?.description ||
                "Telegram photo upload failed.",
            },
            502,
          );
        }

        const message =
          telegramData.result;

        const photos =
          message?.photo;

        if (
          !Array.isArray(photos) ||
          photos.length === 0
        ) {
          return json(
            {
              success: false,
              error:
                "Telegram returned no photo.",
            },
            502,
          );
        }

        const telegramPhoto =
          photos[photos.length - 1];

        if (!telegramPhoto?.file_id) {
          return json(
            {
              success: false,
              error:
                "Telegram returned invalid photo data.",
            },
            502,
          );
        }

        return json({
          success: true,
          message:
            "Photo uploaded to Telegram successfully.",

          storage: {
            provider: "telegram",
            media_type: "photo",

            telegram_chat_id:
              env.TELEGRAM_CHANNEL_ID,

            telegram_file_id:
              telegramPhoto.file_id,

            telegram_message_id:
              message.message_id ?? null,

            mime_type:
              photo.type,

            original_filename:
              photo.name,

            file_size:
              photo.size,

            width:
              telegramPhoto.width ?? null,

            height:
              telegramPhoto.height ?? null,

            duration_seconds: null,
          },
        });
      }

      // ==================================================
      // VIDEO
      // ==================================================

      if (video instanceof File) {
        if (!video.type.startsWith("video/")) {
          return json(
            {
              success: false,
              error: "Only video files are allowed.",
            },
            400,
          );
        }

        const telegramForm = new FormData();

        telegramForm.append(
          "chat_id",
          env.TELEGRAM_CHANNEL_ID,
        );

        telegramForm.append(
          "caption",
          getCaption(video, caption, title),
        );

        telegramForm.append(
          "supports_streaming",
          "true",
        );

        telegramForm.append(
          "video",
          video,
          video.name,
        );

        const telegramResponse = await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendVideo`,
          {
            method: "POST",
            body: telegramForm,
          },
        );

        const telegramData: any =
          await telegramResponse.json();

        if (
          !telegramResponse.ok ||
          !telegramData?.ok
        ) {
          console.error(
            "Telegram video error:",
            telegramData,
          );

          return json(
            {
              success: false,
              error:
                telegramData?.description ||
                "Telegram video upload failed.",
            },
            502,
          );
        }

        const message =
          telegramData.result;

        const telegramVideo =
          message?.video;

        if (!telegramVideo?.file_id) {
          return json(
            {
              success: false,
              error:
                "Telegram returned no video file_id.",
            },
            502,
          );
        }

        return json({
          success: true,
          message:
            "Video uploaded to Telegram successfully.",

          storage: {
            provider: "telegram",
            media_type: "video",

            telegram_chat_id:
              env.TELEGRAM_CHANNEL_ID,

            telegram_file_id:
              telegramVideo.file_id,

            telegram_message_id:
              message.message_id ?? null,

            mime_type:
              video.type,

            original_filename:
              video.name,

            file_size:
              video.size,

            duration_seconds:
              telegramVideo.duration ?? null,

            width:
              telegramVideo.width ?? null,

            height:
              telegramVideo.height ?? null,
          },
        });
      }

      return json(
        {
          success: false,
          error:
            "A photo or video file is required.",
        },
        400,
      );
    } catch (error) {
      console.error(
        "Telegram Worker upload error:",
        error,
      );

      return json(
        {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Telegram upload failed.",
        },
        500,
      );
    }
  },
};