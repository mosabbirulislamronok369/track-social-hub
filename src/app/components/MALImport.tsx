"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type MALStatus =
  | "watching"
  | "completed"
  | "on_hold"
  | "dropped"
  | "plan_to_watch";

type MALAnime = {
  mal_id: number;
  title: string;
  main_picture?: {
    medium?: string;
    large?: string;
  };
  num_episodes?: number | null;
  my_list_status?: {
    status?: string | null;
    num_episodes_watched?: number | null;
    score?: number | null;
  } | null;
};

type ImportStatus = "idle" | "loading" | "success" | "error";

/*
 * Where the anime list currently on screen came from:
 *  - "api"  -> live MyAnimeList account fetch (existing flow)
 *  - "xml"  -> parsed from a MAL XML export the user uploaded
 */
type Source = "api" | "xml";

const STATUS_OPTIONS: {
  value: MALStatus;
  label: string;
}[] = [
  {
    value: "watching",
    label: "Watching",
  },
  {
    value: "completed",
    label: "Completed",
  },
  {
    value: "on_hold",
    label: "On-Hold",
  },
  {
    value: "dropped",
    label: "Dropped",
  },
  {
    value: "plan_to_watch",
    label: "Plan to Watch",
  },
];

function normalizeStatus(status?: string | null): MALStatus {
  switch (status) {
    case "watching":
      return "watching";

    case "completed":
      return "completed";

    case "on_hold":
      return "on_hold";

    case "dropped":
      return "dropped";

    case "plan_to_watch":
      return "plan_to_watch";

    default:
      return "plan_to_watch";
  }
}

function statusLabel(status: MALStatus) {
  const found = STATUS_OPTIONS.find((item) => item.value === status);
  return found?.label ?? "Plan to Watch";
}

/*
 * The XML export MAL gives you (Profile -> Export List)
 * spells statuses differently from the JSON API
 * ("On-Hold", "Plan to Watch", etc). Map those onto the
 * same MALStatus values the rest of this component uses.
 */
function mapXmlStatusToMALStatus(raw: string): MALStatus {
  const normalized = raw.trim().toLowerCase();

  if (normalized === "watching") {
    return "watching";
  }

  if (normalized === "completed") {
    return "completed";
  }

  if (
    normalized === "on-hold" ||
    normalized === "on hold"
  ) {
    return "on_hold";
  }

  if (normalized === "dropped") {
    return "dropped";
  }

  if (
    normalized === "plan to watch" ||
    normalized === "planning"
  ) {
    return "plan_to_watch";
  }

  return "plan_to_watch";
}

/*
 * Parses a MAL XML export (the file you get from MAL's
 * Profile -> Export List page) into the same MALAnime[]
 * shape the live API import already uses, so both sources
 * can share one list/select/import flow.
 */
function parseMalExportXml(xmlText: string): MALAnime[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");

  const parserError = doc.querySelector("parsererror");

  if (parserError) {
    throw new Error(
      "Couldn't read that file — make sure it's a MAL XML export (Profile → Export List).",
    );
  }

  const animeNodes = Array.from(
    doc.querySelectorAll("anime"),
  );

  if (animeNodes.length === 0) {
    throw new Error(
      "No anime entries found in that file.",
    );
  }

  const getText = (
    node: Element,
    tag: string,
  ): string =>
    node.querySelector(tag)?.textContent?.trim() || "";

  const entries: MALAnime[] = animeNodes
    .map((node) => {
      const malId = Number(
        getText(node, "series_animedb_id"),
      );

      const title =
        getText(node, "series_title") ||
        `Anime #${malId}`;

      const episodesText = getText(
        node,
        "series_episodes",
      );

      const numEpisodes = episodesText
        ? Number(episodesText)
        : null;

      const watchedText = getText(
        node,
        "my_watched_episodes",
      );

      const watchedEpisodes = watchedText
        ? Number(watchedText)
        : 0;

      const scoreText = getText(node, "my_score");

      const score =
        scoreText && Number(scoreText) > 0
          ? Number(scoreText)
          : null;

      const rawStatus = getText(node, "my_status");

      return {
        mal_id: malId,
        title,
        num_episodes:
          Number.isFinite(numEpisodes) &&
          (numEpisodes ?? 0) > 0
            ? numEpisodes
            : null,
        my_list_status: {
          status: mapXmlStatusToMALStatus(rawStatus),
          num_episodes_watched: watchedEpisodes,
          score,
        },
      };
    })
    .filter(
      (anime) =>
        Number.isFinite(anime.mal_id) &&
        anime.mal_id > 0,
    );

  return entries;
}

