import { supabase } from "./supabase";

export type LeaderboardCategory =
  | "Total"
  | "Movies"
  | "TV"
  | "Anime"
  | "YouTube";

export type LeaderboardEntry = {
  userId: string;
  displayName: string;
  totalSeconds: number;
};

type RawRow = {
  user_id: string;
  category: string;
  total_seconds: number;
};

async function fetchDisplayNamesByIds(
  ids: string[],
): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(ids)];

  if (uniqueIds.length === 0) {
    return {};
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id,name")
    .in("id", uniqueIds);

  if (error) {
    throw error;
  }

  return Object.fromEntries(
    (data || []).map((profile) => [
      profile.id,
      profile.name?.trim() || "User",
    ]),
  );
}

function groupByCategory(
  rows: RawRow[],
  displayNames: Record<string, string>,
) {
  const byUser: Record <
    string,
    { displayName: string; perCategory: Record<string, number> }
  > = {};

  for (const row of rows) {
    if (!byUser[row.user_id]) {
      byUser[row.user_id] = {
        displayName: displayNames[row.user_id] || "User",
        perCategory: {},
      };
    }

    byUser[row.user_id].perCategory[row.category] =
      Number(row.total_seconds) || 0;
  }

  return byUser;
}

function toRankedEntries(
  byUser: ReturnType<typeof groupByCategory>,
  category: LeaderboardCategory,
): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = Object.entries(byUser).map(
    ([userId, info]) => {
      const totalSeconds =
        category === "Total"
          ? Object.values(info.perCategory).reduce(
              (sum, seconds) => sum + seconds,
              0,
            )
          : info.perCategory[category] || 0;

      return {
        userId,
        displayName: info.displayName,
        totalSeconds,
      };
    },
  );

  return entries
    .filter((entry) => entry.totalSeconds > 0)
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
}

export async function fetchGlobalLeaderboard(
  category: LeaderboardCategory,
): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc("get_leaderboard");

  if (error) {
    throw error;
  }

  const rows = (data || []) as RawRow[];
  const displayNames = await fetchDisplayNamesByIds(
    rows.map((row) => row.user_id),
  );

  return toRankedEntries(groupByCategory(rows, displayNames), category);
}

export async function fetchFriendsLeaderboard(
  category: LeaderboardCategory,
): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc(
    "get_friends_leaderboard",
  );

  if (error) {
    throw error;
  }

  const rows = (data || []) as RawRow[];
  const displayNames = await fetchDisplayNamesByIds(
    rows.map((row) => row.user_id),
  );

  return toRankedEntries(groupByCategory(rows, displayNames), category);
}