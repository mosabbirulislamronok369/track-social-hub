var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// index.ts
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders
    }
  });
}
__name(json, "json");
var index_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }
    const auth = request.headers.get("authorization") || "";
    if (auth !== `Bearer ${env.UPLOAD_SECRET}`) {
      return json({ error: "Unauthorized upload request." }, 401);
    }
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHANNEL_ID || !env.UPLOAD_SECRET) {
      return json({ error: "Worker environment is incomplete." }, 500);
    }
    const incoming = await request.formData();
    const file = incoming.get("video");
    const caption = incoming.get("caption");
    const title = incoming.get("title");
    if (!(file instanceof File)) {
      return json({ error: "A video file is required." }, 400);
    }
    if (!file.type.startsWith("video/")) {
      return json({ error: "Only video files are allowed." }, 400);
    }
    const telegram = new FormData();
    telegram.append("chat_id", env.TELEGRAM_CHANNEL_ID);
    telegram.append(
      "caption",
      typeof caption === "string" && caption.trim() ? caption.trim() : typeof title === "string" && title.trim() ? title.trim() : file.name
    );
    telegram.append("supports_streaming", "true");
    telegram.append("video", file, file.name);
    const response = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendVideo`,
      {
        method: "POST",
        body: telegram
      }
    );
    const data = await response.json();
    if (!response.ok || !data?.ok) {
      return json(
        { error: data?.description || "Telegram upload failed." },
        502
      );
    }
    const message = data.result;
    const video = message?.video;
    if (!video?.file_id) {
      return json(
        { error: "Telegram succeeded but returned no video file_id." },
        502
      );
    }
    return json({
      success: true,
      storage: {
        provider: "telegram",
        telegram_file_id: video.file_id,
        telegram_message_id: message.message_id ?? null,
        mime_type: file.type,
        original_filename: file.name,
        file_size: file.size,
        duration_seconds: video.duration ?? null,
        width: video.width ?? null,
        height: video.height ?? null
      }
    });
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
