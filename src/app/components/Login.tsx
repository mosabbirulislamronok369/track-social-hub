"use client";

import { supabase } from "../lib/supabase";

export default function Login() {
  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) {
      console.error("Google login error:", error.message);
      alert(error.message);
    }
  };

  return (
    <main className="min-h-screen bg-[#070711] text-white flex items-center justify-center">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
        <h1 className="text-3xl font-bold mb-2">
          Welcome to Track Social Hub
        </h1>

        <p className="text-white/50 mb-8">
          Sign in to continue
        </p>

        <button
          onClick={handleGoogleLogin}
          className="w-full rounded-xl bg-white text-black py-3 font-semibold hover:bg-gray-200 transition"
        >
          Continue with Google
        </button>
      </div>
    </main>
  );
}