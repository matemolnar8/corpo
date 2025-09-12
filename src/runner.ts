import { generateText } from "ai";
import { listWorkflows, loadWorkflow } from "./workflows.ts";
import { PlaywrightMCP } from "./tools/mcp/playwright-mcp.ts";
import { RUNNER_SYSTEM_PROMPT } from "./prompts.ts";
import {
  accumulateTokenUsage,
  buildCompactPreviousStepsSummary,
  initTokenUsageSummary,
  logTokenUsageSummary,
  printModelResult,
  type TokenUsageSummary,
} from "./utils.ts";
import { logger, spinner } from "./log.ts";
import { userInputTool } from "./tools/user-input.ts";
import { listVariablesTool, resetVariables, retrieveVariableTool, storeVariableTool } from "./tools/variable.ts";
import { snapshotGetAndFilterTool } from "./tools/snapshot-get-and-filter.ts";
import { listSecretsTool } from "./tools/secret.ts";
import { green } from "@std/fmt/colors";
import { input, select } from "./cli_prompts.ts";
import { model, stopWhen } from "./model.ts";
import { loadSecrets } from "./tools/secret.ts";

export type WorkflowRunResult = {
  workflowName: string;
  steps: number;
  autoMode: boolean;
  elapsedMs: number;
  tokenSummary: TokenUsageSummary;
  finalText?: string;
  attemptsPerStep: number[];
};

export class WorkflowRunError extends Error {
  constructor(public result: WorkflowRunResult, message: string) {
    super(message);
    this.name = "WorkflowRunError";
  }
}

export class WorkflowRunner {
  constructor(private mcp: PlaywrightMCP) {}

