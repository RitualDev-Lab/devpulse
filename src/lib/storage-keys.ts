/**
 * Scoped localStorage key builder.
 * Prevents interactive demo previews (?demo=1) from overwriting real user preferences,
 * widget layouts, or PII scrubber settings in the browser.
 */
export function isDemoStorageContext(isDemo?: boolean, projectId?: string): boolean {
  if (typeof isDemo === "boolean") return isDemo;
  if (projectId === "demo") return true;
  if (typeof window !== "undefined") {
    try {
      return new URLSearchParams(window.location.search).get("demo") === "1";
    } catch {
      return false;
    }
  }
  return false;
}

export function getProjectStorageKey(
  prefix: string,
  projectId: string,
  isDemo?: boolean
): string {
  const demo = isDemoStorageContext(isDemo, projectId);
  return demo ? `devpulse_demo_${prefix}_${projectId}` : `devpulse_${prefix}_${projectId}`;
}
