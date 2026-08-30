"use client";

import { useEffect, useState } from "react";
import {
  fetchFriendsLeaderboard,
  fetchGlobalLeaderboard,
  LeaderboardCategory,
  LeaderboardEntry,
} from "../lib/leaderboard";
import {
  acceptFriendRequest,
  FriendProfile,
  FriendRequest,
  listFriends,
  listIncomingRequests,
  searchUsersByEmail,
  sendFriendRequest,
} from "../lib/friends";
import { fetchQuranLeaderboard } from "../lib/quranTrack";
import { supabase } from "../lib/supabase";

type Scope = "global" | "friends";

/*
 * "Quran" isn't a LeaderboardCategory from lib/leaderboard — it
 * doesn't come from the watch_sessions-based get_leaderboard()
 * RPC, it's a separate fetch against quran_reading_log (see
 * loadLeaderboard below). Kept as a local union so this file
 * doesn't need to touch lib/leaderboard.ts's type.
 */
type DisplayCategory = LeaderboardCategory | "Quran";

const CATEGORIES: DisplayCategory[] = [
  "Total",
  "Movies",
  "TV",
  "Anime",
  "YouTube",
  "Quran",
];

const CATEGORY_LABELS: Record<DisplayCategory, string> = {
  Total: "Total",
  Movies: "Movie",
  TV: "TV",
  Anime: "Anime",
  YouTube: "YouTube",
  Quran: "🕌 Quran",
};

/*
 * Cascading Years/Months/Days/Hours/Minutes/Seconds formatter —
 * kept in sync with Dashboard.tsx's formatTime. Leading zero
 * units are skipped (e.g. no years shows starting from months),
 * but once a non-zero unit is found every smaller unit is shown
 * even if it's 0. Years/months use a 365/30-day approximation.
 */
const YEAR_SECONDS = 365 * 86400;
const MONTH_SECONDS = 30 * 86400;

