export type BreadcrumbLevel = "debug" | "info" | "warning" | "error";

export interface Breadcrumb {
  timestamp: string;
  category: "http" | "console" | "ui.click" | "navigation" | "custom";
  level: BreadcrumbLevel;
  message: string;
  data?: Record<string, unknown>;
}

export interface DevPulseConfig {
  apiKey: string;
  endpoint?: string;
  release?: string;
  commitSha?: string;
  environment?: string;
  runtime?: string;
  maxBreadcrumbs?: number;
  maxRetries?: number;
  autoCapture?: boolean;
  scrubPii?: boolean;
  captureWebVitals?: boolean;
  offlineStorageKey?: string;
}

const SENSITIVE_KEY_RE = /^(password|passwd|secret|token|authorization|auth|cookie|set-cookie|api_key|apikey|access_token|refresh_token|ssn|credit_card|card_number)$/i;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const SECRET_TOKEN_RE = /\b(dp_live|dp_pub|sk_live|sk_test|ghp|gho)_[A-Za-z0-9_-]{8,}\b/g;

export function redactPiiString(input: string): string {
  return input
    .replace(BEARER_RE, "$1 [REDACTED_TOKEN]")
    .replace(SECRET_TOKEN_RE, "$1_[REDACTED]")
    .replace(EMAIL_RE, "[REDACTED_EMAIL]");
}

