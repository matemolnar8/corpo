import { generateText, stepCountIs } from "ai";
import { saveWorkflow, Workflow, WorkflowStep } from "./workflows.ts";
import { PlaywrightMCP } from "./tools/mcp/playwright-mcp.ts";
import { getLogLevel, printModelResult } from "./utils.ts";
import { userInputTool } from "./tools/user-input.ts";
import { resetVariables, retrieveVariableTool, storeVariableTool } from "./tools/variable.ts";
import { cyan, gray, green, yellow } from "@std/fmt/colors";
import { input, select } from "./cli_prompts.ts";
import { model } from "./model.ts";

export class WorkflowRecorder {
  constructor(private mcp: PlaywrightMCP) {}

  async interactiveRecord(): Promise<void> {
    resetVariables();
    const mcpTools = await this.mcp.getAiTools();
    const allTools = {
      ...mcpTools,
      userInput: userInputTool,
      storeVariable: storeVariableTool,
      retrieveVariable: retrieveVariableTool,
    };

    console.log(
      gray(
        `[Recorder] Exposed tools: ${Object.keys(allTools).join(", ") || "<none>"}`,
      ),
    );
    const steps: WorkflowStep[] = [];

    const workflowName = input({
      message: "Workflow name:",
      required: true,
    });
    const workflowDescription = input({
      message: "Description (optional):",
    });

    // Guidance
    console.log(
      cyan(
        "Recording started. Describe each step in natural language (e.g., 'open https://intranet and sign in', 'click the Bookings tab', 'copy the booking dates'). The agent will pick a tool and arguments. Type 'done' to finish.",
      ),
    );

    // Loop adding steps
    while (true) {
      const action = select(
        {
          message: "Next action:",
          choices: [
            { name: "Add step", value: "add" },
            { name: "Finish and save", value: "done" },
            { name: "Cancel", value: "cancel" },
          ] as const,
        },
      );

      if (action === "done") break;
      if (action === "cancel") {
        console.log(yellow("Cancelled; no workflow saved."));
        return;
      }

      const nextAction = input({
        message: "Describe the next action:",
        required: true,
      });

      // Per-step refinement loop: plan -> execute -> validate -> (maybe refine and re-run)
      let accepted = false;
      let refinement: string | undefined = undefined;
      while (!accepted) {
        const prompt =
          `You are recording a browser automation workflow. Use the available tools to perform the user's step end-to-end.

Rules:
- Keep calling tools as needed until the step is fully completed; do not stop after a single tool call.
- Prefer: take a page snapshot -> analyze snapshot -> perform the precise action (e.g., click) using a robust selector or description.
- If the instruction is to click text (e.g., 'Bookings' or 'leading article heading'), first snapshot and analyze to find a stable descriptor, then click using that descriptor.
- Only when the step is fully done, output a single line starting with 'REPRO:' followed by a concise, imperative description that can reproduce this step later. This instruction should include details that help the runner, like the tools used and a description of how to find the targeted elements.
- The REPRO line shouldn't mention specific elements unless they are expected to be constant. If the element depends on previous actions, then they should be located dynamically instead of being saved in the instruction.

User step: ${nextAction}
${refinement ? `Refinement: ${refinement}` : ""}
`;

        if (getLogLevel() === "debug") {
          console.log(gray("[Recorder] About to run model for this step with the following prompt:"));
          console.log(gray(prompt));
        }

        const result = await generateText({
          model: model,
          tools: allTools,
          prompt,
          stopWhen: stepCountIs(10),
        });

        // Use shared utility to print model results
        printModelResult(result, "Recorder");

        const resultText = result.text?.trim() ?? "";
        if (resultText) {
          console.log(gray("[Recorder] Model final text:"));
          console.log(resultText);
        }

        const decision = select({
          message: "Validate this step:",
          choices: [
            { name: "Looks good, save step", value: "accept" },
            { name: "Provide change instructions and re-run", value: "refine" },
            { name: "Discard this step", value: "discard" },
          ] as const,
        });

        if (decision === "accept") {
          const note = input({
            message: "Optional note for this step:",
          });

          const reproMatch = resultText.match(/^REPRO:\s*(.+)$/m);
          const reproduction = reproMatch ? reproMatch[1].trim() : (resultText || nextAction).slice(0, 140);
          if (!reproMatch) {
            console.log(
              yellow(
                "[Recorder] No explicit REPRO: line found; falling back to truncated text/instruction.",
              ),
            );
          }

          steps.push({
            instruction: nextAction,
            note: note || undefined,
            reproduction,
          });
          accepted = true;
        } else if (decision === "refine") {
          const editRefinement = input({
            message: "Describe what to change (the agent will re-run):",
            default: refinement ?? "",
          });
          refinement = editRefinement || undefined;
        } else {
          console.log(yellow("Discarded step."));
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
    console.log(green(`Saved workflow to ${file}`));
  }
}
