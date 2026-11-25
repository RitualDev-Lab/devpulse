"use client";

import React, { useState } from "react";
import { Bell, Rss, CheckCircle2, Loader2 } from "lucide-react";

export function StatusSubscribeWidget({
  projectId,
  projectSlug,
  rssHref,
}: {
  projectId?: string;
  projectSlug?: string;
  rssHref: string;
}) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || (!projectId && !projectSlug)) return;
    setSubmitting(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/v1/status/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectSlug,
          email: email.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMsg({ ok: true, text: data.message || "Subscribed to status updates!" });
        setEmail("");
      } else {
        setStatusMsg({ ok: false, text: data.error || "Could not subscribe email." });
      }
    } catch {
      setStatusMsg({ ok: false, text: "Network error — please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 rounded-2xl bg-zinc-900/80 border border-zinc-800 flex flex-wrap items-center justify-between gap-4">
      <div className="space-y-1">
        <div className="text-xs font-bold text-white flex items-center gap-1.5">
          <Bell className="w-3.5 h-3.5 text-indigo-400" />
          <span>Subscribe to Live Incident &amp; Outage Alerts</span>
        </div>
        <p className="text-[11px] text-zinc-400">
          Receive email notifications on service disruptions or follow updates via RSS reader.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {projectSlug && (
          <form onSubmit={handleSubscribe} className="flex items-center gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="px-3 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white focus:outline-none focus:border-indigo-500 w-48 sm:w-56"
            />
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              <span>Subscribe</span>
            </button>
          </form>
        )}

        <a
          href={rssHref}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-amber-300 flex items-center gap-1.5"
        >
          <Rss className="w-3.5 h-3.5" />
          <span>RSS Feed</span>
        </a>
      </div>

      {statusMsg && (
        <div
          className={`w-full text-[11px] flex items-center gap-1.5 ${
            statusMsg.ok ? "text-emerald-300" : "text-red-300"
          }`}
        >
          {statusMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : null}
          <span>{statusMsg.text}</span>
        </div>
      )}
    </div>
  );
}
