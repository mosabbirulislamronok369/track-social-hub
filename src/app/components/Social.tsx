"use client";

import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "../lib/supabase";

type SocialVideo = {
  id: string;
  user_id: string;
  title: string | null;
  caption: string | null;
  telegram_chat_id: string | null;
  telegram_file_id: string | null;
  telegram_message_id: number | null;
  mime_type: string | null;
  original_filename: string | null;
  file_size: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  created_at: string;
};

type SocialPhoto = {
  id: string;
  user_id: string;
  title: string | null;
  caption: string | null;
  telegram_chat_id: string | null;
  telegram_file_id: string | null;
  telegram_message_id: number | null;
  mime_type: string | null;
  original_filename: string | null;
  file_size: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
};

type CommentRow = {
  id: string;
  video_id: string;
  user_id: string;
  body: string;
  created_at: string;
};

function formatBytes(bytes: number | null) {
  if (!bytes) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );

  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(seconds: number | null) {
  if (!seconds || seconds <= 0) return "";

  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);

  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function timeAgo(value: string) {
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);

  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);

  if (days < 7) return `${days}d ago`;

  return new Date(value).toLocaleDateString();
}

export default function Social() {
  const inputRef = useRef<HTMLInputElement>(null);

  const [videos, setVideos] = useState<SocialVideo[]>([]);
  const [photos, setPhotos] = useState<SocialPhoto[]>([]);

  const [file, setFile] = useState<File | null>(null);

  const [caption, setCaption] = useState("");
  const [title, setTitle] = useState("");

  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activeTab, setActiveTab] = useState<"videos" | "photos">(
    "videos",
  );

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>(
    {},
  );

  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, CommentRow[]>>({});
  const [commentDraft, setCommentDraft] = useState("");

  const [commentLoading, setCommentLoading] = useState(false);
  const [actionError, setActionError] = useState("");

  const selectedItems =
    activeTab === "videos" ? videos : photos;

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError("");

    const [
      { data: videoData, error: videoError },
      { data: photoData, error: photoError },
    ] = await Promise.all([
      supabase
        .from("social_videos")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30),

      supabase
        .from("social_photos")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    if (videoError) {
      console.error("Social videos error:", videoError);
    }

    if (photoError) {
      console.error("Social photos error:", photoError);
    }

    if (videoError && photoError) {
      setError(
        videoError.message || photoError.message,
      );
    }

    setVideos((videoData ?? []) as SocialVideo[]);
    setPhotos((photoData ?? []) as SocialPhoto[]);

    setLoading(false);
  }, []);

  const allIds = useMemo(
    () => [
      ...videos.map((item) => item.id),
      ...photos.map((item) => item.id),
    ],
    [videos, photos],
  );

  const loadSocialStats = useCallback(
    async (ids: string[], userId: string | null) => {
      if (!ids.length) return;

      const [
        { data: likes },
        { data: commentsData },
      ] = await Promise.all([
        supabase
          .from("social_likes")
          .select("video_id,user_id")
          .in("video_id", ids),

        supabase
          .from("social_comments")
          .select("video_id")
          .in("video_id", ids),
      ]);

      const nextLikes: Record<string, number> = {};
      const nextComments: Record<string, number> = {};

      for (const id of ids) {
        nextLikes[id] = 0;
        nextComments[id] = 0;
      }

      const mine = new Set<string>();

      for (const row of likes ?? []) {
        nextLikes[row.video_id] =
          (nextLikes[row.video_id] ?? 0) + 1;

        if (userId && row.user_id === userId) {
          mine.add(row.video_id);
        }
      }

      for (const row of commentsData ?? []) {
        nextComments[row.video_id] =
          (nextComments[row.video_id] ?? 0) + 1;
      }

      setLikeCounts(nextLikes);
      setCommentCounts(nextComments);
      setLikedIds(mine);
    },
    [],
  );

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setCurrentUserId(user?.id ?? null);
    })();
  }, []);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    loadSocialStats(allIds, currentUserId);
  }, [allIds, currentUserId, loadSocialStats]);

  function chooseFile(nextFile: File | null) {
    setError("");
    setProgress(0);

    if (!nextFile) {
      setFile(null);

      if (inputRef.current) {
        inputRef.current.value = "";
      }

      return;
    }

    const isVideo = nextFile.type.startsWith("video/");
    const isPhoto = nextFile.type.startsWith("image/");

    if (!isVideo && !isPhoto) {
      setFile(null);
      setError("Please choose a photo or video file.");
      return;
    }

    setFile(nextFile);

    setActiveTab(isVideo ? "videos" : "photos");
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);

    chooseFile(event.dataTransfer.files?.[0] ?? null);
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0] ?? null);
  }

  async function upload() {
    if (!file || uploading) return;

    setUploading(true);
    setProgress(0);
    setError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error(
          "Please login before uploading.",
        );
      }

      const uploadEndpoint =
        process.env.NEXT_PUBLIC_TELEGRAM_UPLOAD_URL;

      if (!uploadEndpoint) {
        throw new Error(
          "NEXT_PUBLIC_TELEGRAM_UPLOAD_URL is not configured.",
        );
      }

      const uploadSecret =
        process.env.NEXT_PUBLIC_TELEGRAM_UPLOAD_SECRET;

      if (!uploadSecret) {
        throw new Error(
          "NEXT_PUBLIC_TELEGRAM_UPLOAD_SECRET is not configured.",
        );
      }

      const isVideo =
        file.type.startsWith("video/");

      const formData = new FormData();

      formData.append(
        isVideo ? "video" : "photo",
        file,
        file.name,
      );

      formData.append(
        "title",
        title.trim() ||
          file.name.replace(/\.[^.]+$/, ""),
      );

      if (caption.trim()) {
        formData.append(
          "caption",
          caption.trim(),
        );
      }

      const xhr = new XMLHttpRequest();

      xhr.open("POST", uploadEndpoint);
      xhr.responseType = "json";

      xhr.setRequestHeader(
        "Authorization",
        `Bearer ${uploadSecret}`,
      );

      await new Promise<void>((resolve, reject) => {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            setProgress(
              Math.round(
                (event.loaded / event.total) * 100,
              ),
            );
          }
        };

        xhr.onload = async () => {
          try {
            let data = xhr.response;

            if (!data && xhr.responseText) {
              try {
                data = JSON.parse(
                  xhr.responseText,
                );
              } catch {
                data = null;
              }
            }

            if (
              xhr.status < 200 ||
              xhr.status >= 300 ||
              !data?.success
            ) {
              reject(
                new Error(
                  data?.error ||
                    `Upload failed with HTTP ${xhr.status}.`,
                ),
              );
              return;
            }

            if (
              !data.storage?.telegram_file_id
            ) {
              reject(
                new Error(
                  "Telegram upload succeeded but no file ID was returned.",
                ),
              );
              return;
            }

            const metadataResponse =
              await fetch(
                "/api/social/videos/metadata",
                {
                  method: "POST",
                  headers: {
                    "content-type":
                      "application/json",
                    Authorization:
                      `Bearer ${session.access_token}`,
                  },
                  body: JSON.stringify({
                    title:
                      title.trim() ||
                      file.name.replace(
                        /\.[^.]+$/,
                        "",
                      ),

                    caption:
                      caption.trim() || null,

                    media_type: isVideo
                      ? "video"
                      : "photo",

                    storage: data.storage,
                  }),
                },
              );

            let metadata: any = null;

            try {
              metadata =
                await metadataResponse.json();
            } catch {
              metadata = null;
            }

            if (
              !metadataResponse.ok ||
              !metadata?.success
            ) {
              reject(
                new Error(
                  metadata?.error ||
                    "Media uploaded to Telegram, but metadata could not be saved.",
                ),
              );
              return;
            }

            setProgress(100);

            resolve();
          } catch (err) {
            reject(
              err instanceof Error
                ? err
                : new Error("Upload failed."),
            );
          }
        };

        xhr.onerror = () => {
          reject(
            new Error(
              "Network error while uploading.",
            ),
          );
        };

        xhr.onabort = () => {
          reject(
            new Error("Upload cancelled."),
          );
        };

        xhr.send(formData);
      });

      setFile(null);
      setTitle("");
      setCaption("");
      setProgress(100);

      if (inputRef.current) {
        inputRef.current.value = "";
      }

      await loadFeed();
    } catch (err) {
      console.error(
        "Social upload error:",
        err,
      );

      setError(
        err instanceof Error
          ? err.message
          : "Upload failed.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function toggleLike(id: string) {
    setActionError("");

    if (!currentUserId) {
      setActionError(
        "Please login to like posts.",
      );
      return;
    }

    const isLiked = likedIds.has(id);

    setLikedIds((prev) => {
      const next = new Set(prev);

      if (isLiked) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });

    setLikeCounts((prev) => ({
      ...prev,
      [id]: Math.max(
        0,
        (prev[id] ?? 0) +
          (isLiked ? -1 : 1),
      ),
    }));

    const result = isLiked
      ? await supabase
          .from("social_likes")
          .delete()
          .eq("video_id", id)
          .eq("user_id", currentUserId)
      : await supabase
          .from("social_likes")
          .insert({
            video_id: id,
            user_id: currentUserId,
          });

    if (result.error) {
      setActionError(
        result.error.message,
      );

      setLikedIds((prev) => {
        const next = new Set(prev);

        if (isLiked) {
          next.add(id);
        } else {
          next.delete(id);
        }

        return next;
      });

      setLikeCounts((prev) => ({
        ...prev,
        [id]: Math.max(
          0,
          (prev[id] ?? 0) +
            (isLiked ? 1 : -1),
        ),
      }));
    }
  }

  async function loadComments(id: string) {
    const { data, error } =
      await supabase
        .from("social_comments")
        .select(
          "id,video_id,user_id,body,created_at",
        )
        .eq("video_id", id)
        .order("created_at", {
          ascending: true,
        })
        .limit(50);

    if (error) {
      setActionError(error.message);
      return;
    }

    setComments((prev) => ({
      ...prev,
      [id]: (data ?? []) as CommentRow[],
    }));
  }

  async function toggleComments(id: string) {
    setActionError("");

    if (openComments === id) {
      setOpenComments(null);
      return;
    }

    setOpenComments(id);

    await loadComments(id);
  }

  async function addComment(id: string) {
    const body = commentDraft.trim();

    if (!body || commentLoading) return;

    if (!currentUserId) {
      setActionError(
        "Please login to comment.",
      );
      return;
    }

    setCommentLoading(true);
    setActionError("");

    const { data, error } =
      await supabase
        .from("social_comments")
        .insert({
          video_id: id,
          user_id: currentUserId,
          body,
        })
        .select(
          "id,video_id,user_id,body,created_at",
        )
        .single();

    if (error) {
      setActionError(error.message);
    } else if (data) {
      setComments((prev) => ({
        ...prev,
        [id]: [
          ...(prev[id] ?? []),
          data as CommentRow,
        ],
      }));

      setCommentCounts((prev) => ({
        ...prev,
        [id]:
          (prev[id] ?? 0) + 1,
      }));

      setCommentDraft("");
    }

    setCommentLoading(false);
  }

  async function sharePost(id: string) {
    setActionError("");

    const url =
      `${window.location.origin}/?socialVideo=` +
      encodeURIComponent(id);

    try {
      if (navigator.share) {
        await navigator.share({
          title: "Track Social",
          text: "Check out this post",
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);

        setActionError(
          "Link copied to clipboard.",
        );

        window.setTimeout(
          () => setActionError(""),
          1800,
        );
      }

      if (currentUserId) {
        await supabase
          .from("social_shares")
          .insert({
            video_id: id,
            user_id: currentUserId,
          });
      }
    } catch (err) {
      if (
        err instanceof DOMException &&
        err.name === "AbortError"
      ) {
        return;
      }

      console.error(
        "Share error:",
        err,
      );
    }
  }

  const selectedMeta = useMemo(() => {
    if (!file) return null;

    const type = file.type.startsWith("video/")
      ? file.type
          .replace("video/", "")
          .toUpperCase()
      : file.type
          .replace("image/", "")
          .toUpperCase();

    return `${formatBytes(file.size)} · ${type}`;
  }, [file]);

  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-12 pt-6 sm:px-6 lg:px-8">

      {/* HEADER / UPLOAD */}

      <div className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-white/[0.025] shadow-[0_30px_100px_-40px_rgba(124,58,237,0.45)]">

        <div className="absolute -right-28 -top-32 h-72 w-72 rounded-full bg-[var(--accent)]/15 blur-3xl" />

        <div className="absolute -left-32 top-24 h-64 w-64 rounded-full bg-[var(--accent-2)]/10 blur-3xl" />

        <div className="relative p-5 sm:p-7 lg:p-9">

          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">

            <div>
              <p className="eyebrow mb-2">
                YOUR SOCIAL SPACE
              </p>

              <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
                Social
              </h1>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/45 sm:text-base">
                Share moments, clips and memories with a fast, focused social feed.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                inputRef.current?.click()
              }
              className="group inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,var(--accent),var(--accent-2))] px-5 text-sm font-bold text-white shadow-[0_12px_30px_-12px_var(--accent-soft)] transition duration-300 hover:-translate-y-0.5"
            >
              <span className="text-lg leading-none">
                +
              </span>

              Create post
            </button>
          </div>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() =>
              setDragging(false)
            }
            onDrop={handleDrop}
            onClick={() =>
              inputRef.current?.click()
            }
            className={`mt-7 cursor-pointer rounded-2xl border border-dashed p-5 transition-all duration-300 sm:p-7 ${
              dragging
                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                : "border-white/[0.11] bg-black/20 hover:border-white/[0.2] hover:bg-white/[0.035]"
            }`}
          >

            <input
              ref={inputRef}
              type="file"
              accept="image/*,video/*"
              onChange={handleInput}
              className="hidden"
            />

            {!file ? (
              <div className="flex flex-col items-center justify-center py-7 text-center">

                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.045] text-2xl">
                  ◈
                </div>

                <h2 className="text-base font-bold text-white">
                  Drop a photo or video here
                </h2>

                <p className="mt-1 text-sm text-white/35">
                  or click to browse · Photos / MP4 / WebM / MOV
                </p>

                <p className="mt-3 text-xs text-white/25">
                  Direct Telegram upload via Cloudflare Worker
                </p>

              </div>
            ) : (
              <div
                onClick={(event) =>
                  event.stopPropagation()
                }
              >

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">

                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-black">

                    {file.type.startsWith("video/") ? (
                      <video
                        src={URL.createObjectURL(file)}
                        className="h-full w-full object-cover"
                        muted
                        playsInline
                      />
                    ) : (
                      <img
                        src={URL.createObjectURL(file)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )}

                  </div>

                  <div className="min-w-0 flex-1">

                    <p className="truncate text-sm font-bold text-white">
                      {file.name}
                    </p>

                    <p className="mt-1 text-xs text-white/35">
                      {selectedMeta}
                    </p>

                    {uploading && (
                      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">

                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent),var(--accent-2))] transition-all duration-300"
                          style={{
                            width: `${progress}%`,
                          }}
                        />

                      </div>
                    )}

                  </div>

                  {!uploading && (
                    <button
                      type="button"
                      onClick={() =>
                        chooseFile(null)
                      }
                      className="rounded-lg px-3 py-2 text-xs font-semibold text-white/40 transition hover:bg-white/[0.06] hover:text-white"
                    >
                      Remove
                    </button>
                  )}

                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]">

                  <input
                    value={title}
                    onChange={(event) =>
                      setTitle(event.target.value)
                    }
                    placeholder="Post title"
                    className="h-11 rounded-xl border border-white/[0.08] bg-black/25 px-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-[var(--accent)]/50"
                  />

                  <input
                    value={caption}
                    onChange={(event) =>
                      setCaption(event.target.value)
                    }
                    placeholder="Say something..."
                    className="h-11 rounded-xl border border-white/[0.08] bg-black/25 px-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-[var(--accent)]/50"
                  />

                  <button
                    type="button"
                    disabled={uploading}
                    onClick={upload}
                    className="h-11 rounded-xl bg-white text-sm font-extrabold text-black transition hover:bg-white/90 disabled:opacity-50"
                  >
                    {uploading
                      ? `Uploading ${progress}%`
                      : "Publish"}
                  </button>

                </div>

              </div>
            )}

          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-400/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

        </div>
      </div>

      {/* TABS */}

      <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">

        <div>
          <p className="eyebrow">
            LATEST
          </p>

          <h2 className="mt-1 text-xl font-bold text-white sm:text-2xl">
            Your social feed
          </h2>
        </div>

        <div className="inline-flex rounded-xl border border-white/[0.07] bg-white/[0.025] p-1">

          <button
            type="button"
            onClick={() =>
              setActiveTab("videos")
            }
            className={`rounded-lg px-4 py-2 text-xs font-bold transition ${
              activeTab === "videos"
                ? "bg-white text-black"
                : "text-white/40 hover:text-white"
            }`}
          >
            Videos
            <span className="ml-2 opacity-50">
              {videos.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveTab("photos")
            }
            className={`rounded-lg px-4 py-2 text-xs font-bold transition ${
              activeTab === "photos"
                ? "bg-white text-black"
                : "text-white/40 hover:text-white"
            }`}
          >
            Photos
            <span className="ml-2 opacity-50">
              {photos.length}
            </span>
          </button>

        </div>

      </div>

      {/* FEED */}

      {loading ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">

          {Array.from({ length: 4 }).map(
            (_, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025]"
              >
                <div className="aspect-video animate-pulse bg-white/[0.04]" />

                <div className="space-y-3 p-5">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-white/[0.05]" />
                  <div className="h-3 w-full animate-pulse rounded bg-white/[0.04]" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" />
                </div>
              </div>
            ),
          )}

        </div>
      ) : selectedItems.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-6 py-16 text-center">

          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.04] text-xl">
            {activeTab === "videos"
              ? "▶"
              : "▧"}
          </div>

          <h3 className="mt-4 text-lg font-bold text-white">
            No {activeTab} yet
          </h3>

          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/35">
            Upload your first{" "}
            {activeTab === "videos"
              ? "video"
              : "photo"}{" "}
            and it will appear here.
          </p>

        </div>
      ) : activeTab === "videos" ? (

        /* ---------------- VIDEOS ---------------- */

        <div className="mt-5 grid gap-5 lg:grid-cols-2">

          {videos.map((video) => {
            const streamUrl =
              video.telegram_file_id
                ? `/api/social/videos/stream?fileId=${encodeURIComponent(
                    video.telegram_file_id,
                  )}`
                : null;

            const isLiked =
              likedIds.has(video.id);

            const cardComments =
              comments[video.id] ?? [];

            return (
              <article
                key={video.id}
                className="group overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0b0b12]/85 shadow-[0_20px_70px_-45px_rgba(0,0,0,0.9)] transition duration-300 hover:-translate-y-1 hover:border-white/[0.13]"
              >

                <div className="relative aspect-video overflow-hidden bg-black">

                  {streamUrl ? (
                    <video
                      src={streamUrl}
                      className="h-full w-full object-contain"
                      controls
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-white/30">
                      Video unavailable
                    </div>
                  )}

                  {video.duration_seconds ? (
                    <span className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/70 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur">
                      {formatDuration(
                        video.duration_seconds,
                      )}
                    </span>
                  ) : null}

                </div>

                <div className="p-5">

                  <div className="flex items-start gap-3">

                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--accent-soft),rgba(255,255,255,.08))] text-sm font-black text-[var(--accent-2)]">
                      U
                    </div>

                    <div className="min-w-0 flex-1">

                      <div className="flex items-center justify-between gap-3">

                        <p className="truncate text-sm font-bold text-white">
                          {video.title ||
                            video.original_filename ||
                            "Untitled post"}
                        </p>

                        <span className="shrink-0 text-[11px] text-white/25">
                          {timeAgo(
                            video.created_at,
                          )}
                        </span>

                      </div>

                      {video.caption && (
                        <p className="mt-2 text-sm leading-6 text-white/50">
                          {video.caption}
                        </p>
                      )}

                      <PostActions
                        id={video.id}
                        isLiked={isLiked}
                        likeCount={
                          likeCounts[video.id] ?? 0
                        }
                        commentCount={
                          commentCounts[video.id] ?? 0
                        }
                        onLike={() =>
                          toggleLike(video.id)
                        }
                        onComments={() =>
                          toggleComments(
                            video.id,
                          )
                        }
                        onShare={() =>
                          sharePost(video.id)
                        }
                      />

                      {openComments ===
                        video.id && (
                        <Comments
                          comments={cardComments}
                          currentUserId={
                            currentUserId
                          }
                          commentDraft={
                            commentDraft
                          }
                          setCommentDraft={
                            setCommentDraft
                          }
                          commentLoading={
                            commentLoading
                          }
                          onSubmit={() =>
                            addComment(
                              video.id,
                            )
                          }
                        />
                      )}

                      <div className="mt-3 flex items-center gap-3 text-[11px] text-white/25">

                        <span>
                          {formatBytes(
                            video.file_size,
                          )}
                        </span>

                        {video.width &&
                          video.height && (
                            <span>
                              {video.width} ×{" "}
                              {video.height}
                            </span>
                          )}

                        <span className="ml-auto text-emerald-300/70">
                          Telegram storage
                        </span>

                      </div>

                    </div>
                  </div>
                </div>
              </article>
            );
          })}

        </div>

      ) : (

        /* ---------------- PHOTOS ---------------- */

        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">

          {photos.map((photo) => {
            const streamUrl =
              photo.telegram_file_id
                ? `/api/social/photos/stream?fileId=${encodeURIComponent(
                    photo.telegram_file_id,
                  )}`
                : null;

            const isLiked =
              likedIds.has(photo.id);

            const cardComments =
              comments[photo.id] ?? [];

            return (
              <article
                key={photo.id}
                className="group overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0b0b12]/85 shadow-[0_20px_70px_-45px_rgba(0,0,0,0.9)] transition duration-300 hover:-translate-y-1 hover:border-white/[0.13]"
              >

                <div className="relative overflow-hidden bg-black">

                  {streamUrl ? (
                    <img
                      src={streamUrl}
                      alt={
                        photo.title ||
                        photo.original_filename ||
                        "Social photo"
                      }
                      className="block h-auto max-h-[600px] w-full object-contain transition duration-500 group-hover:scale-[1.015]"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex aspect-square items-center justify-center text-sm text-white/30">
                      Photo unavailable
                    </div>
                  )}

                </div>

                <div className="p-5">

                  <div className="flex items-start gap-3">

                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--accent-soft),rgba(255,255,255,.08))] text-sm font-black text-[var(--accent-2)]">
                      U
                    </div>

                    <div className="min-w-0 flex-1">

                      <div className="flex items-center justify-between gap-3">

                        <p className="truncate text-sm font-bold text-white">
                          {photo.title ||
                            photo.original_filename ||
                            "Untitled post"}
                        </p>

                        <span className="shrink-0 text-[11px] text-white/25">
                          {timeAgo(
                            photo.created_at,
                          )}
                        </span>

                      </div>

                      {photo.caption && (
                        <p className="mt-2 text-sm leading-6 text-white/50">
                          {photo.caption}
                        </p>
                      )}

                      <PostActions
                        id={photo.id}
                        isLiked={isLiked}
                        likeCount={
                          likeCounts[photo.id] ?? 0
                        }
                        commentCount={
                          commentCounts[
                            photo.id
                          ] ?? 0
                        }
                        onLike={() =>
                          toggleLike(photo.id)
                        }
                        onComments={() =>
                          toggleComments(
                            photo.id,
                          )
                        }
                        onShare={() =>
                          sharePost(photo.id)
                        }
                      />

                      {openComments ===
                        photo.id && (
                        <Comments
                          comments={cardComments}
                          currentUserId={
                            currentUserId
                          }
                          commentDraft={
                            commentDraft
                          }
                          setCommentDraft={
                            setCommentDraft
                          }
                          commentLoading={
                            commentLoading
                          }
                          onSubmit={() =>
                            addComment(
                              photo.id,
                            )
                          }
                        />
                      )}

                      <div className="mt-3 flex items-center gap-3 text-[11px] text-white/25">

                        <span>
                          {formatBytes(
                            photo.file_size,
                          )}
                        </span>

                        {photo.width &&
                          photo.height && (
                            <span>
                              {photo.width} ×{" "}
                              {photo.height}
                            </span>
                          )}

                        <span className="ml-auto text-emerald-300/70">
                          Telegram storage
                        </span>

                      </div>

                    </div>
                  </div>
                </div>
              </article>
            );
          })}

        </div>
      )}

      {actionError && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-white/10 bg-[#11111a]/95 px-4 py-3 text-xs font-semibold text-white/80 shadow-2xl backdrop-blur-xl">
          {actionError}
        </div>
      )}

    </section>
  );
}

