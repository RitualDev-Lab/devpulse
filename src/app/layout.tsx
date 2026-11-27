import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { PRESET_THEMES } from "@/lib/layout/css-scoper";
import "./globals.css";

const ALLOWED_THEMES = new Set([
  "dark",
  "devpulse-dark",
  "cyber-neon",
  "tokyo-night",
  "emerald-matrix",
  ...PRESET_THEMES.map((t) => t.id),
]);

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DevPulse | Developer Headquarters & Telemetry",
  description:
    "Unified zero-leak sovereign telemetry & mission control for your GitHub repos, npm/PyPI/Rust packages, OCI servers, and runtime crash diagnostics. Built by ritualdev-lab.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let activeTheme = "dark";
  try {
    const c = await cookies();
    const pref = c.get("dp_theme")?.value;
    if (pref && ALLOWED_THEMES.has(pref)) {
      activeTheme = pref;
    }
  } catch {
    // ignore during static prerendering
  }

  return (
    <html
      lang="en"
      data-theme={activeTheme}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">{children}</body>
    </html>
  );
}
