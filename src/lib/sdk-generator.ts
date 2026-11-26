/**
 * DevPulse Client SDK Generators
 * Generates zero-dependency copy-pasteable snippets for Python and Node.js
 */
import { PUBLIC_APP_URL } from "@/lib/config/app-url";

export function getPythonSnippet(apiKey: string, hostUrl = `${PUBLIC_APP_URL}`): string {
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

export function getNodeSnippet(apiKey: string, hostUrl = `${PUBLIC_APP_URL}`): string {
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

export function getRustSnippet(apiKey: string, hostUrl = `${PUBLIC_APP_URL}`): string {
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

export function getCliSnippet(apiKey: string, hostUrl = `${PUBLIC_APP_URL}`): string {
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

export function getWebAppSnippet(apiKey: string, hostUrl = `${PUBLIC_APP_URL}`): string {
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

export function getGoSnippet(apiKey: string, hostUrl = `${PUBLIC_APP_URL}`): string {
  return `// go get github.com/RitualDev-Lab/devpulse-go
import devpulse "github.com/RitualDev-Lab/devpulse-go"

pulse := devpulse.New(devpulse.Config{
    APIKey:   "${apiKey}",
    Endpoint: "${hostUrl}",
    Release:  "v1.0.0",
    ScrubPII: true,
})
// Use pulse.RecoverMiddleware(mux), pulse.TrackMetric("active_jobs", 42), pulse.SendOTLPSpan(...)
`;
}

export function getDotnetSnippet(apiKey: string, hostUrl = `${PUBLIC_APP_URL}`): string {
  return `// dotnet add package DevPulse.Sdk
using DevPulse;

var pulse = new DevPulseClient(new DevPulseOptions("${apiKey}", "${hostUrl}", Release: "1.0.0"));
pulse.AttachGlobalHandlers();
pulse.AddBreadcrumb("http", "info", "ASP.NET Core booted");
`;
}

export function getJvmSnippet(apiKey: string, hostUrl = `${PUBLIC_APP_URL}`): string {
  return `// Maven: in.ritualdev:devpulse-jvm:1.0.0 (Spring Boot / Ktor / Android)
import in.ritualdev.devpulse.DevPulseClient;

var pulse = new DevPulseClient("${apiKey}", "${hostUrl}", "1.0.0", "proguard-v1", true);
pulse.installUncaughtHandler();
pulse.addBreadcrumb("lifecycle", "info", "JVM service started");
`;
}

export function getPhpSnippet(apiKey: string, hostUrl = `${PUBLIC_APP_URL}`): string {
  return `<?php
// composer require ritualdev/devpulse
$pulse = new \\DevPulse\\Client('${apiKey}', '${hostUrl}', '1.0.0');
$pulse->registerHandlers();
$pulse->addBreadcrumb('http', 'info', 'Laravel / Symfony booted');
`;
}

export function getSwiftSnippet(apiKey: string, hostUrl = `${PUBLIC_APP_URL}`): string {
  return `// Swift Package Manager: DevPulseSwift (iOS / macOS / tvOS / Vapor)
import DevPulseSwift

DevPulseSwift.shared.configure(apiKey: "${apiKey}", endpoint: "${hostUrl}", release: "1.0.0")
DevPulseSwift.shared.addBreadcrumb(category: "app", message: "Launched")
`;
}

export function getCppSnippet(apiKey: string, hostUrl = `${PUBLIC_APP_URL}`): string {
  return `// Conan / vcpkg: devpulse-cpp (packages/devpulse-cpp/include/devpulse.hpp)
#include "devpulse.hpp"

devpulse::Client pulse({ "${apiKey}", "${hostUrl}", "1.0.0", true });
pulse.add_breadcrumb("engine", "info", "Worker initialized");
`;
}

export function getRubySnippet(apiKey: string, hostUrl = `${PUBLIC_APP_URL}`): string {
  return `# gem install devpulse-rb (Rails / Sinatra / Sidekiq / Rack)
require "devpulse"

pulse = DevPulse::Client.new(api_key: "${apiKey}", endpoint: "${hostUrl}", release: "1.0.0")
# Rails: config.middleware.use DevPulse::RackMiddleware, pulse
pulse.track_metric("active_jobs", 42)
`;
}
