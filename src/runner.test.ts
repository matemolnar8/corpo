import { expect } from "@std/expect";
import { connectPlaywrightMCP } from "./tools/mcp/playwright-mcp.ts";
import { WorkflowRunner } from "./runner.ts";
import { setLogLevel } from "./log.ts";

setLogLevel("debug");

Deno.test("WorkflowRunner telex workflow sanity check", async () => {
  const playwrightMCP = await connectPlaywrightMCP({
    headless: true,
  });

  try {
    const runner = new WorkflowRunner(playwrightMCP);

    const result = await runner.run("telex", true);

    expect(result).toBeDefined();
    expect(result.workflowName).toBe("telex");
    expect(result.steps).toBe(3);
    expect(result.autoMode).toBe(true);
    expect(result.elapsedMs).toBeGreaterThan(0);
    expect(result.tokenSummary).toBeDefined();
    expect(result.attemptsPerStep).toBeDefined();
    expect(result.attemptsPerStep.length).toBe(3);

    // Verify each step was attempted at least once
    for (const attempts of result.attemptsPerStep) {
      expect(attempts).toBeGreaterThan(0);
    }

    expect(result.finalText).toBeDefined();
    expect(result.finalText!.length).toBeGreaterThan(0);

    const finalText = result.finalText!.toLowerCase();
    expect(finalText).toMatch(/(done|telex|article|title)/);

    console.log(`✅ Telex workflow completed successfully in ${result.elapsedMs}ms`);
    console.log(`📊 Token usage: ${JSON.stringify(result.tokenSummary)}`);
    console.log(`📝 Final output: ${result.finalText}`);
  } finally {
    await playwrightMCP.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
});

Deno.test("WorkflowRunner handles workflow not found error", async () => {
  const playwrightMCP = await connectPlaywrightMCP({
    headless: true,
  });

  try {
    const runner = new WorkflowRunner(playwrightMCP);

    await expect(runner.run("non-existent-workflow", true)).rejects.toThrow();
  } finally {
    await playwrightMCP.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
});
