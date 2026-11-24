<div align="center">

# ⚡ DevPulse

### The Open-Source Developer Headquarters & Multi-Registry Telemetry Engine

[![GitHub License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![Turso libSQL](https://img.shields.io/badge/Database-Turso%20libSQL-00E599?style=flat-square)](https://turso.tech)
[![Cloudflare Pages](https://img.shields.io/badge/Deploy-Cloudflare%20Pages-F38020?style=flat-square&logo=cloudflare)](https://pages.cloudflare.com)
[![Supabase Auth](https://img.shields.io/badge/Auth-Supabase-3ECF8E?style=flat-square&logo=supabase)](https://supabase.com)
[![Built by RitualDev-Lab](https://img.shields.io/badge/Org-RitualDev--Lab-7c3aed?style=flat-square)](https://github.com/RitualDev-Lab)

**DevPulse** is a unified command center designed for modern maintainers and indie hackers. If you maintain multiple repositories, ship npm packages, release PyPI libraries, or build CLI tools, DevPulse brings all your downloads, open issues, pull requests, and live runtime crashes into **one customizable, draggable mission control dashboard.**

[Live Demo](https://devpulse.rolenest.in) • [Report a Bug](https://devpulse.rolenest.in/report/ritual-core) • [Documentation](#quick-start)

</div>

---

## 🌟 The Problem DevPulse Solves

As open-source authors and developers:
* **Tab Overload:** Checking issues, PRs, and stars across 30+ repositories requires dozens of open tabs.
* **Invisible Package Telemetry:** When you publish to **npm** or **PyPI**, you get download totals, but you have zero visibility into runtime crashes, unhandled errors, or user environments.
* **Friction in Bug Reporting:** Most users who consume your CLI tools or packages don't have a GitHub account to open an issue when your package crashes.
* **Cluttered Dashboards:** Existing tools force you to see empty widgets for tools you don't use. DevPulse features **Smart Adaptive Cards**—if you only ship a Python package, npm cards stay out of your way.

---

## ✨ Core Features

### 1. 📊 Multi-Ecosystem Analytics (Zero Tokens Needed)
* **GitHub Activity Hub:** Live stars, forks, open issues count, release tags, and a unified feed of open issues & PRs.
* **npm Download Intelligence:** 30-day velocity sparkline, Today / This Week / This Month counters, and latest version tracking via public `api.npmjs.org`.
* **PyPI Package Trends:** Daily pipeline installs history, 30-day velocity, and system distribution metrics via `pypistats.org`.
* **Smart Ecosystem Filter:** Only renders cards for ecosystems you actually use.

### 2. 🛡️ Runtime Crash Diagnostics & Telemetry
* Receive unhandled exceptions and crashes from packages running in the wild via `POST /api/v1/event`.
* Captures error headlines, stack traces, operating system, runtime (`node`, `python`, `cli`), and package versions.
* Interactive stack trace modal viewer with 1-click **Resolve** and **Ignore** status toggles.

### 3. 🔌 Zero-Dependency Client SDKs
Copy-paste lightweight snippets directly into your packages:
* **Python (`sys.excepthook`):** Uses standard library `urllib` — **0 extra pip dependencies**.
* **Node.js (`uncaughtException`):** Uses native global `fetch` — **0 extra npm dependencies**.

### 4. 📬 Public Bug Reporting Hub (`/report/[project-slug]`)
* Share a public link (e.g. `devpulse.rolenest.in/report/my-lib`) for end-users to submit crash logs, reproduction steps, and contact info without needing GitHub logins.
* Includes copy-pasteable Markdown shields for your GitHub `README.md`.

### 5. 🛡️ Dynamic SVG Badges for READMEs (`/api/badge/...`)
Generate live shields for your package READMEs with real-time stats:
* **Monthly Downloads:** `https://devpulse.rolenest.in/api/badge/downloads/ritual-core.svg`
* **Crash-Free Health Rate:** `https://devpulse.rolenest.in/api/badge/health/ritual-core.svg`

```markdown
[![DevPulse Downloads](https://devpulse.rolenest.in/api/badge/downloads/ritual-core.svg)](https://devpulse.rolenest.in)
[![DevPulse Health](https://devpulse.rolenest.in/api/badge/health/ritual-core.svg)](https://devpulse.rolenest.in)
```

### 6. 💻 Maintainer Companion CLI (`devpulse`)
Query project telemetry directly from your terminal:
```bash
npx @ritualdev/pulse status    # Prints today's stars, npm downloads & PyPI velocity
npx @ritualdev/pulse crashes   # Streams the latest unhandled runtime crashes
```

### 7. 🍪 Cookie-Free GDPR-Compliant Web Analytics (`tracker.js`)
A lightweight (< 2KB) snippet for documentation sites (Google Analytics alternative):
```html
<script defer src="https://devpulse.rolenest.in/tracker.js" data-project="YOUR_PROJECT_KEY"></script>
```
Tracks unique pageviews, top referrers (GitHub, HackerNews, Reddit, X), device distribution, and country demographics with zero cookies.

### 8. 🎨 Drag & Drop Layouts & Live Custom CSS
* Click **Customize** to drag, re-order, hide, and resize cards to your preference.
* Layouts persist automatically.
* Built-in themes: *DevPulse Dark, Cyber Neon, Tokyo Night, Emerald Matrix*, plus a live custom CSS editor.

### 6. 🌐 1 Custom Domain + Cloudflare R2 Storage (BYOS Ready)
* Claim your custom domain (e.g., `stats.yourdomain.com`) with automatic SSL.
* Built on Cloudflare Pages + Turso (libSQL) edge database + Cloudflare R2 storage for crash attachments.
* **Bring Your Own Storage (BYOS)** architecture keeps operational costs at \$0.

---

## 🏗️ Architecture

```
                               [ CLIENTS / DEVELOPERS ]
                                          │
                                          ▼
                ┌───────────────────────────────────────────────────┐
                │        CLOUDFLARE PAGES / CUSTOM DOMAIN           │
                │        (devpulse.rolenest.in / Edge CDN)          │
                └───────────┬───────────────────┬───────────────────┘
                            │                   │
         ┌──────────────────┘                   └──────────────────┐
         ▼                                                         ▼
┌───────────────────┐                                     ┌───────────────────┐
│   SUPABASE AUTH   │                                     │   TURSO (libSQL)  │
│  (GitHub OAuth)   │                                     │ (Relational Data) │
│  • 1-Click Login  │                                     │ • User Projects   │
│  • Secure JWTs    │                                     │ • Saved Layouts   │
└───────────────────┘                                     │ • Daily Metrics   │
                                                          │ • Error Events    │
                                                          └─────────┬─────────┘
                                                                    │
                                                                    ▼
                                                          ┌───────────────────┐
                                                          │   CLOUDFLARE R2   │
                                                          │ (Object Storage)  │
                                                          │ • Crash Dumps     │
                                                          │ • Bug Screenshots │
                                                          └───────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
* [Node.js 20+](https://nodejs.org)
* [Turso CLI](https://turso.tech) (or local SQLite)

### 1. Clone & Install
```bash
git clone https://github.com/RitualDev-Lab/devpulse.git
cd devpulse
npm install
```

### 2. Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Fill in your configuration:
```env
# Database: Turso (or file:local.db for offline testing)
TURSO_DATABASE_URL=file:local.db
TURSO_AUTH_TOKEN=

# Supabase Auth
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# GitHub OAuth App
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Cloudflare R2 Storage
CLOUDFLARE_ACCOUNT_ID=your-cf-account-id
R2_BUCKET_NAME=devpulse-storage
```

### 3. Seed Database & Run
```bash
# Initialize schema and demo data
npx tsx src/db/run-seed.ts

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📦 Integrating the Crash SDK into Your Packages

### Python (Zero Dependencies)
Add this snippet to your package's `__init__.py` or CLI entrypoint:

```python
import sys, traceback, platform, json, urllib.request

class DevPulseTracker:
    def __init__(self, api_key="YOUR_PROJECT_API_KEY", endpoint="https://devpulse.rolenest.in/api/v1/event"):
        self.api_key = api_key
        self.endpoint = endpoint
        sys.excepthook = self._handle_exception

    def _handle_exception(self, exc_type, exc_value, exc_traceback):
        try:
            payload = {
                "apiKey": self.api_key,
                "errorName": str(exc_type.__name__),
                "message": str(exc_value),
                "stackTrace": "".join(traceback.format_exception(exc_type, exc_value, exc_traceback)),
                "runtime": f"python {platform.python_version()}",
                "os": f"{platform.system()} {platform.release()}",
                "version": "1.0.0"
            }
            req = urllib.request.Request(self.endpoint, data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=3)
        except Exception:
            pass

tracker = DevPulseTracker()
```

### Node.js (Zero Dependencies)
Add this snippet to your CLI or package entrypoint:

```javascript
export function initDevPulse({ apiKey = "YOUR_PROJECT_API_KEY", version = "1.0.0" } = {}) {
  const report = async (err, name) => {
    try {
      await fetch("https://devpulse.rolenest.in/api/v1/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          errorName: err?.name || name,
          message: err?.message || String(err),
          stackTrace: err?.stack || null,
          runtime: `node ${process.version}`,
          os: `${process.platform} ${process.arch}`,
          version
        }),
      });
    } catch {}
  };

  process.on("uncaughtException", (err) => report(err, "UncaughtException"));
  process.on("unhandledRejection", (reason) => report(reason, "UnhandledRejection"));
}
```

---

## 🛡️ Security & Trust Guarantee

* **Zero Secret Tokens:** DevPulse **never** asks for your npm publishing tokens, PyPI upload credentials, or GitHub repository write access.
* **Open Source:** Every line of code is available here in this repository under the MIT license.
* **Self-Hostable:** If your organization requires on-premise deployments, DevPulse can be self-hosted anywhere with Docker or Node.js.

---

## 🤝 Contributing

We welcome issues and pull requests! Please feel free to open a ticket on GitHub or reach out to the [RitualDev-Lab](https://github.com/RitualDev-Lab) maintainers.

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<div align="center">
Made with ❤️ by <a href="https://github.com/RitualDev-Lab"><strong>RitualDev-Lab</strong></a>
</div>
