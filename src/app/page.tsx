"use client";

import RecommendedPage from "./components/RecommendedPage";
import Leaderboard from "./components/Leaderboard";
import WatchEngine from "./components/WatchEngine";
import Dashboard from "./components/Dashboard";
import UniversalBrowser from "./components/UniversalBrowser";
import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import Login from "./components/Login";
import Sidebar, { SidebarSection } from "./components/Sidebar";
import MALImport from "./components/MALImport";
import TMDBImport from "./components/TMDBImport";
import IMDBImport from "./components/IMDBImport";
import PrivateWatchlist from "./components/PrivateWatchlist";
import RatingBoard from "./components/RatingBoard";
import Profile from "./components/Profile";

type ImportSource = "mal" | "tmdb" | "imdb";

const IMPORT_TABS: { id: ImportSource; label: string }[] = [
  { id: "mal", label: "MyAnimeList" },
  { id: "tmdb", label: "TMDB" },
  { id: "imdb", label: "IMDb" },
];

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] =
    useState<SidebarSection>("dashboard");
  const [importTab, setImportTab] = useState<ImportSource>("mal");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#070711] text-white flex items-center justify-center">
        Loading...
      </main>
    );
  }

  if (!session) {
    return <Login />;
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <main className="relative flex min-h-screen bg-[#05050a] text-white">
      <div className="aurora-bg" />

      <Sidebar
        active={activeSection}
        onSelect={setActiveSection}
        userEmail={session.user.email}
        onSignOut={handleSignOut}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      <div className="relative z-10 flex-1 overflow-y-auto">
        {/* MOBILE TOP BAR — only shown below the md breakpoint,
            since the sidebar is permanently visible from md up. */}
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/[0.07] bg-[#05050a]/90 px-4 py-3 backdrop-blur-xl md:hidden">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/[0.06] hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path
                d="M4 6h16M4 12h16M4 18h16"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <span className="text-sm font-bold tracking-tight text-white">
            track-social-hub
          </span>
        </div>

        {/* Tracks overall app usage regardless of which
            section is active. */}
        <div className="mx-auto w-full max-w-6xl px-4 pt-6">
          <WatchEngine contentId="dashboard" category="Private" />
        </div>

        {activeSection === "dashboard" && (
          <div className="mx-auto w-full max-w-6xl px-4 pb-10">
            <Dashboard />
          </div>
        )}

        {activeSection === "browse" && <UniversalBrowser />}

      {activeSection === "recommended" && <RecommendedPage />}

        {activeSection === "leaderboard" && <Leaderboard />}

        {activeSection === "watchlist" && (
          <div className="mx-auto w-full max-w-6xl px-4 py-10">
            <PrivateWatchlist />
          </div>
        )}

        {activeSection === "ratings" && <RatingBoard />}

        {activeSection === "profile" && <Profile />}

        {activeSection === "import" && (
          <div className="mx-auto w-full max-w-6xl px-4 py-10">
            <h1 className="text-3xl font-bold tracking-tight">
              Import
            </h1>

            <p className="mt-2 text-white/50">
              Bring in your watchlist or history from another
              service.
            </p>

            <div className="mt-6 flex gap-2 border-b border-white/10 pb-px">
              {IMPORT_TABS.map((tab) => {
                const isActive = importTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setImportTab(tab.id)}
                    className={`rounded-t-lg px-4 py-2.5 text-sm font-semibold transition ${
                      isActive
                        ? "border-b-2 border-purple-400 text-white"
                        : "text-white/40 hover:text-white/70"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-8">
              {importTab === "mal" && <MALImport />}
              {importTab === "tmdb" && <TMDBImport />}
              {importTab === "imdb" && <IMDBImport />}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}