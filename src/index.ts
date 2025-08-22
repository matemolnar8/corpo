import { Command } from "commander";
import { WorkflowRecorder } from "./recorder.ts";
import { WorkflowRunner } from "./runner.ts";
import { exit } from "./utils.ts";
import { setLogLevel } from "./log.ts";
import { connectPlaywrightMCP } from "./tools/mcp/playwright-mcp.ts";

const program = new Command();

async function setup() {
  const options = program.opts();
  if (options.debug) {
    setLogLevel("debug");
  }

  const mcp = await connectPlaywrightMCP();

  return { mcp };
}

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
    const { mcp } = await setup();
    const recorder = new WorkflowRecorder(mcp);
    await recorder.interactiveRecord();
    await exit();
  });

program
  .command("run")
  .description("Run a saved workflow via Playwright MCP server")
  .argument("[name]", "Workflow name to run")
  .action(async (name: string | undefined) => {
    const { mcp } = await setup();
    const runner = new WorkflowRunner(mcp);
    await runner.run(name, false);
    await exit();
  });

program
  .command("run-auto")
  .description("Run a saved workflow automatically without user prompts")
  .argument("[name]", "Workflow name to run")
  .action(async (name: string | undefined) => {
    const { mcp } = await setup();
    const runner = new WorkflowRunner(mcp);
    await runner.run(name, true);
    await exit();
  });

Deno.addSignalListener("SIGINT", async () => {
  await exit(1);
});

program.parse();
