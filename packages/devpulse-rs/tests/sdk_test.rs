use devpulse_rs::{redact_pii, DevPulseClient, DevPulseConfig};

#[test]
fn scrubs_emails_and_tokens() {
    let scrubbed = redact_pii(
        "Failed auth for alice@example.com with Bearer secret_token_123 and dp_live_abc123456",
    );
    assert!(!scrubbed.contains("alice@example.com"));
    assert!(!scrubbed.contains("secret_token_123"));
    assert!(!scrubbed.contains("dp_live_abc123456"));
    assert!(scrubbed.contains("[REDACTED_EMAIL]"));
    assert!(scrubbed.contains("[REDACTED_TOKEN]"));
    assert!(scrubbed.contains("[REDACTED_SECRET]"));
}

#[test]
fn queues_offline_events_with_breadcrumbs() {
    let client = DevPulseClient::new(DevPulseConfig {
        api_key: "dp_live_rust_test".to_string(),
        endpoint: "http://127.0.0.1:9".to_string(),
        release: Some("v0.2.0".to_string()),
        ..Default::default()
    });
    client.add_breadcrumb("http", "info", "GET /health -> 503");
    assert_eq!(client.get_breadcrumbs().len(), 1);
    let ok = client.capture_error("PanicError", "boom for test@example.com", None);
    assert!(!ok);
    assert_eq!(client.pending_queue_size(), 1);
}
