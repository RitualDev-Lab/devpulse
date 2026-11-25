use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::panic;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DEFAULT_ENDPOINT: &str = "https://devpulse.ritualdev.in";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Breadcrumb {
    pub timestamp: u64,
    pub category: String,
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct DevPulseConfig {
    pub api_key: String,
    pub endpoint: String,
    pub release: Option<String>,
    pub commit_sha: Option<String>,
    pub environment: String,
    pub max_breadcrumbs: usize,
    pub max_queue_size: usize,
    pub max_retries: u32,
    pub scrub_pii: bool,
    pub queue_file: Option<PathBuf>,
}

impl Default for DevPulseConfig {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            endpoint: DEFAULT_ENDPOINT.to_string(),
            release: None,
            commit_sha: None,
            environment: "production".to_string(),
            max_breadcrumbs: 40,
            max_queue_size: 100,
            max_retries: 4,
            scrub_pii: true,
            queue_file: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct QueuedBeacon {
    url: String,
    payload: serde_json::Value,
    attempts: u32,
    next_attempt_epoch: u64,
}

#[derive(Clone)]
pub struct DevPulseClient {
    config: DevPulseConfig,
    breadcrumbs: Arc<Mutex<VecDeque<Breadcrumb>>>,
    queue: Arc<Mutex<VecDeque<QueuedBeacon>>>,
}

fn unix_now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_secs()
}

/// Scrubs email addresses, Bearer/Basic headers, and common API tokens without extra regex dependencies.
pub fn redact_pii(input: &str) -> String {
    let mut out_tokens: Vec<String> = Vec::new();
    let mut redact_next_auth = false;

    for raw in input.split_whitespace() {
        if redact_next_auth {
            out_tokens.push("[REDACTED_TOKEN]".to_string());
            redact_next_auth = false;
            continue;
        }
        let lower = raw.to_ascii_lowercase();
        if lower == "bearer" || lower == "basic" {
            out_tokens.push(raw.to_string());
            redact_next_auth = true;
            continue;
        }
        if raw.starts_with("dp_live_")
            || raw.starts_with("sk_live_")
            || raw.starts_with("sk_test_")
            || raw.starts_with("ghp_")
            || raw.starts_with("gho_")
        {
            out_tokens.push("[REDACTED_SECRET]".to_string());
            continue;
        }
        if let Some(at_idx) = raw.find('@') {
            if at_idx > 0 && raw[at_idx + 1..].contains('.') {
                out_tokens.push("[REDACTED_EMAIL]".to_string());
                continue;
            }
        }
        out_tokens.push(raw.to_string());
    }
    out_tokens.join(" ")
}

impl DevPulseClient {
    pub fn new(mut config: DevPulseConfig) -> Self {
        assert!(!config.api_key.trim().is_empty(), "devpulse-rs: api_key is required");
        config.endpoint = config.endpoint.trim_end_matches('/').to_string();

        let loaded_queue = config
            .queue_file
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|raw| serde_json::from_str::<VecDeque<QueuedBeacon>>(&raw).ok())
            .unwrap_or_default();

        Self {
            config,
            breadcrumbs: Arc::new(Mutex::new(VecDeque::with_capacity(40))),
            queue: Arc::new(Mutex::new(loaded_queue)),
        }
    }

    pub fn add_breadcrumb(&self, category: &str, level: &str, message: &str) {
        let clean_msg = if self.config.scrub_pii {
            redact_pii(message)
        } else {
            message.to_string()
        };
        let entry = Breadcrumb {
            timestamp: unix_now_secs(),
            category: category.to_string(),
            level: level.to_string(),
            message: clean_msg.chars().take(300).collect(),
        };
        if let Ok(mut guard) = self.breadcrumbs.lock() {
            if guard.len() >= self.config.max_breadcrumbs {
                guard.pop_front();
            }
            guard.push_back(entry);
        }
    }

    pub fn get_breadcrumbs(&self) -> Vec<Breadcrumb> {
        self.breadcrumbs
            .lock()
            .map(|g| g.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn pending_queue_size(&self) -> usize {
        self.queue.lock().map(|g| g.len()).unwrap_or(0)
    }

    pub fn capture_error(&self, error_name: &str, message: &str, stack_trace: Option<&str>) -> bool {
        let clean_msg = if self.config.scrub_pii {
            redact_pii(message)
        } else {
            message.to_string()
        };
        let clean_stack = stack_trace.map(|s| {
            if self.config.scrub_pii {
                redact_pii(s)
            } else {
                s.to_string()
            }
        });

        let payload = serde_json::json!({
            "apiKey": self.config.api_key,
            "errorName": error_name,
            "message": clean_msg,
            "stackTrace": clean_stack,
            "runtime": "rust",
            "os": std::env::consts::OS,
            "version": self.config.release,
            "commitSha": self.config.commit_sha,
            "environment": self.config.environment,
            "breadcrumbs": self.get_breadcrumbs(),
        });

        self.send_or_queue(format!("{}/api/v1/event", self.config.endpoint), payload)
    }

    pub fn track_metric(&self, metric_name: &str, metric_value: f64) -> bool {
        let payload = serde_json::json!({
            "project": self.config.api_key,
            "metricName": metric_name,
            "metricValue": metric_value,
            "sourceType": "app",
            "os": std::env::consts::OS,
            "appVersion": self.config.release,
        });

        self.send_or_queue(format!("{}/api/v1/analytics", self.config.endpoint), payload)
    }

    pub fn track_release_session(&self) -> bool {
        let Some(ref version) = self.config.release else {
            return false;
        };
        let payload = serde_json::json!({
            "apiKey": self.config.api_key,
            "action": "session",
            "version": version,
            "commitSha": self.config.commit_sha,
            "sessions": 1,
        });
        self.send_or_queue(format!("{}/api/v1/releases", self.config.endpoint), payload)
    }

    pub fn install_panic_hook(self) {
        let prev = panic::take_hook();
        panic::set_hook(Box::new(move |info| {
            let msg = info.to_string();
            let bt = std::backtrace::Backtrace::capture().to_string();
            let _ = self.capture_error("RustPanic", &msg, Some(&bt));
            prev(info);
        }));
    }

    pub fn flush(&self) -> usize {
        let now = unix_now_secs();
        let items: Vec<QueuedBeacon> = match self.queue.lock() {
            Ok(mut q) => q.drain(..).collect(),
            Err(_) => return 0,
        };
        if items.is_empty() {
            return 0;
        }

        let mut delivered = 0usize;
        let mut remaining = VecDeque::new();

        for item in items {
            if item.next_attempt_epoch > now {
                remaining.push_back(item);
                continue;
            }
            if Self::post_json(&item.url, &item.payload) {
                delivered += 1;
            } else if item.attempts < self.config.max_retries {
                let backoff = (1u64 << item.attempts.min(5)).min(60);
                remaining.push_back(QueuedBeacon {
                    url: item.url,
                    payload: item.payload,
                    attempts: item.attempts + 1,
                    next_attempt_epoch: unix_now_secs() + backoff,
                });
            }
        }

        if let Ok(mut q) = self.queue.lock() {
            *q = remaining;
            self.persist_queue(&q);
        }
        delivered
    }

    fn send_or_queue(&self, url: String, payload: serde_json::Value) -> bool {
        if Self::post_json(&url, &payload) {
            if self.pending_queue_size() > 0 {
                let _ = self.flush();
            }
            return true;
        }

        if let Ok(mut q) = self.queue.lock() {
            if q.len() >= self.config.max_queue_size {
                q.pop_front();
            }
            q.push_back(QueuedBeacon {
                url,
                payload,
                attempts: 1,
                next_attempt_epoch: unix_now_secs() + 2,
            });
            self.persist_queue(&q);
        }
        false
    }

    fn persist_queue(&self, q: &VecDeque<QueuedBeacon>) {
        if let Some(ref path) = self.config.queue_file {
            if let Ok(serialized) = serde_json::to_string(q) {
                let _ = std::fs::write(path, serialized);
            }
        }
    }

    fn post_json(url: &str, payload: &serde_json::Value) -> bool {
        match ureq::post(url)
            .set("Content-Type", "application/json")
            .timeout(Duration::from_secs(3))
            .send_json(payload.clone())
        {
            Ok(resp) => resp.status() >= 200 && resp.status() < 300,
            Err(_) => false,
        }
    }
}
