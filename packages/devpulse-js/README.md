# @ritualdev/devpulse

Official zero-dependency telemetry SDK for **DevPulse**:

- Automatic **Breadcrumbs** (`http` fetch calls, `console.error`, DOM clicks)
- **Offline Retry Queue** with exponential backoff
- **Release Health & Commit Attribution** (`release`, `commitSha`, session heartbeats)
- **Source Map Uploader CLI** (`devpulse-sdk upload-sourcemaps`)

## Quick Start
```bash
npm install @ritualdev/devpulse
```

```ts
import { init, addBreadcrumb, captureException, trackEvent } from "@ritualdev/devpulse";

init({
  apiKey: "dp_live_...",
  release: "v1.2.0",
  commitSha: process.env.VERCEL_GIT_COMMIT_SHA,
});

addBreadcrumb({ category: "custom", level: "info", message: "Opened settings" });
trackEvent("app_launch");
```

## Upload Source Maps
```bash
npx devpulse-sdk upload-sourcemaps --key dp_live_... --release v1.2.0 --dir ./dist
```
