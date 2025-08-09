#!/usr/bin/env node
import "dotenv/config";

import { Command } from "commander";
import chalk from "chalk";
import { WorkflowRecorder } from "./recorder.js";
import { WorkflowRunner } from "./runner.js";
import { setLogLevel } from "./utils.js";

const program = new Command();

program
  .name("corpo")
  .description(
    "Corpo is a browser automation tool that uses AI to help you record and automate menial tasks."
  )
  .version("0.0.1")
  .option("-d, --debug", "Enable debug logging");

program
  .command("help")
  .description("Show detailed help information")
  .action(() => {
    console.log(chalk.blue.bold("Corpo CLI - AI-Powered Command Line Tool\n"));
    console.log(chalk.yellow("Available Commands:"));
    console.log("  help         - Show this help message");
    console.log(
      "  record       - Record a workflow using Playwright MCP (@playwright/mcp)"
    );
    console.log("  run [name]   - Run a saved workflow interactively");
    console.log(
      "  run-auto [name] - Run a saved workflow automatically without prompts\n"
    );
  });

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

process.on("SIGINT", () => {});
process.on("SIGTERM", () => {});

program.parse();
