import { generateText, stepCountIs } from "ai";
import { saveWorkflow, Workflow, WorkflowStep } from "./workflows.ts";
import { PlaywrightMCP } from "./tools/mcp/playwright-mcp.ts";
import { accumulateTokenUsage, initTokenUsageSummary, logTokenUsageSummary, printModelResult } from "./utils.ts";
import { logger } from "./log.ts";
import { userInputTool } from "./tools/user-input.ts";
import { listVariablesTool, resetVariables, retrieveVariableTool, storeVariableTool } from "./tools/variable.ts";
import { snapshotGetAndFilterTool } from "./tools/snapshot-get-and-filter.ts";
import { input, select } from "./cli_prompts.ts";
import { model } from "./model.ts";

export class WorkflowRecorder {
  constructor(private mcp: PlaywrightMCP) {}

  async interactiveRecord(): Promise<void> {
    resetVariables();
    const mcpTools = await this.mcp.getAiTools();
    const allTools = {
      ...mcpTools,
      user_input: userInputTool,
      store_variable: storeVariableTool,
      retrieve_variable: retrieveVariableTool,
      snapshot_get_and_filter: snapshotGetAndFilterTool,
      list_variables: listVariablesTool,
    };

    logger.info("Recorder", `Exposed tools: ${Object.keys(allTools).join(", ") || "<none>"}`);
    const steps: WorkflowStep[] = [];
    const tokenSummary = initTokenUsageSummary();

    const workflowName = input({
      message: "Workflow name:",
      required: true,
    });
    const workflowDescription = input({
      message: "Description (optional):",
    });

    // Guidance
    logger.info(
      "Recorder",
      "Recording started. Describe each step in natural language (e.g., 'open https://intranet and sign in', 'click the Bookings tab', 'copy the booking dates'). The agent will pick a tool and arguments. Type 'done' to finish.",
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
        logger.warn("Recorder", "Cancelled; no workflow saved.");
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
          `You are a helpful browser automation assistant. You are recording a browser automation workflow. Use the available tools to perform the user's step, until the step is fully completed.

Rules:
- Keep calling tools as needed until the step is fully completed; do not stop after a single tool call.
- Prefer: take a page snapshot -> analyze snapshot -> perform the precise action (e.g., click) using a robust selector or description.
- Only when the step is fully done, output a SINGLE line starting with 'REPRO:' followed by a concise, imperative description that can reproduce this step later. This instruction should include details that help the runner, like the tools used and a description of how to find the targeted elements.
- The REPRO line should only mention specific elements if they are expected to be constant. If the element depends on previous actions, then they should be located dynamically instead of being saved in the instruction.
- The REPRO line should contain the tools used to perform the step.
- If the instruction is to click text (e.g., 'Bookings' or 'leading article heading'), first snapshot and analyze to find a stable descriptor, then click using that descriptor.

Tool rules:
- Use browser_evaluate to run JavaScript code in the context of the page. This can be used for finding elements and extracting information. Do not use it for actions that can be performed with other tools.
- Use the store_variable tool to store the result of your actions in a variable when needed to use in a later step.
- Snapshots can be stored in variables with the browser_snapshot_and_save tool. Use the retrieve_variable tool to get the snapshot and analyze it.
- Use the snapshot_get_and_filter tool to filter a stored snapshot to find specific elements. This should be preferred as reading the full snapshot by the model is slow and expensive.
- When using browser_evaluate, save the code in REPRO.

User step: ${nextAction}
${refinement ? `Refinement: ${refinement}` : ""}
`;

        logger.debug("Recorder", "About to run model for this step with the following prompt:");
        logger.debug("Recorder", prompt);

        const result = await generateText({
          model: model,
          tools: allTools,
          prompt,
          stopWhen: stepCountIs(10),
        });

        // Use shared utility to print model results
        printModelResult(result, "Recorder");
        accumulateTokenUsage(tokenSummary, result);

        const resultText = result.text?.trim() ?? "";

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
            logger.warn("Recorder", "No explicit REPRO: line found; falling back to truncated text/instruction.");
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
          logger.warn("Recorder", "Discarded step.");
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

    logTokenUsageSummary("Recorder", tokenSummary);
    const file = await saveWorkflow(workflow);
    logger.success("Recorder", `Saved workflow to ${file}`);
  }
}
