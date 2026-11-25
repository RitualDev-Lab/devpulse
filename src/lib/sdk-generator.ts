/**
 * DevPulse Client SDK Generators
 * Generates zero-dependency copy-pasteable snippets for Python and Node.js
 */

export function getPythonSnippet(apiKey: string, hostUrl = "https://devpulse.ritualdev.in"): string {
  return `# Install official zero-dependency SDK:
# pip install devpulse-sdk

import devpulse_sdk

devpulse_sdk.init(
    api_key="${apiKey}",
    endpoint="${hostUrl}",
    release="v1.0.0",
    attach_logging=True,  # Captures breadcrumbs + offline retries
)

devpulse_sdk.add_breadcrumb(category="custom", message="Worker booted")
`;
}

export function getNodeSnippet(apiKey: string, hostUrl = "https://devpulse.ritualdev.in"): string {
  return `// Install official SDK: npm install @ritualdev/devpulse
import { init, addBreadcrumb, trackEvent } from "@ritualdev/devpulse";

init({
  apiKey: "${apiKey}",
  endpoint: "${hostUrl}",
  release: "v1.0.0",
  commitSha: process.env.GIT_COMMIT_SHA,
});

addBreadcrumb({ category: "custom", level: "info", message: "Service ready" });
trackEvent("app_launch");
`;
}

export function getRustSnippet(apiKey: string, hostUrl = "https://devpulse.ritualdev.in"): string {
  return `// Official Rust crate: packages/devpulse-rs (Cargo.toml: devpulse-rs = "0.2.0")
use devpulse_rs::{DevPulseClient, DevPulseConfig};

pub fn init_devpulse() -> DevPulseClient {
    let pulse = DevPulseClient::new(DevPulseConfig {
        api_key: "${apiKey}".into(),
        endpoint: "${hostUrl}".into(),
        release: Some("v1.0.0".into()),
        scrub_pii: true,
        ..Default::default()
    });
    pulse.clone().install_panic_hook();
    pulse.add_breadcrumb("custom", "info", "Worker booted");
    pulse
}
`;
}

export function getCliSnippet(apiKey: string, hostUrl = "https://devpulse.ritualdev.in"): string {
  return `# Send a runtime crash or heavy terminal dump from any CLI / CI script
curl -X POST "${hostUrl}/api/v1/event" \\
  -H "Content-Type: application/json" \\
  -d '{
    "apiKey": "${apiKey}",
    "errorName": "CLIFatalExit",
    "message": "Command exited with non-zero status",
    "runtime": "cli",
    "os": "'$(uname -s)' '$(uname -m)'",
    "stackTrace": "Full stderr/stack trace payload (>4KB auto-offloads to Cloudflare R2)"
  }'
`;
}

export function getWebAppSnippet(apiKey: string, hostUrl = "https://devpulse.ritualdev.in"): string {
  return `// npm install @ritualdev/devpulse
// Captures HTTP/DOM breadcrumbs, offline retries, release sessions & source maps
import { init } from "@ritualdev/devpulse";

init({
  apiKey: "${apiKey}",
  endpoint: "${hostUrl}",
  release: "v1.0.0",
});

// CI Source Map upload:
// npx devpulse-sdk upload-sourcemaps --key ${apiKey} --release v1.0.0 --dir ./dist
`;
}
