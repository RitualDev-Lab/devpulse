import { computeSemanticGroupKey } from "@/lib/crashes/impact";

export interface CrashAnalysisInput {
  errorName: string;
  message: string;
  stackTrace?: string | null;
  runtime: string;
  version?: string | null;
  routePath?: string | null;
}

export interface CrashAnalysisOutput {
  aiGroupKey: string;
  aiGroupTitle: string;
  aiRootCause: string;
  aiFixSuggestion: string;
  aiCodeSnippet: string;
  provider: "gemini-2.5-flash" | "deterministic";
}

function deterministicFallbackAnalysis(input: CrashAnalysisInput): CrashAnalysisOutput {
  const key = computeSemanticGroupKey(input.errorName, input.message, input.stackTrace);
  const topFrame =
    (input.stackTrace || "")
      .split(/\r?\n/)
      .find((l) => /\bat\s+|File\s+"/.test(l))
      ?.trim() || "entry point";

  const cleanErr = input.errorName.split(":")[0].trim() || "RuntimeError";
  return {
    aiGroupKey: key,
    aiGroupTitle: `${cleanErr}: ${input.message.slice(0, 72)}`,
    aiRootCause: `Unhandled ${cleanErr} raised in ${input.runtime}${input.routePath ? ` on route ${input.routePath}` : ""} near ${topFrame}. Triggered by: "${input.message.slice(0, 180)}".`,
    aiFixSuggestion:
      "Add defensive null/boundary validation before accessing external response or request properties, and wrap the failing call in a structured try/catch with retry or graceful fallback.",
    aiCodeSnippet: `try {\n  // Guard inputs around: ${topFrame.slice(0, 60)}\n  if (!payload) throw new Error("Missing expected payload");\n} catch (err) {\n  devpulse.captureException(err, { tags: { handled: true } });\n}`,
    provider: "deterministic",
  };
}

/**
 * Analyzes a crash event using the Gemini API (gemini-2.5-flash) to produce:
 * - Semantic grouping key & canonical title (beyond raw stack hashes)
 * - Natural-language "Why did this crash?" root cause explanation
 * - Concrete fix suggestion + code snippet derived from the stack trace
 */
export async function analyzeCrashWithGemini(
  input: CrashAnalysisInput,
  apiKeyOverride?: string | null
): Promise<CrashAnalysisOutput> {
  const apiKey = apiKeyOverride?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return deterministicFallbackAnalysis(input);
  }

  const prompt = `You are a Principal SRE debugging a production crash. Analyze the crash below and return strict JSON with keys:
- "aiGroupKey": lowercase kebab-case semantic group key (e.g. "null-deref-stripe-customer")
- "aiGroupTitle": concise 5-10 word issue title
- "aiRootCause": clear 2-sentence natural-language explanation of WHY this crashed
- "aiFixSuggestion": actionable 1-2 sentence fix recommendation
- "aiCodeSnippet": short clean code snippet (max 10 lines) fixing the root cause

Runtime: ${input.runtime}
Release: ${input.version || "unknown"}
Route: ${input.routePath || "unknown"}
Error: ${input.errorName}
Message: ${input.message}
Stack Trace:
${(input.stackTrace || "No stack trace supplied").slice(0, 3000)}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        }),
        signal: AbortSignal.timeout(12000),
      }
    );

    if (!res.ok) {
      return deterministicFallbackAnalysis(input);
    }

    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return deterministicFallbackAnalysis(input);
    }

    const parsed = JSON.parse(rawText);
    const fallback = deterministicFallbackAnalysis(input);

    return {
      aiGroupKey:
        typeof parsed.aiGroupKey === "string" && parsed.aiGroupKey.trim()
          ? parsed.aiGroupKey.trim().toLowerCase().slice(0, 80)
          : fallback.aiGroupKey,
      aiGroupTitle:
        typeof parsed.aiGroupTitle === "string" && parsed.aiGroupTitle.trim()
          ? parsed.aiGroupTitle.trim().slice(0, 140)
          : fallback.aiGroupTitle,
      aiRootCause:
        typeof parsed.aiRootCause === "string" && parsed.aiRootCause.trim()
          ? parsed.aiRootCause.trim().slice(0, 1200)
          : fallback.aiRootCause,
      aiFixSuggestion:
        typeof parsed.aiFixSuggestion === "string" && parsed.aiFixSuggestion.trim()
          ? parsed.aiFixSuggestion.trim().slice(0, 1000)
          : fallback.aiFixSuggestion,
      aiCodeSnippet:
        typeof parsed.aiCodeSnippet === "string" && parsed.aiCodeSnippet.trim()
          ? parsed.aiCodeSnippet.trim().slice(0, 1500)
          : fallback.aiCodeSnippet,
      provider: "gemini-2.5-flash",
    };
  } catch {
    return deterministicFallbackAnalysis(input);
  }
}