  async run(workflowName?: string, autoMode: boolean = false): Promise<WorkflowRunResult> {
    const startTimeMs = Date.now();
    resetVariables();
    await loadSecrets();
    const name = await this.selectWorkflow(workflowName);
    const wf = await loadWorkflow(name);

    const mcpTools = await this.mcp.getAiTools();
    const allTools = {
      ...mcpTools,
      user_input: userInputTool,
      store_variable: storeVariableTool,
      retrieve_variable: retrieveVariableTool,
      list_variables: listVariablesTool,
      list_secrets: listSecretsTool,
      snapshot_get_and_filter: snapshotGetAndFilterTool,
    };
    logger.info("Runner", `Exposed tools: ${Object.keys(allTools).join(", ") || "<none>"}`);

    const modeText = autoMode ? "AUTO" : "interactive";
    logger.info("Runner", `Running workflow '${wf.name}' in ${modeText} mode with ${wf.steps.length} steps`);

    const tokenSummary = initTokenUsageSummary();
    let finalStepText: string | undefined = undefined;
    const attemptsPerStep: number[] = [];

    logger.debug("Runner", `System prompt: ${RUNNER_SYSTEM_PROMPT}`);

    for (let i = 0; i < wf.steps.length; i += 1) {
      const step = wf.steps[i];
      logger.info("Runner", `Step ${i + 1}/${wf.steps.length}`);
      logger.info("Runner", `Instruction: ${step.instruction}`);
      logger.info("Runner", `Reproduce: ${step.reproduction}`);
      if (step.note) {
        logger.info("Runner", `Note: ${step.note}`);
      }

      let refinement: string | undefined = undefined;
      let stepFinished = false;
      let attempts = 0;
      const maxAttempts = autoMode ? 3 : Infinity;

      spinner.start();
      spinner.addText(`Running step ${i + 1}...`);
      try {
        while (!stepFinished && attempts < maxAttempts) {
          attempts++;
          if (autoMode) {
            logger.info("Runner", `[Auto Mode] Attempt ${attempts}/${maxAttempts}`);
          }

          const previousStepsSummary = buildCompactPreviousStepsSummary(wf.steps, i);
          const prevSection = previousStepsSummary
            ? `Context (previous steps):\n\n\`\`\`\n${previousStepsSummary}\n\`\`\`\n`
            : "";

          const system = RUNNER_SYSTEM_PROMPT;

          const prompt = `
${prevSection}

Perform the following step:
\`\`\`
${step.instruction}

How to reproduce:
${step.reproduction}
${refinement ? `\nRefinement: ${refinement}` : ""}
\`\`\`
`;

          logger.debug("Runner", "About to run model for this step with the following prompt:");
          logger.debug("Runner", prompt);

          spinner.addText("Thinking...");
          const result = await generateText({
            model: model,
            tools: allTools,
            system,
            prompt,
            stopWhen,
          });

          printModelResult(result, "Runner");
          accumulateTokenUsage(tokenSummary, result);

          const rawText = (result.text ?? "").trim();
          const nonEmptyLines = rawText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
          const firstLine = nonEmptyLines[0] ?? "";
          const lastLine = nonEmptyLines[nonEmptyLines.length - 1] ?? "";
          const isDone = firstLine.startsWith("DONE") || lastLine.startsWith("DONE");
          const isError = firstLine.startsWith("ERROR") || lastLine.startsWith("ERROR");

          if (autoMode) {
            if (isDone) {
              stepFinished = true;
              if (i === wf.steps.length - 1 && rawText) {
                finalStepText = rawText;
              }
              logger.success("Runner", `[Auto Mode] Step ${i + 1} completed successfully`);
            } else if (isError) {
              const message = `[Auto Mode] Step ${i + 1} reported ERROR`;
              logger.error("Runner", message);
              // Record attempts before failing
              attemptsPerStep.push(attempts);
              const elapsedMs = Date.now() - startTimeMs;
              logTokenUsageSummary("Runner", tokenSummary);
              const partial: WorkflowRunResult = {
                workflowName: wf.name,
                steps: wf.steps.length,
                autoMode,
                elapsedMs,
                tokenSummary,
                finalText: rawText || undefined,
                attemptsPerStep,
              };
              throw new WorkflowRunError(partial, message);
            } else if (attempts >= maxAttempts) {
              const message = `[Auto Mode] Step ${i + 1} failed after ${maxAttempts} attempts`;
              logger.error("Runner", message);
              // Record attempts before failing
              attemptsPerStep.push(attempts);
              const elapsedMs = Date.now() - startTimeMs;
              logTokenUsageSummary("Runner", tokenSummary);
              const partial: WorkflowRunResult = {
                workflowName: wf.name,
                steps: wf.steps.length,
                autoMode,
                elapsedMs,
                tokenSummary,
                finalText: rawText || undefined,
                attemptsPerStep,
              };
              throw new WorkflowRunError(partial, message);
            } else {
              logger.warn("Runner", `[Auto Mode] Step ${i + 1} incomplete, retrying...`);
              // Add a small delay between attempts
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          } else {
            // Interactive mode logic: ask user for decision; allow refinement even after ERROR
            if (isError) {
              logger.error("Runner", `Step ${i + 1} reported ERROR`);
            }
            const decision = select({
              message: isError
                ? "Model says ERROR. Proceed, refine, or abort?"
                : isDone
                ? "Model says DONE. Proceed or refine?"
                : "Is this step finished?",
              choices: [
                { name: "Continue to next step", value: "continue" },
                { name: "Re-run with change instructions", value: "refine" },
                { name: "Abort workflow", value: "abort" },
              ] as const,
              defaultIndex: 0,
            });

            if (decision === "continue") {
              stepFinished = true;
              if (i === wf.steps.length - 1 && rawText) {
                finalStepText = rawText;
              }
              if (isDone) {
                logger.success("Runner", `Step ${i + 1} completed successfully`);
              } else if (isError) {
                logger.warn("Runner", `Continuing to next step despite ERROR on step ${i + 1}`);
              }
            } else if (decision === "refine") {
              const r = input({
                message: "Describe changes to apply and re-run:",
                default: refinement ?? "",
              });
              refinement = r || undefined;
            } else {
              // Abort workflow; include partial metrics
              const message = "Workflow aborted by user";
              // Record attempts before failing
              attemptsPerStep.push(attempts);
              const elapsedMs = Date.now() - startTimeMs;
              logTokenUsageSummary("Runner", tokenSummary);
              const partial: WorkflowRunResult = {
                workflowName: wf.name,
                steps: wf.steps.length,
                autoMode,
                elapsedMs,
                tokenSummary,
                finalText: rawText || undefined,
                attemptsPerStep,
              };
              throw new WorkflowRunError(partial, message);
            }
          }
        }
      } finally {
        spinner.stop();
      }
      attemptsPerStep.push(attempts);
    }

    logTokenUsageSummary("Runner", tokenSummary);
    const completionText = autoMode ? "completed in AUTO mode" : "completed";
    logger.success("Runner", `Workflow ${completionText}.`);

    if ((finalStepText ?? "").trim()) {
      logger.info("Runner", green("Final step output:"));
      logger.info("Runner", green("--------------------------------"));
      logger.info("Runner", (finalStepText ?? "").trim());
      logger.info("Runner", green("--------------------------------"));
    }

    const elapsedMs = Date.now() - startTimeMs;
    return {
      workflowName: wf.name,
      steps: wf.steps.length,
      autoMode,
      elapsedMs,
      tokenSummary,
      finalText: (finalStepText ?? "").trim() || undefined,
      attemptsPerStep,
    };
  }

  private async selectWorkflow(pref?: string): Promise<string> {
    if (pref) return pref;
    const names = await listWorkflows();
    if (names.length === 0) {
      throw new Error("No saved workflows found. Record one first.");
    }
    const name = select({
      message: "Select workflow:",
      choices: names.map((n) => ({ name: n, value: n })),
      defaultIndex: 0,
    });
    return name as string;
  }
}
