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
      info.avatar_telegram_file_id,
    )}`;
  }
  return info.avatar_url;
}

function authorDisplayName(info: AuthorInfo | undefined) {
  const displayName = info?.display_name?.trim() || "";
  const name = info?.name?.trim() || "";

  if (displayName && !displayName.includes("@")) return displayName;
  if (name && !name.includes("@")) return name;

  return "Unnamed user";
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );

  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/*
 * Some browsers/OS combinations (screenshots, certain
 * drag-and-drop or clipboard sources) leave `file.type`
 * empty, which previously caused photos to be misclassified
 * as videos. Fall back to the file extension when the MIME
 * type is missing or ambiguous.
 */
const PHOTO_EXTENSIONS = [
  "heic",
  "heif",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "bmp",
];

const VIDEO_EXTENSIONS = [
  "mp4",
  "mov",
  "webm",
  "mkv",
  "avi",
  "m4v",
  "3gp",
];

function detectMediaKind(
  file: File,
): "photo" | "video" | null {
  if (file.type.startsWith("image/")) return "photo";
  if (file.type.startsWith("video/")) return "video";

  const ext =
    file.name.split(".").pop()?.toLowerCase() ?? "";

  if (PHOTO_EXTENSIONS.includes(ext)) return "photo";
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";

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
  const reelsContainerRef = useRef<HTMLDivElement>(null);
  const reelVideoRefs = useRef<Map<number, HTMLVideoElement>>(
    new Map(),
  );

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

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"videos" | "photos">("videos");

  const [reelsOpen, setReelsOpen] = useState(false);
  const [activeReelIndex, setActiveReelIndex] = useState(0);

  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [currentReactions, setCurrentReactions] = useState<
    Record<string, ReactionType | null>
  >({});
  const [reactionCounts, setReactionCounts] = useState<
    Record<string, Record<ReactionType, number>>
  >({});
  const [openReactionId, setOpenReactionId] = useState<string | null>(null);
  const [loadingMoreVideos, setLoadingMoreVideos] = useState(false);
  const [loadingMorePhotos, setLoadingMorePhotos] = useState(false);
  const [hasMoreVideos, setHasMoreVideos] = useState(false);
  const [hasMorePhotos, setHasMorePhotos] = useState(false);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>(
    {},
  );

  const [authors, setAuthors] = useState<Record<string, AuthorInfo>>({});

  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, CommentRow[]>>({});
  const [commentDraft, setCommentDraft] = useState("");

  const [commentLoading, setCommentLoading] = useState(false);
  const [actionError, setActionError] = useState("");

  /*
   * ---------------------------------------------------------
   * LOAD FEED
   * ---------------------------------------------------------
   */

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
        .limit(PAGE_SIZE + 1),

      supabase
        .from("social_photos")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE + 1),
    ]);

    if (videoError) console.error("Social video feed error:", videoError);
    if (photoError) console.error("Social photo feed error:", photoError);

    const nextVideos = (videoData ?? []) as SocialVideo[];
    const nextPhotos = (photoData ?? []) as SocialPhoto[];

    setVideos(nextVideos.slice(0, PAGE_SIZE));
    setPhotos(nextPhotos.slice(0, PAGE_SIZE));
    setHasMoreVideos(nextVideos.length > PAGE_SIZE);
    setHasMorePhotos(nextPhotos.length > PAGE_SIZE);

    if (videoError && photoError) setError(videoError.message);
    setLoading(false);
  }, []);

  const loadMoreVideos = useCallback(async () => {
    if (loadingMoreVideos || !hasMoreVideos) return;
    setLoadingMoreVideos(true);

    const { data, error: queryError } = await supabase
      .from("social_videos")
      .select("*")
      .order("created_at", { ascending: false })
      .range(videos.length, videos.length + PAGE_SIZE);

    if (queryError) {
      setActionError(queryError.message);
    } else {
      const incoming = (data ?? []) as SocialVideo[];
      setVideos((prev) => [...prev, ...incoming.slice(0, PAGE_SIZE)]);
      setHasMoreVideos(incoming.length > PAGE_SIZE);
    }

    setLoadingMoreVideos(false);
  }, [hasMoreVideos, loadingMoreVideos, videos.length]);

  const loadMorePhotos = useCallback(async () => {
    if (loadingMorePhotos || !hasMorePhotos) return;
    setLoadingMorePhotos(true);

    const { data, error: queryError } = await supabase
      .from("social_photos")
      .select("*")
      .order("created_at", { ascending: false })
      .range(photos.length, photos.length + PAGE_SIZE);

    if (queryError) {
      setActionError(queryError.message);
    } else {
      const incoming = (data ?? []) as SocialPhoto[];
      setPhotos((prev) => [...prev, ...incoming.slice(0, PAGE_SIZE)]);
      setHasMorePhotos(incoming.length > PAGE_SIZE);
    }

    setLoadingMorePhotos(false);
  }, [hasMorePhotos, loadingMorePhotos, photos.length]);

  /*
   * ---------------------------------------------------------
   * AUTHORS (name + avatar for every post, so the feed shows
   * who posted it and it's visibly clickable — before this,
   * every card just showed an unlabeled "U" circle with no
   * way to tell it opened a profile).
   * ---------------------------------------------------------
   */

  const loadAuthors = useCallback(
    async (items: { user_id: string }[]) => {
      const ids = Array.from(
        new Set(items.map((item) => item.user_id).filter(Boolean)),
      );

      if (!ids.length) return;

      const { data, error: profilesError } = await supabase
        .from("profiles")
        .select("id,name,display_name,avatar_url,avatar_telegram_file_id")
        .in("id", ids);

      if (profilesError) {
        console.error("Social authors fetch error:", profilesError);
        return;
      }

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
    },
    [],
  );

  useEffect(() => {
    if (videos.length || photos.length) {
      loadAuthors([...videos, ...photos]);
    }
  }, [videos, photos, loadAuthors]);

  /*
   * ---------------------------------------------------------
   * USER
   * ---------------------------------------------------------
   */

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

  /*
   * ---------------------------------------------------------
   * SOCIAL STATS
   * ---------------------------------------------------------
   */

  const loadSocialStats = useCallback(
    async (items: SocialVideo[], userId: string | null) => {
      if (!items.length) return;

      const ids = items.map((item) => item.id);

      const [{ data: likes, error: likesError }, { data: commentsData }] =
        await Promise.all([
          supabase
            .from("social_likes")
            .select("video_id,user_id,reaction")
            .in("video_id", ids),
          supabase
            .from("social_comments")
            .select("video_id")
            .in("video_id", ids),
        ]);

      if (likesError) {
        console.error("Social reaction stats error:", likesError);
        return;
      }

      const nextLikes: Record<string, number> = {};
      const nextComments: Record<string, number> = {};
      const nextReactionCounts: Record<string, Record<ReactionType, number>> = {};
      const nextMine: Record<string, ReactionType | null> = {};

      for (const id of ids) {
        nextLikes[id] = 0;
        nextComments[id] = 0;
        nextReactionCounts[id] = { like: 0, love: 0, haha: 0, wow: 0, angry: 0 };
        nextMine[id] = null;
      }

      for (const row of likes ?? []) {
        const reaction: ReactionType = REACTIONS.some((item) => item.key === row.reaction)
          ? row.reaction
          : "like";
        nextLikes[row.video_id] = (nextLikes[row.video_id] ?? 0) + 1;
        nextReactionCounts[row.video_id][reaction] += 1;
        if (userId && row.user_id === userId) nextMine[row.video_id] = reaction;
      }

      for (const row of commentsData ?? []) {
        nextComments[row.video_id] = (nextComments[row.video_id] ?? 0) + 1;
      }

      setLikeCounts(nextLikes);
      setCommentCounts(nextComments);
      setLikedIds(
        new Set(
          Object.entries(nextMine)
            .filter(([, reaction]) => Boolean(reaction))
            .map(([id]) => id),
        ),
      );
      setCurrentReactions(nextMine);
      setReactionCounts(nextReactionCounts);
    },
    [],
  );

  useEffect(() => {
    if (videos.length) loadSocialStats(videos, currentUserId);
  }, [videos, currentUserId, loadSocialStats]);

  /*
   * ---------------------------------------------------------
   * FILE PICKER / DRAG & DROP
   * ---------------------------------------------------------
   */

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
      setError("Please choose a supported photo or video file.");
      return;
    }

    if (nextFile.size > 20 * 1024 * 1024) {
      setFile(null);
      setError("File is too large. Maximum size is 20 MB.");
      return;
    }

    setError("");
    setProgress(0);
    setFile(nextFile);
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);

    if (uploading) return;
    chooseFile(event.dataTransfer.files?.[0] ?? null);
  }

  /*
   * ---------------------------------------------------------
   * UPLOAD
   * ---------------------------------------------------------
   */

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
        throw new Error("Please login before uploading.");
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

      const isPhoto = detectMediaKind(file) === "photo";

      const formData = new FormData();

      formData.append(
        isPhoto ? "photo" : "video",
        file,
        file.name,
      );

      formData.append(
        "title",
        title.trim() ||
          file.name.replace(/\.[^.]+$/, ""),
      );

      if (caption.trim()) {
        formData.append("caption", caption.trim());
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
              Math.round((event.loaded / event.total) * 100),
            );
          }
        };

        xhr.onload = async () => {
          try {
            let data = xhr.response;

            if (!data && xhr.responseText) {
              try {
                data = JSON.parse(xhr.responseText);
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

            if (!data.storage?.telegram_file_id) {
              reject(
                new Error(
                  "Telegram upload succeeded but no telegram_file_id was returned.",
                ),
              );

              return;
            }

            /*
             * Photo and video use separate Supabase metadata routes.
             */

            const metadataEndpoint = isPhoto
              ? "/api/social/photos/metadata"
              : "/api/social/videos/metadata";

            const metadataResponse = await fetch(
              metadataEndpoint,
              {
                method: "POST",

                headers: {
                  "content-type": "application/json",
                  Authorization: `Bearer ${session.access_token}`,
                },

                body: JSON.stringify({
                  title:
                    title.trim() ||
                    file.name.replace(/\.[^.]+$/, ""),

                  caption:
                    caption.trim() || null,

                  storage: data.storage,
                }),
              },
            );

            let metadata: any = null;

            try {
              metadata = await metadataResponse.json();
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
                    "Telegram upload completed, but metadata could not be saved.",
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
              "Network error while uploading to Telegram Worker.",
            ),
          );
        };

        xhr.onabort = () => {
          reject(new Error("Upload cancelled."));
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
      console.error("Social upload error:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Upload failed.",
      );
    } finally {
      setUploading(false);
    }
  }

  /*
   * ---------------------------------------------------------
   * REELS
   * ---------------------------------------------------------
   */

  function openReels(index: number) {
    setActiveReelIndex(index);
    setReelsOpen(true);
    document.body.style.overflow = "hidden";
  }

  function closeReels() {
    setReelsOpen(false);
    document.body.style.overflow = "";
  }

  function goToReel(index: number) {
    if (!videos.length) return;

    const nextIndex = Math.max(
      0,
      Math.min(index, videos.length - 1),
    );

    setActiveReelIndex(nextIndex);

    requestAnimationFrame(() => {
      const container = reelsContainerRef.current;

      if (!container) return;

      const target = container.children[
        nextIndex
      ] as HTMLElement | undefined;

      target?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  useEffect(() => {
    if (!reelsOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeReels();
      }

      if (
        event.key === "ArrowDown" ||
        event.key === "PageDown"
      ) {
        event.preventDefault();
        goToReel(activeReelIndex + 1);
      }

      if (
        event.key === "ArrowUp" ||
        event.key === "PageUp"
      ) {
        event.preventDefault();
        goToReel(activeReelIndex - 1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [reelsOpen, activeReelIndex]);

  useEffect(() => {
    if (!reelsOpen) return;

    const container = reelsContainerRef.current;

    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) =>
              b.intersectionRatio -
              a.intersectionRatio,
          )[0];

        if (!visible) return;

        const index = Array.from(
          container.children,
        ).indexOf(visible.target);

        if (index >= 0) {
          setActiveReelIndex(index);
        }
      },
      {
        root: container,
        threshold: [0.6, 0.8],
      },
    );

    Array.from(container.children).forEach((child) => {
      observer.observe(child);
    });

    return () => observer.disconnect();
  }, [reelsOpen, videos.length]);

  /*
   * Only the active reel should ever be playing. Without this,
   * scrolling to the next reel leaves the previous video's
   * audio/playback running underneath the new one.
   */
  useEffect(() => {
    if (!reelsOpen) return;

    reelVideoRefs.current.forEach((videoEl, index) => {
      if (index === activeReelIndex) {
        videoEl.play().catch(() => {
          /* Autoplay can be rejected by the browser; ignore. */
        });
      } else {
        videoEl.pause();
        videoEl.currentTime = 0;
      }
    });
  }, [reelsOpen, activeReelIndex]);

  useEffect(() => {
    if (reelsOpen) return;

    reelVideoRefs.current.forEach((videoEl) => {
      videoEl.pause();
    });
  }, [reelsOpen]);

  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  /*
   * ---------------------------------------------------------
   * LIKES
   * ---------------------------------------------------------
   */

  async function setReaction(videoId: string, reaction: ReactionType | null) {
    setActionError("");

    if (!currentUserId) {
      setActionError("Please login to react.");
      return;
    }

    const previous = currentReactions[videoId] ?? null;
    if (previous === reaction) {
      setOpenReactionId(null);
      return;
    }

    setCurrentReactions((prev) => ({ ...prev, [videoId]: reaction }));
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (reaction) next.add(videoId);
      else next.delete(videoId);
      return next;
    });
    setLikeCounts((prev) => ({
      ...prev,
      [videoId]: Math.max(0, (prev[videoId] ?? 0) + (previous ? 0 : 1) - (reaction ? 0 : 1)),
    }));
    setReactionCounts((prev) => {
      const next = { ...prev, [videoId]: { ...(prev[videoId] ?? { like: 0, love: 0, haha: 0, wow: 0, angry: 0 }) } };
      if (previous) next[videoId][previous] = Math.max(0, next[videoId][previous] - 1);
      if (reaction) next[videoId][reaction] = next[videoId][reaction] + 1;
      return next;
    });
    setOpenReactionId(null);

    const result = reaction
      ? await supabase
          .from("social_likes")
          .upsert(
            { video_id: videoId, user_id: currentUserId, reaction },
            { onConflict: "video_id,user_id" },
          )
      : await supabase
          .from("social_likes")
          .delete()
          .eq("video_id", videoId)
          .eq("user_id", currentUserId);

    if (result.error) {
      setCurrentReactions((prev) => ({ ...prev, [videoId]: previous }));
      setLikedIds((prev) => {
        const next = new Set(prev);
        if (previous) next.add(videoId);
        else next.delete(videoId);
        return next;
      });
      setLikeCounts((prev) => ({
        ...prev,
        [videoId]: Math.max(
          0,
          (prev[videoId] ?? 0) +
            (previous ? (reaction ? 0 : 1) : reaction ? -1 : 0),
        ),
      }));
      setReactionCounts((prev) => {
        const next = { ...prev, [videoId]: { ...(prev[videoId] ?? { like: 0, love: 0, haha: 0, wow: 0, angry: 0 }) } };
        if (reaction) next[videoId][reaction] = Math.max(0, next[videoId][reaction] - 1);
        if (previous) next[videoId][previous] += 1;
        return next;
      });
      setActionError(result.error.message);
    }
  }

  async function toggleLike(videoId: string) {
    const current = currentReactions[videoId] ?? null;
    await setReaction(videoId, current === "like" ? null : "like");
  }

  /*
   * ---------------------------------------------------------
   * COMMENTS
   * ---------------------------------------------------------
   */

  async function loadComments(videoId: string) {
    const { data, error: queryError } =
      await supabase
        .from("social_comments")
        .select(
          "id,video_id,user_id,body,created_at",
        )
        .eq("video_id", videoId)
        .order("created_at", {
          ascending: true,
        })
        .limit(50);

    if (queryError) {
      setActionError(queryError.message);
      return;
    }

    setComments((prev) => ({
      ...prev,
      [videoId]: (data ?? []) as CommentRow[],
    }));
  }

  async function toggleComments(videoId: string) {
    setActionError("");

    if (openComments === videoId) {
      setOpenComments(null);
      return;
    }

    setOpenComments(videoId);

    await loadComments(videoId);
  }

  async function addComment(videoId: string) {
    const body = commentDraft.trim();

    if (!body || commentLoading) return;

    if (!currentUserId) {
      setActionError("Please login to comment.");
      return;
    }

    setCommentLoading(true);
    setActionError("");

    const { data, error: insertError } =
      await supabase
        .from("social_comments")
        .insert({
          video_id: videoId,
          user_id: currentUserId,
          body,
        })
        .select(
          "id,video_id,user_id,body,created_at",
        )
        .single();

    if (insertError) {
      setActionError(insertError.message);
    } else if (data) {
      setComments((prev) => ({
        ...prev,
        [videoId]: [
          ...(prev[videoId] ?? []),
          data as CommentRow,
        ],
      }));

      setCommentCounts((prev) => ({
        ...prev,
        [videoId]:
          (prev[videoId] ?? 0) + 1,
      }));

      setCommentDraft("");
    }

    setCommentLoading(false);
  }

  /*
   * ---------------------------------------------------------
   * SHARE
   * ---------------------------------------------------------
   */

  async function shareVideo(videoId: string) {
    setActionError("");

    const url =
      `${window.location.origin}/?socialVideo=` +
      encodeURIComponent(videoId);

    try {
      if (navigator.share) {
        await navigator.share({
          title: "Track Social",
          text: "Check out this video",
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);

        setActionError("Link copied to clipboard.");

        window.setTimeout(
          () => setActionError(""),
          1800,
        );
      }

      if (currentUserId) {
        await supabase.from("social_shares").insert({
          video_id: videoId,
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

      console.error("Share error:", err);
    }
  }

  /*
   * ---------------------------------------------------------
   * SELECTED FILE META
   * ---------------------------------------------------------
   */

  const selectedMeta = useMemo(() => {
    if (!file) return null;

    const typeSuffix = file.type.split("/").pop();
    const ext = file.name.split(".").pop()?.toLowerCase();

    return {
      size: formatBytes(file.size),
      kind: typeSuffix || ext || "file",
    };
  }, [file]);

  /*
   * ---------------------------------------------------------
   * RENDER
   * ---------------------------------------------------------
   */

  return (
    <>
      <section className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        {/* HERO / COMMAND CENTER */}
        <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[#090b12] shadow-[0_30px_100px_rgba(0,0,0,0.35)]">
          <div className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-[var(--accent)]/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
          <div className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,.7) 1px, transparent 1px)", backgroundSize: "24px 24px" }} />

          <div className="relative p-5 sm:p-8 lg:p-10">
            <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.8)]" />
                  Personal social hub
                </div>
                <h1 className="text-4xl font-black tracking-[-0.04em] text-white sm:text-6xl">
                  Your <span className="bg-gradient-to-r from-white via-white to-white/40 bg-clip-text text-transparent">moments</span>.
                </h1>
                <p className="mt-4 max-w-xl text-sm leading-6 text-white/45 sm:text-base">
                  Share the clips and photos you actually want to keep around. Fast, clean and built for your personal feed.
                </p>
              </div>

              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 text-sm font-black text-black shadow-lg transition hover:-translate-y-0.5 hover:bg-white/90"
              >
                <span className="text-xl leading-none transition group-hover:rotate-90">+</span>
                Create post
              </button>
            </div>

            <div className={`mt-8 rounded-[24px] border p-4 sm:p-5 transition ${dragging ? "border-[var(--accent)]/60 bg-[var(--accent)]/10" : "border-white/10 bg-black/25"}`}>
              <div
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className="cursor-pointer rounded-[20px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-7 transition hover:border-white/20 hover:bg-white/[0.035] sm:px-6"
              >
                <input ref={inputRef} type="file" accept="video/*,image/*" onChange={handleInput} className="hidden" />
                {!file ? (
                  <div className="flex flex-col items-center text-center">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-2xl shadow-inner">✦</div>
                    <h2 className="text-sm font-extrabold text-white sm:text-base">Drop a photo or video here</h2>
                    <p className="mt-1 text-xs text-white/35">or click anywhere to browse · up to 20 MB</p>
                  </div>
                ) : (
                  <div onClick={(event) => event.stopPropagation()}>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-black">
                        {detectMediaKind(file) === "video" ? <video src={URL.createObjectURL(file)} className="h-full w-full object-cover" muted playsInline /> : <img src={URL.createObjectURL(file)} alt="" className="h-full w-full object-cover" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-white">{file.name}</p>
                        <p className="mt-1 text-xs text-white/35">Ready to publish</p>
                        {uploading && <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-white transition-all" style={{ width: `${progress}%` }} /></div>}
                      </div>
                      {!uploading && <button type="button" onClick={() => chooseFile(null)} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-white/50 transition hover:bg-white/10 hover:text-white">Remove</button>}
                    </div>
                    <div className="mt-5 grid gap-3 md:grid-cols-[1fr_1.5fr_auto]">
                      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Give it a title" className="h-12 rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-[var(--accent)]/50" />
                      <input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Add a caption..." className="h-12 rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none placeholder:text-white/25 focus:border-[var(--accent)]/50" />
                      <button type="button" disabled={uploading} onClick={upload} className="h-12 rounded-2xl bg-white px-6 text-sm font-black text-black transition hover:bg-white/90 disabled:opacity-50">{uploading ? `Publishing ${progress}%` : "Publish"}</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {error && <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
          </div>
        </div>

        {/* FEED TOOLBAR */}
        <div className="mt-10 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30">Latest activity</p>
            <h2 className="mt-1 text-2xl font-black tracking-[-0.03em] text-white sm:text-3xl">Your feed</h2>
          </div>
          <div className="flex w-full rounded-2xl border border-white/10 bg-white/[0.035] p-1 sm:w-auto">
            <button type="button" onClick={() => setActiveTab("videos")} className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition sm:min-w-32 ${activeTab === "videos" ? "bg-white text-black shadow-lg" : "text-white/40 hover:text-white"}`}>
              <span>Reels</span><span className={`rounded-full px-1.5 py-0.5 text-[9px] ${activeTab === "videos" ? "bg-black/10" : "bg-white/10"}`}>{videos.length}{hasMoreVideos ? "+" : ""}</span>
            </button>
            <button type="button" onClick={() => setActiveTab("photos")} className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition sm:min-w-32 ${activeTab === "photos" ? "bg-white text-black shadow-lg" : "text-white/40 hover:text-white"}`}>
              <span>Photos</span><span className={`rounded-full px-1.5 py-0.5 text-[9px] ${activeTab === "photos" ? "bg-black/10" : "bg-white/10"}`}>{photos.length}{hasMorePhotos ? "+" : ""}</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => <div key={index} className="overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0d14]"><div className="aspect-video animate-pulse bg-white/[0.04]" /><div className="space-y-3 p-5"><div className="h-4 w-1/2 animate-pulse rounded bg-white/[0.06]" /><div className="h-3 w-3/4 animate-pulse rounded bg-white/[0.04]" /><div className="h-10 animate-pulse rounded-2xl bg-white/[0.035]" /></div></div>)}
          </div>
        ) : activeTab === "videos" ? (
          videos.length === 0 ? (
            <div className="mt-6 rounded-[28px] border border-dashed border-white/10 bg-white/[0.02] px-6 py-20 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.05] text-xl">▶</div><h3 className="mt-5 text-xl font-black text-white">No reels yet</h3><p className="mx-auto mt-2 max-w-md text-sm text-white/35">Your first video will appear here.</p></div>
          ) : (
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              {videos.map((video, index) => {
                const streamUrl = video.telegram_file_id ? `/api/social/videos/stream?fileId=${encodeURIComponent(video.telegram_file_id)}` : null;
                const reaction = currentReactions[video.id] ?? null;
                const counts = reactionCounts[video.id] ?? { like: 0, love: 0, haha: 0, wow: 0, angry: 0 };
                const totalReactions = Object.values(counts).reduce((sum, value) => sum + value, 0);
                const cardComments = comments[video.id] ?? [];
                const isFeatured = index === 0;
                return (
                  <article key={video.id} className={`group relative overflow-visible rounded-[28px] border border-white/10 bg-[#0a0c12] shadow-[0_20px_60px_rgba(0,0,0,.22)] transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:shadow-[0_28px_80px_rgba(0,0,0,.35)] ${isFeatured ? "lg:col-span-2" : ""}`}>
                    <button type="button" onClick={() => openReels(index)} className={`relative block w-full overflow-hidden rounded-t-[28px] bg-black text-left ${isFeatured ? "aspect-[21/9]" : "aspect-video"}`}>
                      {streamUrl ? <video src={streamUrl} className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.035]" playsInline preload="metadata" muted /> : <div className="flex h-full items-center justify-center text-sm text-white/30">Video unavailable</div>}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                      <div className="absolute left-4 top-4 rounded-full border border-white/15 bg-black/35 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white/70 backdrop-blur-xl">Reel</div>
                      <div className="absolute bottom-4 left-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/20 bg-white/15 text-white backdrop-blur-xl transition group-hover:scale-105">▶</div>
                    </button>

                    <div className="p-5 sm:p-6">
                      <div className="flex items-start gap-3">
                        <button type="button" onClick={() => onViewProfile?.(video.user_id)} title={`View ${authorDisplayName(authors[video.user_id])}'s profile`} className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] text-xs font-black text-white transition hover:border-white/30 hover:scale-105">
                          {authorAvatarSrc(authors[video.user_id]) ? <img src={authorAvatarSrc(authors[video.user_id]) as string} alt="" className="h-full w-full object-cover" /> : authorDisplayName(authors[video.user_id]).charAt(0).toUpperCase()}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <button type="button" onClick={() => onViewProfile?.(video.user_id)} className="truncate text-xs font-extrabold text-white hover:underline">{authorDisplayName(authors[video.user_id])}</button>
                              <h3 className="mt-1 truncate text-lg font-black tracking-[-0.02em] text-white">{video.title || "Untitled post"}</h3>
                            </div>
                            <span className="shrink-0 rounded-full bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold text-white/30">{timeAgo(video.created_at)}</span>
                          </div>
                          {video.caption && <p className="mt-3 line-clamp-2 text-sm leading-6 text-white/45">{video.caption}</p>}
                        </div>
                      </div>

                      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-4">
                        <div className="relative">
                          <button type="button" onClick={() => setOpenReactionId(openReactionId === video.id ? null : video.id)} className={`inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-xs font-black transition ${reaction ? "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-white" : "border-white/10 bg-white/[0.035] text-white/50 hover:bg-white/[0.07] hover:text-white"}`}>
                            <span className="text-base">{REACTIONS.find((item) => item.key === reaction)?.emoji || "👍"}</span>
                            <span>{totalReactions}</span>
                            <span className="text-[10px] text-white/30">React</span>
                          </button>
                          {openReactionId === video.id && (
                            <div className="absolute bottom-full left-0 z-50 mb-2 flex items-center gap-1 rounded-2xl border border-white/10 bg-[#121521]/95 p-2 shadow-2xl backdrop-blur-2xl">
                              {REACTIONS.map((item) => <button key={item.key} type="button" title={item.label} onClick={() => setReaction(video.id, item.key)} className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl transition hover:scale-110 hover:bg-white/10 ${reaction === item.key ? "bg-white/10" : ""}`}>{item.emoji}</button>)}
                              {reaction && <button type="button" title="Remove reaction" onClick={() => setReaction(video.id, null)} className="ml-1 flex h-10 w-10 items-center justify-center rounded-xl border-l border-white/10 text-xs text-white/35 hover:text-white">×</button>}
                            </div>
                          )}
                        </div>
                        <button type="button" onClick={() => toggleComments(video.id)} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.035] px-3.5 py-2.5 text-xs font-black text-white/45 transition hover:bg-white/[0.07] hover:text-white">◌ {commentCounts[video.id] ?? 0}</button>
                        <button type="button" onClick={() => shareVideo(video.id)} className="ml-auto inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.035] px-3.5 py-2.5 text-xs font-black text-white/45 transition hover:bg-white/[0.07] hover:text-white">Share ↗</button>
                      </div>

                      {openComments === video.id && <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div className="max-h-56 space-y-2 overflow-y-auto pr-1">{cardComments.length === 0 ? <p className="py-4 text-center text-xs text-white/25">No comments yet.</p> : cardComments.map((comment) => <div key={comment.id} className="rounded-xl bg-white/[0.035] px-3 py-2.5"><div className="flex items-center justify-between gap-3"><span className="text-[11px] font-bold text-white/55">{comment.user_id === currentUserId ? "You" : "User"}</span><span className="text-[10px] text-white/20">{timeAgo(comment.created_at)}</span></div><p className="mt-1 text-xs leading-5 text-white/45">{comment.body}</p></div>)}</div>
                        <div className="mt-3 flex gap-2"><input value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addComment(video.id); }} placeholder="Write a comment..." className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-white outline-none placeholder:text-white/20 focus:border-[var(--accent)]/40" /><button type="button" disabled={commentLoading} onClick={() => addComment(video.id)} className="h-10 rounded-xl bg-white px-4 text-xs font-black text-black disabled:opacity-50">Post</button></div>
                      </div>}
                    </div>
                  </article>
                );
              })}
            </div>
          )
        ) : (
          photos.length === 0 ? (
            <div className="mt-6 rounded-[28px] border border-dashed border-white/10 bg-white/[0.02] px-6 py-20 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.05] text-xl">▧</div><h3 className="mt-5 text-xl font-black text-white">No photos yet</h3><p className="mx-auto mt-2 max-w-md text-sm text-white/35">Your first photo will appear here.</p></div>
          ) : (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {photos.map((photo) => {
                const streamUrl = photo.telegram_file_id ? `/api/social/photos/stream?fileId=${encodeURIComponent(photo.telegram_file_id)}` : null;
                return <article key={photo.id} className="group overflow-hidden rounded-[28px] border border-white/10 bg-[#0a0c12] shadow-[0_20px_60px_rgba(0,0,0,.2)] transition duration-300 hover:-translate-y-1 hover:border-white/20">
                  <div className="relative aspect-[4/5] overflow-hidden bg-black">
                    {streamUrl ? <img src={streamUrl} alt={photo.title || "Social photo"} className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" loading="lazy" /> : <div className="flex h-full items-center justify-center text-sm text-white/30">Photo unavailable</div>}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/10" />
                    <div className="absolute left-3 top-3"><button type="button" onClick={() => onViewProfile?.(photo.user_id)} title={`View ${authorDisplayName(authors[photo.user_id])}'s profile`} className="flex items-center gap-2 rounded-full border border-white/15 bg-black/35 py-1.5 pl-1.5 pr-3 backdrop-blur-xl transition hover:border-white/30">
                      <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-white/10 text-[10px] font-black text-white">{authorAvatarSrc(authors[photo.user_id]) ? <img src={authorAvatarSrc(authors[photo.user_id]) as string} alt="" className="h-full w-full object-cover" /> : authorDisplayName(authors[photo.user_id]).charAt(0).toUpperCase()}</span>
                      <span className="max-w-[8rem] truncate text-xs font-extrabold text-white">{authorDisplayName(authors[photo.user_id])}</span>
                    </button></div>
                    <div className="absolute inset-x-0 bottom-0 p-5 pt-20"><div className="flex items-end justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-lg font-black text-white">{photo.title || "Untitled photo"}</h3>{photo.caption && <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/60">{photo.caption}</p>}</div><span className="shrink-0 rounded-full bg-black/30 px-2.5 py-1 text-[10px] font-bold text-white/45 backdrop-blur">{timeAgo(photo.created_at)}</span></div></div>
                  </div>
                </article>;
              })}
            </div>
          )
        )}

        {!loading && activeTab === "videos" && hasMoreVideos && <div className="mt-8 flex justify-center"><button type="button" onClick={loadMoreVideos} disabled={loadingMoreVideos} className="rounded-2xl border border-white/10 bg-white/[0.045] px-6 py-3 text-xs font-black text-white transition hover:-translate-y-0.5 hover:bg-white/[0.08] disabled:opacity-50">{loadingMoreVideos ? "Loading 25 more…" : "Load 25 more reels ↓"}</button></div>}
        {!loading && activeTab === "photos" && hasMorePhotos && <div className="mt-8 flex justify-center"><button type="button" onClick={loadMorePhotos} disabled={loadingMorePhotos} className="rounded-2xl border border-white/10 bg-white/[0.045] px-6 py-3 text-xs font-black text-white transition hover:-translate-y-0.5 hover:bg-white/[0.08] disabled:opacity-50">{loadingMorePhotos ? "Loading 25 more…" : "Load 25 more photos ↓"}</button></div>}
      </section>

      {/* REELS VIEWER */}
      {reelsOpen && videos.length > 0 && <div className="fixed inset-0 z-[9999] bg-black">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between bg-gradient-to-b from-black/85 via-black/30 to-transparent px-4 pb-16 pt-5 sm:px-8">
          <div className="pointer-events-auto">
            <button type="button" onClick={() => { const authorId = videos[activeReelIndex]?.user_id; closeReels(); if (authorId) onViewProfile?.(authorId); }} className="flex items-center gap-3 text-left text-sm font-black text-white">
              <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-white/15 bg-white/10 text-xs">{authorAvatarSrc(authors[videos[activeReelIndex]?.user_id ?? ""]) ? <img src={authorAvatarSrc(authors[videos[activeReelIndex]?.user_id ?? ""]) as string} alt="" className="h-full w-full object-cover" /> : authorDisplayName(authors[videos[activeReelIndex]?.user_id ?? ""]).charAt(0).toUpperCase()}</span>
              <span>{authorDisplayName(authors[videos[activeReelIndex]?.user_id ?? ""])}</span>
            </button>
            <p className="mt-2 max-w-md truncate text-sm font-bold text-white/80">{videos[activeReelIndex]?.title || "Untitled post"}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">{activeReelIndex + 1} / {videos.length}</p>
          </div>
          <button type="button" onClick={closeReels} className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-xl text-white backdrop-blur-xl transition hover:bg-white/20">×</button>
        </div>

        <div ref={reelsContainerRef} className="h-full w-full snap-y snap-mandatory overflow-y-auto overscroll-contain scroll-smooth" style={{ scrollbarWidth: "none" }}>
          {videos.map((video, index) => {
            const streamUrl = video.telegram_file_id ? `/api/social/videos/stream?fileId=${encodeURIComponent(video.telegram_file_id)}` : null;
            const reaction = currentReactions[video.id] ?? null;
            const counts = reactionCounts[video.id] ?? { like: 0, love: 0, haha: 0, wow: 0, angry: 0 };
            const shouldLoad = Math.abs(index - activeReelIndex) <= 1;
            return <section key={video.id} className="relative flex h-[100svh] w-full snap-start snap-always items-center justify-center overflow-hidden bg-black">
              {streamUrl && shouldLoad ? <video ref={(el) => { if (el) reelVideoRefs.current.set(index, el); else reelVideoRefs.current.delete(index); }} src={streamUrl} className="h-full w-full object-contain" controls playsInline preload={index === activeReelIndex ? "auto" : "metadata"} muted={false} loop /> : streamUrl ? <div className="h-full w-full bg-black" /> : <div className="text-sm text-white/40">Video unavailable</div>}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/20" />
              <div className="absolute bottom-8 left-4 right-20 z-10 max-w-xl sm:bottom-10 sm:left-[calc(50%-350px)]">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">{timeAgo(video.created_at)}</p>
                {video.caption && <p className="mt-2 line-clamp-4 text-sm leading-6 text-white/80 drop-shadow-lg">{video.caption}</p>}
              </div>
              <div className="absolute bottom-10 right-4 z-20 flex flex-col items-center gap-2 sm:right-[calc(50%-350px)]">
                <div className="relative">
                  <button type="button" onClick={() => setOpenReactionId(openReactionId === video.id ? null : video.id)} className={`flex h-14 w-14 flex-col items-center justify-center rounded-2xl border backdrop-blur-xl transition ${reaction ? "border-white/30 bg-white/15" : "border-white/15 bg-white/10"}`}><span className="text-xl">{REACTIONS.find((item) => item.key === reaction)?.emoji || "👍"}</span><span className="text-[9px] font-black text-white/70">{Object.values(counts).reduce((a,b) => a+b, 0)}</span></button>
                  {openReactionId === video.id && <div className="absolute bottom-0 right-full mr-2 flex items-center gap-1 rounded-2xl border border-white/10 bg-[#121521]/95 p-2 shadow-2xl backdrop-blur-2xl">{REACTIONS.map((item) => <button key={item.key} type="button" title={item.label} onClick={() => setReaction(video.id, item.key)} className="flex h-10 w-10 items-center justify-center rounded-xl text-xl transition hover:scale-110 hover:bg-white/10">{item.emoji}</button>)}</div>}
                </div>
                <button type="button" onClick={() => toggleComments(video.id)} className="flex h-14 w-14 flex-col items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white backdrop-blur-xl"><span className="text-lg">◌</span><span className="text-[9px] font-black">{commentCounts[video.id] ?? 0}</span></button>
                <button type="button" onClick={() => shareVideo(video.id)} className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white backdrop-blur-xl">↗</button>
              </div>
              <div className="absolute right-4 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-2 sm:flex"><button type="button" disabled={index === 0} onClick={() => goToReel(index - 1)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/30 text-white disabled:opacity-20">↑</button><button type="button" disabled={index === videos.length - 1} onClick={() => goToReel(index + 1)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/30 text-white disabled:opacity-20">↓</button></div>
            </section>;
          })}
        </div>
        {activeReelIndex === 0 && videos.length > 1 && <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full border border-white/10 bg-black/40 px-4 py-2 text-xs font-bold text-white/45 backdrop-blur-xl sm:hidden">Swipe up</div>}
      </div>}

      {actionError && <div className="fixed bottom-5 left-1/2 z-[10000] -translate-x-1/2 rounded-2xl border border-white/10 bg-[#111521]/95 px-4 py-3 text-xs font-bold text-white/80 shadow-2xl backdrop-blur-xl">{actionError}</div>}
    </>
  );
}
