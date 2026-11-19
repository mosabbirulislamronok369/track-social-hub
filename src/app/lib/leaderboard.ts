import { supabase } from "./supabase";

export type LeaderboardCategory =
  | "Total"
  | "Movies"
  | "TV"
  | "YouTube";

export type LeaderboardEntry = {
  userId: string;
  displayName: string;
  totalSeconds: number;
};

type RawRow = {
  user_id: string;
  display_name?: string | null;
  category: string;
  total_seconds: number | string;
};

const ACTIVE_CATEGORIES = ["Movies", "TV", "YouTube"] as const;

type ActiveCategory = (typeof ACTIVE_CATEGORIES)[number];

function isActiveCategory(category: string): category is ActiveCategory {
  return ACTIVE_CATEGORIES.includes(category as ActiveCategory);
}

/**
 * Groups the RPC rows by user and category.
 * The SQL RPC already aggregates by user/category, but we add values
 * rather than overwrite them so duplicate rows cannot silently lose time.
 */
function groupByCategory(rows: RawRow[]) {
  const byUser: Record<
    string,
    {
      displayName: string;
      perCategory: Record<ActiveCategory, number>;
    }
  > = {};

  for (const row of rows) {
    if (!isActiveCategory(row.category)) {
      continue;
    }

    if (!byUser[row.user_id]) {
      byUser[row.user_id] = {
        displayName: row.display_name?.trim() || "User",
        perCategory: {
          Movies: 0,
          TV: 0,
          YouTube: 0,
        },
      };
    } else if (
      (!byUser[row.user_id].displayName ||
        byUser[row.user_id].displayName === "User") &&
      row.display_name?.trim()
    ) {
      byUser[row.user_id].displayName = row.display_name.trim();
    }

    byUser[row.user_id].perCategory[row.category] +=
      Math.max(0, Number(row.total_seconds) || 0);
  }

  return byUser;
}

function toRankedEntries(
  byUser: ReturnType<typeof groupByCategory>,
  category: LeaderboardCategory,
): LeaderboardEntry[] {
  const entries = Object.entries(byUser).map(([userId, info]) => {
    const totalSeconds =
      category === "Total"
        ? ACTIVE_CATEGORIES.reduce(
            (sum, key) => sum + info.perCategory[key],
            0,
          )
        : info.perCategory[category] || 0;

    return {
      userId,
      displayName: info.displayName || "User",
      totalSeconds,
    };
  });

  return entries
    .filter((entry) => entry.totalSeconds > 0)
    .sort(
      (a, b) =>
        b.totalSeconds - a.totalSeconds ||
        a.displayName.localeCompare(b.displayName),
    );
}

async function fetchLeaderboardRows(
  rpcName: "get_leaderboard" | "get_friends_leaderboard",
): Promise<RawRow[]> {
  const { data, error } = await supabase.rpc(rpcName);

  if (error) {
    console.error(`Failed to load ${rpcName}:`, error);
    throw error;
  }

  return (data ?? []) as RawRow[];
}

export async function fetchGlobalLeaderboard(
  category: LeaderboardCategory,
): Promise<LeaderboardEntry[]> {
  const rows = await fetchLeaderboardRows("get_leaderboard");
  return toRankedEntries(groupByCategory(rows), category);
}

export async function fetchFriendsLeaderboard(
  category: LeaderboardCategory,
): Promise<LeaderboardEntry[]> {
  const rows = await fetchLeaderboardRows("get_friends_leaderboard");
  return toRankedEntries(groupByCategory(rows), category);
}
