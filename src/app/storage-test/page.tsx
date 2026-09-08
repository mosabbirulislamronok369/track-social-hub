"use client";

import { useRef, useState } from "react";

type UploadResult = {
  telegramFileId?: string;
  telegramMessageId?: number;
  chatId?: string;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  fileSize?: number | null;
};

const MAX_BYTES = 4 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(seconds: number | null | undefined) {
  if (!seconds) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export default function StorageTestPage() {
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState("");

  function chooseFile(nextFile: File | null) {
    setError("");
    setResult(null);
    setProgress(0);

    if (!nextFile) {
      setFile(null);
      return;
    }

    if (!nextFile.type.startsWith("video/")) {
      setFile(null);
      setError("Please select a video file.");
      return;
    }

    if (nextFile.size > MAX_BYTES) {
      setFile(null);
      setError(
        `For this Vercel test, keep the video under ${formatBytes(MAX_BYTES)}.`,
      );
      return;
    }

    setFile(nextFile);
  }

  function upload() {
    if (!file || uploading) return;

    setUploading(true);
    setProgress(0);
    setError("");
    setResult(null);

    const formData = new FormData();
    formData.append("video", file, file.name);

    if (caption.trim()) {
      formData.append("caption", caption.trim());
    }

    const xhr = new XMLHttpRequest();

    xhr.open("POST", "/api/storage/test");
    xhr.responseType = "json";

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      setUploading(false);

      const data = xhr.response;

      if (xhr.status >= 200 && xhr.status < 300 && data?.success) {
        setProgress(100);
        setResult(data.storage ?? null);
        return;
      }

      setError(
        data?.error ||
          `Upload failed with HTTP ${xhr.status || "unknown"}.`,
      );
    };

    xhr.onerror = () => {
      setUploading(false);
      setError("Network error. Check the Vercel deployment and try again.");
    };

    xhr.onabort = () => {
      setUploading(false);
      setError("Upload cancelled.");
    };

    xhr.send(formData);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "48px 20px",
        background:
          "radial-gradient(circle at 15% 10%, rgba(99,102,241,.20), transparent 32%), radial-gradient(circle at 85% 80%, rgba(168,85,247,.16), transparent 32%), #07070b",
        color: "#f5f5f7",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 12px",
            border: "1px solid rgba(255,255,255,.10)",
            borderRadius: 999,
            background: "rgba(255,255,255,.045)",
            color: "#b7b7c4",
            fontSize: 13,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#4ade80",
              boxShadow: "0 0 12px rgba(74,222,128,.8)",
            }}
          />
          Telegram Storage • Phase 1
        </div>

        <h1
          style={{
            margin: "18px 0 10px",
            fontSize: "clamp(34px, 6vw, 58px)",
            lineHeight: 1.02,
            letterSpacing: "-.045em",
          }}
        >
          Storage Test
        </h1>

        <p
          style={{
            margin: 0,
            maxWidth: 620,
            color: "#a7a7b3",
            fontSize: 16,
            lineHeight: 1.7,
          }}
        >
          Upload a small test video. The server will forward it to your
          private Telegram storage channel without exposing your bot token to
          the browser.
        </p>

        <section
          style={{
            marginTop: 30,
            padding: 22,
            border: "1px solid rgba(255,255,255,.10)",
            borderRadius: 24,
            background: "rgba(255,255,255,.055)",
            backdropFilter: "blur(18px)",
            boxShadow: "0 24px 80px rgba(0,0,0,.32)",
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(event) =>
              chooseFile(event.target.files?.[0] ?? null)
            }
          />

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            style={{
              width: "100%",
              minHeight: 180,
              borderRadius: 20,
              border: "1px dashed rgba(255,255,255,.20)",
              background: "rgba(0,0,0,.18)",
              color: "#fff",
              cursor: uploading ? "not-allowed" : "pointer",
              opacity: uploading ? 0.65 : 1,
            }}
          >
            <div style={{ fontSize: 38, marginBottom: 10 }}>↑</div>
            <strong style={{ fontSize: 16 }}>
              {file ? "Choose another video" : "Choose a test video"}
            </strong>
            <div style={{ marginTop: 8, color: "#8f8f9b", fontSize: 13 }}>
              MP4/WebM/MOV • max 4 MB for Vercel test
            </div>
          </button>

          {file && (
            <div
              style={{
                marginTop: 16,
                padding: 15,
                borderRadius: 16,
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.07)",
              }}
            >
              <div style={{ fontWeight: 650, wordBreak: "break-word" }}>
                {file.name}
              </div>
              <div style={{ marginTop: 5, color: "#9999a5", fontSize: 13 }}>
                {formatBytes(file.size)} • {file.type || "video"}
              </div>
            </div>
          )}

          <label
            style={{
              display: "block",
              marginTop: 18,
              color: "#b7b7c2",
              fontSize: 13,
            }}
          >
            Optional caption
            <input
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              maxLength={1024}
              disabled={uploading}
              placeholder="Storage test video"
              style={{
                display: "block",
                width: "100%",
                boxSizing: "border-box",
                marginTop: 8,
                padding: "13px 14px",
                borderRadius: 13,
                border: "1px solid rgba(255,255,255,.10)",
                outline: "none",
                background: "rgba(0,0,0,.22)",
                color: "#fff",
                fontSize: 14,
              }}
            />
          </label>

          {uploading && (
            <div style={{ marginTop: 20 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: "#bdbdc8",
                  fontSize: 13,
                  marginBottom: 8,
                }}
              >
                <span>Uploading to Telegram…</span>
                <span>{progress}%</span>
              </div>
              <div
                style={{
                  height: 8,
                  overflow: "hidden",
                  borderRadius: 999,
                  background: "rgba(255,255,255,.08)",
                }}
              >
                <div
                  style={{
                    width: `${progress}%`,
                    height: "100%",
                    borderRadius: 999,
                    background:
                      "linear-gradient(90deg, #8b5cf6, #22d3ee)",
                    transition: "width .15s ease",
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
              marginTop: 18,
              padding: "14px 18px",
              border: 0,
              borderRadius: 14,
              background:
                !file || uploading
                  ? "rgba(255,255,255,.10)"
                  : "linear-gradient(135deg, #7c3aed, #4f46e5)",
              color: !file || uploading ? "#777783" : "#fff",
              fontWeight: 700,
              cursor: !file || uploading ? "not-allowed" : "pointer",
              boxShadow:
                !file || uploading
                  ? "none"
                  : "0 12px 30px rgba(99,102,241,.25)",
            }}
          >
            {uploading ? "Uploading…" : "Upload to Telegram"}
          </button>

          {error && (
            <div
              role="alert"
              style={{
                marginTop: 16,
                padding: 13,
                borderRadius: 13,
                border: "1px solid rgba(248,113,113,.25)",
                background: "rgba(248,113,113,.08)",
                color: "#fca5a5",
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          )}

          {result && (
            <div
              style={{
                marginTop: 18,
                padding: 17,
                borderRadius: 16,
                border: "1px solid rgba(74,222,128,.22)",
                background: "rgba(74,222,128,.07)",
              }}
            >
              <div
                style={{
                  fontWeight: 750,
                  color: "#86efac",
                  marginBottom: 12,
                }}
              >
                ✓ Uploaded successfully
              </div>

              <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
                <div>
                  <span style={{ color: "#92929e" }}>Telegram message ID: </span>
                  {result.telegramMessageId ?? "—"}
                </div>
                <div>
                  <span style={{ color: "#92929e" }}>File ID: </span>
                  <code style={{ wordBreak: "break-all" }}>
                    {result.telegramFileId ?? "—"}
                  </code>
                </div>
                <div>
                  <span style={{ color: "#92929e" }}>Duration: </span>
                  {formatDuration(result.duration)}
                </div>
                <div>
                  <span style={{ color: "#92929e" }}>Dimensions: </span>
                  {result.width && result.height
                    ? `${result.width} × ${result.height}`
                    : "—"}
                </div>
                <div>
                  <span style={{ color: "#92929e" }}>Telegram file size: </span>
                  {result.fileSize ? formatBytes(result.fileSize) : "—"}
                </div>
              </div>
            </div>
          )}
        </section>

        <p
          style={{
            marginTop: 18,
            color: "#777783",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          Test page only. The 4 MB browser limit is intentional because Vercel
          Functions currently reject incoming function payloads above 4.5 MB.
          The final Social upload architecture should use a direct/large-file
          upload path rather than sending large videos through this test route.
        </p>
      </div>
    </main>
  );
}
