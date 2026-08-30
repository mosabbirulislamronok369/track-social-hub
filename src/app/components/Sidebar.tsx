"use client";

import { useState, type ReactElement } from "react";
export type SidebarSection =
  | "dashboard"
  | "browse"
  | "anime"
  | "watchlist"
  | "ratings"
  | "profile"
  | "import"
  | "leaderboard"
  | "recommended"
  | "islamic"
  | "countdown"
  | "favourites";

type NavItem = {
  id: SidebarSection;
  label: string;
icon: ReactElement;
};

/*
 * Minimal inline line-icons (no icon library dependency —
 * keeps this component drop-in without adding packages).
 */
function IconDashboard() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
      <rect
        x="3.5"
        y="3.5"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect
        x="13.5"
        y="3.5"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect
        x="3.5"
        y="13.5"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect
        x="13.5"
        y="13.5"
        width="7"
        height="7"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function IconBrowse() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
      <circle
        cx="10.5"
        cy="10.5"
        r="6.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M20 20l-4.7-4.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconAnime() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
      <path
        d="M4 17c1.8-6 4.6-11 8-11s6.2 5 8 11"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="9" cy="10" r="1" fill="currentColor" />
      <circle cx="15" cy="10" r="1" fill="currentColor" />
      <path
        d="M4 17h16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconWatchlist() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
      <path
        d="M6 3.5h12v17l-6-4-6 4v-17z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconRating() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
      <path
        d="M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconProfile() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
      <circle
        cx="12"
        cy="8"
        r="3.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M4.5 20c1.4-3.6 4.4-5.5 7.5-5.5s6.1 1.9 7.5 5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconImport() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
      <path
        d="M12 4v11m0 0l-4-4m4 4l4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.5 17v2.2c0 .7.6 1.3 1.3 1.3h12.4c.7 0 1.3-.6 1.3-1.3V17"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconLeaderboard() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
      <path
        d="M8 4h8v6a4 4 0 01-8 0V4z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8 6H5.5A1.5 1.5 0 004 7.5v1A3.5 3.5 0 007.5 12H8M16 6h2.5A1.5 1.5 0 0120 7.5v1A3.5 3.5 0 0116.5 12H16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M12 14v3m-3 3h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconGift() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
      <rect
        x="4"
        y="9"
        width="16"
        height="11"
        rx="1.2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M4 9h16v3H4z" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 9v11M12 9c-1.5-4-6-4-6-1.2C6 9 12 9 12 9zM12 9c1.5-4 6-4 6-1.2C18 9 12 9 12 9z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconIslamic() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
      <path
        d="M15.5 4.5A8 8 0 1019.5 18a7 7 0 01-4-13.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 6.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7.7-1.6z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconCountdown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
      <circle
        cx="12"
        cy="13"
        r="7.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M12 9v4l2.6 2.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 2.5h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M12 2.5V4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconFavourite() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
      <path
        d="M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.15"
      />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: <IconDashboard /> },
  { id: "countdown", label: "Countdown", icon: <IconCountdown /> },
  { id: "islamic", label: "Islamic Track", icon: <IconIslamic /> },
  { id: "browse", label: "Browse", icon: <IconBrowse /> },

  { id: "leaderboard", label: "Leaderboard", icon: <IconLeaderboard /> },
  { id: "recommended", label: "Recommended", icon: <IconGift /> },
  { id: "favourites", label: "Favourites", icon: <IconFavourite /> },
  { id: "watchlist", label: "Watchlist", icon: <IconWatchlist /> },
  { id: "ratings", label: "Ratings", icon: <IconRating /> },
  { id: "profile", label: "Profile", icon: <IconProfile /> },
  { id: "import", label: "Import", icon: <IconImport /> },
];

