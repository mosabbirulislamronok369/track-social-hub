"use client";

import {
  ChangeEvent,
  DragEvent,
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
  const [activeTab, setActiveTab] = useState<"text" | "videos" | "photos">("text");

  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [currentReactions, setCurrentReactions] = useState<Record<string, ReactionType | null>>({});
  const [openReactionId, setOpenReactionId] = useState<string | null>(null);

  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [authors, setAuthors] = useState<Record<string, AuthorInfo>>({});
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, CommentRow[]>>({});
  const [commentDraft, setCommentDraft] = useState("");
  const [commentLoading, setCommentLoading] = useState(false);
  const [actionError, setActionError] = useState("");

  /* FETCH FEED */
  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError("");

    const [
      { data: textData, error: textError },
      { data: videoData, error: videoError },
      { data: photoData, error: photoError },
    ] = await Promise.all([
      supabase.from("social_texts").select("*").order("created_at", { ascending: false }).limit(PAGE_SIZE),
      supabase.from("social_videos").select("*").order("created_at", { ascending: false }).limit(PAGE_SIZE),
      supabase.from("social_photos").select("*").order("created_at", { ascending: false }).limit(PAGE_SIZE),
    ]);

    setTextPosts((textData ?? []) as SocialTextPost[]);
    setVideos((videoData ?? []) as SocialVideo[]);
    setPhotos((photoData ?? []) as SocialPhoto[]);

    if (textError && videoError && photoError) setError("Error loading feed.");
    setLoading(false);
  }, []);

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
    loadFeed();
  }, [loadFeed]);

  /* STATS (LIKES & COMMENTS) */
  const loadSocialStats = useCallback(async (items: { id: string }[], userId: string | null) => {
    if (!items.length) return;
    const ids = items.map((item) => item.id);

    const [{ data: likes }, { data: commentsData }] = await Promise.all([
      supabase.from("social_likes").select("video_id,user_id,reaction").in("video_id", ids),
      supabase.from("social_comments").select("video_id").in("video_id", ids),
    ]);

    const nextLikes: Record<string, number> = {};
    const nextComments: Record<string, number> = {};
    const nextMine: Record<string, ReactionType | null> = {};

    for (const id of ids) {
      nextLikes[id] = 0;
      nextComments[id] = 0;
      nextMine[id] = null;
    }

    for (const row of likes ?? []) {
      const reaction: ReactionType = REACTIONS.some((i) => i.key === row.reaction) ? row.reaction : "like";
      nextLikes[row.video_id] = (nextLikes[row.video_id] ?? 0) + 1;
      if (userId && row.user_id === userId) nextMine[row.video_id] = reaction;
    }

    for (const row of commentsData ?? []) {
      nextComments[row.video_id] = (nextComments[row.video_id] ?? 0) + 1;
    }

    setLikeCounts((prev) => ({ ...prev, ...nextLikes }));
    setCommentCounts((prev) => ({ ...prev, ...nextComments }));
    setCurrentReactions((prev) => ({ ...prev, ...nextMine }));
  }, []);

  useEffect(() => {
    const allItems = [...textPosts, ...videos, ...photos];
    if (allItems.length) loadSocialStats(allItems, currentUserId);
  }, [textPosts, videos, photos, currentUserId, loadSocialStats]);

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

  /* UPLOAD & PUBLISH */
  async function upload() {
    if (uploading) return;

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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Please login to post.");

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

      let metadataEndpoint = "/api/social/texts/metadata";
      let payload: any = {
        title: title.trim() || null,
        text_content: textContent.trim() || null,
        media_type: file ? detectMediaKind(file) : null,
        telegram_chat_id: storageData?.telegram_chat_id || null,
        telegram_file_id: storageData?.telegram_file_id || null,
        telegram_message_id: storageData?.telegram_message_id || null,
        mime_type: file?.type || null,
        original_filename: file?.name || null,
        file_size: file?.size || null,
      };

      if (activeTab === "videos") {
        metadataEndpoint = "/api/social/videos/metadata";
        payload = {
          title: title.trim() || file?.name,
          caption: caption.trim() || null,
          telegram_chat_id: storageData?.telegram_chat_id || null,
          telegram_file_id: storageData?.telegram_file_id || null,
          telegram_message_id: storageData?.telegram_message_id || null,
          mime_type: file?.type || null,
          original_filename: file?.name || null,
          file_size: file?.size || null,
        };
      } else if (activeTab === "photos") {
        metadataEndpoint = "/api/social/photos/metadata";
        payload = {
          title: title.trim() || file?.name,
          caption: caption.trim() || null,
          telegram_chat_id: storageData?.telegram_chat_id || null,
          telegram_file_id: storageData?.telegram_file_id || null,
          telegram_message_id: storageData?.telegram_message_id || null,
          mime_type: file?.type || null,
          original_filename: file?.name || null,
          file_size: file?.size || null,
        };
      }

      const res = await fetch(metadataEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${session.access_token}` },
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
      await loadFeed();
    } catch (err: any) {
      setError(err.message || "Failed to publish post.");
    } finally {
      setUploading(false);
    }
  }

  /* DELETE */
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

  /* REACTION HANDLER */
  async function setReaction(postId: string, reaction: ReactionType | null) {
    if (!currentUserId) { setActionError("Please login to react."); return; }
    const previous = currentReactions[postId] ?? null;

    setCurrentReactions((prev) => ({ ...prev, [postId]: reaction }));
    setLikeCounts((prev) => ({
      ...prev,
      [postId]: Math.max(0, (prev[postId] ?? 0) + (previous ? 0 : 1) - (reaction ? 0 : 1)),
    }));
    setOpenReactionId(null);

    const result = reaction
      ? await supabase.from("social_likes").upsert({ video_id: postId, user_id: currentUserId, reaction }, { onConflict: "video_id,user_id" })
      : await supabase.from("social_likes").delete().eq("video_id", postId).eq("user_id", currentUserId);

    if (result.error) setActionError(result.error.message);
  }

  function toggleLike(postId: string) {
    const current = currentReactions[postId];
    setReaction(postId, current ? null : "like");
  }

  /* COMMENTS HANDLER */
  async function toggleComments(postId: string) {
    if (openComments === postId) {
      setOpenComments(null);
      return;
    }
    setOpenComments(postId);

    const { data } = await supabase
      .from("social_comments")
      .select("id,video_id,user_id,body,created_at")
      .eq("video_id", postId)
      .order("created_at", { ascending: true });

    setComments((prev) => ({ ...prev, [postId]: (data ?? []) as CommentRow[] }));
  }

  async function addComment(postId: string) {
    const body = commentDraft.trim();
    if (!body || commentLoading || !currentUserId) return;

    setCommentLoading(true);
    const { data, error: insertError } = await supabase
      .from("social_comments")
      .insert({ video_id: postId, user_id: currentUserId, body })
      .select()
      .single();

    if (!insertError && data) {
      setComments((prev) => ({ ...prev, [postId]: [...(prev[postId] ?? []), data as CommentRow] }));
      setCommentCounts((prev) => ({ ...prev, [postId]: (prev[postId] ?? 0) + 1 }));
      setCommentDraft("");
    }
    setCommentLoading(false);
  }

  /* SHARE HANDLER */
  async function sharePost(postId: string) {
    const url = `${window.location.origin}/?socialPost=${encodeURIComponent(postId)}`;
    if (navigator.share) {
      await navigator.share({ title: "Social Hub Post", url });
    } else {
      await navigator.clipboard.writeText(url);
      setActionError("Link copied to clipboard!");
      setTimeout(() => setActionError(""), 2000);
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8 font-sans">
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
              className="w-full rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white placeholder-white/30 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition"
            />
          )}

          {/* DRAG AND DROP FILE ZONE */}
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
              <p className="text-xs font-medium text-white/50">✦ Drag & drop or <span className="text-cyan-400 underline">Browse File</span> (Photo, Video, PDF, Voice)</p>
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

      {/* TABS */}
      <div className="mt-8 flex items-center gap-2 border-b border-white/10 pb-3">
        {(["text", "videos", "photos"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-xl px-5 py-2 text-xs font-bold capitalize transition ${
              activeTab === tab ? "bg-white text-black shadow-lg" : "text-white/40 hover:text-white"
            }`}
          >
            {tab} Feed
          </button>
        ))}
      </div>

      {/* FEED LIST */}
      {loading ? (
        <div className="mt-6 space-y-4">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-32 animate-pulse rounded-2xl bg-white/5" />
          ))}
        </div>
      ) : activeTab === "text" ? (
        <div className="mt-6 space-y-4">
          {textPosts.length === 0 ? (
            <div className="py-12 text-center text-xs text-white/30">No text posts found.</div>
          ) : (
            textPosts.map((post) => {
              const author = authors[post.user_id];
              const streamUrl = post.telegram_file_id
                ? `/api/social/${post.media_type === "video" ? "videos" : "photos"}/stream?fileId=${encodeURIComponent(post.telegram_file_id)}`
                : null;

              return (
                <article key={post.id} className="relative rounded-2xl border border-white/10 bg-[#0c0f17] p-5 shadow-xl transition hover:border-white/20">
                  {/* AUTHOR ROW */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button onClick={() => onViewProfile?.(post.user_id)} className="h-10 w-10 overflow-hidden rounded-xl bg-white/10 flex items-center justify-center font-bold text-white text-xs">
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

                  {/* POST CONTENT */}
                  {post.title && <h3 className="mt-4 text-base font-bold text-white">{post.title}</h3>}
                  {post.text_content && <p className="mt-2 text-xs leading-relaxed text-white/80 whitespace-pre-line">{post.text_content}</p>}

                  {/* ATTACHED MEDIA */}
                  {streamUrl && (
                    <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/50">
                      {post.media_type === "photo" && <img src={streamUrl} alt="" className="max-h-96 w-full object-cover" />}
                      {post.media_type === "video" && <video src={streamUrl} controls className="max-h-96 w-full" />}
                      {post.media_type === "voice" && <audio src={streamUrl} controls className="w-full p-2" />}
                      {post.media_type === "pdf" && (
                        <div className="p-4 text-xs text-white/80 flex items-center justify-between">
                          <span>📄 Attached PDF Document</span>
                          <a href={streamUrl} download className="rounded-lg bg-cyan-500/20 px-3 py-1.5 font-bold text-cyan-400 hover:bg-cyan-500/30">Download</a>
                        </div>
                      )}
                    </div>
                  )}

                  {/* INTERACTIONS BAR */}
                  <div className="relative mt-4 flex items-center gap-4 border-t border-white/5 pt-3 text-xs text-white/50">
                    {/* EMOJI PICKER POPUP */}
                    {openReactionId === post.id && (
                      <div className="absolute -top-12 left-0 flex gap-2 rounded-2xl border border-white/10 bg-[#161b26] p-2 shadow-2xl backdrop-blur-xl">
                        {REACTIONS.map((r) => (
                          <button key={r.key} onClick={() => setReaction(post.id, r.key)} className="text-lg transition hover:scale-125">
                            {r.emoji}
                          </button>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => toggleLike(post.id)}
                      onMouseEnter={() => setOpenReactionId(post.id)}
                      className="flex items-center gap-1.5 hover:text-white"
                    >
                      <span>{currentReactions[post.id] ? REACTIONS.find(r=>r.key === currentReactions[post.id])?.emoji : "👍"}</span>
                      <span>{likeCounts[post.id] || 0}</span>
                    </button>

                    <button onClick={() => toggleComments(post.id)} className="flex items-center gap-1.5 hover:text-white">
                      💬 <span>{commentCounts[post.id] || 0}</span>
                    </button>

                    <button onClick={() => sharePost(post.id)} className="ml-auto hover:text-white">↗ Share</button>
                  </div>

                  {/* COMMENTS SECTION */}
                  {openComments === post.id && (
                    <div className="mt-4 border-t border-white/5 pt-3 space-y-3">
                      <div className="max-h-48 overflow-y-auto space-y-2">
                        {(comments[post.id] ?? []).map((c) => (
                          <div key={c.id} className="rounded-xl bg-white/5 p-2.5 text-xs text-white/80">
                            <p className="text-[10px] font-bold text-cyan-400">{timeAgo(c.created_at)}</p>
                            <p className="mt-1">{c.body}</p>
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-2">
                        <input
                          value={commentDraft}
                          onChange={(e) => setCommentDraft(e.target.value)}
                          placeholder="Write a comment..."
                          className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-500/50"
                        />
                        <button
                          onClick={() => addComment(post.id)}
                          disabled={commentLoading}
                          className="rounded-xl bg-white px-4 py-1.5 text-xs font-bold text-black hover:bg-white/90"
                        >
                          Send
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      ) : activeTab === "videos" ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {videos.map((video) => {
            const streamUrl = video.telegram_file_id ? `/api/social/videos/stream?fileId=${encodeURIComponent(video.telegram_file_id)}` : null;
            return (
              <article key={video.id} className="rounded-2xl border border-white/10 bg-[#0c0f17] p-3 shadow-xl">
                <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
                  {streamUrl ? <video src={streamUrl} controls className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-white/30">Video stream error</div>}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white truncate">{video.title || "Untitled Video"}</h4>
                  {video.user_id === currentUserId && (
                    <button onClick={() => deletePost(video.id, "video")} className="text-xs text-red-400 hover:underline">Delete</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {photos.map((photo) => {
            const streamUrl = photo.telegram_file_id ? `/api/social/photos/stream?fileId=${encodeURIComponent(photo.telegram_file_id)}` : null;
            return (
              <article key={photo.id} className="rounded-2xl border border-white/10 bg-[#0c0f17] p-3 shadow-xl">
                <div className="aspect-square w-full overflow-hidden rounded-xl bg-black">
                  {streamUrl ? <img src={streamUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-white/30">Photo stream error</div>}
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
      )}

      {/* TOAST NOTIFICATION */}
      {actionError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-2xl border border-white/10 bg-[#161b26]/90 px-5 py-2.5 text-xs font-bold text-white shadow-2xl backdrop-blur-xl">
          {actionError}
        </div>
      )}
    </section>
  );
}