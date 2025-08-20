import { Command } from "commander";
import { WorkflowRecorder } from "./recorder.ts";
import { WorkflowRunner } from "./runner.ts";
import { setLogLevel } from "./utils.ts";

const program = new Command();

program
  .name("corpo")
  .description(
    "Corpo is a browser automation tool that uses AI to help you record and automate menial tasks.",
  )
  .version("0.0.1")
  .option("-d, --debug", "Enable debug logging");

program
  .command("record")
  .description("Record a workflow using Playwright MCP server")
  .action(async () => {
    const options = program.opts();
    if (options.debug) {
      setLogLevel("debug");
    }
    const recorder = new WorkflowRecorder();
    await recorder.interactiveRecord();
  });

program
  .command("run")
  .description("Run a saved workflow via Playwright MCP server")
  .argument("[name]", "Workflow name to run")
  .action(async (name: string | undefined) => {
    const options = program.opts();
    if (options.debug) {
      setLogLevel("debug");
    }
    const runner = new WorkflowRunner();
    await runner.run(name, false);
  });

program
  .command("run-auto")
  .description("Run a saved workflow automatically without user prompts")
  .argument("[name]", "Workflow name to run")
  .action(async (name: string | undefined) => {
    const options = program.opts();
    if (options.debug) {
      setLogLevel("debug");
    }
    const runner = new WorkflowRunner();
    await runner.run(name, true);
  });

program.parse();
