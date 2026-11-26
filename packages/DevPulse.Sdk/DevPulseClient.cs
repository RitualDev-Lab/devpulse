using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace DevPulse;

public sealed record DevPulseOptions(
    string ApiKey,
    string Endpoint = "https://devpulse.ritualdev.in",
    string? Release = null,
    string Environment = "production",
    bool ScrubPii = true,
    int MaxBreadcrumbs = 40);

public sealed record DevPulseBreadcrumb(long Timestamp, string Category, string Level, string Message);

public sealed class DevPulseClient
{
    private readonly DevPulseOptions _options;
    private readonly HttpClient _http;
    private readonly ConcurrentQueue<DevPulseBreadcrumb> _breadcrumbs = new();

    private static readonly Regex BearerPattern = new(@"(?i)\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+", RegexOptions.Compiled);
    private static readonly Regex EmailPattern = new(@"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", RegexOptions.Compiled);

    public DevPulseClient(DevPulseOptions options, HttpClient? httpClient = null)
    {
        _options = options;
        _http = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
    }

    public static string RedactPii(string? input)
    {
        if (string.IsNullOrEmpty(input)) return string.Empty;
        var clean = BearerPattern.Replace(input, "$1 [REDACTED]");
        return EmailPattern.Replace(clean, "[REDACTED_EMAIL]");
    }

    public void AddBreadcrumb(string category, string level, string message)
    {
        var msg = _options.ScrubPii ? RedactPii(message) : message;
        _breadcrumbs.Enqueue(new DevPulseBreadcrumb(DateTimeOffset.UtcNow.ToUnixTimeSeconds(), category, level, msg));
        while (_breadcrumbs.Count > _options.MaxBreadcrumbs)
            _breadcrumbs.TryDequeue(out _);
    }

    public void AttachGlobalHandlers()
    {
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            if (args.ExceptionObject is Exception ex)
                CaptureExceptionAsync(ex).GetAwaiter().GetResult();
        };
    }

    public async Task CaptureExceptionAsync(Exception ex, CancellationToken ct = default)
    {
        var msg = _options.ScrubPii ? RedactPii(ex.Message) : ex.Message;
        var stack = _options.ScrubPii ? RedactPii(ex.StackTrace) : ex.StackTrace;
        var payload = new
        {
            apiKey = _options.ApiKey,
            errorName = ex.GetType().Name,
            message = msg,
            stackTrace = stack,
            runtime = "dotnet",
            os = RuntimeInformation.OSDescription,
            version = _options.Release,
            environment = _options.Environment,
            breadcrumbs = _breadcrumbs.ToArray(),
        };
        using var resp = await _http.PostAsJsonAsync($"{_options.Endpoint.TrimEnd('/')}/api/v1/event", payload, ct);
    }

    public async Task TrackMetricAsync(string metricName, double metricValue, CancellationToken ct = default)
    {
        var payload = new
        {
            project = _options.ApiKey,
            metricName,
            metricValue,
            sourceType = "app",
            os = RuntimeInformation.OSDescription,
            appVersion = _options.Release,
        };
        using var resp = await _http.PostAsJsonAsync($"{_options.Endpoint.TrimEnd('/')}/api/v1/analytics", payload, ct);
    }
}
