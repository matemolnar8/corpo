import { GenerateTextResult } from "ai";
import { disconnectPlaywrightMCP } from "./tools/mcp/playwright-mcp.ts";
import { getLogLevel, logger, stringifySmall } from "./log.ts";

// Shared utility function for printing AI-SDK model results
export function printModelResult(
  // deno-lint-ignore no-explicit-any
  result: GenerateTextResult<any, any>,
  context: string,
): void {
  // Always log basic info
  logger.info(
    context,
    `toolCalls: ${result.toolCalls.length}, toolResults: ${result.toolResults.length}, tokens in: ${result.totalUsage.inputTokens}, tokens out: ${result.totalUsage.outputTokens}, total tokens: ${result.totalUsage.totalTokens}`,
  );

  // Print tool calls from result.steps
  if (result.steps && result.steps.length > 0) {
    logger.info(context, `Steps executed: ${result.steps.length}`);
    for (let stepIndex = 0; stepIndex < result.steps.length; stepIndex++) {
      const step = result.steps[stepIndex];
      logger.info(context, `Step ${stepIndex + 1}:`);
      if (step.toolCalls && step.toolCalls.length > 0) {
        for (
          let toolIndex = 0;
          toolIndex < step.toolCalls.length;
          toolIndex++
        ) {
          const tc = step.toolCalls[toolIndex];
          const tr = step.toolResults?.find(
            (r) => r.toolCallId === tc.toolCallId,
          );

          // Default level: just tool name and args in one line
          if (getLogLevel() === "default") {
            const args = stringifySmall(tc.input);
            logger.info(context, `  Tool ${toolIndex + 1}/${step.toolCalls.length}: ${tc.toolName}(${args})`);
          } else {
            // Debug level: detailed logging
            logger.debug(context, `  Tool ${toolIndex + 1}/${step.toolCalls.length}: ${tc.toolName}`);
            logger.debug(context, `  Input: ${stringifySmall(tc.input)}`);
            if (tr) {
              logger.debug(context, `  Result: ${stringifySmall(tr.output)}`);
            }
          }
        }
      } else {
        logger.info(context, "  No tools called in this step");
      }
    }
  } else {
    logger.info(context, "No tools were called.");
  }

  logger.debug(context, `finishReason: ${result.finishReason ?? "unknown"}`);
  if (result.usage) {
    logger.debug(context, `usage: ${JSON.stringify(result.usage)}`);
  }

  // Always log final text
  if ((result.text ?? "").trim()) {
    logger.info(context, "Model final text:");
    console.log((result.text ?? "").trim());
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
