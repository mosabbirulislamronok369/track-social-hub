import { NextResponse } from "next/server";
import { uploadVideoToTelegram } from "../../../lib/telegramStorage";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const file = formData.get("video");
    const caption = formData.get("caption");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "A video file is required." },
        { status: 400 },
      );
    }

    if (!file.type.startsWith("video/")) {
      return NextResponse.json(
        { error: "Only video files are allowed." },
        { status: 400 },
      );
    }

    const result = await uploadVideoToTelegram(
      file,
      typeof caption === "string" ? caption : undefined,
    );

    return NextResponse.json({
      success: true,
      message: "Video uploaded to Telegram successfully.",
      storage: result,
    });
  } catch (error) {
    console.error("Telegram storage test error:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Telegram storage upload failed.";

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
