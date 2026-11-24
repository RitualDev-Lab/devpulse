"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ padding: "2rem", fontFamily: "monospace", color: "#f87171", background: "#09090b" }}>
        <h1 style={{ fontSize: "1.5rem", color: "#ef4444" }}>Critical Application Error</h1>
        <p style={{ marginTop: "1rem", whiteSpace: "pre-wrap" }}>{error?.message || String(error)}</p>
        {error?.digest && <p style={{ color: "#a1a1aa" }}>Digest: {error.digest}</p>}
        <button
          onClick={() => reset()}
          style={{ marginTop: "1.5rem", padding: "0.5rem 1rem", background: "#27272a", color: "#fff", border: "1px solid #3f3f46", borderRadius: "4px", cursor: "pointer" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
