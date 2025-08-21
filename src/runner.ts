import { generateText, stepCountIs } from "ai";
import { listWorkflows, loadWorkflow } from "./workflows.ts";
import { PlaywrightMCP } from "./tools/mcp/playwright-mcp.ts";
import { getLogLevel, printModelResult } from "./utils.ts";
import { userInputTool } from "./tools/user-input.ts";
import { resetVariables, retrieveVariableTool, storeVariableTool } from "./tools/variable.ts";
import { accessibilityFilterTool } from "./tools/accessibility-tree.ts";
import { cyan, gray, green, red, yellow } from "@std/fmt/colors";
import { input, select } from "./cli_prompts.ts";
import { model } from "./model.ts";

export class WorkflowRunner {
  constructor(private mcp: PlaywrightMCP) {}

  async run(workflowName?: string, autoMode: boolean = false): Promise<void> {
    resetVariables();
    const name = await this.selectWorkflow(workflowName);
    const wf = await loadWorkflow(name);

    const mcpTools = await this.mcp.getAiTools();
    const allTools = {
      ...mcpTools,
      userInput: userInputTool,
      storeVariable: storeVariableTool,
      retrieveVariable: retrieveVariableTool,
      accessibilityFilter: accessibilityFilterTool,
    };
    console.log(
      gray(
        `[Runner] Exposed tools: ${Object.keys(allTools).join(", ") || "<none>"}`,
      ),
    );

    const modeText = autoMode ? "AUTO" : "interactive";
    console.log(
      cyan(
        `Running workflow '${wf.name}' in ${modeText} mode with ${wf.steps.length} steps`,
      ),
    );

    for (let i = 0; i < wf.steps.length; i += 1) {
      const step = wf.steps[i];
      console.log(cyan(`Step ${i + 1}/${wf.steps.length}`));
      console.log(gray(`Instruction: ${step.instruction}`));
      console.log(gray(`Reproduce: ${step.reproduction}`));
      if (step.note) {
        console.log(gray(`Note: ${step.note}`));
      }

      let refinement: string | undefined = undefined;
      let stepFinished = false;
      let attempts = 0;
      const maxAttempts = autoMode ? 3 : Infinity;

      while (!stepFinished && attempts < maxAttempts) {
        attempts++;
        if (autoMode) {
          console.log(
            yellow(`[Auto Mode] Attempt ${attempts}/${maxAttempts}`),
          );
        }

        const prompt = `Reproduce the following browser automation step using the available tools.

Rules:
- Keep calling tools until the step is fully completed; do not stop after a single call.
- Prefer: snapshot -> analyze -> act (e.g., click) using robust selectors/descriptions.
- Use browser_evaluate to run JavaScript code in the context of the page. This can be used for finding elements and extracting information. Do not use it for actions that can be performed with other tools.
- For clicking text like 'leading article heading', snapshot and analyze to find the best locator, then click that element.
- Use the storeVariable tool to store the result of your actions in a variable when needed to use in a later step.
- Snapshots can be stored in variables with the snapshotAndSave tool. Use the retrieveVariable tool to get the snapshot and analyze it.
- Use the accessibilityFilter tool to filter a stored snapshot to find specific elements. This should be preferred as reading the full snapshot by the model is slow and expensive.
- When finished, output a single line starting with 'DONE'. Only output 'DONE' if the step is fully completed. Otherwise, if there was an error, output 'ERROR' and explain the error.

Step: ${step.instruction}
How to reproduce: ${step.reproduction}
${refinement ? `Refinement: ${refinement}` : ""}`;

        if (getLogLevel() === "debug") {
          console.log(gray("[Runner] About to run model for this step with the following prompt:"));
          console.log(gray(prompt));
        }

        const result = await generateText({
          model: model,
          tools: allTools,
          prompt,
          stopWhen: stepCountIs(10),
        });

        printModelResult(result, "Runner");

        if (autoMode) {
          // Auto mode logic: assume step is complete if tools were called or "DONE" is output
          const outputText = (result.text ?? "").trim().toLowerCase();
          if (outputText.includes("done") || result.toolCalls.length > 0) {
            stepFinished = true;
            console.log(
              green(`[Auto Mode] Step ${i + 1} completed successfully`),
            );
          } else if (attempts >= maxAttempts) {
            console.log(
              red(
                `[Auto Mode] Step ${i + 1} failed after ${maxAttempts} attempts, continuing to next step`,
              ),
            );
            stepFinished = true;
          } else {
            console.log(
              yellow(`[Auto Mode] Step ${i + 1} incomplete, retrying...`),
            );
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
          });

          if (decision === "continue") {
            stepFinished = true;
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
    }

    const completionText = autoMode ? "completed in AUTO mode" : "completed";
    console.log(green(`Workflow ${completionText}.`));
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
    });
    return name as string;
  }
}
