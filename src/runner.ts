import inquirer from "inquirer";
import chalk from "chalk";
import { google } from "@ai-sdk/google";
import { generateText, stepCountIs } from "ai";
import { loadWorkflow, listWorkflows } from "./workflows.js";
import { PlaywrightMCP } from "./mcp/playwright-mcp.js";

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

  async interactiveRun(workflowName?: string): Promise<void> {
    await this.connect();
    try {
      const name = await this.selectWorkflow(workflowName);
      const wf = await loadWorkflow(name);

      if (!this.mcp) throw new Error("Not connected");
      const aiTools = await this.mcp.getAiTools();
      const toolNames = Object.keys(aiTools);
      console.log(chalk.gray(`[Runner] Exposed tools: ${toolNames.join(", ") || "<none>"}`));

      console.log(chalk.blue(`Running workflow '${wf.name}' with ${wf.steps.length} steps`));

      for (let i = 0; i < wf.steps.length; i += 1) {
        const step = wf.steps[i];
        console.log(chalk.cyan(`Step ${i + 1}/${wf.steps.length}`));
        if (step.instruction) console.log(chalk.gray(`Instruction: ${step.instruction}`));
        if (step.note) console.log(chalk.gray(`Note: ${step.note}`));
        console.log(chalk.gray(`Reproduce: ${step.reproduction}`));

        let refinement: string | undefined = undefined;
        let stepFinished = false;
        while (!stepFinished) {
          const prompt = `Reproduce the following browser automation step using the available tools.\n\nRules:\n- Keep calling tools until the step is fully completed; do not stop after a single call.\n- Prefer: snapshot -> analyze -> act (e.g., click) using robust selectors/descriptions.\n- For clicking text like 'leading article heading', snapshot and analyze to find the best locator, then click that element.\n- When finished, output a single line starting with 'DONE'.\n\nStep: ${step.reproduction}\n${refinement ? `Refinement: ${refinement}` : ``}`;

          console.log(chalk.magenta("[Runner] About to run model for this step with the following prompt:"));
          console.log(chalk.gray(prompt));

          const result = await generateText({ model: this.model, tools: aiTools, prompt, stopWhen: stepCountIs(10) });
          console.log(chalk.gray(`[Runner] finishReason: ${(result as any).finishReason ?? "unknown"}`));
          if ((result as any).usage) console.log(chalk.gray(`[Runner] usage: ${JSON.stringify((result as any).usage)}`));
          console.log(chalk.gray(`[Runner] toolCalls: ${result.toolCalls.length}, toolResults: ${result.toolResults.length}`));
          if (result.toolCalls.length === 0) {
            console.log(chalk.yellow("No tools were called for this step."));
          }
          for (let k = 0; k < result.toolCalls.length; k += 1) {
            const tc = result.toolCalls[k];
            const tr = result.toolResults.find(r => r.toolCallId === tc.toolCallId);
            console.log(chalk.cyan(`Executed tool ${k + 1}/${result.toolCalls.length}: ${tc.toolName}`));
            console.log(chalk.gray("Input:"), stringifySmall((tc as any).input));
            if (tr) console.log(chalk.green("Result:"), stringifySmall(tr.output));
          }
          if ((result.text ?? "").trim()) {
            console.log(chalk.gray("[Runner] Model final text:"));
            console.log((result.text ?? "").trim());
          }

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
              { type: "input", name: "r", message: "Describe changes to apply and re-run:", default: refinement ?? "" },
            ]);
            refinement = ans.r || undefined;
          } else {
            throw new Error("Workflow aborted by user");
          }
        }
      }

      console.log(chalk.green("Workflow completed."));
    } finally {
      await this.disconnect();
    }
  }

  private async selectWorkflow(pref?: string): Promise<string> {
    if (pref) return pref;
    const names = await listWorkflows();
    if (names.length === 0) throw new Error("No saved workflows found. Record one first.");
    const { name } = await inquirer.prompt([
      { type: "list", name: "name", message: "Select workflow:", choices: names },
    ]);
    return name as string;
  }
}

function stringifySmall(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 500 ? s.slice(0, 500) + "…" : s;
  } catch {
    return String(v);
  }
}
