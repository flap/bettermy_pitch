import tracer from "dd-trace";

// Datadog LLM Observability helpers. The tracer itself is started by
// `node --require dd-trace/init` (see Dockerfile); when it isn't (local dev,
// tests), these calls are no-ops.
const llmobs = tracer.llmobs;

type AgentName = "buyer" | "coach" | "evaluator" | "vote";

/**
 * Run one agent call inside an LLM Observability `agent` span grouped by the
 * practice session, so a whole rehearsal shows up as one LLM Obs session.
 */
export async function traceAgent<T>(
  agent: AgentName,
  opts: { sessionId: string; input: unknown; tags?: Record<string, string> },
  fn: () => Promise<T>,
  onDone?: (result: T, span: ReturnType<typeof llmobs.exportSpan> | undefined) => void,
): Promise<T> {
  return llmobs.trace({ kind: "agent", name: `bmp.${agent}`, sessionId: opts.sessionId }, async (span) => {
    const result = await fn();
    try {
      llmobs.annotate(span, {
        inputData: typeof opts.input === "string" ? opts.input : JSON.stringify(opts.input),
        outputData: typeof result === "string" ? result : JSON.stringify(result),
        tags: { agent, practice_session_id: opts.sessionId, ...opts.tags },
      });
      onDone?.(result, llmobs.exportSpan(span));
    } catch {
      // Never fail a user request because of telemetry.
    }
    return result;
  });
}

/** Attach the scorecard's scores to the evaluator span as LLM Obs evaluations. */
export function submitScores(
  span: ReturnType<typeof llmobs.exportSpan> | undefined,
  scores: Record<string, number>,
  tags: Record<string, string>,
) {
  if (!span) return;
  for (const [label, value] of Object.entries(scores)) {
    try {
      llmobs.submitEvaluation(span, { label, metricType: "score", value, tags });
    } catch {
      /* no-op when LLM Observability is disabled */
    }
  }
}
