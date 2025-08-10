import inquirer from "inquirer";
import chalk from "chalk";
import { google } from "@ai-sdk/google";
import { generateText, stepCountIs } from "ai";
import { Workflow, WorkflowStep, saveWorkflow } from "./workflows.js";
import { PlaywrightMCP } from "./tools/mcp/playwright-mcp.js";
import { printModelResult, getLogLevel } from "./utils.js";
import { userInputOutputSchema, userInputTool } from "./tools/user-input.js";

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
      const mcpTools = await this.mcp.getAiTools();
      const allTools = {
        ...mcpTools,
        userInput: userInputTool,
      };

      console.log(
        chalk.gray(
          `[Recorder] Exposed tools: ${
            Object.keys(allTools).join(", ") || "<none>"
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

      let previousUserInput: string | undefined;
      // Loop adding steps
      while (true) {
        const { action } = await inquirer.prompt<{
          action: "add" | "done" | "cancel";
        }>([
          {
            type: "list",
            name: "action",
            message: "Next action:",
            choices: [
              { name: "Add step", value: "add" },
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

        const { nextAction } = await inquirer.prompt<{ nextAction: string }>([
          {
            type: "input",
            name: "nextAction",
            message: "Describe the next action:",
            validate: (s: string) => !!s.trim() || "Required",
          },
        ]);

        // Per-step refinement loop: plan -> execute -> validate -> (maybe refine and re-run)
        let accepted = false;
        let refinement: string | undefined = undefined;
        let userInputForStep: string | undefined;
        while (!accepted) {
          const prompt = `You are recording a browser automation workflow. Use the available tools to perform the user's step end-to-end.

Rules:
- Keep calling tools as needed until the step is fully completed; do not stop after a single tool call.
- Prefer: take a page snapshot -> analyze snapshot -> perform the precise action (e.g., click) using a robust selector or description.
- If the instruction is to click text (e.g., 'Bookings' or 'leading article heading'), first snapshot and analyze to find a stable descriptor, then click using that descriptor.
- Only when the step is fully done, output a single line starting with 'REPRO:' followed by a concise, imperative description that can reproduce this step later. This instruction should include details that help the runner, like the tools used and a description of how to find the targeted elements.
- The REPRO line shouldn't mention specific elements unless they are expected to be constant. If the element depends on previous actions, then they should be located dynamically instead of being saved in the instruction.

User step: ${nextAction}
${refinement ? `Refinement: ${refinement}` : ""}
${previousUserInput ? `User input from the previous step: ${previousUserInput}`: ""}
`;

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
            tools: allTools,
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

          const userInputStep = result.steps.find((step) =>
            step.toolCalls.find((call) => call.toolName === "userInput")
          );

          if (userInputStep) {
            const userInputResult = userInputStep.toolResults.find(
              (result) => result.toolName === "userInput"
            );
            const output = await userInputOutputSchema.parseAsync(userInputResult?.output);

            console.log(chalk.gray("[Recorder] User input for next step: "));
            console.log(output.userInput);
            userInputForStep = output.userInput;
          } else {
            userInputForStep = undefined;
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
              : (resultText || nextAction).slice(0, 140);
            if (!reproMatch) {
              console.log(
                chalk.yellow(
                  "[Recorder] No explicit REPRO: line found; falling back to truncated text/instruction."
                )
              );
            }

            steps.push({
              instruction: nextAction,
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
          previousUserInput = userInputForStep;
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
}
