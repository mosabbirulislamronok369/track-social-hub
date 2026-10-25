"use client";

import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

// Components
import Sidebar, { SidebarSection } from "./components/Sidebar";
import Login from "./components/Login";
import Dashboard from "./components/Dashboard";
import UniversalBrowser from "./components/UniversalBrowser";
import FavouriteList from "./components/FavouriteList";
import RatingBoard from "./components/RatingBoard";
import Leaderboard from "./components/Leaderboard";
import RecommendedPage from "./components/RecommendedPage";
import Profile from "./components/Profile";
import IslamicTrack from "./components/IslamicTrack";
import EventCountdown from "./components/EventCountdown";
import PrivateWatchlist from "./components/PrivateWatchlist";
import MALImport from "./components/MALImport";
import IMDBImport from "./components/IMDBImport";
import TMDBImport from "./components/TMDBImport";

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<SidebarSection>("dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  const renderContent = () => {
    switch (activeSection) {
      case "dashboard":
        return <Dashboard />;
      case "browse":
        return <UniversalBrowser />;
      case "watchlist":
        return <PrivateWatchlist />;
      case "favourites":
        return <FavouriteList />;
      case "ratings":
        return <RatingBoard />;
      case "leaderboard":
        return <Leaderboard />;
      case "recommended":
        return <RecommendedPage />;
      case "profile":
        return <Profile />;
      case "islamic":
        return <IslamicTrack />;
      case "countdown":
        return <EventCountdown />;
      case "import":
        return (
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
            <h1 className="text-3xl font-bold text-white mb-6">Import Content</h1>
            <div className="grid gap-8">
              <MALImport />
              <IMDBImport />
              <TMDBImport />
            </div>
          </div>
        );
      // "social" কেসটি সম্পূর্ণ বাদ দেওয়া হয়েছে
      default:
        return <Dashboard />;
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#070711] text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-purple-500"></div>
          <p className="text-sm text-white/50">Loading Track Social Hub...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  return (
    <div className="flex min-h-screen bg-[#070711] text-white">
      <Sidebar
        active={activeSection}
        onSelect={setActiveSection}
        userEmail={session.user.email}
        onSignOut={handleSignOut}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />

      <main className="flex-1 overflow-x-hidden">
        {/* Top mobile header (optional, for hamburger menu) */}
        <div className="flex items-center justify-between p-4 md:hidden border-b border-white/10">
          <div className="flex items-center gap-2">
             <span className="text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-500">
               TSH
             </span>
          </div>
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="rounded-lg p-2 text-white/50 hover:bg-white/5 hover:text-white"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>

        <div className="pb-20">
          {renderContent()}
        </div>
      </main>
    </div>
  );
}