function PostActions({
  id,
  isLiked,
  likeCount,
  commentCount,
  onLike,
  onComments,
  onShare,
}: {
  id: string;
  isLiked: boolean;
  likeCount: number;
  commentCount: number;
  onLike: () => void;
  onComments: () => void;
  onShare: () => void;
}) {
  return (
    <div className="mt-4 flex items-center gap-2 border-t border-white/[0.06] pt-4">

      <button
        type="button"
        onClick={onLike}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition ${
          isLiked
            ? "bg-[var(--accent-soft)] text-[var(--accent-2)]"
            : "text-white/40 hover:bg-white/[0.05] hover:text-white"
        }`}
      >
        <span>
          {isLiked ? "♥" : "♡"}
        </span>

        {likeCount}
      </button>

      <button
        type="button"
        onClick={onComments}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white/40 transition hover:bg-white/[0.05] hover:text-white"
      >
        <span>◌</span>

        {commentCount}
      </button>

      <button
        type="button"
        onClick={onShare}
        className="ml-auto rounded-lg px-3 py-2 text-xs font-bold text-white/40 transition hover:bg-white/[0.05] hover:text-white"
      >
        Share
      </button>

    </div>
  );
}

function Comments({
  comments,
  currentUserId,
  commentDraft,
  setCommentDraft,
  commentLoading,
  onSubmit,
}: {
  comments: CommentRow[];
  currentUserId: string | null;
  commentDraft: string;
  setCommentDraft: (value: string) => void;
  commentLoading: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/20 p-3">

      <div className="max-h-56 space-y-3 overflow-y-auto pr-1">

        {comments.length === 0 ? (
          <p className="py-3 text-center text-xs text-white/25">
            No comments yet.
          </p>
        ) : (
          comments.map((comment) => (
            <div
              key={comment.id}
              className="rounded-lg bg-white/[0.025] px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-3">

                <span className="text-[11px] font-bold text-white/55">
                  {comment.user_id ===
                  currentUserId
                    ? "You"
                    : "User"}
                </span>

                <span className="text-[10px] text-white/20">
                  {timeAgo(
                    comment.created_at,
                  )}
                </span>

              </div>

              <p className="mt-1 text-xs leading-5 text-white/45">
                {comment.body}
              </p>
            </div>
          ))
        )}

      </div>

      <div className="mt-3 flex gap-2">

        <input
          value={commentDraft}
          onChange={(event) =>
            setCommentDraft(
              event.target.value,
            )
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onSubmit();
            }
          }}
          placeholder="Write a comment..."
          className="h-10 min-w-0 flex-1 rounded-lg border border-white/[0.07] bg-black/30 px-3 text-xs text-white outline-none placeholder:text-white/20 focus:border-[var(--accent)]/40"
        />

        <button
          type="button"
          disabled={commentLoading}
          onClick={onSubmit}
          className="h-10 rounded-lg bg-white px-3 text-xs font-extrabold text-black disabled:opacity-50"
        >
          Post
        </button>

      </div>
    </div>
  );
}