export default function Sidebar({
  active,
  onSelect,
  userEmail,
  onSignOut,
  mobileOpen = false,
  onMobileClose,
}: {
  active: SidebarSection;
  onSelect: (section: SidebarSection) => void;
  userEmail?: string | null;
  onSignOut: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  function handleSelect(section: SidebarSection) {
    onSelect(section);

    if (onMobileClose) {
      onMobileClose();
    }
  }

  return (
    <>
      {/* MOBILE BACKDROP — tap outside to close */}
      {mobileOpen && (
        <div
          onClick={onMobileClose}
          className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-screen flex-col border-r border-white/[0.07] bg-[#08080f]/95 backdrop-blur-2xl transition-transform duration-300 md:sticky md:top-0 md:z-20 md:translate-x-0 md:bg-[#08080f]/70 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "md:w-[76px]" : "md:w-64"} w-72`}
      >
        {/* BRAND */}
        <div className="flex items-center gap-3 px-5 py-6">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--accent)_0%,var(--accent-2)_100%)] font-black text-white shadow-[0_8px_24px_-8px_var(--accent-soft)]">
            <span className="relative z-10">T</span>
            <span className="absolute inset-0 rounded-xl bg-white/20 opacity-0 blur-md transition-opacity duration-300 hover:opacity-40" />
          </div>

          {!collapsed && (
            <div className="min-w-0">
              <span className="block truncate text-[15px] font-bold tracking-tight text-white">
                track-social-hub
              </span>
              <span className="eyebrow block">personal watch data</span>
            </div>
          )}

          {/* MOBILE CLOSE BUTTON */}
          <button
            type="button"
            onClick={onMobileClose}
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/50 hover:bg-white/[0.06] hover:text-white md:hidden"
          >
            ✕
          </button>
        </div>

        <div className="mx-5 mb-2 h-px bg-gradient-to-r from-white/[0.09] via-white/[0.03] to-transparent" />

        {/* NAV */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
          {NAV_ITEMS.map((item) => {
            const isActive = active === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                title={item.label}
                className={`group relative flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${
                  isActive
                    ? "bg-[var(--accent-soft)] text-white"
                    : "text-white/45 hover:bg-white/[0.05] hover:text-white/85"
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[linear-gradient(180deg,var(--accent)_0%,var(--accent-2)_100%)] shadow-[0_0_12px_1px_var(--accent-soft)]" />
                )}

                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 ${
                    isActive
                      ? "bg-white/[0.08] text-[var(--accent-2)]"
                      : "text-white/35 group-hover:text-white/70"
                  }`}
                >
                  {item.icon}
                </span>

                {!collapsed && (
                  <span className="truncate">{item.label}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="mx-5 h-px bg-gradient-to-r from-white/[0.09] via-white/[0.03] to-transparent" />

        {/* USER + COLLAPSE */}
        <div className="p-3">
          {!collapsed && userEmail && (
            <div className="mb-2 flex items-center gap-2.5 rounded-[var(--radius-sm)] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent-2)]">
                {userEmail[0]?.toUpperCase()}
              </div>
              <span className="truncate text-xs text-white/45">
                {userEmail}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={onSignOut}
            className={`mb-1 flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-sm font-semibold text-white/45 transition-colors duration-200 hover:bg-red-500/[0.08] hover:text-red-300 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-[18px] w-[18px] shrink-0"
            >
              <path
                d="M9 4H6a2 2 0 00-2 2v12a2 2 0 002 2h3M16 16l4-4-4-4M20 12H9"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>

            {!collapsed && <span>Sign Out</span>}
          </button>

          <button
            type="button"
            onClick={() => setCollapsed((current) => !current)}
            className="hidden w-full items-center justify-center rounded-[var(--radius-sm)] px-3 py-2 text-white/25 transition-colors duration-200 hover:bg-white/[0.05] hover:text-white/60 md:flex"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className={`h-4 w-4 transition-transform duration-300 ${
                collapsed ? "rotate-180" : ""
              }`}
            >
              <path
                d="M14.5 5l-7 7 7 7"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </aside>
    </>
  );
}