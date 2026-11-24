"use client";

import React, { useState, useEffect, useRef } from "react";
import { Send, CheckCircle2, AlertOctagon, Terminal, Paperclip, X, Loader2, ShieldCheck } from "lucide-react";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

interface BugReportClientFormProps {
  projectSlug: string;
  projectName: string;
  turnstileSiteKey: string;
}

export function BugReportClientForm({
  projectSlug,
  projectName,
  turnstileSiteKey,
}: BugReportClientFormProps) {
  const [errorName, setErrorName] = useState("");
  const [message, setMessage] = useState("");
  const [stackTrace, setStackTrace] = useState("");
  const [runtime, setRuntime] = useState("node");
  const [reporterEmail, setReporterEmail] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (submitted || !turnstileSiteKey) return;

    const renderWidget = () => {
      if (!window.turnstile || !turnstileContainerRef.current) return;
      if (widgetIdRef.current) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore
        }
      }
      widgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
        sitekey: turnstileSiteKey,
        theme: "dark",
        callback: (token: string) => setTurnstileToken(token),
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => setTurnstileToken(""),
      });
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]'
      );
      if (existingScript) {
        existingScript.addEventListener("load", renderWidget);
      } else {
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.onload = renderWidget;
        document.head.appendChild(script);
      }
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore
        }
        widgetIdRef.current = null;
      }
    };
  }, [submitted, turnstileSiteKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!turnstileToken) {
      setErrorMessage("Please complete the Cloudflare Turnstile verification check first.");
      return;
    }

    setSubmitting(true);
    setErrorMessage("");

    try {
      let attachmentKey: string | null = null;

      // Direct Cloudflare R2 presigned upload for bug report screenshot or heavy log file
      if (attachmentFile) {
        setUploadingAttachment(true);
        const presignRes = await fetch("/api/v1/storage/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectSlug,
            turnstileToken,
            filename: attachmentFile.name,
            contentType: attachmentFile.type || "application/octet-stream",
            sizeBytes: attachmentFile.size,
          }),
        });

        const presignData = await presignRes.json();
        if (!presignRes.ok) {
          throw new Error(presignData.error || "Attachment upload rejected by storage quota guard.");
        }

        const uploadRes = await fetch(presignData.uploadUrl, {
          method: "PUT",
          body: attachmentFile,
        });

        if (!uploadRes.ok) {
          throw new Error("Failed to upload attachment to Cloudflare R2.");
        }

        attachmentKey = presignData.objectKey;
        setUploadingAttachment(false);
      }

      const res = await fetch("/api/v1/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectSlug,
          turnstileToken,
          errorName: errorName || "UserReportedBug",
          message,
          stackTrace: stackTrace || null,
          runtime,
          reporterEmail: reporterEmail || null,
          attachmentKey,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
          setTurnstileToken("");
        }
        throw new Error(data.error || "Failed to deliver report. Please try again.");
      }

      setSubmitted(true);
    } catch (err: any) {
      setErrorMessage(err.message || "An unexpected error occurred.");
    } finally {
      setUploadingAttachment(false);
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
            setAttachmentFile(null);
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
            <option value="rust">Rust (crates.io)</option>
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
          <span>Error Log / Stack Trace (Optional — heavy 100 KB+ logs offload to R2)</span>
        </label>
        <textarea
          rows={4}
          value={stackTrace}
          onChange={(e) => setStackTrace(e.target.value)}
          placeholder="Paste terminal error logs or stack trace here..."
          className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 font-mono text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition resize-none"
        />
      </div>

      {/* Screenshot / Log Attachment via Cloudflare R2 Presigned URL */}
      <div>
        <label className="block text-xs font-semibold text-zinc-300 mb-1 flex items-center gap-1.5">
          <Paperclip className="w-3.5 h-3.5 text-cyan-400" />
          <span>Screenshot or Log Attachment (Optional &bull; Direct Cloudflare R2 Upload)</span>
        </label>
        {attachmentFile ? (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-zinc-950 border border-cyan-500/40 text-xs text-zinc-200">
            <span className="truncate font-mono">
              {attachmentFile.name} ({Math.max(1, Math.round(attachmentFile.size / 1024))} KB)
            </span>
            <button
              type="button"
              onClick={() => setAttachmentFile(null)}
              className="text-zinc-400 hover:text-white p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,.txt,.log,.json"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setAttachmentFile(f);
            }}
            className="w-full text-xs text-zinc-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-zinc-800 file:text-zinc-200 hover:file:bg-zinc-700 cursor-pointer"
          />
        )}
      </div>

      {/* Cloudflare Turnstile Bot Verification */}
      <div className="p-3 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-2">
        <div className="flex items-center justify-between text-[11px] text-zinc-400">
          <span className="flex items-center gap-1.5 font-medium text-zinc-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            Human Verification (Cloudflare Turnstile)
          </span>
          {turnstileToken && (
            <span className="text-emerald-400 font-semibold">Verified</span>
          )}
        </div>
        <div ref={turnstileContainerRef} className="min-h-[65px] flex items-center" />
      </div>

      <button
        type="submit"
        disabled={submitting || !turnstileToken}
        className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 transition disabled:opacity-50"
      >
        {uploadingAttachment ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Uploading Attachment to R2...</span>
          </>
        ) : (
          <>
            <Send className="w-4 h-4" />
            <span>{submitting ? "Delivering Report..." : "Submit Bug Report"}</span>
          </>
        )}
      </button>
    </form>
  );
}
