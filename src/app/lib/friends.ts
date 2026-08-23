import { supabase } from "./supabase";

export type FriendProfile = {
  id: string;
  email: string;
  displayName: string;
};

export type FriendRequest = {
  id: string;
  fromUserId: string;
  displayName: string;
  email: string;
};

async function fetchProfilesByIds(
  ids: string[],
): Promise<Record<string, { email: string; displayName: string }>> {
  if (ids.length === 0) {
    return {};
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,display_name")
    .in("id", ids);

  if (error) {
    throw error;
  }

  const map: Record<string, { email: string; displayName: string }> = {};

  (data || []).forEach((row) => {
    map[row.id] = {
      email: row.email || "",
      displayName: row.display_name || row.email || "Unknown",
    };
  });

  return map;
}

export async function searchUsersByEmail(
  query: string,
): Promise<FriendProfile[]> {
  if (!query.trim()) {
    return [];
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,display_name")
    .ilike("email", `%${query.trim()}%`)
    .limit(10);

  if (error) {
    throw error;
  }

  return (data || []).map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name || row.email,
  }));
}

export async function sendFriendRequest(friendId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Please login first.");
  }

  if (user.id === friendId) {
    throw new Error("You can't add yourself.");
  }

  const { error } = await supabase.from("friends").insert({
    user_id: user.id,
    friend_id: friendId,
    status: "pending",
  });

  if (error) {
    throw error;
  }
}

export async function acceptFriendRequest(requestId: string) {
  const { error } = await supabase
    .from("friends")
    .update({ status: "accepted" })
    .eq("id", requestId);

  if (error) {
    throw error;
  }
}

export async function listIncomingRequests(): Promise <
  FriendRequest[]
> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from("friends")
    .select("id,user_id")
    .eq("friend_id", user.id)
    .eq("status", "pending");

  if (error) {
    throw error;
  }

  const rows = data || [];

  const profilesMap = await fetchProfilesByIds(
    rows.map((row) => row.user_id),
  );

  return rows.map((row) => {
    const profile = profilesMap[row.user_id];

    return {
      id: row.id,
      fromUserId: row.user_id,
      displayName: profile?.displayName || "Unknown",
      email: profile?.email || "",
    };
  });
}

export async function listFriends(): Promise<FriendProfile[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from("friends")
    .select("user_id,friend_id,status")
    .eq("status", "accepted")
    .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);

  if (error) {
    throw error;
  }

  const rows = data || [];

  const otherUserIds = rows.map((row) =>
    row.user_id === user.id ? row.friend_id : row.user_id,
  );

  const profilesMap = await fetchProfilesByIds(otherUserIds);

  return otherUserIds.map((otherId) => {
    const profile = profilesMap[otherId];

    return {
      id: otherId,
      email: profile?.email || "",
      displayName: profile?.displayName || "Unknown",
    };
  });
}