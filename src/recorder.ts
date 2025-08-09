import inquirer from "inquirer";
import chalk from "chalk";
import { google } from "@ai-sdk/google";
import { generateText, stepCountIs } from "ai";
import { MCPTool } from "./tools/mcp/mcp-client.js";
import { Workflow, WorkflowStep, saveWorkflow } from "./workflows.js";
import { PlaywrightMCP } from "./tools/mcp/playwright-mcp.js";
import { printModelResult, getLogLevel } from "./utils.js";

export class WorkflowRecorder {
  private mcp?: PlaywrightMCP;
  private model = google("gemini-2.5-flash");

  async connect(): Promise<void> {
    const mcp = new PlaywrightMCP();
    await mcp.connect();
    this.mcp = mcp;
  }

  async disconnect() {
    if (this.mcp) await this.mcp.disconnect();
  }

  async interactiveRecord(): Promise<void> {
    await this.connect();
    try {
      if (!this.mcp) throw new Error("Not connected");
      const aiTools = await this.mcp.getAiTools();
      console.log(
        chalk.gray(
          `[Recorder] Exposed tools: ${
            Object.keys(aiTools).join(", ") || "<none>"
          }`
        )
      );
      const steps: WorkflowStep[] = [];

      const { workflowName, workflowDescription } = await inquirer.prompt([
        {
          type: "input",
          name: "workflowName",
          message: "Workflow name:",
          validate: (s: string) => !!s.trim() || "Required",
        },
        {
          type: "input",
          name: "workflowDescription",
          message: "Description (optional):",
        },
      ]);

      // Guidance
      console.log(
        chalk.blue(
          "Recording started. Describe each step in natural language (e.g., 'open https://intranet and sign in', 'click the Bookings tab', 'copy the booking dates'). The agent will pick a tool and arguments. Type 'done' to finish."
        )
      );

      // Loop adding steps
      while (true) {
        const { action } = await inquirer.prompt([
          {
            type: "list",
            name: "action",
            message: "Next action:",
            choices: [
              { name: "Add natural-language step", value: "add" },
              { name: "Finish and save", value: "done" },
              { name: "Cancel", value: "cancel" },
            ],
          },
        ]);

        if (action === "done") break;
        if (action === "cancel") {
          console.log(chalk.yellow("Cancelled; no workflow saved."));
          return;
        }

        const { nl } = await inquirer.prompt([
          {
            type: "input",
            name: "nl",
            message: "Describe the next action:",
            validate: (s: string) => !!s.trim() || "Required",
          },
        ]);

        // Per-step refinement loop: plan -> execute -> validate -> (maybe refine and re-run)
        let accepted = false;
        let refinement: string | undefined = undefined;
        while (!accepted) {
          const prompt = `You are recording a browser automation workflow. Use the available tools to perform the user's step end-to-end.

Rules:
- Keep calling tools as needed until the step is fully completed; do not stop after a single tool call.
- Prefer: take a page snapshot -> analyze snapshot -> perform the precise action (e.g., click) using a robust selector or description.
- If the instruction is to click text (e.g., 'Bookings' or 'leading article heading'), first snapshot and analyze to find a stable descriptor, then click using that descriptor.
- Only when the step is fully done, output a single line starting with 'REPRO:' followed by a concise, imperative description that can reproduce this step later. This instruction should include details that help the runner, like the tools used and a description of the targeted elements.

User step: ${nl}
${refinement ? `Refinement: ${refinement}` : ""}`;

          if (getLogLevel() === "debug") {
            console.log(
              chalk.magenta(
                "[Recorder] About to run model for this step with the following prompt:"
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

          // Use shared utility to print model results
          printModelResult(result, "Recorder");

          const resultText = result.text?.trim() ?? "";
          if (resultText) {
            console.log(chalk.gray("[Recorder] Model final text:"));
            console.log(resultText);
          }

          const { decision } = await inquirer.prompt([
            {
              type: "list",
              name: "decision",
              message: "Validate this step:",
              choices: [
                { name: "Looks good, save step", value: "accept" },
                {
                  name: "Provide change instructions and re-run",
                  value: "refine",
                },
                { name: "Discard this step", value: "discard" },
              ],
            },
          ]);

          if (decision === "accept") {
            const { note } = await inquirer.prompt([
              {
                type: "input",
                name: "note",
                message: "Optional note for this step:",
              },
            ]);

            const reproMatch = resultText.match(/^REPRO:\s*(.+)$/m);
            const reproduction = reproMatch
              ? reproMatch[1].trim()
              : (resultText || nl).slice(0, 140);
            if (!reproMatch) {
              console.log(
                chalk.yellow(
                  "[Recorder] No explicit REPRO: line found; falling back to truncated text/instruction."
                )
              );
            }

            steps.push({
              instruction: nl,
              note: note || undefined,
              reproduction,
            });
            accepted = true;
          } else if (decision === "refine") {
            const editAns: { refinement?: string } = await inquirer.prompt([
              {
                type: "input",
                name: "refinement",
                message: "Describe what to change (the agent will re-run):",
                default: refinement ?? "",
              },
            ]);
            refinement = editAns.refinement || undefined;
          } else {
            console.log(chalk.yellow("Discarded step."));
            accepted = true;
          }
        }
      }

      const workflow: Workflow = {
        name: workflowName,
        description: workflowDescription || undefined,
        createdAt: new Date().toISOString(),
        steps,
      };

      const file = await saveWorkflow(workflow);
      console.log(chalk.green(`Saved workflow to ${file}`));
    } finally {
      await this.disconnect();
    }
  }

  private buildAiTools(_tools: MCPTool[]) {
    // Kept for backward-compatibility, but runner/recorder now use PlaywrightMCP.getAiTools()
    return {} as Record<string, any>;
  }
}
