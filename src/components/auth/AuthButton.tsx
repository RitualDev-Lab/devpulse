"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LogOut, User as UserIcon, KeyRound } from "lucide-react";
import type { User } from "@supabase/supabase-js";

interface SsoUserSummary {
  id: string;
  githubUsername: string;
  name: string | null;
  email: string | null;
}

export function AuthButton() {
  const [user, setUser] = useState<User | null>(null);
  const [ssoUser, setSsoUser] = useState<SsoUserSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!active) return;
      if (data.user) {
        setUser(data.user);
        setLoading(false);
        return;
      }
      try {
        const res = await fetch("/api/auth/saml?action=session");
        const s = await res.json();
        if (active && s.authenticated && s.user) {
          setSsoUser(s.user);
        }
      } catch {
        // ignore session probe failures
      } finally {
        if (active) setLoading(false);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) setSsoUser(null);
      setLoading(false);
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [supabase]);

  const handleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        scopes: "read:user user:email read:org",
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    if (ssoUser) {
      await fetch("/api/auth/saml", { method: "DELETE" }).catch(() => {});
    }
    setUser(null);
    setSsoUser(null);
    window.location.href = "/";
  };

  if (loading) {
    return (
      <div className="w-20 h-8 rounded-xl bg-zinc-900 border border-zinc-800 animate-pulse" />
    );
  }

  if (ssoUser && !user) {
    const label = ssoUser.name || ssoUser.email || ssoUser.githubUsername;
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-zinc-900 border border-cyan-500/40 text-xs">
          <KeyRound className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-semibold text-zinc-200 max-w-[140px] truncate">{label}</span>
          <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300">
            SSO
          </span>
        </div>
        <button
          onClick={handleSignOut}
          title="Sign out"
          className="p-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-red-400 transition"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (user) {
    const avatarUrl = user.user_metadata?.avatar_url;
    const username = user.user_metadata?.user_name || user.email?.split("@")[0] || "Maintainer";

    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-zinc-900 border border-zinc-800 text-xs">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={username}
              className="w-5 h-5 rounded-full border border-zinc-700"
            />
          ) : (
            <UserIcon className="w-3.5 h-3.5 text-zinc-400" />
          )}
          <span className="font-semibold text-zinc-200">{username}</span>
        </div>
        <button
          onClick={handleSignOut}
          title="Sign out"
          className="p-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-red-400 transition"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleSignIn}
      className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r from-zinc-800 to-zinc-900 hover:from-zinc-700 hover:to-zinc-800 border border-zinc-700 text-xs font-semibold text-white transition shadow-sm"
    >
      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
      </svg>
      <span>Sign In</span>
    </button>
  );
}
