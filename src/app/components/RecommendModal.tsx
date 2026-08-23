"use client";

import { useEffect, useState } from "react";
import { listFriends, type FriendProfile } from "../lib/friends";
import { sendRecommendation } from "../lib/recommendations";

export default function RecommendModal({
  contentType,
  contentId,
  contentTitle,
  posterPath,
  onClose,
}: {
  contentType: string;
  contentId: string;
  contentTitle: string;
  posterPath?: string | null;
  onClose: () => void;
}) {
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    listFriends()
      .then((result) => {
        setFriends(result);
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Failed to load friends.",
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  async function handleSend() {
    if (!selectedId || sending) {
      return;
    }

    setSending(true);
    setError("");

    try {
      await sendRecommendation({
        toUserId: selectedId,
        contentType: contentType,
        contentId: contentId,
        contentTitle: contentTitle,
        posterPath: posterPath,
        message: message,
      });

      setSentTo((current) => {
        const next = new Set(current);
        next.add(selectedId);
        return next;
      });

      setSelectedId(null);
      setMessage("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to send recommendation.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#11111a] p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">
            Recommend to a friend
          </h3>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
          >
            ✕
          </button>
        </div>

        <p className="mt-1 text-sm text-white/40">{contentTitle}</p>

        {error && (
          <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {loading ? (
          <p className="mt-4 text-sm text-white/40">Loading friends...</p>
        ) : friends.length === 0 ? (
          <p className="mt-4 text-sm text-white/40">
            You have no friends added yet.
          </p>
        ) : (
          <div className="mt-4 max-h-56 space-y-2 overflow-y-auto">
            {friends.map((friend) => {
              const alreadySent = sentTo.has(friend.id);
              const isSelected = selectedId === friend.id;

              return (
                <button
                  key={friend.id}
                  type="button"
                  disabled={alreadySent}
                  onClick={() => setSelectedId(friend.id)}
                  className={
                    "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition " +
                    (isSelected
                      ? "border-purple-400/60 bg-purple-500/10 text-white"
                      : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10") +
                    (alreadySent ? " cursor-not-allowed opacity-40" : "")
                  }
                >
                  <span>{friend.displayName}</span>

                  {alreadySent && (
                    <span className="text-xs text-emerald-300">
                      ✓ Sent
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Add a note (optional)..."
          rows={2}
          className="mt-4 w-full rounded-xl border border-white/10 bg-[#14141d] p-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-purple-400/60"
        />

        <button
          type="button"
          disabled={!selectedId || sending}
          onClick={handleSend}
          className="mt-4 h-11 w-full rounded-xl bg-white font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "Sending..." : "Send Recommendation"}
        </button>
      </div>
    </div>
  );
}