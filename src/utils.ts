import chalk from "chalk";
import { GenerateTextResult } from "ai";

export type LogLevel = "default" | "debug";

let currentLogLevel: LogLevel = "default";

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

// Shared utility function for printing AI-SDK model results
export function printModelResult(
  result: GenerateTextResult<any, any>,
  context: string
): void {
  // Always log basic info
  console.log(
    chalk.gray(
      `[${context}] toolCalls: ${result.toolCalls.length}, toolResults: ${result.toolResults.length}`
    )
  );

  // Print tool calls from result.steps
  if (result.steps && result.steps.length > 0) {
    console.log(
      chalk.blue(`[${context}] Steps executed: ${result.steps.length}`)
    );
    for (let stepIndex = 0; stepIndex < result.steps.length; stepIndex++) {
      const step = result.steps[stepIndex];
      console.log(chalk.blue(`[${context}] Step ${stepIndex + 1}:`));
      if (step.toolCalls && step.toolCalls.length > 0) {
        for (
          let toolIndex = 0;
          toolIndex < step.toolCalls.length;
          toolIndex++
        ) {
          const tc = step.toolCalls[toolIndex];
          const tr = step.toolResults?.find(
            (r: any) => r.toolCallId === tc.toolCallId
          );
          
          // Default level: just tool name and args in one line
          if (currentLogLevel === "default") {
            const args = stringifySmall((tc as any).input);
            console.log(
              chalk.cyan(
                `  Tool ${toolIndex + 1}/${step.toolCalls.length}: ${tc.toolName}(${args})`
              )
            );
          } else {
            // Debug level: detailed logging
            console.log(
              chalk.cyan(
                `  Tool ${toolIndex + 1}/${step.toolCalls.length}: ${tc.toolName}`
              )
            );
            console.log(
              chalk.gray("  Input:"),
              stringifySmall((tc as any).input)
            );
            if (tr)
              console.log(chalk.green("  Result:"), stringifySmall(tr.output));
          }
        }
      } else {
        console.log(chalk.yellow("  No tools called in this step"));
      }
    }
  } else {
    console.log(chalk.yellow(`[${context}] No tools were called.`));
  }

  // Debug level: additional logging
  if (currentLogLevel === "debug") {
    console.log(
      chalk.gray(`[${context}] finishReason: ${result.finishReason ?? "unknown"}`)
    );
    if (result.usage) {
      console.log(
        chalk.gray(`[${context}] usage: ${JSON.stringify(result.usage)}`)
      );
    }
  }

  // Always log final text
  if ((result.text ?? "").trim()) {
    console.log(chalk.gray(`[${context}] Model final text:`));
    console.log((result.text ?? "").trim());
  }
}

export function stringifySmall(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 500 ? s.slice(0, 500) + "…" : s;
  } catch {
    return String(v);
  }
}