export function redactPiiValue(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) return value;
  if (typeof value === "string") return redactPiiString(value);
  if (Array.isArray(value)) return value.map((item) => redactPiiValue(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? "[REDACTED]" : redactPiiValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

interface QueuedBeacon {
  url: string;
  payload: Record<string, unknown>;
  attempts: number;
  nextAttemptAt: number;
}

const DEFAULT_BASE_URL = "https://devpulse.ritualdev.in";

export class DevPulseClient {
  private config: Required<
    Pick<
      DevPulseConfig,
      "apiKey" | "endpoint" | "environment" | "maxBreadcrumbs" | "maxRetries" | "offlineStorageKey"
    >
  > &
    DevPulseConfig;
  private breadcrumbs: Breadcrumb[] = [];
  private queue: QueuedBeacon[] = [];
  private initialized = false;
  private flushing = false;

  constructor(config: DevPulseConfig) {
    if (!config?.apiKey) {
      throw new Error("@ritualdev/devpulse: apiKey is required");
    }
    this.config = {
      ...config,
      apiKey: config.apiKey,
      endpoint: (config.endpoint || DEFAULT_BASE_URL).replace(/\/$/, ""),
      environment: config.environment || "production",
      maxBreadcrumbs: config.maxBreadcrumbs ?? 40,
      maxRetries: config.maxRetries ?? 4,
      scrubPii: config.scrubPii ?? true,
      captureWebVitals: config.captureWebVitals ?? true,
      offlineStorageKey: config.offlineStorageKey || "__devpulse_offline_queue__",
    };
  }

  public init(): this {
    if (this.initialized) return this;
    this.initialized = true;

    this.restoreOfflineQueue();
    this.installBreadcrumbHooks();

    if (this.config.autoCapture !== false) {
      this.installCrashHooks();
    }

    if (this.config.captureWebVitals !== false) {
      this.installWebVitalsHooks();
    }

    if (this.config.release) {
      void this.trackReleaseSession(this.config.release, this.config.commitSha);
    }

    void this.flush();
    return this;
  }

  public addBreadcrumb(crumb: Omit<Breadcrumb, "timestamp"> & { timestamp?: string }): void {
    const shouldScrub = this.config.scrubPii !== false;
    const rawMsg = String(crumb.message || "").slice(0, 300);
    const entry: Breadcrumb = {
      timestamp: crumb.timestamp || new Date().toISOString(),
      category: crumb.category,
      level: crumb.level || "info",
      message: shouldScrub ? redactPiiString(rawMsg) : rawMsg,
      ...(crumb.data
        ? {
            data: (shouldScrub ? redactPiiValue(crumb.data) : crumb.data) as Record<
              string,
              unknown
            >,
          }
        : {}),
    };
    this.breadcrumbs.push(entry);
    if (this.breadcrumbs.length > this.config.maxBreadcrumbs) {
      this.breadcrumbs.shift();
    }
  }

  public getBreadcrumbs(): Breadcrumb[] {
    return [...this.breadcrumbs];
  }

  public async trackReleaseSession(version: string, commitSha?: string): Promise<boolean> {
    return this.sendOrQueue(`${this.config.endpoint}/api/v1/releases`, {
      apiKey: this.config.apiKey,
      action: "session",
      version,
      commitSha: commitSha || this.config.commitSha || null,
      sessions: 1,
    });
  }

  public async trackEvent(
    eventName: string,
    opts?: { path?: string; sourceType?: "web" | "app" | "desktop" | "cli"; os?: string }
  ): Promise<boolean> {
    return this.sendOrQueue(`${this.config.endpoint}/api/v1/analytics`, {
      project: this.config.apiKey,
      eventName,
      path: opts?.path || "/",
      sourceType: opts?.sourceType || (typeof window !== "undefined" ? "web" : "app"),
      os: opts?.os || this.detectOs(),
      appVersion: this.config.release || null,
    });
  }

  public async trackMetric(
    metricName: string,
    metricValue: number,
    opts?: { properties?: Record<string, unknown>; sourceType?: "web" | "app" | "desktop" | "cli"; os?: string }
  ): Promise<boolean> {
    const cleanProps =
      opts?.properties && this.config.scrubPii !== false
        ? (redactPiiValue(opts.properties) as Record<string, unknown>)
        : opts?.properties || null;
    return this.sendOrQueue(`${this.config.endpoint}/api/v1/analytics`, {
      project: this.config.apiKey,
      metricName,
      metricValue,
      properties: cleanProps,
      sourceType: opts?.sourceType || (typeof window !== "undefined" ? "web" : "app"),
      os: opts?.os || this.detectOs(),
      appVersion: this.config.release || null,
    });
  }

  public async trackWebVital(
    metric: "LCP" | "CLS" | "INP" | "TTFB" | "FCP",
    value: number,
    path?: string
  ): Promise<boolean> {
    const rounded = metric === "CLS" ? Math.round(value * 1000) / 1000 : Math.round(value);
    const rating =
      (metric === "LCP" && value <= 2500) ||
      (metric === "CLS" && value <= 0.1) ||
      (metric === "INP" && value <= 200) ||
      (metric === "TTFB" && value <= 800) ||
      (metric === "FCP" && value <= 1800)
        ? "good"
        : "needs_improvement";
    return this.trackMetric(`web_vital_${metric.toLowerCase()}`, rounded, {
      sourceType: "web",
      properties: {
        metric,
        rating,
        path: path || (typeof window !== "undefined" ? window.location.pathname : "/"),
      },
    });
  }

  public async captureException(
    error: unknown,
    extra?: { errorName?: string; extraMessage?: string; terminalLogs?: string }
  ): Promise<boolean> {
    const errObj = error instanceof Error ? error : null;
    const shouldScrub = this.config.scrubPii !== false;
    const errorName = extra?.errorName || errObj?.name || "UnhandledError";
    const rawMessage = extra?.extraMessage || errObj?.message || String(error);
    const rawStack = errObj?.stack || null;
    const rawLogs = extra?.terminalLogs || null;

    return this.sendOrQueue(`${this.config.endpoint}/api/v1/event`, {
      apiKey: this.config.apiKey,
      errorName,
      message: shouldScrub ? redactPiiString(rawMessage) : rawMessage,
      stackTrace: rawStack && shouldScrub ? redactPiiString(rawStack) : rawStack,
      terminalLogs: rawLogs && shouldScrub ? redactPiiString(rawLogs) : rawLogs,
      runtime: this.detectRuntime(),
      version: this.config.release || null,
      commitSha: this.config.commitSha || null,
      os: this.detectOs(),
      environment: this.config.environment,
      breadcrumbs: this.getBreadcrumbs(),
    });
  }

  public async captureMessage(message: string, level: BreadcrumbLevel = "error"): Promise<boolean> {
    const shouldScrub = this.config.scrubPii !== false;
    const cleanMessage = shouldScrub ? redactPiiString(message) : message;
    this.addBreadcrumb({ category: "custom", level, message: cleanMessage });
    return this.sendOrQueue(`${this.config.endpoint}/api/v1/event`, {
      apiKey: this.config.apiKey,
      errorName: level === "error" ? "CapturedErrorMessage" : "CapturedEvent",
      message: cleanMessage,
      runtime: this.detectRuntime(),
      version: this.config.release || null,
      commitSha: this.config.commitSha || null,
      os: this.detectOs(),
      environment: this.config.environment,
      breadcrumbs: this.getBreadcrumbs(),
    });
  }

  public async flush(): Promise<number> {
    if (this.flushing || this.queue.length === 0) return 0;
    this.flushing = true;
    let delivered = 0;
    const remaining: QueuedBeacon[] = [];
    const now = Date.now();

    try {
      for (const item of this.queue) {
        if (item.nextAttemptAt > now) {
          remaining.push(item);
          continue;
        }
        const ok = await this.postJson(item.url, item.payload);
        if (ok) {
          delivered++;
        } else if (item.attempts + 1 < this.config.maxRetries) {
          const backoffMs = Math.min(60_000, 1000 * Math.pow(2, item.attempts));
          remaining.push({
            ...item,
            attempts: item.attempts + 1,
            nextAttemptAt: Date.now() + backoffMs,
          });
        }
      }
      this.queue = remaining;
      this.persistOfflineQueue();
    } finally {
      this.flushing = false;
    }

    return delivered;
  }

  public getPendingQueueSize(): number {
    return this.queue.length;
  }

  private async sendOrQueue(url: string, payload: Record<string, unknown>): Promise<boolean> {
    const ok = await this.postJson(url, payload);
    if (ok) {
      if (this.queue.length > 0) void this.flush();
      return true;
    }

    this.queue.push({
      url,
      payload,
      attempts: 1,
      nextAttemptAt: Date.now() + 1500,
    });
    if (this.queue.length > 100) this.queue.shift();
    this.persistOfflineQueue();
    return false;
  }

  private async postJson(url: string, payload: Record<string, unknown>): Promise<boolean> {
    try {
      const body = JSON.stringify(payload).slice(0, 49_152); // Hard 48 KiB cap
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
        ...(typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
          ? { signal: AbortSignal.timeout(1500) }
          : {}),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private restoreOfflineQueue(): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const raw = window.localStorage.getItem(this.config.offlineStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) this.queue = parsed;
        }
      }
    } catch {
      // ignore storage errors
    }
  }

  private persistOfflineQueue(): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(this.config.offlineStorageKey, JSON.stringify(this.queue));
      }
    } catch {
      // ignore storage errors
    }
  }

  private installBreadcrumbHooks(): void {
    // 1. Wrap global fetch to record HTTP breadcrumbs (skipping DevPulse ingest calls)
    if (typeof globalThis.fetch === "function") {
      const origFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const targetUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (targetUrl.startsWith(this.config.endpoint)) {
          return origFetch(input, init);
        }
        const method = init?.method || "GET";
        const t0 = Date.now();
        try {
          const res = await origFetch(input, init);
          this.addBreadcrumb({
            category: "http",
            level: res.ok ? "info" : "warning",
            message: `${method} ${targetUrl} -> ${res.status}`,
            data: { status: res.status, durationMs: Date.now() - t0 },
          });
          return res;
        } catch (err: any) {
          this.addBreadcrumb({
            category: "http",
            level: "error",
            message: `${method} ${targetUrl} FAILED (${err?.message || "network error"})`,
            data: { durationMs: Date.now() - t0 },
          });
          throw err;
        }
      };
    }

    // 2. Console warning/error breadcrumbs
    if (typeof console !== "undefined") {
      const origErr = console.error.bind(console);
      console.error = (...args: unknown[]) => {
        this.addBreadcrumb({
          category: "console",
          level: "error",
          message: args.map((a) => String(a)).join(" ").slice(0, 200),
        });
        return origErr(...args);
      };
    }

    // 3. Browser UI clicks, navigation & online retry flush
    if (typeof window !== "undefined") {
      window.addEventListener("click", (evt) => {
        const el = evt.target as HTMLElement | null;
        if (!el) return;
        const label =
          el.getAttribute?.("aria-label") ||
          el.textContent?.trim()?.slice(0, 40) ||
          el.tagName?.toLowerCase();
        this.addBreadcrumb({
          category: "ui.click",
          level: "info",
          message: `Clicked <${el.tagName?.toLowerCase()}> ${label || ""}`.trim(),
        });
      });

      window.addEventListener("online", () => {
        void this.flush();
      });
    }
  }

  private installCrashHooks(): void {
    if (typeof window !== "undefined") {
      window.addEventListener("error", (evt) => {
        void this.captureException(evt.error || new Error(evt.message), {
          errorName: evt.error?.name || "UncaughtError",
          extraMessage: evt.message,
        });
      });
      window.addEventListener("unhandledrejection", (evt) => {
        void this.captureException(evt.reason, { errorName: "UnhandledRejection" });
      });
    } else if (typeof process !== "undefined" && typeof process.on === "function") {
      let fatalInFlight = false;
      process.on("uncaughtException", (err) => {
        if (fatalInFlight) return;
        fatalInFlight = true;
        void this.captureException(err, { errorName: "UncaughtException" }).finally(() => {
          fatalInFlight = false;
        });
      });
      process.on("unhandledRejection", (reason) => {
        void this.captureException(reason, { errorName: "UnhandledRejection" });
      });
    }
  }

  private installWebVitalsHooks(): void {
    if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;
    try {
      const lcpObs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) void this.trackWebVital("LCP", last.startTime);
      });
      lcpObs.observe({ type: "largest-contentful-paint", buffered: true });

      let clsScore = 0;
      const clsObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { hadRecentInput?: boolean; value?: number }>) {
          if (!entry.hadRecentInput && typeof entry.value === "number") {
            clsScore += entry.value;
          }
        }
      });
      clsObs.observe({ type: "layout-shift", buffered: true });

      const navEntries = performance.getEntriesByType?.("navigation") as Array<PerformanceNavigationTiming> | undefined;
      if (navEntries && navEntries[0]?.responseStart > 0) {
        void this.trackWebVital("TTFB", navEntries[0].responseStart);
      }

      window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && clsScore > 0) {
          void this.trackWebVital("CLS", clsScore);
        }
      });
    } catch {
      // Unsupported browser PerformanceObserver types fail silently
    }
  }

  private detectRuntime(): string {
    if (this.config.runtime) return this.config.runtime;
    if (typeof window !== "undefined") return "browser";
    if (typeof process !== "undefined" && process.version) return `node ${process.version}`;
    return "js";
  }

  private detectOs(): string {
    if (typeof navigator !== "undefined") return navigator.platform || "Web";
    if (typeof process !== "undefined") return `${process.platform} ${process.arch}`;
    return "Unknown";
  }

  /**
   * Evaluate a feature flag remotely for this user:
   *   if (await pulse.flag("new-checkout", { userId: "usr_123" })) { ... }
   */
  public async flag(
    flagKey: string,
    opts?: { userId?: string; defaultValue?: boolean }
  ): Promise<boolean> {
    const userId = opts?.userId || "anonymous";
    try {
      const res = await fetch(
        `${this.config.endpoint}/api/v1/flags/evaluate?apiKey=${encodeURIComponent(
          this.config.apiKey
        )}&key=${encodeURIComponent(flagKey)}&userId=${encodeURIComponent(userId)}`
      );
      if (!res.ok) return opts?.defaultValue ?? false;
      const data = (await res.json()) as { flags?: Record<string, boolean>; variants?: Record<string, string> };
      const enabled = Boolean(data.flags?.[flagKey]);
      const variant = data.variants?.[flagKey] || "control";
      void this.sendOrQueue(`${this.config.endpoint}/api/v1/flags/evaluate`, {
        apiKey: this.config.apiKey,
        flagKey,
        variant,
        userId,
        converted: false,
      });
      return enabled;
    } catch {
      return opts?.defaultValue ?? false;
    }
  }

  public async getFlagVariant(flagKey: string, userId = "anonymous"): Promise<string> {
    try {
      const res = await fetch(
        `${this.config.endpoint}/api/v1/flags/evaluate?apiKey=${encodeURIComponent(
          this.config.apiKey
        )}&key=${encodeURIComponent(flagKey)}&userId=${encodeURIComponent(userId)}`
      );
      if (!res.ok) return "control";
      const data = (await res.json()) as { variants?: Record<string, string> };
      return data.variants?.[flagKey] || "control";
    } catch {
      return "control";
    }
  }

  public async trackFlagConversion(flagKey: string, variant: string, userId = "anonymous"): Promise<boolean> {
    return this.sendOrQueue(`${this.config.endpoint}/api/v1/flags/evaluate`, {
      apiKey: this.config.apiKey,
      flagKey,
      variant,
      userId,
      converted: true,
    });
  }

  /**
   * React Native Mobile Crash Capture (iOS & Android):
   * Hooks ErrorUtils, OOM memory warning reporters, ANR JS-thread watchdog, and network errors.
   */
  public initReactNative(opts?: {
    platform?: "ios" | "android";
    deviceModel?: string;
    appBuild?: string;
    anrThresholdMs?: number;
  }): this {
    this.init();
    const g = globalThis as any;
    const rnPlatform = opts?.platform ? `react_native_${opts.platform}` : "react_native";

    if (g.ErrorUtils && typeof g.ErrorUtils.setGlobalHandler === "function") {
      const prev = g.ErrorUtils.getGlobalHandler?.();
      g.ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
        void this.sendOrQueue(`${this.config.endpoint}/api/v1/event`, {
          apiKey: this.config.apiKey,
          errorName: (error as Error)?.name || "ReactNativeCrash",
          message: (error as Error)?.message || String(error),
          stackTrace: (error as Error)?.stack || "",
          runtime: "react_native",
          platform: opts?.platform || "react_native",
          errorCategory: "exception",
          deviceModel: opts?.deviceModel || null,
          appBuild: opts?.appBuild || this.config.release || null,
          os: rnPlatform,
          breadcrumbs: this.breadcrumbs,
        });
        if (typeof prev === "function") prev(error, isFatal);
      });
    }

    // JS-thread ANR (Application Not Responding) stall watchdog
    const anrMs = opts?.anrThresholdMs ?? 5000;
    let lastTick = Date.now();
    if (typeof setInterval === "function") {
      const timer = setInterval(() => {
        const now = Date.now();
        const drift = now - lastTick - 1000;
        lastTick = now;
        if (drift > anrMs) {
          void this.sendOrQueue(`${this.config.endpoint}/api/v1/event`, {
            apiKey: this.config.apiKey,
            errorName: "ANRWatchdogError",
            message: `React Native JS thread blocked for ${drift}ms`,
            runtime: "react_native",
            platform: opts?.platform || "react_native",
            errorCategory: "anr",
            deviceModel: opts?.deviceModel || null,
            appBuild: opts?.appBuild || this.config.release || null,
            breadcrumbs: this.breadcrumbs,
          });
        }
      }, 1000);
      if (typeof (timer as any)?.unref === "function") (timer as any).unref();
    }

    return this;
  }

  public reportMobileEvent(params: {
    errorName: string;
    message: string;
    category: "oom" | "anr" | "network" | "exception";
    platform?: "ios" | "android" | "react_native" | "flutter";
    deviceModel?: string;
    appBuild?: string;
  }): Promise<boolean> {
    return this.sendOrQueue(`${this.config.endpoint}/api/v1/event`, {
      apiKey: this.config.apiKey,
      errorName: params.errorName,
      message: params.message,
      runtime: params.platform || "react_native",
      platform: params.platform || "react_native",
      errorCategory: params.category,
      deviceModel: params.deviceModel || null,
      appBuild: params.appBuild || this.config.release || null,
      breadcrumbs: this.breadcrumbs,
    });
  }
}

let activeClient: DevPulseClient | null = null;

export function init(config: DevPulseConfig): DevPulseClient {
  activeClient = new DevPulseClient(config).init();
  return activeClient;
}

export function addBreadcrumb(crumb: Omit<Breadcrumb, "timestamp"> & { timestamp?: string }): void {
  activeClient?.addBreadcrumb(crumb);
}

export function captureException(
  error: unknown,
  extra?: { errorName?: string; extraMessage?: string; terminalLogs?: string }
): Promise<boolean> {
  if (!activeClient) return Promise.resolve(false);
  return activeClient.captureException(error, extra);
}

export function trackEvent(
  eventName: string,
  opts?: { path?: string; sourceType?: "web" | "app" | "desktop" | "cli"; os?: string }
): Promise<boolean> {
  if (!activeClient) return Promise.resolve(false);
  return activeClient.trackEvent(eventName, opts);
}

export function flush(): Promise<number> {
  if (!activeClient) return Promise.resolve(0);
  return activeClient.flush();
}
