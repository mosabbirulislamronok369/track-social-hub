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
  kind: "video" | "photo" | "text";
  user_id: string;
  title: string | null;
  caption?: string | null;
  text_content?: string | null;
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

export default function SocialProfile({
  userId,
  onBack,
  onViewProfile,
}: {
  userId: string;
  onBack: () => void;
  onViewProfile?: (userId: string) => void;
}) {
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);

  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  const isOwnProfile = currentUserId === userId;

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUserId(user?.id ?? null);
    })();
  }, []);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    const { data, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (profileError) {
      setError(profileError.message);
    } else {
      setProfile(data as ProfileRow);
    }
    setLoading(false);
  }, [userId]);

  const loadPosts = useCallback(async () => {
    const [
      { data: textData },
      { data: videoData },
      { data: photoData },
    ] = await Promise.all([
      supabase.from("social_texts").select("*").eq("user_id", userId),
      supabase.from("social_videos").select("*").eq("user_id", userId),
      supabase.from("social_photos").select("*").eq("user_id", userId),
    ]);

    const merged: Post[] = [
      ...(textData ?? []).map((r) => ({ ...r, kind: "text" as const })),
      ...(videoData ?? []).map((r) => ({ ...r, kind: "video" as const })),
      ...(photoData ?? []).map((r) => ({ ...r, kind: "photo" as const })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    setPosts(merged);
  }, [userId]);

  async function deletePost(id: string, kind: "text" | "video" | "photo") {
    if (!confirm("Delete this post?")) return;

    const tableMap = {
      text: "social_texts",
      video: "social_videos",
      photo: "social_photos",
    };

    const { error: delError } = await supabase
      .from(tableMap[kind])
      .delete()
      .eq("id", id)
      .eq("user_id", currentUserId);

    if (delError) {
      setActionError(delError.message);
    } else {
      setPosts((prev) => prev.filter((p) => p.id !== id));
    }
  }

  useEffect(() => {
    loadProfile();
    loadPosts();
  }, [loadProfile, loadPosts]);

  if (loading) return <div className="p-8 text-center text-white/50">Loading profile...</div>;

  return (
    <section className="mx-auto w-full max-w-4xl px-4 pb-12 pt-6">
      <button type="button" onClick={onBack} className="text-xs font-semibold text-white/50 hover:text-white">
        ← Back to feed
      </button>

      <div className="mt-5 rounded-2xl border border-white/10 bg-[#0c0c10] p-6">
        <div className="flex items-center gap-4">
          <div className="h-20 w-20 overflow-hidden rounded-full border border-white/20 bg-white/10">
            {profile && avatarSrc(profile) ? (
              <img src={avatarSrc(profile)!} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-xl text-white font-bold">
                {profile?.display_name?.charAt(0) || "U"}
              </div>
            )}
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{profile?.display_name || "User"}</h1>
            <p className="text-xs text-white/40">{profile?.bio || "No bio available."}</p>
          </div>
        </div>
      </div>

      <h2 className="mt-8 text-lg font-bold text-white">All Posts</h2>
      <div className="mt-4 space-y-3">
        {posts.map((post) => (
          <div key={`${post.kind}-${post.id}`} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/40 p-4">
            <div>
              <span className="text-[10px] uppercase font-bold text-cyan-400">{post.kind}</span>
              <h4 className="text-sm font-bold text-white">{post.title || post.text_content || "Untitled"}</h4>
              <span className="text-[10px] text-white/30">{new Date(post.created_at).toLocaleDateString()}</span>
            </div>
            {isOwnProfile && (
              <button
                type="button"
                onClick={() => deletePost(post.id, post.kind)}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Delete
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}