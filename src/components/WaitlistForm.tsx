"use client";

import React, { useState } from "react";
import { Sparkles, CheckCircle2, ArrowRight, Loader2 } from "lucide-react";

interface WaitlistFormProps {
  source?: string;
}

export function WaitlistForm({ source = "landing" }: WaitlistFormProps) {
  const [email, setEmail] = useState("");
  const [githubUsername, setGithubUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrMsg(null);
    try {
      const res = await fetch("/api/v1/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, githubUsername, source }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Unable to submit");
      setDoneMsg(json.message || "Joined waitlist!");
      setEmail("");
      setGithubUsername("");
    } catch (err: unknown) {
      setErrMsg(err instanceof Error ? err.message : "Failed to join");
    } finally {
      setBusy(false);
    }
  };

  if (doneMsg) {
    return (
      <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-center gap-2">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span>{doneMsg}</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2.5 max-w-lg mx-auto">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@domain.dev"
          className="flex-1 px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
        <input
          type="text"
          value={githubUsername}
          onChange={(e) => setGithubUsername(e.target.value)}
          placeholder="@github (optional)"
          className="sm:w-40 px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 font-mono"
        />
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 shrink-0 transition disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          <span>Get Beta Invite</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
      {errMsg && <p className="text-xs text-red-400 text-center">{errMsg}</p>}
    </form>
  );
}