function formatTime(totalSeconds: number) {
  let seconds = Math.max(0, Math.floor(totalSeconds));

  const years = Math.floor(seconds / YEAR_SECONDS);
  seconds %= YEAR_SECONDS;

  const months = Math.floor(seconds / MONTH_SECONDS);
  seconds %= MONTH_SECONDS;

  const days = Math.floor(seconds / 86400);
  seconds %= 86400;

  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;

  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  const secs = seconds;

  const units = [
    { value: years, label: "y" },
    { value: months, label: "mo" },
    { value: days, label: "d" },
    { value: hours, label: "h" },
    { value: minutes, label: "m" },
    { value: secs, label: "s" },
  ];

  let startIndex = units.findIndex((unit) => unit.value > 0);

  if (startIndex === -1) {
    startIndex = units.length - 1;
  }

  return units
    .slice(startIndex)
    .map((unit) => `${unit.value}${unit.label}`)
    .join(" ");
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default function Leaderboard() {
  const [scope, setScope] = useState<Scope>("global");
  const [category, setCategory] =
    useState<DisplayCategory>("Total");

  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [currentUserId, setCurrentUserId] = useState <
    string | null
  >(null);

  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [incomingRequests, setIncomingRequests] = useState <
    FriendRequest[]
  >([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState <
    FriendProfile[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [addingFriendId, setAddingFriendId] = useState <
    string | null
  >(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id || null);
    });
  }, []);

  async function loadLeaderboard() {
    setLoading(true);
    setError("");

    try {
      let data: LeaderboardEntry[];

      if (category === "Quran") {
        if (scope === "global") {
          data = await fetchQuranLeaderboard();
        } else {
          // Friends scope: fetch the friends list directly
          // here rather than relying on `friends` state, since
          // that's only populated when scope is already
          // "friends" and could still be loading in parallel.
          const friendsList = await listFriends();
          const friendIds = friendsList.map(
            (friend) => friend.id,
          );

          data = await fetchQuranLeaderboard(
            currentUserId
              ? [...friendIds, currentUserId]
              : friendIds,
          );
        }
      } else {
        data =
          scope === "global"
            ? await fetchGlobalLeaderboard(category)
            : await fetchFriendsLeaderboard(category);
      }

      setEntries(data);
    } catch (err) {
      console.error("Failed to load leaderboard:", err);
      setEntries([]);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load leaderboard.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLeaderboard();

    // Keep rankings reasonably fresh without hammering Supabase —
    // re-fetch every 5 minutes instead of on every render/poll.
    const interval = setInterval(loadLeaderboard, 5 * 60 * 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, category]);

  async function loadFriendsData() {
    try {
      const [friendsList, requests] = await Promise.all([
        listFriends(),
        listIncomingRequests(),
      ]);

      setFriends(friendsList);
      setIncomingRequests(requests);
    } catch (err) {
      console.error("Failed to load friends data:", err);
    }
  }

  useEffect(() => {
    if (scope === "friends") {
      loadFriendsData();
    }
  }, [scope]);

  async function handleSearch() {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);

    try {
      const results = await searchUsersByEmail(searchQuery);
      setSearchResults(
        results.filter((result) => result.id !== currentUserId),
      );
    } catch (err) {
      console.error("Friend search failed:", err);
    } finally {
      setSearching(false);
    }
  }

  async function handleAddFriend(friendId: string) {
    setAddingFriendId(friendId);

    try {
      await sendFriendRequest(friendId);
      setSearchResults((current) =>
        current.filter((result) => result.id !== friendId),
      );
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Failed to send friend request.",
      );
    } finally {
      setAddingFriendId(null);
    }
  }

  async function handleAcceptRequest(requestId: string) {
    try {
      await acceptFriendRequest(requestId);
      await loadFriendsData();
      loadLeaderboard();
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Failed to accept request.",
      );
    }
  }

  return (
    <section className="min-h-screen bg-[#070711] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Leaderboard
          </h1>
          <p className="mt-2 text-white/50">
            See who's watched the most
          </p>
        </div>

        <div className="mb-6 flex gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-1">
          <button
            type="button"
            onClick={() => setScope("global")}
            className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
              scope === "global"
                ? "bg-white text-black"
                : "text-white/50 hover:text-white/80"
            }`}
          >
            🌐 Global
          </button>

          <button
            type="button"
            onClick={() => setScope("friends")}
            className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
              scope === "friends"
                ? "bg-white text-black"
                : "text-white/50 hover:text-white/80"
            }`}
          >
            👥 Friends
          </button>
        </div>

        <div className="mb-8 flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                category === cat
                  ? "border-purple-400/60 bg-purple-500/10 text-purple-300"
                  : "border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06]"
              }`}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        {scope === "friends" && (
          <div className="mb-8 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <h3 className="mb-3 text-sm font-semibold text-white/70">
                Add a friend
              </h3>

              <div className="flex gap-2">
                <input
                  value={searchQuery}
                  onChange={(event) =>
                    setSearchQuery(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleSearch();
                    }
                  }}
                  placeholder="Search by email..."
                  className="h-11 flex-1 rounded-lg border border-white/10 bg-[#14141d] px-3 text-sm text-white outline-none focus:border-purple-400/60"
                />

                <button
                  type="button"
                  onClick={handleSearch}
                  disabled={searching}
                  className="h-11 rounded-lg bg-white px-5 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50"
                >
                  {searching ? "..." : "Search"}
                </button>
              </div>

              {searchResults.length > 0 && (
                <div className="mt-4 space-y-2">
                  {searchResults.map((result) => (
                    <div
                      key={result.id}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-2.5"
                    >
                      <span className="text-sm">
                        {result.displayName}
                      </span>

                      <button
                        type="button"
                        disabled={addingFriendId === result.id}
                        onClick={() => handleAddFriend(result.id)}
                        className="rounded-lg border border-purple-400/30 bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-300 transition hover:bg-purple-500/20 disabled:opacity-50"
                      >
                        {addingFriendId === result.id
                          ? "Sending..."
                          : "+ Add"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {incomingRequests.length > 0 && (
              <div className="rounded-2xl border border-yellow-400/30 bg-yellow-500/5 p-5">
                <h3 className="mb-3 text-sm font-semibold text-yellow-300">
                  Friend requests
                </h3>

                <div className="space-y-2">
                  {incomingRequests.map((request) => (
                    <div
                      key={request.id}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-2.5"
                    >
                      <span className="text-sm">
                        {request.displayName}
                      </span>

                      <button
                        type="button"
                        onClick={() =>
                          handleAcceptRequest(request.id)
                        }
                        className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
                      >
                        Accept
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {friends.length === 0 &&
              incomingRequests.length === 0 && (
                <p className="text-sm text-white/40">
                  You haven't added any friends yet. Search for
                  one above to get started.
                </p>
              )}
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/50 bg-red-500/10 p-5">
            <p className="text-red-200/80">{error}</p>
          </div>
        )}

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-16 animate-pulse rounded-xl bg-white/[0.03]"
              />
            ))}
          </div>
        )}

        {!loading && entries.length > 0 && (
          <div className="space-y-2">
            {entries.map((entry, index) => {
              const isCurrentUser =
                entry.userId === currentUserId;

              return (
                <div
                  key={entry.userId}
                  className={`flex items-center gap-4 rounded-xl border p-4 transition ${
                    isCurrentUser
                      ? "border-purple-400/50 bg-purple-500/10"
                      : "border-white/10 bg-white/[0.03]"
                  }`}
                >
                  <div className="w-10 text-center text-lg font-bold text-white/50">
                    {MEDALS[index] || `#${index + 1}`}
                  </div>

                  <div className="flex-1">
                    <p className="font-semibold">
                      {entry.displayName}
                      {isCurrentUser && (
                        <span className="ml-2 text-xs text-purple-300">
                          (you)
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="text-sm font-semibold text-white/70">
                    {formatTime(entry.totalSeconds)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-12 text-center">
            <p className="text-lg font-semibold">
              No rankings yet
            </p>

            <p className="mt-2 text-sm text-white/40">
              {scope === "friends"
                ? "Add some friends to see how you compare."
                : "Start watching something to appear here."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}