"use client";

import React, { useState } from "react";
import { Bug, Sparkles } from "lucide-react";
import { BugReportClientForm } from "./BugReportClientForm";
import { FeedbackBoardClient } from "@/components/portal/FeedbackBoardClient";

export function ReportPortalTabsClient({
  projectSlug,
  projectName,
  turnstileSiteKey,
  initialTab = "bug",
}: {
  projectSlug: string;
  projectName: string;
  turnstileSiteKey: string;
  initialTab?: "bug" | "feedback";
}) {
  const [tab, setTab] = useState<"bug" | "feedback">(initialTab);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-zinc-950 border border-zinc-800">
        <button
          type="button"
          onClick={() => setTab("bug")}
          className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-semibold transition ${
            tab === "bug"
              ? "bg-red-500/15 text-red-200 border border-red-500/30"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          <Bug className="w-3.5 h-3.5" />
          <span>Report Crash / Bug</span>
        </button>

        <button
          type="button"
          onClick={() => setTab("feedback")}
          className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-semibold transition ${
            tab === "feedback"
              ? "bg-indigo-500/20 text-indigo-200 border border-indigo-500/40"
              : "text-zinc-400 hover:text-white"
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Feature Voting</span>
        </button>
      </div>

      {tab === "bug" ? (
        <BugReportClientForm
          projectSlug={projectSlug}
          projectName={projectName}
          turnstileSiteKey={turnstileSiteKey}
        />
      ) : (
        <FeedbackBoardClient projectSlug={projectSlug} projectName={projectName} />
      )}
    </div>
  );
}
