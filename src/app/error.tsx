"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("DevPulse Global Error:", error);
  }, [error]);

  return (
    <div style={{ padding: "2rem", fontFamily: "monospace", color: "#f87171", background: "#09090b", minHeight: "100vh" }}>
      <h1 style={{ fontSize: "1.5rem", color: "#ef4444" }}>Runtime Error</h1>
      <p style={{ marginTop: "1rem", whiteSpace: "pre-wrap" }}>{error?.message || String(error)}</p>
      {error?.digest && <p style={{ color: "#a1a1aa" }}>Digest: {error.digest}</p>}
      <button
        onClick={() => reset()}
        style={{ marginTop: "1.5rem", padding: "0.5rem 1rem", background: "#27272a", color: "#fff", border: "1px solid #3f3f46", borderRadius: "4px", cursor: "pointer" }}
      >
        Try again
      </button>
    </div>
  );
}
