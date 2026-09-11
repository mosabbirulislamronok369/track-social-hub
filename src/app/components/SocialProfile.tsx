"use client";

import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "../lib/supabase";

type ProfileRow = {
  id: string;
  name: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  avatar_telegram_file_id: string | null;
  avatar_mime_type: string | null;
};

type Post = {
  id: string;
  kind: "video" | "photo";
  user_id: string;
  title: string | null;
  caption: string | null;
  telegram_file_id: string | null;
  created_at: string;
};

type FollowUser = {
  id: string;
  display_name: string | null;
  name: string | null;
  avatar_url: string | null;
  avatar_telegram_file_id: string | null;
};

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

function isPhotoFile(file: File) {
  if (file.type) return file.type.startsWith("image/");

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  return PHOTO_EXTENSIONS.includes(ext);
}

function avatarSrc(row: {
  avatar_telegram_file_id: string | null;
  avatar_url: string | null;
}) {
  if (row.avatar_telegram_file_id) {
    return `/api/social/photos/stream?fileId=${encodeURIComponent(
      row.avatar_telegram_file_id,
    )}`;
  }

  return row.avatar_url;
}

type SocialProfileProps = {
  userId: string;
  onBack: () => void;
  onViewProfile?: (userId: string) => void;
};

export default function SocialProfile({
  userId,
  onBack,
  onViewProfile,
}: SocialProfileProps) {
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [currentUserId, setCurrentUserId] = useState<
    string | null
  >(null);

  const [profile, setProfile] = useState<ProfileRow | null>(
    null,
  );
  const [posts, setPosts] = useState<Post[]>([]);

  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  const [isEditingBio, setIsEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [savingBio, setSavingBio] = useState(false);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarProgress, setAvatarProgress] = useState(0);

  const [listModal, setListModal] = useState<
    "followers" | "following" | null
  >(null);
  const [listUsers, setListUsers] = useState<FollowUser[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const [openPost, setOpenPost] = useState<Post | null>(null);

  const isOwnProfile = currentUserId === userId;

  /*
   * ---------------------------------------------------------
   * CURRENT USER
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

  /*
   * ---------------------------------------------------------
   * LOAD PROFILE + POSTS + COUNTS
   * ---------------------------------------------------------
   */

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError("");

    const { data, error: profileError } = await supabase
      .from("profiles")
      .select(
        "id,name,display_name,bio,avatar_url,avatar_telegram_file_id,avatar_mime_type",
      )
      .eq("id", userId)
      .single();

    if (profileError) {
      setError(profileError.message);
      setLoading(false);
      return;
    }

    setProfile(data as ProfileRow);
    setBioDraft((data as ProfileRow)?.bio ?? "");
    setLoading(false);
  }, [userId]);

  const loadPosts = useCallback(async () => {
    const [
      { data: videoData, error: videoError },
      { data: photoData, error: photoError },
    ] = await Promise.all([
      supabase
        .from("social_videos")
        .select("id,user_id,title,caption,telegram_file_id,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),

      supabase
        .from("social_photos")
        .select("id,user_id,title,caption,telegram_file_id,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (videoError) console.error("Profile videos error:", videoError);
    if (photoError) console.error("Profile photos error:", photoError);

    const merged: Post[] = [
      ...(videoData ?? []).map((row) => ({
        ...row,
        kind: "video" as const,
      })),
      ...(photoData ?? []).map((row) => ({
        ...row,
        kind: "photo" as const,
      })),
    ].sort(
      (a, b) =>
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime(),
    );

    setPosts(merged);
  }, [userId]);

  const loadCounts = useCallback(async () => {
    const [followers, following, mine] = await Promise.all([
      supabase
        .from("social_follows")
        .select("follower_id", { count: "exact", head: true })
        .eq("following_id", userId),

      supabase
        .from("social_follows")
        .select("following_id", { count: "exact", head: true })
        .eq("follower_id", userId),

      currentUserId
        ? supabase
            .from("social_follows")
            .select("follower_id")
            .eq("follower_id", currentUserId)
            .eq("following_id", userId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    setFollowersCount(followers.count ?? 0);
    setFollowingCount(following.count ?? 0);
    setIsFollowing(Boolean((mine as any)?.data));
  }, [userId, currentUserId]);

  useEffect(() => {
    loadProfile();
    loadPosts();
  }, [loadProfile, loadPosts]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  /*
   * ---------------------------------------------------------
   * FOLLOW / UNFOLLOW
   * ---------------------------------------------------------
   */

  async function toggleFollow() {
    setActionError("");

    if (!currentUserId) {
      setActionError("Please login to follow people.");
      return;
    }

    if (followBusy || isOwnProfile) return;

    setFollowBusy(true);

    const wasFollowing = isFollowing;

    setIsFollowing(!wasFollowing);
    setFollowersCount((prev) =>
      Math.max(0, prev + (wasFollowing ? -1 : 1)),
    );

    const result = wasFollowing
      ? await supabase
          .from("social_follows")
          .delete()
          .eq("follower_id", currentUserId)
          .eq("following_id", userId)
      : await supabase.from("social_follows").insert({
          follower_id: currentUserId,
          following_id: userId,
        });

    if (result.error) {
      setIsFollowing(wasFollowing);
      setFollowersCount((prev) =>
        Math.max(0, prev + (wasFollowing ? 1 : -1)),
      );
      setActionError(result.error.message);
    }

    setFollowBusy(false);
  }

  /*
   * ---------------------------------------------------------
   * FOLLOWERS / FOLLOWING LIST
   * ---------------------------------------------------------
   */

  async function openList(kind: "followers" | "following") {
    setListModal(kind);
    setListLoading(true);
    setListUsers([]);

    const column =
      kind === "followers" ? "following_id" : "follower_id";
    const targetColumn =
      kind === "followers" ? "follower_id" : "following_id";

    const { data: followRows, error: followError } =
      await supabase
        .from("social_follows")
        .select(targetColumn)
        .eq(column, userId)
        .limit(200);

    if (followError || !followRows?.length) {
      setListLoading(false);
      return;
    }

    const ids = followRows.map(
      (row: any) => row[targetColumn],
    );

    const { data: profileRows } = await supabase
      .from("profiles")
      .select(
        "id,display_name,name,avatar_url,avatar_telegram_file_id",
      )
      .in("id", ids);

    setListUsers((profileRows ?? []) as FollowUser[]);
    setListLoading(false);
  }

  /*
   * ---------------------------------------------------------
   * BIO EDIT
   * ---------------------------------------------------------
   */

  async function saveBio() {
    if (!isOwnProfile || savingBio) return;

    setSavingBio(true);
    setActionError("");

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ bio: bioDraft.trim() || null })
      .eq("id", userId);

    if (updateError) {
      setActionError(updateError.message);
    } else {
      setProfile((prev) =>
        prev ? { ...prev, bio: bioDraft.trim() || null } : prev,
      );
      setIsEditingBio(false);
    }

    setSavingBio(false);
  }

  /*
   * ---------------------------------------------------------
   * AVATAR UPLOAD
   * ---------------------------------------------------------
   */

  function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;

    if (nextFile) uploadAvatar(nextFile);

    event.target.value = "";
  }

  async function uploadAvatar(file: File) {
    if (!isOwnProfile || avatarUploading) return;

    if (!isPhotoFile(file)) {
      setActionError("Please choose an image file for your avatar.");
      return;
    }

    setAvatarUploading(true);
    setAvatarProgress(0);
    setActionError("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please login before uploading.");
      }

      const uploadEndpoint =
        process.env.NEXT_PUBLIC_TELEGRAM_UPLOAD_URL;
      const uploadSecret =
        process.env.NEXT_PUBLIC_TELEGRAM_UPLOAD_SECRET;

      if (!uploadEndpoint || !uploadSecret) {
        throw new Error("Telegram upload is not configured.");
      }

      const formData = new FormData();
      formData.append("photo", file, file.name);
      formData.append("title", "avatar");

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
            setAvatarProgress(
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
                  "Upload succeeded but no telegram_file_id was returned.",
                ),
              );
              return;
            }

            const metadataResponse = await fetch(
              "/api/social/profile/avatar",
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ storage: data.storage }),
              },
            );

            let metadata: any = null;

            try {
              metadata = await metadataResponse.json();
            } catch {
              metadata = null;
            }

            if (!metadataResponse.ok || !metadata?.success) {
              reject(
                new Error(
                  metadata?.error ||
                    "Avatar uploaded, but profile could not be updated.",
                ),
              );
              return;
            }

            resolve();
          } catch (err) {
            reject(
              err instanceof Error
                ? err
                : new Error("Avatar upload failed."),
            );
          }
        };

        xhr.onerror = () =>
          reject(new Error("Network error while uploading."));

        xhr.send(formData);
      });

      await loadProfile();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Avatar upload failed.",
      );
    } finally {
      setAvatarUploading(false);
    }
  }

  const displayName = useMemo(() => {
    return (
      profile?.display_name ||
      profile?.name ||
      "Unnamed user"
    );
  }, [profile]);

  /*
   * ---------------------------------------------------------
   * RENDER
   * ---------------------------------------------------------
   */

  if (loading) {
    return (
      <section className="mx-auto w-full max-w-4xl px-4 pb-12 pt-6 sm:px-6 lg:px-8">
        <div className="h-40 animate-pulse rounded-2xl border border-white/[0.07] bg-white/[0.03]" />
      </section>
    );
  }

  if (error || !profile) {
    return (
      <section className="mx-auto w-full max-w-4xl px-4 pb-12 pt-6 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onBack}
          className="text-sm font-semibold text-white/50 hover:text-white"
        >
          ← Back to feed
        </button>

        <div className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.025] px-6 py-16 text-center text-sm text-white/40">
          {error || "Profile not found."}
        </div>
      </section>
    );
  }

  const src = avatarSrc(profile);

  return (
    <section className="mx-auto w-full max-w-4xl px-4 pb-12 pt-6 sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-semibold text-white/50 transition hover:text-white"
      >
        ← Back to feed
      </button>

      {/* HEADER */}

      <div className="mt-5 rounded-2xl border border-white/[0.07] bg-[#0c0c10] p-6 sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="relative shrink-0">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/[0.05] text-2xl font-semibold text-white/70">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt={displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                displayName.charAt(0).toUpperCase()
              )}
            </div>

            {isOwnProfile && (
              <>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarUploading}
                  className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black text-xs font-bold text-white transition hover:bg-white/10 disabled:opacity-50"
                  aria-label="Change avatar"
                >
                  {avatarUploading ? `${avatarProgress}%` : "✎"}
                </button>
              </>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="font-serif text-2xl italic text-white">
                {displayName}
              </h1>

              {isOwnProfile ? null : (
                <button
                  type="button"
                  onClick={toggleFollow}
                  disabled={followBusy}
                  className={`h-10 shrink-0 rounded-full px-5 text-sm font-semibold transition disabled:opacity-50 ${
                    isFollowing
                      ? "border border-white/15 text-white/70 hover:text-white"
                      : "bg-white text-black hover:bg-white/90"
                  }`}
                >
                  {isFollowing ? "Following" : "Follow"}
                </button>
              )}
            </div>

            {/* STATS */}

            <div className="mt-4 flex items-center gap-6 text-sm">
              <div>
                <span className="font-semibold text-white">
                  {posts.length}
                </span>{" "}
                <span className="text-white/40">posts</span>
              </div>

              <button
                type="button"
                onClick={() => openList("followers")}
                className="transition hover:text-white"
              >
                <span className="font-semibold text-white">
                  {followersCount}
                </span>{" "}
                <span className="text-white/40">followers</span>
              </button>

              <button
                type="button"
                onClick={() => openList("following")}
                className="transition hover:text-white"
              >
                <span className="font-semibold text-white">
                  {followingCount}
                </span>{" "}
                <span className="text-white/40">following</span>
              </button>
            </div>

            {/* BIO */}

            <div className="mt-4">
              {isEditingBio ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={bioDraft}
                    onChange={(event) =>
                      setBioDraft(event.target.value)
                    }
                    rows={3}
                    placeholder="Say something about yourself..."
                    className="w-full rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-white/25"
                  />

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={saveBio}
                      disabled={savingBio}
                      className="h-9 rounded-lg bg-white px-4 text-xs font-bold text-black disabled:opacity-50"
                    >
                      {savingBio ? "Saving..." : "Save"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingBio(false);
                        setBioDraft(profile.bio ?? "");
                      }}
                      className="h-9 rounded-lg px-4 text-xs font-semibold text-white/50 hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <p className="max-w-lg text-sm leading-6 text-white/50">
                    {profile.bio || "No bio yet."}
                  </p>

                  {isOwnProfile && (
                    <button
                      type="button"
                      onClick={() => setIsEditingBio(true)}
                      className="shrink-0 text-xs font-semibold text-white/40 hover:text-white"
                    >
                      Edit
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {actionError && (
        <div className="mt-4 rounded-xl border border-red-400/20 bg-red-500/[0.07] px-4 py-3 text-sm text-red-200">
          {actionError}
        </div>
      )}

      {/* POSTS GRID */}

      <h2 className="mt-9 font-serif text-xl italic text-white">
        Posts
      </h2>

      {posts.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-white/[0.1] px-6 py-16 text-center text-sm text-white/35">
          No posts yet.
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {posts.map((post) => {
            const streamUrl = post.telegram_file_id
              ? `/api/social/${
                  post.kind === "video" ? "videos" : "photos"
                }/stream?fileId=${encodeURIComponent(
                  post.telegram_file_id,
                )}`
              : null;

            return (
              <button
                key={`${post.kind}-${post.id}`}
                type="button"
                onClick={() => setOpenPost(post)}
                className="group relative aspect-square overflow-hidden rounded-xl border border-white/[0.07] bg-black text-left"
              >
                {streamUrl ? (
                  post.kind === "video" ? (
                    <video
                      src={streamUrl}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      muted
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={streamUrl}
                      alt={post.title ?? "Post"}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                  )
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-white/30">
                    Unavailable
                  </div>
                )}

                {post.kind === "video" && (
                  <div className="absolute bottom-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-[10px] text-white">
                    ▶
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* FOLLOWERS / FOLLOWING MODAL */}

      {listModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setListModal(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="max-h-[70vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-white/10 bg-[#0c0c10] p-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                {listModal === "followers" ? "Followers" : "Following"}
              </h3>

              <button
                type="button"
                onClick={() => setListModal(null)}
                className="text-white/40 hover:text-white"
              >
                ×
              </button>
            </div>

            <div className="mt-4 space-y-1">
              {listLoading ? (
                <p className="py-6 text-center text-xs text-white/35">
                  Loading...
                </p>
              ) : listUsers.length === 0 ? (
                <p className="py-6 text-center text-xs text-white/35">
                  Nobody here yet.
                </p>
              ) : (
                listUsers.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => {
                      setListModal(null);
                      onViewProfile?.(person.id);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/[0.05]"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/[0.05] text-xs font-semibold text-white/70">
                      {avatarSrc(person) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={avatarSrc(person) as string}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        (person.display_name || person.name || "?")
                          .charAt(0)
                          .toUpperCase()
                      )}
                    </div>

                    <span className="truncate text-sm text-white/80">
                      {person.display_name || person.name || "Unnamed user"}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* POST LIGHTBOX */}

      {openPost && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setOpenPost(null)}
        >
          <button
            type="button"
            onClick={() => setOpenPost(null)}
            className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-lg text-white"
            aria-label="Close"
          >
            ×
          </button>

          <div
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0c0c10]"
          >
            <div className="flex items-center justify-center bg-black">
              {openPost.telegram_file_id &&
                (openPost.kind === "video" ? (
                  <video
                    src={`/api/social/videos/stream?fileId=${encodeURIComponent(
                      openPost.telegram_file_id,
                    )}`}
                    className="max-h-[65vh] w-full object-contain"
                    controls
                    autoPlay
                    playsInline
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/social/photos/stream?fileId=${encodeURIComponent(
                      openPost.telegram_file_id,
                    )}`}
                    alt={openPost.title ?? "Post"}
                    className="max-h-[65vh] w-full object-contain"
                  />
                ))}
            </div>

            {(openPost.title || openPost.caption) && (
              <div className="p-4">
                {openPost.title && (
                  <p className="font-serif text-base italic text-white">
                    {openPost.title}
                  </p>
                )}

                {openPost.caption && (
                  <p className="mt-1 text-sm leading-6 text-white/50">
                    {openPost.caption}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}