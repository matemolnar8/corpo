import { modelId } from "../src/model.ts";
import { WorkflowRunError, WorkflowRunner, WorkflowRunResult } from "../src/runner.ts";
import { connectPlaywrightMCP, disconnectPlaywrightMCP } from "../src/tools/mcp/playwright-mcp.ts";
import { resetVariables } from "../src/tools/variable.ts";
import { exit } from "../src/utils.ts";
import { parseArgs } from "@std/cli/parse-args";

export type VerifyResult = { ok: true } | { ok: false; reason?: string };

export type EvalConfig = {
  workflowName: string;
  headless?: boolean;
  verify: (result: WorkflowRunResult) => Promise<VerifyResult> | VerifyResult;
};
function isEvalConfig(value: unknown): value is EvalConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.workflowName === "string" && typeof v.verify === "function";
}

export type EvalRunSummary = {
  pass: boolean;
  reason?: string;
  workflowName: string;
  steps: number;
  elapsedMs: number;
  tokensIn: number;
  tokensOut: number;
  tokensTotal: number;
  attemptsPerStep: number[];
  modelId: string;
  timestamp: string;
};

export async function runEval(config: EvalConfig): Promise<EvalRunSummary> {
  resetVariables();
  const mcp = await connectPlaywrightMCP({ headless: config.headless ?? true });
  try {
    const runner = new WorkflowRunner(mcp);
    const result = await runner.run(config.workflowName, true);
    const verify = await config.verify(result);
    return {
      pass: verify.ok,
      reason: "reason" in verify ? verify.reason : undefined,
      workflowName: result.workflowName,
      steps: result.steps,
      elapsedMs: result.elapsedMs,
      tokensIn: result.tokenSummary.inputTokens,
      tokensOut: result.tokenSummary.outputTokens,
      tokensTotal: result.tokenSummary.totalTokens,
      attemptsPerStep: result.attemptsPerStep,
      modelId,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    console.error(e);
    if (e instanceof WorkflowRunError) {
      return {
        pass: false,
        reason: e.message,
        workflowName: e.result.workflowName,
        steps: e.result.steps,
        elapsedMs: e.result.elapsedMs,
        tokensIn: e.result.tokenSummary.inputTokens,
        tokensOut: e.result.tokenSummary.outputTokens,
        tokensTotal: e.result.tokenSummary.totalTokens,
        attemptsPerStep: e.result.attemptsPerStep,
        modelId,
        timestamp: new Date().toISOString(),
      };
    }
    return {
      pass: false,
      reason: e instanceof Error ? e.message : "Unknown error",
      workflowName: config.workflowName,
      steps: 0,
      elapsedMs: 0,
      tokensIn: 0,
      tokensOut: 0,
      tokensTotal: 0,
      attemptsPerStep: [],
      modelId,
      timestamp: new Date().toISOString(),
    };
  } finally {
    await disconnectPlaywrightMCP();
  }
}

// CLI entry: deno task eval <evalName> [--repeat=N]
if (import.meta.main) {
  const parsed = parseArgs(Deno.args, {
    string: ["repeat"],
    alias: { r: "repeat" },
  });
  // Mark process as running evals so interactive tools can enforce non-interactive behavior
  Deno.env.set("CORPO_EVAL_MODE", "1");
  const evalName = (parsed._[0] as string | undefined) ?? undefined;
  if (!evalName) {
    console.log("Usage: deno task eval <evalName> [--repeat=N]");
    await exit(2);
    throw new Error("Unreachable");
  }
  const repeat = Math.max(1, Number.parseInt((parsed.repeat as string | undefined) ?? "1", 10) || 1);

  const resultsDir = new URL("../evals/results/", import.meta.url);
  await Deno.mkdir(resultsDir, { recursive: true });

  const moduleUrl = new URL(`../evals/cases/${evalName}.ts`, import.meta.url).href;
  type EvalModule = { config: EvalConfig } | { default: EvalConfig };

  const mod = (await import(moduleUrl)) as unknown as Partial<EvalModule>;
  const candidate = (mod as Partial<{ config: unknown; default: unknown }>).config ??
    (mod as Partial<{ config: unknown; default: unknown }>).default;

  if (!isEvalConfig(candidate)) {
    console.error(`Eval '${evalName}' did not export a valid EvalConfig (expected 'config' or default export).`);
    await exit(2);
    throw new Error("Unreachable");
  }

  const config: EvalConfig = candidate;

  let anyFail = false;
  const safeEvalName = evalName.replace(/[^a-zA-Z0-9_-]+/g, "-");
  for (let i = 0; i < repeat; i += 1) {
    const summary = await runEval(config);
    const status = summary.pass ? "PASS" : "FAIL";
    console.log(
      JSON.stringify(
        {
          run: i + 1,
          status,
          workflow: summary.workflowName,
          modelId: summary.modelId,
          timestamp: summary.timestamp,
          steps: summary.steps,
          elapsedMs: summary.elapsedMs,
          tokens: {
            in: summary.tokensIn,
            out: summary.tokensOut,
            total: summary.tokensTotal,
          },
          attemptsPerStep: summary.attemptsPerStep,
          reason: summary.reason,
        },
        null,
        2,
      ),
    );

    const fileUrl = new URL(`./${summary.workflowName}__${safeEvalName}.jsonl`, resultsDir);
    const line = JSON.stringify({ ...summary, status, run: i + 1 }) + "\n";
    await Deno.writeTextFile(fileUrl, line, { append: true, create: true });

    if (!summary.pass) anyFail = true;
  }

  await exit(anyFail ? 1 : 0);
}
