package in.ritualdev.devpulse;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.CompletableFuture;
import java.util.regex.Pattern;

public final class DevPulseClient {
    private static final Pattern BEARER = Pattern.compile("(?i)\\b(Bearer|Basic)\\s+[A-Za-z0-9._~+/=-]+");
    private static final Pattern EMAIL = Pattern.compile("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}");

    private final String apiKey;
    private final String endpoint;
    private final String release;
    private final String mappingTag;
    private final boolean scrubPii;
    private final HttpClient http;
    private final Deque<String> breadcrumbs = new ArrayDeque<>();

    public DevPulseClient(String apiKey, String endpoint, String release, String mappingTag, boolean scrubPii) {
        this.apiKey = apiKey;
        this.endpoint = (endpoint == null || endpoint.isBlank() ? "https://devpulse.ritualdev.in" : endpoint).replaceAll("/+$", "");
        this.release = release;
        this.mappingTag = mappingTag;
        this.scrubPii = scrubPii;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }

    public static String redactPii(String input) {
        if (input == null) return "";
        String cleaned = BEARER.matcher(input).replaceAll("$1 [REDACTED]");
        return EMAIL.matcher(cleaned).replaceAll("[REDACTED_EMAIL]");
    }

    public synchronized void addBreadcrumb(String category, String level, String message) {
        String msg = scrubPii ? redactPii(message) : message;
        breadcrumbs.addLast("{\"timestamp\":" + Instant.now().getEpochSecond() + ",\"category\":\"" + esc(category) + "\",\"level\":\"" + esc(level) + "\",\"message\":\"" + esc(msg) + "\"}");
        while (breadcrumbs.size() > 40) breadcrumbs.removeFirst();
    }

    public void installUncaughtHandler() {
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> captureException(e).join());
    }

    public CompletableFuture<HttpResponse<String>> captureException(Throwable throwable) {
        StringWriter sw = new StringWriter();
        throwable.printStackTrace(new PrintWriter(sw));
        String msg = scrubPii ? redactPii(throwable.getMessage()) : String.valueOf(throwable.getMessage());
        String stack = scrubPii ? redactPii(sw.toString()) : sw.toString();

        String json = "{"
                + "\"apiKey\":\"" + esc(apiKey) + "\","
                + "\"errorName\":\"" + esc(throwable.getClass().getSimpleName()) + "\","
                + "\"message\":\"" + esc(msg) + "\","
                + "\"stackTrace\":\"" + esc(stack) + "\","
                + "\"runtime\":\"jvm\","
                + "\"os\":\"" + esc(System.getProperty("os.name", "linux")) + "\","
                + "\"version\":\"" + esc(release == null ? "1.0.0" : release) + "\","
                + (mappingTag != null ? "\"appBuild\":\"" + esc(mappingTag) + "\"," : "")
                + "\"breadcrumbs\":[" + String.join(",", breadcrumbs) + "]"
                + "}";

        HttpRequest req = HttpRequest.newBuilder(URI.create(endpoint + "/api/v1/event"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();
        return http.sendAsync(req, HttpResponse.BodyHandlers.ofString());
    }

    public CompletableFuture<HttpResponse<String>> trackMetric(String metricName, double metricValue) {
        String json = "{\"project\":\"" + esc(apiKey) + "\",\"metricName\":\"" + esc(metricName) + "\",\"metricValue\":" + metricValue + ",\"sourceType\":\"app\"}";
        HttpRequest req = HttpRequest.newBuilder(URI.create(endpoint + "/api/v1/analytics"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();
        return http.sendAsync(req, HttpResponse.BodyHandlers.ofString());
    }

    private static String esc(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "");
    }
}
