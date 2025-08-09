import inquirer from "inquirer";
import chalk from "chalk";
import { google } from "@ai-sdk/google";
import { generateText, stepCountIs } from "ai";
import { loadWorkflow, listWorkflows } from "./workflows.js";
import { PlaywrightMCP } from "./mcp/playwright-mcp.js";
import { printModelResult, getLogLevel } from "./utils.js";

export class WorkflowRunner {
  private mcp?: PlaywrightMCP;
  private model = google("gemini-2.5-flash");

  async connect(): Promise<void> {
    const mcp = new PlaywrightMCP();
    await mcp.connect();
    this.mcp = mcp;
  }

  async disconnect(): Promise<void> {
    if (this.mcp) await this.mcp.disconnect();
  }

  async run(workflowName?: string, autoMode: boolean = false): Promise<void> {
    await this.connect();
    try {
      const name = await this.selectWorkflow(workflowName);
      const wf = await loadWorkflow(name);

      if (!this.mcp) throw new Error("Not connected");
      const aiTools = await this.mcp.getAiTools();
      const toolNames = Object.keys(aiTools);
      console.log(
        chalk.gray(
          `[Runner] Exposed tools: ${toolNames.join(", ") || "<none>"}`
        )
      );

      const modeText = autoMode ? "AUTO" : "interactive";
      console.log(
        chalk.blue(
          `Running workflow '${wf.name}' in ${modeText} mode with ${wf.steps.length} steps`
        )
      );

      for (let i = 0; i < wf.steps.length; i += 1) {
        const step = wf.steps[i];
        console.log(chalk.cyan(`Step ${i + 1}/${wf.steps.length}`));
        if (step.instruction)
          console.log(chalk.gray(`Instruction: ${step.instruction}`));
        if (step.note) console.log(chalk.gray(`Note: ${step.note}`));
        console.log(chalk.gray(`Reproduce: ${step.reproduction}`));

        let refinement: string | undefined = undefined;
        let stepFinished = false;
        let attempts = 0;
        const maxAttempts = autoMode ? 3 : 1; // Auto mode allows retries, interactive mode doesn't

        while (!stepFinished && attempts < maxAttempts) {
          attempts++;
          if (autoMode) {
            console.log(
              chalk.yellow(`[Auto Mode] Attempt ${attempts}/${maxAttempts}`)
            );
          }

          const prompt = `Reproduce the following browser automation step using the available tools.

Rules:
- Keep calling tools until the step is fully completed; do not stop after a single call.
- Prefer: snapshot -> analyze -> act (e.g., click) using robust selectors/descriptions.
- For clicking text like 'leading article heading', snapshot and analyze to find the best locator, then click that element.
- When finished, output a single line starting with 'DONE'.

Step: ${step.reproduction}
${refinement ? `Refinement: ${refinement}` : ""}`;

          if (getLogLevel() === "debug") {
            console.log(
              chalk.magenta(
                "[Runner] About to run model for this step with the following prompt:"
              )
            );
            console.log(chalk.gray(prompt));
          }

          const result = await generateText({
            model: this.model,
            tools: aiTools,
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
                chalk.green(`[Auto Mode] Step ${i + 1} completed successfully`)
              );
            } else if (attempts >= maxAttempts) {
              console.log(
                chalk.red(
                  `[Auto Mode] Step ${
                    i + 1
                  } failed after ${maxAttempts} attempts, continuing to next step`
                )
              );
              stepFinished = true;
            } else {
              console.log(
                chalk.yellow(
                  `[Auto Mode] Step ${i + 1} incomplete, retrying...`
                )
              );
              // Add a small delay between attempts
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          } else {
            // Interactive mode logic: ask user for decision
            const { decision } = await inquirer.prompt([
              {
                type: "list",
                name: "decision",
                message: "Is this step finished?",
                choices: [
                  { name: "Continue to next step", value: "continue" },
                  { name: "Re-run with change instructions", value: "refine" },
                  { name: "Abort workflow", value: "abort" },
                ],
              },
            ]);

            if (decision === "continue") {
              stepFinished = true;
            } else if (decision === "refine") {
              const ans: { r?: string } = await inquirer.prompt([
                {
                  type: "input",
                  name: "r",
                  message: "Describe changes to apply and re-run:",
                  default: refinement ?? "",
                },
              ]);
              refinement = ans.r || undefined;
            } else {
              throw new Error("Workflow aborted by user");
            }
          }
        }
      }

      const completionText = autoMode ? "completed in AUTO mode" : "completed";
      console.log(chalk.green(`Workflow ${completionText}.`));
    } finally {
      await this.disconnect();
    }
  }

  private async selectWorkflow(pref?: string): Promise<string> {
    if (pref) return pref;
    const names = await listWorkflows();
    if (names.length === 0)
      throw new Error("No saved workflows found. Record one first.");
    const { name } = await inquirer.prompt([
      {
        type: "list",
        name: "name",
        message: "Select workflow:",
        choices: names,
      },
    ]);
    return name as string;
  }
}
