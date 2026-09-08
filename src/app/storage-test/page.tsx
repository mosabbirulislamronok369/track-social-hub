"use client";

import { useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type UploadResult = {
  telegramFileId: string;
  telegramMessageId: number;
  chatId: string;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  fileSize?: number | null;
};

const MAX_BYTES = 4 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }

  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export default function StorageTestPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const [error, setError] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);

  function chooseFile() {
    inputRef.current?.click();
  }

  function handleFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const selected = event.target.files?.[0];

    setError("");
    setResult(null);
    setProgress(0);

    if (!selected) {
      setFile(null);
      return;
    }

    if (!selected.type.startsWith("video/")) {
      setFile(null);
      setError("Only video files are allowed.");
      return;
    }

    if (selected.size > MAX_BYTES) {
      setFile(null);
      setError(
        `Video is too large. Maximum allowed size is ${formatBytes(
          MAX_BYTES,
        )}.`,
      );
      return;
    }

    setFile(selected);
  }

  async function upload() {
    if (!file || uploading) return;

    setUploading(true);
    setProgress(0);
    setError("");
    setResult(null);

    try {
      /*
       * Get the currently logged-in Supabase session.
       * The access token is sent to the API so the server
       * can identify the user and insert the metadata row.
       */
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw new Error(sessionError.message);
      }

      if (!session?.access_token) {
        throw new Error("Please login first.");
      }

      const formData = new FormData();

      formData.append("video", file, file.name);

      if (caption.trim()) {
        formData.append("caption", caption.trim());
      }

      /*
       * XMLHttpRequest is used here so we can show
       * real upload progress.
       */
      const xhr = new XMLHttpRequest();

      xhr.open("POST", "/api/storage/test");

      xhr.setRequestHeader(
        "Authorization",
        `Bearer ${session.access_token}`,
      );

      xhr.responseType = "json";

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percentage = Math.round(
            (event.loaded / event.total) * 100,
          );

          setProgress(percentage);
        }
      };

      xhr.onload = () => {
        setUploading(false);

        const data = xhr.response;

        if (
          xhr.status >= 200 &&
          xhr.status < 300 &&
          data?.success
        ) {
          setProgress(100);
          setResult(data.storage ?? null);
          return;
        }

        setError(
          data?.error ||
            data?.details ||
            `Upload failed with HTTP ${
              xhr.status || "unknown"
            }.`,
        );
      };

      xhr.onerror = () => {
        setUploading(false);
        setError(
          "Network error. Please check the deployment and try again.",
        );
      };

      xhr.onabort = () => {
        setUploading(false);
        setError("Upload cancelled.");
      };

      xhr.send(formData);
    } catch (err) {
      setUploading(false);

      setError(
        err instanceof Error
          ? err.message
          : "Upload failed.",
      );
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, #21164a 0%, #09090d 45%, #050507 100%)",
        color: "#fff",
        padding: "48px 20px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 760,
          margin: "0 auto",
        }}
      >
        <div
          style={{
            marginBottom: 28,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              padding: "7px 12px",
              borderRadius: 999,
              background: "rgba(124, 58, 237, 0.15)",
              border: "1px solid rgba(139, 92, 246, 0.3)",
              color: "#c4b5fd",
              fontSize: 13,
              fontWeight: 700,
              marginBottom: 14,
            }}
          >
            TELEGRAM STORAGE TEST
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: "clamp(32px, 6vw, 54px)",
              lineHeight: 1.05,
              fontWeight: 800,
              letterSpacing: "-0.04em",
            }}
          >
            Telegram Video Storage
          </h1>

          <p
            style={{
              marginTop: 14,
              marginBottom: 0,
              color: "#a1a1aa",
              fontSize: 16,
              lineHeight: 1.6,
            }}
          >
            Upload a small video to test Telegram storage
            and Supabase metadata saving.
          </p>
        </div>

        <section
          style={{
            background: "rgba(24, 24, 29, 0.88)",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 24,
            padding: 24,
            boxShadow: "0 20px 70px rgba(0,0,0,0.35)",
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />

          <button
            type="button"
            onClick={chooseFile}
            disabled={uploading}
            style={{
              width: "100%",
              minHeight: 180,
              borderRadius: 20,
              border: "1px dashed rgba(167,139,250,0.55)",
              background:
                "linear-gradient(145deg, rgba(124,58,237,0.10), rgba(59,130,246,0.05))",
              color: "#fff",
              cursor: uploading ? "not-allowed" : "pointer",
              padding: 24,
            }}
          >
            <div
              style={{
                fontSize: 38,
                marginBottom: 12,
              }}
            >
              ↑
            </div>

            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
              }}
            >
              {file ? "Choose another video" : "Choose a video"}
            </div>

            <div
              style={{
                marginTop: 8,
                color: "#a1a1aa",
                fontSize: 14,
              }}
            >
              MP4/WebM/MOV • max 4 MB for this Vercel test
            </div>
          </button>

          {file && (
            <div
              style={{
                marginTop: 16,
                padding: 16,
                borderRadius: 16,
                background: "#202024",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  wordBreak: "break-word",
                }}
              >
                {file.name}
              </div>

              <div
                style={{
                  marginTop: 7,
                  color: "#a1a1aa",
                  fontSize: 14,
                }}
              >
                {formatBytes(file.size)} • {file.type}
              </div>
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <label
              style={{
                display: "block",
                marginBottom: 8,
                color: "#d4d4d8",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              Optional caption
            </label>

            <input
              value={caption}
              onChange={(event) =>
                setCaption(event.target.value)
              }
              disabled={uploading}
              placeholder="Write a caption..."
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "15px 16px",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "#111116",
                color: "#fff",
                outline: "none",
                fontSize: 15,
              }}
            />
          </div>

          {uploading && (
            <div style={{ marginTop: 20 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 8,
                  fontSize: 13,
                  color: "#a1a1aa",
                }}
              >
                <span>Uploading...</span>
                <span>{progress}%</span>
              </div>

              <div
                style={{
                  height: 8,
                  borderRadius: 999,
                  background: "#2a2a31",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${progress}%`,
                    background:
                      "linear-gradient(90deg, #7c3aed, #4f46e5)",
                    transition: "width 0.2s ease",
                  }}
                />
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={upload}
            disabled={!file || uploading}
            style={{
              width: "100%",
              marginTop: 20,
              padding: "16px 20px",
              border: 0,
              borderRadius: 15,
              background:
                !file || uploading
                  ? "#37323f"
                  : "linear-gradient(90deg, #7c3aed, #4f46e5)",
              color: "#fff",
              fontSize: 16,
              fontWeight: 800,
              cursor:
                !file || uploading
                  ? "not-allowed"
                  : "pointer",
              boxShadow:
                !file || uploading
                  ? "none"
                  : "0 10px 30px rgba(99,102,241,0.25)",
            }}
          >
            {uploading
              ? `Uploading ${progress}%`
              : "Upload to Telegram"}
          </button>

          {error && (
            <div
              style={{
                marginTop: 18,
                padding: 16,
                borderRadius: 15,
                background: "rgba(127,29,29,0.18)",
                border: "1px solid rgba(248,113,113,0.3)",
                color: "#fca5a5",
                lineHeight: 1.5,
                wordBreak: "break-word",
              }}
            >
              <strong>Upload failed</strong>
              <div style={{ marginTop: 5 }}>
                {error}
              </div>
            </div>
          )}

          {result && (
            <div
              style={{
                marginTop: 18,
                padding: 18,
                borderRadius: 16,
                background: "rgba(22,163,74,0.10)",
                border: "1px solid rgba(74,222,128,0.3)",
              }}
            >
              <div
                style={{
                  color: "#86efac",
                  fontSize: 16,
                  fontWeight: 800,
                  marginBottom: 14,
                }}
              >
                ✓ Uploaded successfully
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 9,
                  fontSize: 14,
                  color: "#d4d4d8",
                }}
              >
                <div>
                  Telegram message ID:{" "}
                  <strong>
                    {result.telegramMessageId}
                  </strong>
                </div>

                <div
                  style={{
                    wordBreak: "break-all",
                  }}
                >
                  File ID:{" "}
                  <strong>
                    {result.telegramFileId}
                  </strong>
                </div>

                {result.duration != null && (
                  <div>
                    Duration:{" "}
                    <strong>
                      {result.duration}s
                    </strong>
                  </div>
                )}

                {result.width != null &&
                  result.height != null && (
                    <div>
                      Dimensions:{" "}
                      <strong>
                        {result.width} × {result.height}
                      </strong>
                    </div>
                  )}

                {result.fileSize != null && (
                  <div>
                    Telegram file size:{" "}
                    <strong>
                      {formatBytes(result.fileSize)}
                    </strong>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <div
          style={{
            marginTop: 22,
            display: "grid",
            gap: 10,
            color: "#71717a",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <div>
            <strong style={{ color: "#a1a1aa" }}>
              Telegram:
            </strong>{" "}
            actual video storage
          </div>

          <div>
            <strong style={{ color: "#a1a1aa" }}>
              Supabase:
            </strong>{" "}
            video metadata only
          </div>

          <div>
            <strong style={{ color: "#a1a1aa" }}>
              Supabase Storage:
            </strong>{" "}
            not used
          </div>
        </div>
      </div>
    </main>
  );
}