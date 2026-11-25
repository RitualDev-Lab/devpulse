# devpulse-rs

Official Rust telemetry, crash reporting, custom metrics, and release-health SDK for DevPulse (`https://devpulse.ritualdev.in`).

## Features
- **Panic Hook**: Automatic `std::panic::set_hook` capture including backtraces & breadcrumbs.
- **PII Scrubbing**: Redacts emails, `Bearer`/`Basic` credentials, and `dp_live_` / `sk_live_` keys client-side before transmission.
- **Offline Retry Queue**: Bounded ring buffer with exponential backoff when offline.
- **Release Tagging**: Associates crashes and metrics with `release` + `commit_sha`.

## Quickstart
```rust
use devpulse_rs::{DevPulseClient, DevPulseConfig};

fn main() {
    let pulse = DevPulseClient::new(DevPulseConfig {
        api_key: "dp_live_your_key".into(),
        release: Some("v1.0.0".into()),
        commit_sha: option_env!("GIT_SHA").map(String::from),
        ..Default::default()
    });
    pulse.clone().install_panic_hook();
    pulse.add_breadcrumb("custom", "info", "Worker booted");
    let _ = pulse.track_metric("active_jobs", 42.0);
}
```
