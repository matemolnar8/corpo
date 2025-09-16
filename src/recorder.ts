import { generateText } from "ai";
import { loadWorkflow, saveWorkflow, Workflow, WorkflowStep } from "./workflows.ts";
import { PlaywrightMCP } from "./tools/mcp/playwright-mcp.ts";
import { WorkflowRunner } from "./runner.ts";
import { RECORDER_SYSTEM_PROMPT } from "./prompts.ts";
import {
  accumulateTokenUsage,
  buildCompactPreviousStepsSummary,
  initTokenUsageSummary,
  logTokenUsageSummary,
  printModelResult,
} from "./utils.ts";
import { logger, spinner } from "./log.ts";
import { userInputTool } from "./tools/user-input.ts";
import { listVariablesTool, retrieveVariableTool, storeVariableTool } from "./tools/variable.ts";
import { snapshotFilterJsonTool, snapshotGetAndFilterTool } from "./tools/snapshot.ts";
import { input, select } from "./cli_prompts.ts";
import { recorderModel, stopWhen } from "./model.ts";
import { listSecretsTool, loadSecrets } from "./tools/secret.ts";

export class WorkflowRecorder {
  constructor(private mcp: PlaywrightMCP) {}

  async interactiveRecord(existingWorkflow?: Workflow): Promise<void> {
    await loadSecrets();
    const mcpTools = await this.mcp.getAiTools();
    const allTools = {
      ...mcpTools,
      user_input: userInputTool,
      store_variable: storeVariableTool,
      retrieve_variable: retrieveVariableTool,
      snapshot_get_and_filter: snapshotGetAndFilterTool,
      snapshot_filter_json: snapshotFilterJsonTool,
      list_variables: listVariablesTool,
      list_secrets: listSecretsTool,
    };

    logger.info("Recorder", `Exposed tools: ${Object.keys(allTools).join(", ") || "<none>"}`);
    const steps: WorkflowStep[] = existingWorkflow ? [...existingWorkflow.steps] : [];
    const tokenSummary = initTokenUsageSummary();

    let workflow: Workflow;
    if (existingWorkflow) {
      workflow = { ...existingWorkflow };
      logger.info("Recorder", `Resuming workflow '${existingWorkflow.name}'`);
      logger.info("Recorder", `Existing steps: ${existingWorkflow.steps.length}`);
    } else {
      const workflowName = input({
        message: "Workflow name:",
        required: true,
      });
      const workflowDescription = input({
        message: "Description (optional):",
      });

      workflow = {
        name: workflowName,
        description: workflowDescription || undefined,
        createdAt: new Date().toISOString(),
        steps: [],
      };
    }

    logger.debug("Recorder", `System prompt: ${RECORDER_SYSTEM_PROMPT}`);

    // Guidance
    const guidanceMessage = existingWorkflow
      ? "Resuming recording. The existing steps are loaded. Describe each new step in natural language. The agent will pick a tool and arguments. Type 'done' to finish, or 'cancel' to abort."
      : "Recording started. Describe each step in natural language (e.g., 'open https://intranet and sign in', 'click the Bookings tab', 'copy the booking dates'). The agent will pick a tool and arguments. Type 'done' to finish, or 'cancel' to abort.";

    logger.info("Recorder", guidanceMessage);

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
      spinner.start();
      while (!accepted) {
        const previousStepsSummary = buildCompactPreviousStepsSummary(steps, steps.length);
        const prevSection = previousStepsSummary
          ? `Context (previous steps, do not execute them):\n\n\`\`\`\n${previousStepsSummary}\n\`\`\`\n\n`
          : "";
        const system = RECORDER_SYSTEM_PROMPT;

        const prompt = `${prevSection}
Perform the following step, and output a REPRO block that describes how to reproduce the step later.
Step:
\`\`\`
${nextAction}
${refinement ? `\nRefinement: ${refinement}` : ""}
\`\`\`
`;

        logger.debug("Recorder", "About to run model for this step with the following prompt:");
        logger.debug("Recorder", prompt);

        spinner.addText("Thinking...");
        const result = await generateText({
          model: recorderModel,
          tools: allTools,
          system,
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
      spinner.stop();
    }

    // Update workflow with final steps
    workflow.steps = steps;

    logTokenUsageSummary("Recorder", tokenSummary);
    const file = await saveWorkflow(workflow);
    logger.success("Recorder", `Saved workflow to ${file}`);
  }

  async resumeRecording(workflowName: string): Promise<void> {
    // Load existing workflow
    let existingWorkflow: Workflow;
    try {
      existingWorkflow = await loadWorkflow(workflowName);
    } catch (error) {
      logger.error(
        "Recorder",
        `Failed to load workflow '${workflowName}': ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    // First, run all existing steps to get back to the state where we left off
    if (existingWorkflow.steps.length > 0) {
      logger.info(
        "Recorder",
        `Running ${existingWorkflow.steps.length} existing steps to resume from current state...`,
      );

      const runner = new WorkflowRunner(this.mcp);
      try {
        await runner.run(workflowName, true); // Run in auto mode
        logger.success("Recorder", "Existing steps completed successfully");
      } catch (error) {
        logger.error(
          "Recorder",
          `Failed to run existing steps: ${error instanceof Error ? error.message : String(error)}`,
        );
        logger.warn("Recorder", "You may need to manually navigate to the correct state before continuing recording");
      }
    } else {
      logger.info("Recorder", "No existing steps to run, starting fresh recording");
    }

    // Now start recording new steps
    await this.interactiveRecord(existingWorkflow);
  }
}
