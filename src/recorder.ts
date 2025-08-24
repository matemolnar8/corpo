import { generateText } from "ai";
import { saveWorkflow, Workflow, WorkflowStep } from "./workflows.ts";
import { PlaywrightMCP } from "./tools/mcp/playwright-mcp.ts";
import { accumulateTokenUsage, initTokenUsageSummary, logTokenUsageSummary, printModelResult } from "./utils.ts";
import { logger } from "./log.ts";
import { userInputTool } from "./tools/user-input.ts";
import { listVariablesTool, resetVariables, retrieveVariableTool, storeVariableTool } from "./tools/variable.ts";
import { snapshotGetAndFilterTool } from "./tools/snapshot-get-and-filter.ts";
import { input, select } from "./cli_prompts.ts";
import { model, stopWhen } from "./model.ts";
import { listSecretsTool, loadSecrets } from "./tools/secret.ts";

export class WorkflowRecorder {
  constructor(private mcp: PlaywrightMCP) {}

  async interactiveRecord(): Promise<void> {
    resetVariables();
    await loadSecrets();
    const mcpTools = await this.mcp.getAiTools();
    const allTools = {
      ...mcpTools,
      user_input: userInputTool,
      store_variable: storeVariableTool,
      retrieve_variable: retrieveVariableTool,
      snapshot_get_and_filter: snapshotGetAndFilterTool,
      list_variables: listVariablesTool,
      list_secrets: listSecretsTool,
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
      "Recording started. Describe each step in natural language (e.g., 'open https://intranet and sign in', 'click the Bookings tab', 'copy the booking dates'). The agent will pick a tool and arguments. Type 'done' to finish, or 'cancel' to abort.",
    );

    // Loop adding steps
    while (true) {
      const nextAction = input({
        message: "Describe the next action (or type 'done' / 'cancel'):",
        required: true,
      });

      const lowered = nextAction.trim().toLowerCase();
      if (lowered === "done") break;
      if (lowered === "cancel") {
        logger.warn("Recorder", "Cancelled; no workflow saved.");
        return;
      }

      // Per-step refinement loop: plan -> execute -> validate -> (maybe refine and re-run)
      let accepted = false;
      let refinement: string | undefined = undefined;
      while (!accepted) {
        const prompt =
          `You are a helpful browser automation assistant. You are recording a browser automation workflow. Use the available tools to perform the user's step, until the step is fully completed.

Rules:
- Keep calling tools as needed until the step is fully completed; do not stop after a single tool call.
- Prefer: take a page snapshot -> filter with snapshot_get_and_filter -> analyze -> perform the precise action (e.g., click) using a robust selector or description.
- When the step is fully done, ALWAYS output a REPRO block that describes how to reproduce the step later.
- Start a line with \`REPRO:\`, then provide one or more lines of instructions, and finish with a line \`ENDREPRO\`. Do not include code fences. Example:
  REPRO:
  use snapshot_get_and_filter to locate the button [name="Submit"] and click it
  verify the confirmation toast appears with role="status" and text includes "Saved"
  ENDREPRO
- The REPRO block should only mention specific elements if they are expected to be stable; otherwise describe how to locate them dynamically.
- The REPRO block MUST include the tools used to perform the step.
- If the instruction is to click text (e.g., 'Bookings' or 'leading article heading'), first snapshot and analyze to find a stable descriptor, then click using that descriptor.

Snapshot guidance:
- Snapshots are ARIA accessibility snapshots (accessibility trees). Node descriptors use ARIA roles (e.g., 'button', 'link', 'heading', 'row') and accessible names.
- Prefer locating elements by role and accessible name. Use attributes from descriptors (e.g., [level=2], [checked]) when helpful.
- Use the snapshot_get_and_filter tool to filter stored snapshots by role/text/attributes. Avoid loading entire snapshots into the model.

Tool rules:
- Prefer snapshot_get_and_filter for locating elements, reading text, and checking attributes. Use browser_evaluate only when snapshot filtering cannot achieve the goal. Do not use it for actions that can be performed with other tools.
- Use the store_variable tool to store the result of your actions in a variable when needed to use in a later step.
- Snapshots can be stored in variables with the browser_snapshot_and_save tool. Use the retrieve_variable tool to get the snapshot and analyze it.
- Use the snapshot_get_and_filter tool to filter a stored snapshot to find specific elements. This is the default path for element discovery and should be preferred over running JavaScript; reading the full snapshot by the model is slow and expensive.
- When you need credentials or are unsure which secret names exist, first call list_secrets to view the available placeholders and then use those placeholders (e.g., {{secret.NAME}}) in subsequent tool calls. Never include raw secret values in messages.

User step:
\`\`\`
${nextAction}

${refinement ? `Refinement: ${refinement}` : ""}
\`\`\`
`;

        logger.debug("Recorder", "About to run model for this step with the following prompt:");
        logger.debug("Recorder", prompt);

        const result = await generateText({
          model: model,
          tools: allTools,
          prompt,
          stopWhen,
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
          defaultIndex: 0,
        });

        if (decision === "accept") {
          const note = input({
            message: "Optional note for this step:",
          });

          const blockMatch = resultText.match(/^REPRO:\s*\r?\n([\s\S]*?)\r?\nENDREPRO\b/m);
          const reproduction = blockMatch ? blockMatch[1].trim() : (resultText || nextAction).slice(0, 140);
          if (!blockMatch) {
            logger.warn(
              "Recorder",
              "No explicit REPRO block (REPRO: ... ENDREPRO) found; falling back to truncated text/instruction.",
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
