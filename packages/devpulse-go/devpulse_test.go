package devpulse

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCaptureAndRecoverMiddleware(t *testing.T) {
	var received bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received = true
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	client := New(Config{APIKey: "dp_live_test", Endpoint: srv.URL, Release: "v1.0.0", ScrubPII: true})
	handler := client.RecoverMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("token Bearer secret123 user@example.com failed")
	}))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/checkout", nil)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rr.Code)
	}
	if !received {
		t.Fatalf("expected crash payload to be delivered")
	}
	redacted := RedactPII("Authorization: Bearer abc.def user@example.com")
	if strings.Contains(redacted, "abc.def") || strings.Contains(redacted, "user@example.com") {
		t.Fatalf("expected PII redaction, got %q", redacted)
	}
}
