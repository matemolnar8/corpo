import { GenerateTextResult } from "ai";
import { disconnectPlaywrightMCP } from "./tools/mcp/playwright-mcp.ts";
import { getLogLevel, logger, stringifySmall } from "./log.ts";
import { WorkflowStep } from "./workflows.ts";

// Shared utility function for printing AI-SDK model results
export function printModelResult(
  // deno-lint-ignore no-explicit-any
  result: GenerateTextResult<any, any>,
  context: string,
): void {
  // Always log basic info
  if (getLogLevel() === "default") {
    logger.info(
      context,
      `Tokens in/out/total: ${result.totalUsage.inputTokens}/${result.totalUsage.outputTokens}/${result.totalUsage.totalTokens}`,
    );
  } else {
    logger.info(
      context,
      `toolCalls: ${result.toolCalls.length}, toolResults: ${result.toolResults.length}, tokens in: ${result.totalUsage.inputTokens}, tokens out: ${result.totalUsage.outputTokens}, total tokens: ${result.totalUsage.totalTokens}`,
    );
  }

  // Print tool calls from result.steps
  if (result.steps && result.steps.length > 0) {
    if (getLogLevel() === "default") {
      // Compact per-step summary in default mode
      const stepSummaries: string[] = [];
      for (let i = 0; i < result.steps.length; i++) {
        const step = result.steps[i];
        const toolNames = (step.toolCalls ?? []).map((tc) => tc.toolName);
        const summary = toolNames.length > 0 ? `${i + 1}: ${toolNames.join(", ")}` : `${i + 1}: -`;
        stepSummaries.push(summary);
      }
      logger.info(context, `Steps: ${stepSummaries.join(" | ")}`);
    } else {
      // Detailed in debug mode
      logger.info(context, `Steps executed: ${result.steps.length}`);
      for (let stepIndex = 0; stepIndex < result.steps.length; stepIndex++) {
        const step = result.steps[stepIndex];
        logger.info(context, `Step ${stepIndex + 1}:`);
        if (step.toolCalls && step.toolCalls.length > 0) {
          for (let toolIndex = 0; toolIndex < step.toolCalls.length; toolIndex++) {
            const tc = step.toolCalls[toolIndex];
            const tr = step.toolResults?.find((r) => r.toolCallId === tc.toolCallId);
            logger.debug(context, `  Tool ${toolIndex + 1}/${step.toolCalls.length}: ${tc.toolName}`);
            logger.debug(context, `  Input: ${stringifySmall(tc.input)}`);
            if (tr) {
              logger.debug(context, `  Result: ${stringifySmall(tr.output)}`);
            }
          }
        } else {
          logger.info(context, "  No tools called in this step");
        }
      }
    }
  }

  logger.debug(context, `finishReason: ${result.finishReason ?? "unknown"}`);
  if (result.usage) {
    logger.debug(context, `usage: ${JSON.stringify(result.usage)}`);
  }

  // Always log final text
  if ((result.text ?? "").trim()) {
    if (getLogLevel() === "default") {
      logger.info(context, (result.text ?? "").trim());
    } else {
      logger.info(context, "Model final text:");
      logger.info(context, (result.text ?? "").trim());
    }
  }
}

// Token usage aggregation helpers
export type TokenUsageSummary = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  calls: number;
};

export function initTokenUsageSummary(): TokenUsageSummary {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 };
}

// deno-lint-ignore no-explicit-any
export function accumulateTokenUsage(summary: TokenUsageSummary, result: GenerateTextResult<any, any>): void {
  const input = result.totalUsage?.inputTokens ?? 0;
  const output = result.totalUsage?.outputTokens ?? 0;
  const total = result.totalUsage?.totalTokens ?? (input + output);
  summary.inputTokens += input;
  summary.outputTokens += output;
  summary.totalTokens += total;
  summary.calls += 1;
}

export function logTokenUsageSummary(context: string, summary: TokenUsageSummary): void {
  logger.info(
    context,
    `Token usage summary: calls: ${summary.calls}, tokens in: ${summary.inputTokens}, tokens out: ${summary.outputTokens}, total tokens: ${summary.totalTokens}`,
  );
}

export async function exit(code = 0) {
  logger.info("Core", "Exiting...");
  await disconnectPlaywrightMCP();
  // Sleep to ensure the MCP process is killed
  await new Promise((resolve) => setTimeout(resolve, 1000));
  Deno.exit(code);
}

export function deferPromise<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let deferred: { resolve: (value: T) => void; reject: (reason?: unknown) => void } | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    deferred = { resolve, reject };
  });

  return { promise, resolve: deferred!.resolve, reject: deferred!.reject };
}

// Build a compact summary of previous workflow steps to provide minimal context
// without significantly increasing token usage. Includes only the most recent
// few steps and truncates each line.
export function buildCompactPreviousStepsSummary(
  steps: WorkflowStep[],
  uptoIndexExclusive: number,
): string {
  if (!steps || uptoIndexExclusive <= 0) return "";
  const maxRecent = 3;
  const maxLineLength = Infinity;

  const start = Math.max(0, uptoIndexExclusive - maxRecent);
  const lines: string[] = [];
  for (let i = start; i < uptoIndexExclusive; i++) {
    const step = steps[i];
    const firstReproLine = (step.reproduction || "").split(/\r?\n/)[0]?.trim() ?? "";
    const base = (firstReproLine || step.instruction || "").replace(/\s+/g, " ").trim();
    const text = base.length > maxLineLength ? `${base.slice(0, maxLineLength - 1)}…` : base;
    lines.push(`${i + 1}) ${text}`);
  }

  // Keep header minimal; callers can wrap in a code fence.
  return lines.join("\n");
}
