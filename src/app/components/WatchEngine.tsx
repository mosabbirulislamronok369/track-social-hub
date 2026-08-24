"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type WatchCategory =
  | "YouTube"
  | "Anime"
  | "TV"
  | "Movies"
  | "Social"
  | "Private";

type WatchEngineProps = {
  contentId: string;
  category?: WatchCategory;
};

export default function WatchEngine({
  contentId,
  category = "Private",
}: WatchEngineProps) {
  const [seconds, setSeconds] = useState(0);
  const [isWatching, setIsWatching] = useState(false);
  const [saving, setSaving] = useState(false);

  const sessionIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const secondsRef = useRef(0);
  const mountedRef = useRef(true);

  // Keep ref synchronized with state
  useEffect(() => {
    secondsRef.current = seconds;
  }, [seconds]);

  // Format seconds -> 0d 0h 0m (rolls into days for long sessions)
  function formatTime(totalSeconds: number) {
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;

    if (d > 0) {
      return `${d}d ${h}h ${m}m`;
    }

    if (h > 0) {
      return `${h}h ${m}m ${s}s`;
    }

    if (m > 0) {
      return `${m}m ${s}s`;
    }

    return `${s}s`;
  }

  // Save current watch time to Supabase
  async function saveHeartbeat() {
    const sessionId = sessionIdRef.current;
    const userId = userIdRef.current;

    if (!sessionId || !userId) {
      return;
    }

    const currentSeconds = secondsRef.current;

    setSaving(true);

    const { error } = await supabase
      .from("watch_sessions")
      .update({
        total_seconds: currentSeconds,
        last_heartbeat: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("user_id", userId);

    setSaving(false);

    if (error) {
      console.error("Failed to save heartbeat:", error);
      return;
    }

    console.log("Watch heartbeat saved:", currentSeconds);
  }

  // Start a new watch session
  async function startSession() {
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        console.error("Failed to get user:", userError);
        return;
      }

      if (!user) {
        console.error("No logged-in user found.");
        return;
      }

      userIdRef.current = user.id;

      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from("watch_sessions")
        .insert({
          user_id: user.id,
          content_id: contentId,
          category: category,
          started_at: now,
          last_heartbeat: now,
          total_seconds: 0,
        })
        .select("id")
        .single();

      if (error) {
        console.error("Failed to start watch session:", error);
        return;
      }

      if (!data) {
        console.error("No session data returned.");
        return;
      }

      sessionIdRef.current = data.id;

      if (!mountedRef.current) {
        return;
      }

      setSeconds(0);
      setIsWatching(true);

      console.log("Watch session started:", data.id);
      console.log("Category:", category);
    } catch (error) {
      console.error("Unexpected start session error:", error);
    }
  }

  // Pause watching
  async function pauseSession() {
    if (!sessionIdRef.current) {
      return;
    }

    setIsWatching(false);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    await saveHeartbeat();

    console.log("Watch session paused.");
  }

  // Resume watching
  function resumeSession() {
    if (!sessionIdRef.current) {
      return;
    }

    setIsWatching(true);

    console.log("Watch session resumed.");
  }

  // Start session once
  useEffect(() => {
    mountedRef.current = true;

    startSession();

    return () => {
      mountedRef.current = false;

      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }

      // Final save when component is removed
      saveHeartbeat();
    };

    // We intentionally start only once for this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer
  useEffect(() => {
    if (!isWatching) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      return;
    }

    timerRef.current = setInterval(() => {
      setSeconds((previous) => previous + 1);
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isWatching]);

  // Supabase heartbeat every 10 seconds
  useEffect(() => {
    if (!isWatching || !sessionIdRef.current) {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }

      return;
    }

    heartbeatRef.current = setInterval(() => {
      saveHeartbeat();
    }, 10000);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [isWatching]);

  // Save when browser tab becomes hidden
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        saveHeartbeat();
      }
    }

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-xl font-semibold">
        Watching {formatTime(seconds)}
      </div>

      <div className="text-sm">
  {isWatching ? (
    <span className="text-green-400">
      • Live tracking • In Track Social Hub
    </span>
  ) : (
    <span className="text-yellow-400">
      • Paused • In Track Social Hub
    </span>
  )}
</div>

      {isWatching ? (
        <button
          onClick={pauseSession}
          className="rounded-lg bg-white px-6 py-2 font-semibold text-black hover:bg-white/90"
        >
          Pause
        </button>
      ) : (
        <button
          onClick={resumeSession}
          className="rounded-lg bg-white px-6 py-2 font-semibold text-black hover:bg-white/90"
        >
          Resume
        </button>
      )}

      {saving && (
        <div className="text-xs text-white/40">
          Saving...
        </div>
      )}
    </div>
  );
}