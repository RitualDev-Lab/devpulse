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
  offlineStorageKey?: string;
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

    if (this.config.release) {
      void this.trackReleaseSession(this.config.release, this.config.commitSha);
    }

    void this.flush();
    return this;
  }

  public addBreadcrumb(crumb: Omit<Breadcrumb, "timestamp"> & { timestamp?: string }): void {
    const entry: Breadcrumb = {
      timestamp: crumb.timestamp || new Date().toISOString(),
      category: crumb.category,
      level: crumb.level || "info",
      message: String(crumb.message || "").slice(0, 300),
      ...(crumb.data ? { data: crumb.data } : {}),
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

  public async captureException(
    error: unknown,
    extra?: { errorName?: string; extraMessage?: string; terminalLogs?: string }
  ): Promise<boolean> {
    const errObj = error instanceof Error ? error : null;
    const errorName = extra?.errorName || errObj?.name || "UnhandledError";
    const message = extra?.extraMessage || errObj?.message || String(error);
    const stackTrace = errObj?.stack || null;

    return this.sendOrQueue(`${this.config.endpoint}/api/v1/event`, {
      apiKey: this.config.apiKey,
      errorName,
      message,
      stackTrace,
      terminalLogs: extra?.terminalLogs || null,
      runtime: this.detectRuntime(),
      version: this.config.release || null,
      commitSha: this.config.commitSha || null,
      os: this.detectOs(),
      environment: this.config.environment,
      breadcrumbs: this.getBreadcrumbs(),
    });
  }

  public async captureMessage(message: string, level: BreadcrumbLevel = "error"): Promise<boolean> {
    this.addBreadcrumb({ category: "custom", level, message });
    return this.sendOrQueue(`${this.config.endpoint}/api/v1/event`, {
      apiKey: this.config.apiKey,
      errorName: level === "error" ? "CapturedErrorMessage" : "CapturedEvent",
      message,
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
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
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
      process.on("uncaughtException", (err) => {
        void this.captureException(err, { errorName: "UncaughtException" });
      });
      process.on("unhandledRejection", (reason) => {
        void this.captureException(reason, { errorName: "UnhandledRejection" });
      });
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
