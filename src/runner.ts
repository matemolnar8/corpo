import { generateText } from "ai";
import { listWorkflows, loadWorkflow } from "./workflows.ts";
import { PlaywrightMCP } from "./tools/mcp/playwright-mcp.ts";
import {
  accumulateTokenUsage,
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
      while (!stepFinished && attempts < maxAttempts) {
        attempts++;
        if (autoMode) {
          logger.info("Runner", `[Auto Mode] Attempt ${attempts}/${maxAttempts}`);
        }

        const prompt = `Reproduce the following browser automation step using the available tools.

Rules:
- Keep calling tools until the step is fully completed; do not stop after a single call.
- Prefer: snapshot -> filter with snapshot_get_and_filter -> analyze -> act (e.g., click) using robust selectors/descriptions.
- For clicking text like 'leading article heading', snapshot and analyze to find the best locator, then click that element.

Snapshot guidance:
- Snapshots are ARIA accessibility snapshots (accessibility trees). Node descriptors use ARIA roles (e.g., 'button', 'link', 'heading', 'row') and accessible names.
- Prefer locating elements by role and accessible name. Use descriptor attributes (e.g., [level=2], [checked]) when helpful.
- Use the snapshot_get_and_filter tool to filter stored snapshots by role/text/attributes. Avoid loading entire snapshots into the model.

Tool rules:
- Prefer snapshot_get_and_filter for locating elements, reading text, and checking attributes. Use browser_evaluate only when snapshot filtering cannot achieve the goal. Do not use it for actions that can be performed with other tools.
- Use the store_variable tool to store results you will need in a later step.
- Snapshots can be stored in variables with the browser_snapshot_and_save tool. Use the retrieve_variable tool to get the snapshot and analyze it.
- Use the snapshot_get_and_filter tool to filter a stored snapshot to find specific elements. This is the default path for element discovery and should be preferred over running JavaScript; reading the full snapshot by the model is slow and expensive.
- If you need to reference a credential or secret in a tool call, use placeholders like {{secret.NAME}}. Do not reveal secret values; placeholders will be replaced at tool-execution time.
- When you need credentials or are unsure which secret names exist, first call list_secrets to view the available placeholders and then use those placeholders (e.g., {{secret.NAME}}) in subsequent tool calls. Never include raw secret values in messages.

When finished, output a single line starting with 'DONE'. Only output 'DONE' if the step is fully completed. Otherwise, if there was an error, output 'ERROR' and explain the error.

Step: 
\`\`\`
${step.instruction}

How to reproduce:
${step.reproduction}

${refinement ? `Refinement: ${refinement}` : ""}
\`\`\`
`;

        logger.debug("Runner", "About to run model for this step with the following prompt:");
        logger.debug("Runner", prompt);

        spinner.addText("Thinking...");
        const result = await generateText({
          model: model,
          tools: allTools,
          prompt,
          stopWhen,
        });

        printModelResult(result, "Runner");
        accumulateTokenUsage(tokenSummary, result);

        if (autoMode) {
          // Auto mode logic: assume step is complete if tools were called or "DONE" is output
          const rawText = (result.text ?? "").trim();
          const outputText = rawText.toLowerCase();
          if (outputText.includes("done")) {
            stepFinished = true;
            if (i === wf.steps.length - 1 && rawText) {
              finalStepText = rawText;
            }
            logger.success("Runner", `[Auto Mode] Step ${i + 1} completed successfully`);
          } else if (attempts >= maxAttempts) {
            logger.error(
              "Runner",
              `[Auto Mode] Step ${i + 1} failed after ${maxAttempts} attempts, continuing to next step`,
            );
            stepFinished = true;
            if (i === wf.steps.length - 1 && (result.text ?? "").trim()) {
              finalStepText = (result.text ?? "").trim();
            }
          } else {
            logger.warn("Runner", `[Auto Mode] Step ${i + 1} incomplete, retrying...`);
            // Add a small delay between attempts
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } else {
          // Interactive mode logic: ask user for decision
          const decision = select({
            message: "Is this step finished?",
            choices: [
              { name: "Continue to next step", value: "continue" },
              { name: "Re-run with change instructions", value: "refine" },
              { name: "Abort workflow", value: "abort" },
            ] as const,
            defaultIndex: 0,
          });

          if (decision === "continue") {
            stepFinished = true;
            const rawText = (result.text ?? "").trim();
            if (i === wf.steps.length - 1 && rawText) {
              finalStepText = rawText;
            }
          } else if (decision === "refine") {
            const r = input({
              message: "Describe changes to apply and re-run:",
              default: refinement ?? "",
            });
            refinement = r || undefined;
          } else {
            throw new Error("Workflow aborted by user");
          }
        }
      }
      spinner.stop();
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
