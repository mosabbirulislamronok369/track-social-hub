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

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Only POST is allowed
    if (request.method !== "POST") {
      return json(
        {
          success: false,
          error: "Method not allowed.",
        },
        405,
      );
    }

    // Check environment variables first
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

    // Check upload authorization
    const authorization =
      request.headers.get("authorization") || "";

    const expectedAuthorization =
      `Bearer ${env.UPLOAD_SECRET}`;

    if (authorization !== expectedAuthorization) {
      return json(
        {
          success: false,
          error: "Unauthorized upload request.",
        },
        401,
      );
    }

    try {
      // Read incoming multipart form
      const incoming = await request.formData();

      const file = incoming.get("video");
      const caption = incoming.get("caption");
      const title = incoming.get("title");

      // Validate file
      if (!(file instanceof File)) {
        return json(
          {
            success: false,
            error: "A video file is required.",
          },
          400,
        );
      }

      if (!file.type.startsWith("video/")) {
        return json(
          {
            success: false,
            error: "Only video files are allowed.",
          },
          400,
        );
      }

      // Build Telegram request
      const telegramForm = new FormData();

      telegramForm.append(
        "chat_id",
        env.TELEGRAM_CHANNEL_ID,
      );

      let finalCaption = file.name;

      if (
        typeof caption === "string" &&
        caption.trim()
      ) {
        finalCaption = caption.trim();
      } else if (
        typeof title === "string" &&
        title.trim()
      ) {
        finalCaption = title.trim();
      }

      telegramForm.append(
        "caption",
        finalCaption,
      );

      telegramForm.append(
        "supports_streaming",
        "true",
      );

      telegramForm.append(
        "video",
        file,
        file.name,
      );

      // Upload to Telegram
      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendVideo`,
        {
          method: "POST",
          body: telegramForm,
        },
      );

      const telegramData: any =
        await telegramResponse.json();

      // Telegram upload failed
      if (
        !telegramResponse.ok ||
        !telegramData?.ok
      ) {
        return json(
          {
            success: false,
            error:
              telegramData?.description ||
              "Telegram upload failed.",
          },
          502,
        );
      }

      // Extract Telegram message/video
      const message =
        telegramData?.result;

      const video =
        message?.video;

      if (!video?.file_id) {
        return json(
          {
            success: false,
            error:
              "Telegram succeeded but returned no video file_id.",
          },
          502,
        );
      }

      // Successful response
      return json({
        success: true,
        message:
          "Video uploaded to Telegram successfully.",
        storage: {
          provider: "telegram",

          telegram_file_id:
            video.file_id,

          telegram_message_id:
            message.message_id ?? null,

          mime_type:
            file.type,

          original_filename:
            file.name,

          file_size:
            file.size,

          duration_seconds:
            video.duration ?? null,

          width:
            video.width ?? null,

          height:
            video.height ?? null,
        },
      });
    } catch (error) {
      console.error(
        "Telegram Worker upload error:",
        error,
      );

      const message =
        error instanceof Error
          ? error.message
          : "Telegram upload failed.";

      return json(
        {
          success: false,
          error: message,
        },
        500,
      );
    }
  },
};