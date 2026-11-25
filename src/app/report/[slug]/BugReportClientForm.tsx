"use client";

import React, { useState } from "react";
import { Send, CheckCircle2, AlertOctagon, Terminal } from "lucide-react";

interface BugReportClientFormProps {
  apiKey: string;
  projectName: string;
}

export function BugReportClientForm({ apiKey, projectName }: BugReportClientFormProps) {
  const [errorName, setErrorName] = useState("");
  const [message, setMessage] = useState("");
  const [stackTrace, setStackTrace] = useState("");
  const [runtime, setRuntime] = useState("node");
  const [reporterEmail, setReporterEmail] = useState("");
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [attachmentText, setAttachmentText] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setAttachmentName(null);
      setAttachmentText(null);
      return;
    }
    if (file.size > 512 * 1024) {
      setErrorMessage("Attachment exceeds 500 KB max limit.");
      return;
    }
    const text = await file.text();
    setAttachmentName(file.name);
    setAttachmentText(text);
    setErrorMessage("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    try {
      const res = await fetch("/api/v1/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          errorName: errorName || "UserReportedBug",
          message,
          stackTrace: stackTrace || null,
          runtime,
          environment: "production",
          reporterEmail: reporterEmail || null,
          attachment: attachmentText || undefined,
          attachmentName: attachmentName || undefined,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to deliver report. Please try again.");
      }

      setSubmitted(true);
    } catch (err: any) {
      setErrorMessage(err.message || "An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="text-center py-8 space-y-3">
        <div className="w-12 h-12 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-400 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-white">Report Delivered Successfully</h3>
        <p className="text-sm text-zinc-400 max-w-sm mx-auto">
          Thank you! Your bug report and diagnostics have been sent directly to the {projectName} team on DevPulse.
        </p>
        <button
          onClick={() => {
            setSubmitted(false);
            setMessage("");
            setStackTrace("");
            setErrorName("");
          }}
          className="mt-4 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition"
        >
          Submit Another Report
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {errorMessage && (
        <div className="p-3 rounded-xl bg-red-950/60 border border-red-800 text-red-300 text-xs flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-zinc-300 mb-1">
          Issue Title / Error Headline *
        </label>
        <input
          type="text"
          required
          value={errorName}
          onChange={(e) => setErrorName(e.target.value)}
          placeholder="e.g. CLI crashes with TypeError when token is undefined"
          className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1">
            Environment / Runtime
          </label>
          <select
            value={runtime}
            onChange={(e) => setRuntime(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white focus:outline-none focus:border-indigo-500 transition"
          >
            <option value="node">Node.js (npm)</option>
            <option value="python">Python (PyPI)</option>
            <option value="cli">CLI Tool</option>
            <option value="browser">Web Browser</option>
            <option value="vscode">VS Code Extension</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1">
            Your Email (Optional)
          </label>
          <input
            type="email"
            value={reporterEmail}
            onChange={(e) => setReporterEmail(e.target.value)}
            placeholder="For resolution updates"
            className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-zinc-300 mb-1">
          Detailed Description / Steps to Reproduce *
        </label>
        <textarea
          required
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What command or function did you run? What happened vs what did you expect?"
          className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-zinc-300 mb-1 flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5 text-zinc-400" />
          <span>Error Log / Stack Trace (Optional)</span>
        </label>
        <textarea
          rows={4}
          value={stackTrace}
          onChange={(e) => setStackTrace(e.target.value)}
          placeholder="Paste terminal error logs or stack trace here..."
          className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 font-mono text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-zinc-300 mb-1">
          Attach Log File (Optional &bull; Stored in R2 up to 500 KB)
        </label>
        <input
          type="file"
          accept=".log,.txt,.json"
          onChange={handleFileChange}
          className="w-full text-xs text-zinc-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-zinc-700 file:text-xs file:font-semibold file:bg-zinc-900 file:text-zinc-200 hover:file:bg-zinc-800"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 transition disabled:opacity-50"
      >
        <Send className="w-4 h-4" />
        <span>{submitting ? "Delivering Report..." : "Submit Bug Report"}</span>
      </button>
    </form>
  );
}
