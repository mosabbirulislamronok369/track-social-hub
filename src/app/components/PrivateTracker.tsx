"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type PrivateItem = {
  id: string;
  title: string;
  runtime_seconds: number;
  watched_seconds: number;
  status: "Watching" | "Completed" | "Paused" | "Dropped";
};

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function parseRuntime(value: string) {
  const text = value.toLowerCase().trim();

  let seconds = 0;

  const hours = text.match(/(\d+)\s*h/);
  const minutes = text.match(/(\d+)\s*m/);

  if (hours) seconds += Number(hours[1]) * 3600;
  if (minutes) seconds += Number(minutes[1]) * 60;

  if (!hours && !minutes && /^\d+$/.test(text)) {
    seconds = Number(text) * 60;
  }

  return seconds;
}

export default function PrivateWatchlist() {
  const [items, setItems] = useState<PrivateItem[]>([]);
  const [title, setTitle] = useState("");
  const [runtime, setRuntime] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadItems() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("private_watchlist")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Private watchlist load error:", error);
      return;
    }

    setItems(data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadItems();
  }, []);

  async function addItem() {
    if (!title.trim()) return;

    const runtimeSeconds = parseRuntime(runtime);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      alert("Please login first.");
      return;
    }

    const { error } = await supabase
      .from("private_watchlist")
      .insert({
        user_id: user.id,
        title: title.trim(),
        runtime_seconds: runtimeSeconds,
        watched_seconds: 0,
        status: "Watching",
      });

    if (error) {
      console.error("Private item insert error:", error);
      alert(error.message);
      return;
    }

    setTitle("");
    setRuntime("");

    await loadItems();
  }

  async function updateStatus(
    id: string,
    status: PrivateItem["status"]
  ) {
    const { error } = await supabase
      .from("private_watchlist")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      console.error(error);
      return;
    }

    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, status } : item
      )
    );
  }

  async function deleteItem(id: string) {
    const { error } = await supabase
      .from("private_watchlist")
      .delete()
      .eq("id", id);

    if (error) {
      console.error(error);
      return;
    }

    setItems((current) =>
      current.filter((item) => item.id !== id)
    );
  }

  if (loading) {
    return (
      <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        Loading private watchlist...
      </div>
    );
  }

  return (
    <section className="mt-8">
      <div className="mb-5">
        <p className="text-sm text-white/50">
          Your personal content
        </p>

        <h2 className="text-2xl font-bold text-white">
          Private Watchlist
        </h2>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Content name"
            className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none"
          />

          <input
            value={runtime}
            onChange={(e) => setRuntime(e.target.value)}
            placeholder="Runtime: 1h 30m"
            className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none"
          />

          <button
            onClick={addItem}
            className="rounded-xl bg-white px-5 py-3 font-semibold text-black"
          >
            + Add
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {items.map((item) => {
          const progress =
            item.runtime_seconds > 0
              ? Math.min(
                  100,
                  (item.watched_seconds / item.runtime_seconds) * 100
                )
              : 0;

          return (
            <div
              key={item.id}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-white">
                    {item.title}
                  </h3>

                  <p className="mt-1 text-sm text-white/50">
                    {formatTime(item.watched_seconds)}
                    {item.runtime_seconds > 0 &&
                      ` / ${formatTime(item.runtime_seconds)}`}
                  </p>
                </div>

                <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
                  {item.status}
                </span>
              </div>

              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-white"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => updateStatus(item.id, "Watching")}
                  className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black"
                >
                  ▶ Watch
                </button>

                <button
                  onClick={() => updateStatus(item.id, "Completed")}
                  className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white"
                >
                  Completed
                </button>

                <button
                  onClick={() => updateStatus(item.id, "Paused")}
                  className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white"
                >
                  Paused
                </button>

                <button
                  onClick={() => deleteItem(item.id)}
                  className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}

        {items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-white/40 md:col-span-2">
            Your private watchlist is empty.
          </div>
        )}
      </div>
    </section>
  );
}