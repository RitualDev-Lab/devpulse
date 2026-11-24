/**
 * DevPulse Client SDK Generators
 * Generates zero-dependency copy-pasteable snippets for Python and Node.js
 */

export function getPythonSnippet(apiKey: string, hostUrl = "https://devpulse.ritualdev.in"): string {
  return `import sys
import traceback
import platform
import json
import urllib.request

class DevPulseTracker:
    def __init__(self, api_key="${apiKey}", endpoint="${hostUrl}/api/v1/event"):
        self.api_key = api_key
        self.endpoint = endpoint
        self._install_hook()

    def _install_hook(self):
        original_hook = sys.excepthook
        def custom_hook(exc_type, exc_value, exc_traceback):
            self.capture_exception(exc_type, exc_value, exc_traceback)
            return original_hook(exc_type, exc_value, exc_traceback)
        sys.excepthook = custom_hook

    def capture_exception(self, exc_type, exc_value, exc_traceback, version="1.0.0"):
        try:
            tb_lines = traceback.format_exception(exc_type, exc_value, exc_traceback)
            payload = {
                "apiKey": self.api_key,
                "errorName": str(exc_type.__name__),
                "message": str(exc_value),
                "stackTrace": "".join(tb_lines),
                "runtime": f"python {platform.python_version()}",
                "os": f"{platform.system()} {platform.release()}",
                "version": version
            }
            req = urllib.request.Request(
                self.endpoint,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            urllib.request.urlopen(req, timeout=3)
        except Exception:
            pass # Never crash the host application

# Initialize in your main entrypoint:
tracker = DevPulseTracker()
`;
}

export function getNodeSnippet(apiKey: string, hostUrl = "https://devpulse.ritualdev.in"): string {
  return `/**
 * DevPulse Zero-Dependency Node.js Error & Telemetry Tracker
 */
export function initDevPulse({
  apiKey = "${apiKey}",
  version = "1.0.0",
  endpoint = "${hostUrl}/api/v1/event"
} = {}) {
  const sendError = async (error, errorName = "UnhandledError") => {
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          errorName: error?.name || errorName,
          message: error?.message || String(error),
          stackTrace: error?.stack || null,
          runtime: \`node \${process.version}\`,
          os: \`\${process.platform} \${process.arch}\`,
          version
        }),
      });
    } catch {
      // Never crash user process if network fails
    }
  };

  process.on("uncaughtException", async (err) => {
    await sendError(err, "UncaughtException");
    process.exit(1);
  });

  process.on("unhandledRejection", async (reason) => {
    await sendError(reason, "UnhandledRejection");
  });

  return { captureError: sendError };
}

// In your app/CLI entrypoint:
// initDevPulse();
`;
}
