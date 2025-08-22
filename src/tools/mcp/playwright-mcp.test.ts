import { expect } from "@std/expect";
import { assertSnapshot } from "@std/testing/snapshot";
import { connectPlaywrightMCP } from "./playwright-mcp.ts";
import { setLogLevel } from "../../log.ts";
import { getVariable, resetVariables } from "../variable.ts";
import { parse } from "@std/yaml";

setLogLevel("debug");

Deno.test("Playwright MCP snapshot", async (context) => {
  resetVariables();
  const playwrightMCP = await connectPlaywrightMCP({ headless: true });

  await playwrightMCP.callTool("browser_navigate", { url: "https://demo.applitools.com/" });

  await playwrightMCP.callTool("snapshotAndSave", { variable: "applitools_snapshot" });

  expect(getVariable("applitools_snapshot")).toBeDefined();
  expect(getVariable("applitools_snapshot")).not.toMatch(/```yaml([\s\S]*?)```/);

  const parsed = parse(getVariable("applitools_snapshot")!);
  assertSnapshot(context, parsed, { name: "applitools_snapshot" });

  await playwrightMCP.disconnect();
  await new Promise((resolve) => {
    setTimeout(resolve, 1000);
  });
});
