/** Shared demo project used by the public landing page and API examples. */
export const DEMO_PROJECT_ID = "prj_ritual_core";

/**
 * The demo project is readable without an account only when the operator opts in with
 * DEVPULSE_PUBLIC_DEMO_PROJECT=true. Otherwise it is an ordinary project and needs normal auth.
 */
export function isPublicDemoProject(projectId: string | null | undefined): boolean {
  return process.env.DEVPULSE_PUBLIC_DEMO_PROJECT === "true" && projectId === DEMO_PROJECT_ID;
}