export default function MALImport() {
  const [source, setSource] = useState<Source>("api");

  /* Live-API anime list (existing behaviour). */
  const [liveAnimeList, setLiveAnimeList] = useState<
    MALAnime[]
  >([]);

  /* Anime parsed from an uploaded XML export. */
  const [xmlAnimeList, setXmlAnimeList] = useState<
    MALAnime[]
  >([]);

  const [xmlFileName, setXmlFileName] = useState("");

  const [selectedStatus, setSelectedStatus] =
    useState<MALStatus>("watching");

  const [selectedAnime, setSelectedAnime] = useState<number[]>([]);

  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  const [status, setStatus] = useState<ImportStatus>("idle");
  const [message, setMessage] = useState("");

  const [search, setSearch] = useState("");

  /*
   * The list currently on screen: filtered to the
   * selected MAL status, from whichever source is active.
   */
  const animeList = useMemo(() => {
    if (source === "xml") {
      return xmlAnimeList.filter(
        (anime) =>
          normalizeStatus(
            anime.my_list_status?.status,
          ) === selectedStatus,
      );
    }

    return liveAnimeList;
  }, [source, xmlAnimeList, liveAnimeList, selectedStatus]);

  const filteredAnime = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return animeList;
    }

    return animeList.filter((anime) =>
      anime.title.toLowerCase().includes(query)
    );
  }, [animeList, search]);

  const selectedCount = selectedAnime.length;

  /*
   * Only the live API needs to fetch on status/source
   * change — the XML list is already fully loaded in
   * memory and just gets re-filtered above.
   */
  useEffect(() => {
    if (source === "api") {
      loadMALAnime();
    } else {
      setSelectedAnime([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStatus, source]);

  async function loadMALAnime() {
    try {
      setLoading(true);
      setMessage("");
      setStatus("idle");
      setSelectedAnime([]);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setStatus("error");
        setMessage("Please login first.");
        return;
      }

      const response = await fetch(
        `/api/mal/import?status=${encodeURIComponent(
          selectedStatus
        )}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.error || "Failed to load anime from MAL."
        );
      }

      setLiveAnimeList(
        Array.isArray(result?.anime) ? result.anime : [],
      );
    } catch (error) {
      console.error("MAL load error:", error);

      setLiveAnimeList([]);

      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to load anime from MAL."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleXmlFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    // Allow re-uploading the same file name later.
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      setLoading(true);
      setStatus("idle");
      setMessage("");

      const text = await file.text();
      const parsed = parseMalExportXml(text);

      setXmlAnimeList(parsed);
      setXmlFileName(file.name);
      setSource("xml");
      setSelectedAnime([]);

      setStatus("success");
      setMessage(
        `Loaded ${parsed.length} anime from "${file.name}".`,
      );
    } catch (error) {
      console.error("MAL XML parse error:", error);

      setXmlAnimeList([]);
      setXmlFileName("");

      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to read that XML file.",
      );
    } finally {
      setLoading(false);
    }
  }

  function switchToLiveApi() {
    setSource("api");
    setXmlAnimeList([]);
    setXmlFileName("");
    setSelectedAnime([]);
    setStatus("idle");
    setMessage("");
  }

  function toggleAnime(malId: number) {
    setSelectedAnime((current) => {
      if (current.includes(malId)) {
        return current.filter((id) => id !== malId);
      }

      return [...current, malId];
    });
  }

  function selectAll() {
    const ids = filteredAnime.map((anime) => anime.mal_id);

    setSelectedAnime((current) => {
      const merged = new Set([...current, ...ids]);
      return Array.from(merged);
    });
  }

  function clearSelection() {
    setSelectedAnime([]);
  }

  async function importAnime() {
    if (selectedAnime.length === 0) {
      setStatus("error");
      setMessage("Select at least one anime.");
      return;
    }

    try {
      setImporting(true);
      setStatus("idle");
      setMessage("");

      /*
       * The backend needs to know *which* Track Social
       * Hub user this import belongs to. Passing the
       * current session's access token as a Bearer header
       * is what lets the API route identify the user
       * server-side (supabase.auth.getUser() alone won't
       * work reliably in a server route).
       */
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Please login first.");
      }

      const animeToImport = animeList.filter((anime) =>
        selectedAnime.includes(anime.mal_id)
      );

      const response = await fetch("/api/mal/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          status: selectedStatus,
          anime: animeToImport,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.error || "Failed to import anime."
        );
      }

      const importedCount =
        Number(result?.imported ?? animeToImport.length);

      const skippedCount = Number(result?.skipped ?? 0);

      setStatus("success");

      setMessage(
        `${importedCount} anime imported to Anime ${
          skippedCount > 0
            ? `• ${skippedCount} already existed`
            : ""
        }`
      );

      setSelectedAnime([]);

      /*
       * Dashboard / AnimeBrowser / Watchlist যেন
       * নতুন data সাথে সাথে দেখতে পারে।
       */
      window.dispatchEvent(
        new CustomEvent("anime-imported", {
          detail: {
            status: selectedStatus,
            count: importedCount,
          },
        })
      );

      /*
       * Supabase realtime না থাকলেও অন্য component
       * refresh করার সুযোগ থাকবে।
       */
      window.dispatchEvent(
        new Event("watch-stats-updated")
      );
    } catch (error) {
      console.error("MAL import error:", error);

      setStatus("error");

      setMessage(
        error instanceof Error
          ? error.message
          : "Failed to import anime."
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-white/40">
            MyAnimeList
          </p>

          <h2 className="mt-1 text-2xl font-bold">
            Import from MAL
          </h2>

          <p className="mt-1 text-sm text-white/50">
            Import your MAL anime list directly into the
            Anime category.
          </p>
        </div>

        {source === "api" ? (
          <button
            type="button"
            onClick={loadMALAnime}
            disabled={loading || importing}
            className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh MAL"}
          </button>
        ) : (
          <button
            type="button"
            onClick={switchToLiveApi}
            disabled={importing}
            className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Use Live MAL Account
          </button>
        )}
      </div>

      {/* Source: Live account vs XML upload */}
      <div className="mb-5 rounded-xl border border-white/10 bg-black/10 p-4">
        <p className="mb-3 text-sm font-medium text-white/70">
          Import Source
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label
            className={[
              "flex-1 cursor-pointer rounded-xl border px-4 py-3 text-center text-sm font-semibold transition",
              source === "api"
                ? "border-white/30 bg-white text-black"
                : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]",
            ].join(" ")}
          >
            <input
              type="radio"
              name="mal-source"
              className="sr-only"
              checked={source === "api"}
              onChange={switchToLiveApi}
            />
            Live MAL Account
          </label>

          <label
            className={[
              "flex-1 cursor-pointer rounded-xl border px-4 py-3 text-center text-sm font-semibold transition",
              source === "xml"
                ? "border-white/30 bg-white text-black"
                : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]",
            ].join(" ")}
          >
            <input
              type="file"
              accept=".xml,text/xml"
              className="sr-only"
              onChange={handleXmlFileChange}
              disabled={loading || importing}
            />
            Upload XML File
          </label>
        </div>

        <p className="mt-3 text-xs text-white/40">
          {source === "xml" && xmlFileName
            ? `Currently using: ${xmlFileName} (${xmlAnimeList.length} anime total)`
            : "Get your XML export from MyAnimeList → Profile → Export List. Useful if the live account fetch fails or times out."}
        </p>
      </div>

      {/* Status Selector */}
      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-white/70">
          MAL Status
        </label>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {STATUS_OPTIONS.map((option) => {
            const active =
              selectedStatus === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  setSelectedStatus(option.value)
                }
                disabled={loading || importing}
                className={[
                  "rounded-xl border px-3 py-3 text-sm font-semibold transition",
                  active
                    ? "border-white/30 bg-white text-black"
                    : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                ].join(" ")}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <p className="mt-2 text-xs text-white/40">
          Showing MAL list:
          {" "}
          <span className="text-white/70">
            {statusLabel(selectedStatus)}
          </span>
          {" "}
          <span className="text-white/30">
            ({source === "xml" ? "from XML file" : "live account"})
          </span>
        </p>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(event) =>
            setSearch(event.target.value)
          }
          placeholder="Search anime..."
          className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/30"
        />
      </div>

      {/* Selection Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={selectAll}
          disabled={
            loading ||
            importing ||
            filteredAnime.length === 0
          }
          className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-semibold hover:bg-white/10 disabled:opacity-40"
        >
          Select All
        </button>

        <button
          type="button"
          onClick={clearSelection}
          disabled={
            loading ||
            importing ||
            selectedCount === 0
          }
          className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-semibold hover:bg-white/10 disabled:opacity-40"
        >
          Clear
        </button>

        <span className="ml-auto text-xs text-white/40">
          {selectedCount} selected
        </span>
      </div>

      {/* Anime List */}
      <div className="max-h-[500px] space-y-2 overflow-y-auto pr-1">
        {loading ? (
          <div className="rounded-xl border border-white/10 bg-black/10 p-6 text-center text-sm text-white/40">
            {source === "xml"
              ? "Reading your XML file..."
              : "Loading your MAL anime list..."}
          </div>
        ) : filteredAnime.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-black/10 p-6 text-center text-sm text-white/40">
            {source === "xml" && xmlAnimeList.length === 0
              ? "Upload a MAL XML export to get started."
              : "No anime found for this MAL status."}
          </div>
        ) : (
          filteredAnime.map((anime) => {
            const checked = selectedAnime.includes(
              anime.mal_id
            );

            const watched =
              anime.my_list_status
                ?.num_episodes_watched ?? 0;

            const totalEpisodes =
              anime.num_episodes ?? null;

            return (
              <label
                key={anime.mal_id}
                className={[
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition",
                  checked
                    ? "border-white/30 bg-white/[0.08]"
                    : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                ].join(" ")}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    toggleAnime(anime.mal_id)
                  }
                  className="h-4 w-4 accent-white"
                />

                {anime.main_picture?.medium ? (
                  <img
                    src={anime.main_picture.medium}
                    alt={anime.title}
                    className="h-16 w-12 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-12 items-center justify-center rounded-lg bg-white/10 text-[10px] text-white/30">
                    No image
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">
                    {anime.title}
                  </div>

                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/40">
                    <span>
                      MAL ID: {anime.mal_id}
                    </span>

                    {totalEpisodes ? (
                      <span>
                        Episodes: {watched}/
                        {totalEpisodes}
                      </span>
                    ) : (
                      <span>
                        Watched: {watched}
                      </span>
                    )}

                    {anime.my_list_status?.score ? (
                      <span>
                        Score:{" "}
                        {anime.my_list_status.score}
                      </span>
                    ) : null}
                  </div>
                </div>

                <span className="hidden rounded-full border border-white/10 px-2 py-1 text-[10px] text-white/50 sm:inline-block">
                  {statusLabel(
                    normalizeStatus(
                      anime.my_list_status?.status
                    )
                  )}
                </span>
              </label>
            );
          })
        )}
      </div>

      {/* Import Button */}
      <div className="mt-5 flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">
            Import to Anime
          </p>

          <p className="text-xs text-white/40">
            Selected anime will be added to the Anime
            category with the selected MAL status.
          </p>
        </div>

        <button
          type="button"
          onClick={importAnime}
          disabled={
            importing ||
            loading ||
            selectedAnime.length === 0
          }
          className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {importing
            ? "Importing..."
            : `Import ${selectedCount || ""} Anime`}
        </button>
      </div>

      {/* Message */}
      {message ? (
        <div
          className={[
            "mt-4 rounded-xl border p-3 text-sm",
            status === "success"
              ? "border-green-400/20 bg-green-400/5 text-green-300"
              : "border-red-400/20 bg-red-400/5 text-red-300",
          ].join(" ")}
        >
          {message}
        </div>
      ) : null}
    </section>
  );
}