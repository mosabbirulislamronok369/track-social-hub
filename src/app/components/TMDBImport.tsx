"use client";

import { useState } from "react";

type ImportType = "movies" | "tv";

type TMDBItem = {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
};

export default function TMDBImport() {
  const [type, setType] = useState<ImportType>("movies");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TMDBItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const searchTMDB = async () => {
    if (!query.trim()) {
      setError("Please enter a movie or TV show name.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setMessage("");
      setResults([]);

      const response = await fetch(
        `/api/tmdb/${type}?query=${encodeURIComponent(query.trim())}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "TMDB search failed.");
      }

      setResults(data.results || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  };

  const importItem = async (item: TMDBItem) => {
    try {
      setImporting(item.id);
      setError("");
      setMessage("");

      const response = await fetch(`/api/tmdb/${type}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(item),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Import failed.");
      }

      const name = item.title || item.name || "Item";

      setMessage(`${name} imported successfully.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Import failed."
      );
    } finally {
      setImporting(null);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-6">
      <div className="rounded-xl border bg-background p-6 shadow-sm">
        <h2 className="text-2xl font-bold mb-2">
          Import from TMDB
        </h2>

        <p className="text-sm text-muted-foreground mb-6">
          Search TMDB and import movies or TV shows into your database.
        </p>

        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as ImportType);
              setResults([]);
              setMessage("");
              setError("");
            }}
            className="h-10 rounded-md border bg-background px-3"
          >
            <option value="movies">Movies</option>
            <option value="tv">TV Shows</option>
          </select>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                searchTMDB();
              }
            }}
            placeholder={
              type === "movies"
                ? "Search movies..."
                : "Search TV shows..."
            }
            className="h-10 flex-1 rounded-md border bg-background px-3"
          />

          <button
            type="button"
            onClick={searchTMDB}
            disabled={loading}
            className="h-10 rounded-md bg-primary px-5 text-primary-foreground disabled:opacity-50"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>

        {message && (
          <div className="mb-4 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-600">
            {message}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {results.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((item) => {
              const name = item.title || item.name || "Unknown";
              const date =
                item.release_date || item.first_air_date || "";

              const image = item.poster_path
                ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
                : null;

              return (
                <div
                  key={item.id}
                  className="overflow-hidden rounded-lg border bg-card"
                >
                  {image ? (
                    <img
                      src={image}
                      alt={name}
                      className="h-72 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-72 items-center justify-center bg-muted text-sm text-muted-foreground">
                      No Poster
                    </div>
                  )}

                  <div className="p-4">
                    <h3 className="font-semibold line-clamp-1">
                      {name}
                    </h3>

                    {date && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {date}
                      </p>
                    )}

                    {item.vote_average !== undefined && (
                      <p className="mt-1 text-sm">
                        ⭐ {item.vote_average.toFixed(1)}
                      </p>
                    )}

                    {item.overview && (
                      <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                        {item.overview}
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() => importItem(item)}
                      disabled={importing === item.id}
                      className="mt-4 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {importing === item.id
                        ? "Importing..."
                        : `Import ${type === "movies" ? "Movie" : "TV Show"}`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && query && results.length === 0 && !error && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No results found.
          </div>
        )}
      </div>
    </div>
  );
}