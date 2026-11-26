<?php

declare(strict_types=1);

namespace DevPulse;

final class Client
{
    private array $breadcrumbs = [];

    public function __construct(
        private readonly string $apiKey,
        private readonly string $endpoint = 'https://devpulse.ritualdev.in',
        private readonly ?string $release = null,
        private readonly bool $scrubPii = true,
        private readonly int $maxBreadcrumbs = 40
    ) {}

    public static function redactPii(string $input): string
    {
        $clean = preg_replace('/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]+/i', '$1 [REDACTED]', $input) ?? $input;
        return preg_replace('/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/', '[REDACTED_EMAIL]', $clean) ?? $clean;
    }

    public function addBreadcrumb(string $category, string $level, string $message): void
    {
        if ($this->scrubPii) {
            $message = self::redactPii($message);
        }
        $this->breadcrumbs[] = [
            'timestamp' => time(),
            'category' => $category,
            'level' => $level,
            'message' => $message,
        ];
        if (count($this->breadcrumbs) > $this->maxBreadcrumbs) {
            array_shift($this->breadcrumbs);
        }
    }

    public function registerHandlers(): void
    {
        set_exception_handler(fn(\Throwable $e) => $this->captureException($e));
    }

    public function captureException(\Throwable $e, array $context = []): bool
    {
        $msg = $this->scrubPii ? self::redactPii($e->getMessage()) : $e->getMessage();
        $trace = $this->scrubPii ? self::redactPii($e->getTraceAsString()) : $e->getTraceAsString();

        return $this->post('/api/v1/event', [
            'apiKey' => $this->apiKey,
            'errorName' => get_class($e),
            'message' => $msg,
            'stackTrace' => $trace,
            'runtime' => 'php',
            'os' => PHP_OS_FAMILY,
            'version' => $this->release ?? '1.0.0',
            'breadcrumbs' => $this->breadcrumbs,
            'routePath' => $context['route'] ?? ($_SERVER['REQUEST_URI'] ?? null),
        ]);
    }

    public function trackMetric(string $metricName, float $metricValue): bool
    {
        return $this->post('/api/v1/analytics', [
            'project' => $this->apiKey,
            'metricName' => $metricName,
            'metricValue' => $metricValue,
            'sourceType' => 'app',
            'os' => PHP_OS_FAMILY,
            'appVersion' => $this->release,
        ]);
    }

    private function post(string $path, array $payload): bool
    {
        $url = rtrim($this->endpoint, '/') . $path;
        $ctx = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => json_encode($payload, JSON_THROW_ON_ERROR),
                'timeout' => 4.5,
                'ignore_errors' => true,
            ],
        ]);
        return @file_get_contents($url, false, $ctx) !== false;
    }
}
