package devpulse

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"runtime"
	"runtime/debug"
	"sync"
	"time"
)

const DefaultEndpoint = "https://devpulse.ritualdev.in"

var piiBearerRe = regexp.MustCompile(`(?i)\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+`)
var piiEmailRe = regexp.MustCompile(`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`)

type Breadcrumb struct {
	Timestamp int64  `json:"timestamp"`
	Category  string `json:"category"`
	Level     string `json:"level"`
	Message   string `json:"message"`
}

type Config struct {
	APIKey         string
	Endpoint       string
	Release        string
	CommitSHA      string
	Environment    string
	MaxBreadcrumbs int
	ScrubPII       bool
	HTTPClient     *http.Client
}

type Client struct {
	cfg         Config
	mu          sync.Mutex
	breadcrumbs []Breadcrumb
}

func RedactPII(raw string) string {
	cleaned := piiBearerRe.ReplaceAllString(raw, "$1 [REDACTED]")
	cleaned = piiEmailRe.ReplaceAllString(cleaned, "[REDACTED_EMAIL]")
	return cleaned
}

func New(cfg Config) *Client {
	if cfg.Endpoint == "" {
		cfg.Endpoint = DefaultEndpoint
	}
	if cfg.Environment == "" {
		cfg.Environment = "production"
	}
	if cfg.MaxBreadcrumbs <= 0 {
		cfg.MaxBreadcrumbs = 40
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 5 * time.Second}
	}
	return &Client{cfg: cfg}
}

func (c *Client) AddBreadcrumb(category, level, message string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cfg.ScrubPII {
		message = RedactPII(message)
	}
	c.breadcrumbs = append(c.breadcrumbs, Breadcrumb{
		Timestamp: time.Now().Unix(),
		Category:  category,
		Level:     level,
		Message:   message,
	})
	if len(c.breadcrumbs) > c.cfg.MaxBreadcrumbs {
		c.breadcrumbs = c.breadcrumbs[len(c.breadcrumbs)-c.cfg.MaxBreadcrumbs:]
	}
}

func (c *Client) CaptureError(errorName, message, stackTrace string) error {
	if c.cfg.ScrubPII {
		message = RedactPII(message)
		stackTrace = RedactPII(stackTrace)
	}
	c.mu.Lock()
	crumbs := make([]Breadcrumb, len(c.breadcrumbs))
	copy(crumbs, c.breadcrumbs)
	c.mu.Unlock()

	payload := map[string]any{
		"apiKey":      c.cfg.APIKey,
		"errorName":   errorName,
		"message":     message,
		"stackTrace":  stackTrace,
		"runtime":     "go",
		"os":          runtime.GOOS + "/" + runtime.GOARCH,
		"version":     c.cfg.Release,
		"commitSha":   c.cfg.CommitSHA,
		"environment": c.cfg.Environment,
		"breadcrumbs": crumbs,
	}
	return c.postJSON(c.cfg.Endpoint+"/api/v1/event", payload, false)
}

func (c *Client) TrackMetric(metricName string, metricValue float64) error {
	payload := map[string]any{
		"project":     c.cfg.APIKey,
		"metricName":  metricName,
		"metricValue": metricValue,
		"sourceType":  "app",
		"os":          runtime.GOOS,
		"appVersion":  c.cfg.Release,
	}
	return c.postJSON(c.cfg.Endpoint+"/api/v1/analytics", payload, false)
}

func (c *Client) SendOTLPSpan(serviceName, spanName string, durationMs int64, statusCode string) error {
	payload := map[string]any{
		"resourceSpans": []map[string]any{
			{
				"resource": map[string]any{
					"attributes": []map[string]any{{"key": "service.name", "value": map[string]string{"stringValue": serviceName}}},
				},
				"scopeSpans": []map[string]any{
					{
						"spans": []map[string]any{
							{
								"name":              spanName,
								"startTimeUnixNano": time.Now().Add(-time.Duration(durationMs) * time.Millisecond).UnixNano(),
								"endTimeUnixNano":   time.Now().UnixNano(),
								"status":            map[string]string{"code": statusCode},
							},
						},
					},
				},
			},
		},
	}
	return c.postJSON(c.cfg.Endpoint+"/api/v1/ingest/otlp/traces", payload, true)
}

// RecoverMiddleware works directly with Go net/http (and adapts trivially to Gin, Echo, or Fiber).
func (c *Client) RecoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.AddBreadcrumb("http", "info", fmt.Sprintf("%s %s", r.Method, r.URL.Path))
		defer func() {
			if rec := recover(); rec != nil {
				_ = c.CaptureError("GoPanic", fmt.Sprintf("%v", rec), string(debug.Stack()))
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (c *Client) postJSON(url string, payload any, withKeyHeader bool) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "devpulse-go/1.0.0 ("+os.Getenv("HOSTNAME")+")")
	if withKeyHeader {
		req.Header.Set("x-devpulse-key", c.cfg.APIKey)
	}
	resp, err := c.cfg.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("devpulse ingest status %d", resp.StatusCode)
	}
	return nil
}
