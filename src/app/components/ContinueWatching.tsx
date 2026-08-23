"use client";

import { useState } from "react";

const watching = [
  {
    title: "Attack on Titan",
    type: "Anime",
    progress: 72,
    episode: "S4 · Episode 18",
    remaining: "12 min remaining",
    image:
      "https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=800&q=80",
  },
  {
    title: "Interstellar",
    type: "Movie",
    progress: 48,
    episode: "Movie",
    remaining: "1h 02m remaining",
    image:
      "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=800&q=80",
  },
  {
    title: "Stranger Things",
    type: "TV Show",
    progress: 36,
    episode: "S4 · Episode 3",
    remaining: "28 min remaining",
    image:
      "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=800&q=80",
  },
];

type WatchingItem = (typeof watching)[number];

export default function ContinueWatching() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  /*
   * Details modal — opened by clicking anywhere on a card
   * (except the 3-dot menu, which stops propagation so it
   * doesn't also trigger the modal).
   */
  const [selectedItem, setSelectedItem] =
    useState<WatchingItem | null>(null);

  return (
    <section className="mt-10">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-white/30">
            Keep going
          </p>

          <h3 className="mt-1 text-xl font-semibold">
            Continue Watching
          </h3>
        </div>

        <button className="text-sm text-purple-400 transition hover:text-purple-300">
          View library
        </button>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {watching.map((item) => (
          <article
            key={item.title}
            onClick={() => setSelectedItem(item)}
            className="group cursor-pointer overflow-visible rounded-2xl border border-white/10 bg-white/[0.04] transition hover:border-white/20"
          >
            {/* Image */}
            <div className="relative h-44 overflow-hidden rounded-t-2xl">
              <img
                src={item.image}
                alt={item.title}
                className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
              />

              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

              {/* 3-dot menu */}
              <button
                onClick={(event) => {
                  event.stopPropagation();

                  setOpenMenu(
                    openMenu === item.title ? null : item.title,
                  );
                }}
                className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-lg text-white backdrop-blur-md transition hover:bg-black/80"
              >
                ⋮
              </button>

              {/* Menu */}
              {openMenu === item.title && (
                <div
                  onClick={(event) => event.stopPropagation()}
                  className="absolute right-3 top-14 z-20 w-48 overflow-hidden rounded-xl border border-white/10 bg-[#151522]/95 p-1 shadow-2xl backdrop-blur-xl"
                >
                  {[
                    "Add Watch Time",
                    "Mark Watched",
                    "Re-watch",
                    "Add to Library",
                    "Favorite",
                    "Watch Later",
                    "Remove",
                  ].map((action) => (
                    <button
                      key={action}
                      onClick={() => setOpenMenu(null)}
                      className="w-full rounded-lg px-3 py-2.5 text-left text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              )}

              {/* Type */}
              <div className="absolute bottom-4 left-4">
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/70 backdrop-blur-md">
                  {item.type}
                </span>
              </div>
            </div>

            {/* Content */}
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold">{item.title}</h4>

                  <p className="mt-1 text-xs text-white/40">
                    {item.episode}
                  </p>
                </div>

                <span className="text-xs font-semibold text-purple-400">
                  {item.progress}%
                </span>
              </div>

              {/* Progress */}
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-purple-500 to-blue-500"
                  style={{ width: `${item.progress}%` }}
                />
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-[11px] text-white/30">
                  {item.remaining}
                </span>

                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedItem(item);
                  }}
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-white/90"
                >
                  Resume
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {/* DETAILS MODAL */}
      {selectedItem && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setSelectedItem(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-[#11111a] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="grid md:grid-cols-[220px_1fr]">
              {/* MODAL IMAGE */}
              <div className="relative aspect-[2/3] md:aspect-auto">
                <img
                  src={selectedItem.image}
                  alt={selectedItem.title}
                  className="h-full w-full object-cover"
                />
              </div>

              {/* MODAL CONTENT */}
              <div className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold">
                      {selectedItem.title}
                    </h2>

                    <p className="mt-1 text-sm text-white/40">
                      {selectedItem.episode}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedItem(null)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:bg-white/10"
                  >
                    ✕
                  </button>
                </div>

                {/* META */}
                <div className="mt-5 flex flex-wrap gap-2">
                  <span className="rounded-full bg-white/5 px-3 py-1 text-sm text-white/60">
                    {selectedItem.type}
                  </span>

                  <span className="rounded-full bg-purple-500/10 px-3 py-1 text-sm text-purple-300">
                    {selectedItem.progress}% watched
                  </span>
                </div>

                {/* PROGRESS */}
                <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-wider text-white/30">
                    Progress
                  </p>

                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500"
                      style={{ width: `${selectedItem.progress}%` }}
                    />
                  </div>

                  <p className="mt-3 text-sm text-white/60">
                    {selectedItem.remaining}
                  </p>
                </div>

                {/* ACTIONS */}
                <div className="mt-6 grid gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedItem(null)}
                    className="h-11 rounded-xl bg-white font-semibold text-black transition hover:bg-white/90"
                  >
                    Resume Watching
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedItem(null)}
                    className="h-11 rounded-xl border border-white/10 bg-white/5 font-semibold text-white transition hover:bg-white/10"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}