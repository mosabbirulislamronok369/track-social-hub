"use client";

import {
  ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { supabase } from "../lib/supabase";

type SocialTextPost = {
  id: string;
  user_id: string;
  title: string | null;
  text_content: string | null;
  media_type: "photo" | "video" | "pdf" | "voice" | null;
  telegram_chat_id: string | null;
  telegram_file_id: string | null;
  telegram_message_id: number | null;
  mime_type: string | null;
  original_filename: string | null;
  file_size: number | null;
  created_at: string;
};

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

type ReactionType = "like" | "love" | "haha" | "wow" | "angry";

const PAGE_SIZE = 25;

const REACTIONS: { key: ReactionType; emoji: string; label: string }[] = [
  { key: "like", emoji: "👍", label: "Like" },
  { key: "love", emoji: "❤️", label: "Love" },
  { key: "haha", emoji: "😂", label: "Haha" },
  { key: "wow", emoji: "😮", label: "Wow" },
  { key: "angry", emoji: "😡", label: "Angry" },
];

type AuthorInfo = {
  display_name: string | null;
  name: string | null;
  avatar_url: string | null;
  avatar_telegram_file_id: string | null;
};

// খারাপ/অশ্লীল শব্দ সনাক্তকরণের লিস্ট (প্রয়োজনে ব্যাকএন্ড বা এআই ফিল্টার যুক্ত করতে পারেন)
const BANNED_WORDS = [
  "sex", "porn", "nude", "naked", "adult", "xvideo", "hentai", "xxx", "bastard"
];

function containsInappropriateContent(text: string): boolean {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return BANNED_WORDS.some((word) => lowerText.includes(word));
}

function authorAvatarSrc(info: AuthorInfo | undefined) {
  if (!info) return null;
  if (info.avatar_telegram_file_id) {
    return `/api/social/photos/stream?fileId=${encodeURIComponent(
      info.avatar_telegram_file_id
    )}`;
  }
  return info.avatar_url;
}

function authorDisplayName(info: AuthorInfo | undefined) {
  const displayName = info?.display_name?.trim() || "";
  const name = info?.name?.trim() || "";

  if (displayName && !displayName.includes("@")) return displayName;
  if (name && !name.includes("@")) return name;

  return "User";
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const PHOTO_EXTENSIONS = [
  "heic", "heif", "jpg", "jpeg", "png", "webp", "gif", "avif", "bmp",
];
const VIDEO_EXTENSIONS = ["mp4", "mov", "webm", "mkv", "avi", "m4v", "3gp"];

function detectMediaKind(file: File): "photo" | "video" | "pdf" | "voice" | null {
  if (file.type.startsWith("image/")) return "photo";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "voice";
  if (file.type === "application/pdf") return "pdf";

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (PHOTO_EXTENSIONS.includes(ext)) return "photo";
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  if (ext === "pdf") return "pdf";

  return null;
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

export default function Social({
  onViewProfile,
}: {
  onViewProfile?: (userId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [textPosts, setTextPosts] = useState<SocialTextPost[]>([]);
  const [videos, setVideos] = useState<SocialVideo[]>([]);
  const [photos, setPhotos] = useState<SocialPhoto[]>([]);

  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [title, setTitle] = useState("");
  const [textContent, setTextContent] = useState("");

  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"text" | "videos" | "photos" | "reels">("reels");

  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [currentReactions, setCurrentReactions] = useState<Record<string, ReactionType | null>>({});

  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [authors, setAuthors] = useState<Record<string, AuthorInfo>>({});
  const [actionError, setActionError] = useState("");

  /* FETCH FEED (PAGINATED 25 ITEMS) */
  const loadFeed = useCallback(async (isLoadMore = false) => {
    setLoading(true);
    setError("");

    const nextPage = isLoadMore ? page + 1 : 0;
    const from = nextPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const [
      { data: textData, error: textError },
      { data: videoData, error: videoError },
      { data: photoData, error: photoError },
    ] = await Promise.all([
      supabase.from("social_texts").select("*").order("created_at", { ascending: false }).range(from, to),
      supabase.from("social_videos").select("*").order("created_at", { ascending: false }).range(from, to),
      supabase.from("social_photos").select("*").order("created_at", { ascending: false }).range(from, to),
    ]);

    if (isLoadMore) {
      setTextPosts((prev) => [...prev, ...((textData ?? []) as SocialTextPost[])]);
      setVideos((prev) => [...prev, ...((videoData ?? []) as SocialVideo[])]);
      setPhotos((prev) => [...prev, ...((photoData ?? []) as SocialPhoto[])]);
    } else {
      setTextPosts((textData ?? []) as SocialTextPost[]);
      setVideos((videoData ?? []) as SocialVideo[]);
      setPhotos((photoData ?? []) as SocialPhoto[]);
    }

    setPage(nextPage);
    if ((videoData?.length || 0) < PAGE_SIZE) setHasMore(false);

    if (textError && videoError && photoError) setError("Error loading feed.");
    setLoading(false);
  }, [page]);

  /* AUTHORS */
  const loadAuthors = useCallback(async (items: { user_id: string }[]) => {
    const ids = Array.from(new Set(items.map((item) => item.user_id).filter(Boolean)));
    if (!ids.length) return;

    const { data } = await supabase
      .from("profiles")
      .select("id,name,display_name,avatar_url,avatar_telegram_file_id")
      .in("id", ids);

    setAuthors((prev) => {
      const next = { ...prev };
      for (const row of data ?? []) {
        next[row.id] = {
          display_name: row.display_name,
          name: row.name,
          avatar_url: row.avatar_url,
          avatar_telegram_file_id: row.avatar_telegram_file_id,
        };
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (textPosts.length || videos.length || photos.length) {
      loadAuthors([...textPosts, ...videos, ...photos]);
    }
  }, [textPosts, videos, photos, loadAuthors]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUserId(user?.id ?? null);
    })();
    loadFeed(false);
  }, []);

  /* OPEN IN LOCAL PLAYER */
  const openInLocalPlayer = (fileId: string | null, type: "mx" | "vlc" | "telegram" | "copy") => {
    if (!fileId) return;
    const directStreamUrl = `${window.location.origin}/api/social/videos/stream?fileId=${encodeURIComponent(fileId)}`;

    if (type === "mx") {
      window.location.href = `intent:${directStreamUrl}#Intent;package=com.mxtech.videoplayer.ad;type=video/*;end`;
    } else if (type === "vlc") {
      window.location.href = `vlc://${directStreamUrl}`;
    } else if (type === "telegram") {
      window.open(`https://t.me/share/url?url=${encodeURIComponent(directStreamUrl)}`, "_blank");
    } else if (type === "copy") {
      navigator.clipboard.writeText(directStreamUrl);
      setActionError("Stream link copied!");
      setTimeout(() => setActionError(""), 2000);
    }
  };

  /* FILE HANDLING */
  function chooseFile(nextFile: File | null) {
    if (uploading) return;
    if (!nextFile) {
      setFile(null);
      setProgress(0);
      setError("");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    const kind = detectMediaKind(nextFile);
    if (!kind) {
      setFile(null);
      setError("Supported file types: Photo, Video, PDF, Voice.");
      return;
    }

    if (nextFile.size > 20 * 1024 * 1024) {
      setFile(null);
      setError("Maximum file size limit is 20 MB.");
      return;
    }

    setError("");
    setFile(nextFile);
  }

  /* UPLOAD & PUBLISH WITH TOKEN FIX & CONTENT FILTER */
  async function upload() {
    if (uploading) return;

    // ১. খারাপ/অশ্লীল কনটেন্ট ফিল্টার
    const combinedText = `${title} ${caption} ${textContent}`;
    if (containsInappropriateContent(combinedText)) {
      setError("আপনার পোস্টে অনাকাঙ্ক্ষিত বা অশ্লীল বিষয়বস্তু শনাক্ত হয়েছে। অনুগ্রহ করে ভদ্র কনটেন্ট প্রকাশ করুন।");
      return;
    }

    if (!textContent.trim() && !file && activeTab === "text") {
      setError("Please write some content or upload a file.");
      return;
    }

    if (!file && activeTab !== "text") {
      setError("Please attach a media file.");
      return;
    }

    setUploading(true);
    setProgress(0);
    setError("");

    try {
      // 🔒 ২. টোকেন ইস্যু ফিক্স (getSession ব্যবহার)
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData?.session;

      if (!session?.access_token) {
        throw new Error("আপনার লগইন সেশনের মেয়াদ শেষ। সাইন-আউট করে পুনরায় লগইন করুন।");
      }

      let storageData: any = null;

      if (file) {
        const uploadEndpoint = process.env.NEXT_PUBLIC_TELEGRAM_UPLOAD_URL;
        const uploadSecret = process.env.NEXT_PUBLIC_TELEGRAM_UPLOAD_SECRET;
        if (!uploadEndpoint || !uploadSecret) throw new Error("Telegram configuration missing.");

        const kind = detectMediaKind(file);
        const formData = new FormData();
        formData.append(kind === "video" ? "video" : "photo", file, file.name);
        formData.append("title", title.trim() || file.name.replace(/\.[^.]+$/, ""));
        if (caption.trim()) formData.append("caption", caption.trim());

        const xhr = new XMLHttpRequest();
        xhr.open("POST", uploadEndpoint);
        xhr.responseType = "json";
        xhr.setRequestHeader("Authorization", `Bearer ${uploadSecret}`);

        await new Promise<void>((resolve, reject) => {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => {
            let res = xhr.response;
            if (xhr.status >= 200 && xhr.status < 300 && res?.success && res?.storage?.telegram_file_id) {
              storageData = res.storage;
              resolve();
            } else {
              reject(new Error(res?.error || "Telegram upload failed."));
            }
          };
          xhr.onerror = () => reject(new Error("Network upload error."));
          xhr.send(formData);
        });
      }

      const telegramFields = {
        telegram_chat_id: storageData?.telegram_chat_id || null,
        telegram_file_id: storageData?.telegram_file_id || null,
        telegram_message_id: storageData?.telegram_message_id || null,
        mime_type: file?.type || storageData?.mime_type || null,
        original_filename: file?.name || storageData?.original_filename || null,
        file_size: file?.size || storageData?.file_size || null,
        storage: storageData,
      };

      let metadataEndpoint = "/api/social/texts/metadata";
      let payload: any = {
        title: title.trim() || null,
        text_content: textContent.trim() || null,
        media_type: file ? detectMediaKind(file) : null,
        ...telegramFields,
      };

      if (activeTab === "videos" || activeTab === "reels") {
        metadataEndpoint = "/api/social/videos/metadata";
        payload = {
          title: title.trim() || file?.name || "Untitled Video",
          caption: caption.trim() || null,
          ...telegramFields,
        };
      } else if (activeTab === "photos") {
        metadataEndpoint = "/api/social/photos/metadata";
        payload = {
          title: title.trim() || file?.name || "Untitled Photo",
          caption: caption.trim() || null,
          ...telegramFields,
        };
      }

      const res = await fetch(metadataEndpoint, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json", 
          Authorization: `Bearer ${session.access_token}` 
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || "Error saving metadata.");

      setFile(null);
      setTitle("");
      setCaption("");
      setTextContent("");
      setProgress(100);
      if (inputRef.current) inputRef.current.value = "";
      await loadFeed(false);
    } catch (err: any) {
      setError(err.message || "Failed to publish post.");
    } finally {
      setUploading(false);
    }
  }

  /* DELETE POST */
  async function deletePost(id: string, type: "text" | "video" | "photo") {
    if (!confirm("Are you sure you want to delete this post?")) return;
    const tableMap = { text: "social_texts", video: "social_videos", photo: "social_photos" };

    const { error: delErr } = await supabase.from(tableMap[type]).delete().eq("id", id).eq("user_id", currentUserId);
    if (delErr) {
      setActionError(delErr.message);
    } else {
      if (type === "text") setTextPosts((prev) => prev.filter((p) => p.id !== id));
      if (type === "video") setVideos((prev) => prev.filter((p) => p.id !== id));
      if (type === "photo") setPhotos((prev) => prev.filter((p) => p.id !== id));
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8 font-sans text-white">
      {/* HERO POST BUILDER */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#131722] to-[#090b10] p-6 shadow-2xl backdrop-blur-xl sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-bold text-cyan-400">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
              Telegram Storage Hub
            </div>
            <h1 className="mt-3 text-3xl font-black text-white sm:text-4xl">
              Express & Stream <span className="bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">Freely</span>
            </h1>
          </div>

          {currentUserId && (
            <button
              onClick={() => onViewProfile?.(currentUserId)}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-2 pr-4 text-white transition hover:bg-white/10"
            >
              <div className="h-10 w-10 overflow-hidden rounded-xl bg-purple-600/30 flex items-center justify-center font-bold">
                {authorAvatarSrc(authors[currentUserId]) ? (
                  <img src={authorAvatarSrc(authors[currentUserId])!} className="h-full w-full object-cover" />
                ) : (
                  authorDisplayName(authors[currentUserId]).charAt(0).toUpperCase()
                )}
              </div>
              <span className="text-xs font-bold">{authorDisplayName(authors[currentUserId])}</span>
            </button>
          )}
        </div>

        {/* INPUT FORM */}
        <div className="mt-6 space-y-4">
          {activeTab === "text" && (
            <textarea
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              placeholder="What's on your mind? Share text, ideas or stories..."
              rows={3}
              className="w-full rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white placeholder-white/30 outline-none focus:border-cyan-500/50"
            />
          )}

          {/* DRAG AND DROP ZONE WITH INSTRUCTIONS */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files?.[0] ?? null); }}
            onClick={() => inputRef.current?.click()}
            className={`cursor-pointer rounded-2xl border-2 border-dashed p-4 text-center transition ${
              dragging ? "border-cyan-500 bg-cyan-500/10" : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
            }`}
          >
            <input ref={inputRef} type="file" accept="image/*,video/*,application/pdf,audio/*" onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} className="hidden" />
            {!file ? (
              <p className="text-xs font-medium text-white/60">
                ✦ Drag & drop or <span className="text-cyan-400 underline">Browse File</span> (Photo, Video, PDF, Voice) — সর্বোচ্চ ২০MB ফাইল আপলোড করতে পারবেন। <span className="text-red-400 font-bold">(খারাপ বা অশ্লীল পোস্ট করবেন না)</span>
              </p>
            ) : (
              <div onClick={(e) => e.stopPropagation()} className="flex items-center justify-between text-xs text-white">
                <span className="truncate font-bold">📎 {file.name} ({formatBytes(file.size)})</span>
                <button type="button" onClick={() => chooseFile(null)} className="text-red-400 hover:underline">Remove</button>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-[1fr_1fr_auto]">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              className="rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-xs text-white outline-none focus:border-cyan-500/50"
            />
            {activeTab !== "text" && (
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Caption..."
                className="rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-xs text-white outline-none focus:border-cyan-500/50"
              />
            )}
            <button
              onClick={upload}
              disabled={uploading}
              className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-2.5 text-xs font-black text-white shadow-lg transition hover:brightness-110 disabled:opacity-50"
            >
              {uploading ? `Uploading ${progress}%` : "Publish"}
            </button>
          </div>
        </div>

        {error && <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300">{error}</div>}
      </div>

      {/* TABS SELECTOR */}
      <div className="mt-8 flex items-center gap-2 border-b border-white/10 pb-3">
        {(["reels", "videos", "photos", "text"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-xl px-5 py-2 text-xs font-bold capitalize transition ${
              activeTab === tab ? "bg-white text-black shadow-lg" : "text-white/40 hover:text-white"
            }`}
          >
            {tab === "reels" ? "⚡ Reels Feed" : `${tab} Feed`}
          </button>
        ))}
      </div>

      {/* FEED CONTROLLER */}
      {loading ? (
        <div className="mt-6 space-y-4">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-32 animate-pulse rounded-2xl bg-white/5" />
          ))}
        </div>
      ) : activeTab === "reels" ? (
        /* REELS SNAP-SCROLL VIEW WITH ORIGINAL ASPECT RATIO */
        <div className="mt-6 h-[80vh] w-full snap-y snap-mandatory overflow-y-scroll rounded-3xl border border-white/10 bg-black shadow-2xl">
          {videos.map((video) => {
            const streamUrl = video.telegram_file_id
              ? `/api/social/videos/stream?fileId=${encodeURIComponent(video.telegram_file_id)}`
              : null;

            return (
              <div key={video.id} className="relative h-full w-full snap-start flex items-center justify-center bg-black">
                {streamUrl ? (
                  <video 
                    src={streamUrl} 
                    controls 
                    loop 
                    playsInline 
                    className="max-h-full max-w-full object-contain" 
                  />
                ) : (
                  <p className="text-xs text-white/40">Stream Error</p>
                )}

                <div className="absolute bottom-6 left-6 right-6 flex items-center justify-between rounded-2xl bg-black/60 p-4 backdrop-blur-md border border-white/10">
                  <div>
                    <h3 className="text-sm font-bold">{video.title || "Untitled Reel"}</h3>
                    <p className="text-[10px] text-white/60">{timeAgo(video.created_at)}</p>
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => openInLocalPlayer(video.telegram_file_id, "mx")} className="rounded-lg bg-blue-600 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-blue-500">
                      MX Player
                    </button>
                    <button onClick={() => openInLocalPlayer(video.telegram_file_id, "telegram")} className="rounded-lg bg-cyan-500 px-3 py-1.5 text-[10px] font-bold text-black hover:bg-cyan-400">
                      Telegram
                    </button>
                    <button onClick={() => openInLocalPlayer(video.telegram_file_id, "copy")} className="rounded-lg bg-white/20 px-2 py-1.5 text-[10px] font-bold hover:bg-white/30">
                      🔗 Link
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : activeTab === "videos" ? (
        /* VIDEOS GRID VIEW WITH ORIGINAL ASPECT RATIO */
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {videos.map((video) => {
            const streamUrl = video.telegram_file_id ? `/api/social/videos/stream?fileId=${encodeURIComponent(video.telegram_file_id)}` : null;
            return (
              <article key={video.id} className="rounded-2xl border border-white/10 bg-[#0c0f17] p-3 shadow-xl flex flex-col justify-between">
                <div className="w-full overflow-hidden rounded-xl bg-black flex items-center justify-center" style={{ minHeight: '220px' }}>
                  {streamUrl ? (
                    <video src={streamUrl} controls className="max-h-[400px] w-full object-contain" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-white/30">Video error</div>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white truncate">{video.title || "Untitled Video"}</h4>
                  {video.user_id === currentUserId && (
                    <button onClick={() => deletePost(video.id, "video")} className="text-xs text-red-400 hover:underline">Delete</button>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2 border-t border-white/5 pt-3">
                  <button onClick={() => openInLocalPlayer(video.telegram_file_id, "mx")} className="flex-1 rounded-lg bg-blue-600/30 border border-blue-500/30 py-1.5 text-[10px] font-bold text-blue-300">Open MX</button>
                  <button onClick={() => openInLocalPlayer(video.telegram_file_id, "telegram")} className="flex-1 rounded-lg bg-cyan-500/30 border border-cyan-500/30 py-1.5 text-[10px] font-bold text-cyan-300">Telegram</button>
                  <button onClick={() => openInLocalPlayer(video.telegram_file_id, "copy")} className="rounded-lg bg-white/10 px-3 py-1.5 text-[10px] font-bold">Copy Link</button>
                </div>
              </article>
            );
          })}
        </div>
      ) : activeTab === "photos" ? (
        /* PHOTOS GRID VIEW */
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {photos.map((photo) => {
            const streamUrl = photo.telegram_file_id ? `/api/social/photos/stream?fileId=${encodeURIComponent(photo.telegram_file_id)}` : null;
            return (
              <article key={photo.id} className="rounded-2xl border border-white/10 bg-[#0c0f17] p-3 shadow-xl">
                <div className="w-full overflow-hidden rounded-xl bg-black flex items-center justify-center min-h-[200px]">
                  {streamUrl ? <img src={streamUrl} alt="" className="max-h-[350px] w-full object-contain" /> : <div className="flex h-full items-center justify-center text-xs text-white/30">Photo error</div>}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white truncate">{photo.title || "Untitled Photo"}</h4>
                  {photo.user_id === currentUserId && (
                    <button onClick={() => deletePost(photo.id, "photo")} className="text-xs text-red-400 hover:underline">Delete</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        /* TEXT POSTS VIEW */
        <div className="mt-6 space-y-4">
          {textPosts.map((post) => {
            const author = authors[post.user_id];
            return (
              <article key={post.id} className="rounded-2xl border border-white/10 bg-[#0c0f17] p-5 shadow-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button onClick={() => onViewProfile?.(post.user_id)} className="h-10 w-10 overflow-hidden rounded-xl bg-white/10 flex items-center justify-center font-bold text-xs">
                      {authorAvatarSrc(author) ? <img src={authorAvatarSrc(author)!} className="h-full w-full object-cover" /> : authorDisplayName(author).charAt(0)}
                    </button>
                    <div>
                      <h4 className="text-xs font-bold text-white">{authorDisplayName(author)}</h4>
                      <span className="text-[10px] text-white/40">{timeAgo(post.created_at)}</span>
                    </div>
                  </div>
                  {post.user_id === currentUserId && (
                    <button onClick={() => deletePost(post.id, "text")} className="text-xs text-red-400 hover:underline">Delete</button>
                  )}
                </div>
                {post.title && <h3 className="mt-4 text-base font-bold text-white">{post.title}</h3>}
                {post.text_content && <p className="mt-2 text-xs leading-relaxed text-white/80 whitespace-pre-line">{post.text_content}</p>}
              </article>
            );
          })}
        </div>
      )}

      {/* LOAD MORE BUTTON (25 Items at a time) */}
      {hasMore && activeTab !== "reels" && (
        <div className="mt-8 text-center">
          <button
            onClick={() => loadFeed(true)}
            disabled={loading}
            className="rounded-xl border border-white/10 bg-white/5 px-6 py-2.5 text-xs font-bold text-white transition hover:bg-white/10 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load 25 More"}
          </button>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      {actionError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-2xl border border-white/10 bg-[#161b26]/90 px-5 py-2.5 text-xs font-bold text-cyan-400 shadow-2xl backdrop-blur-xl">
          {actionError}
        </div>
      )}
    </section>
  );
}