import { expect } from "@std/expect";
import { assertSnapshot } from "@std/testing/snapshot";
import { connectPlaywrightMCP, type PlaywrightToolOutput } from "./playwright-mcp.ts";
import { setLogLevel } from "../../log.ts";
import { getVariable, resetVariables } from "../variable.ts";
import { parse } from "@std/yaml";

setLogLevel("debug");

Deno.test("Playwright MCP snapshot", async (context) => {
  resetVariables();
  const playwrightMCP = await connectPlaywrightMCP({ headless: true });

  await playwrightMCP.callTool("browser_navigate", { url: "https://demo.applitools.com/" });

  await playwrightMCP.callTool("browser_snapshot_and_save", { variable: "applitools_snapshot" });

  expect(getVariable("applitools_snapshot")).toBeDefined();
  expect(getVariable("applitools_snapshot")).not.toMatch(/```yaml([\s\S]*?)```/);

  const parsed = parse(getVariable("applitools_snapshot")!);
  assertSnapshot(context, parsed);

  await playwrightMCP.disconnect();
  await new Promise((resolve) => {
    setTimeout(resolve, 1000);
  });
});

Deno.test("Playwright MCP actions respect includeSnapshot option", async (context) => {
  resetVariables();
  const playwrightMCP = await connectPlaywrightMCP({ headless: true });

  await playwrightMCP.callTool("browser_navigate", { url: "https://demo.applitools.com/" });

  // Default behavior on actions (navigate, click): no fenced YAML
  const filtered =
    (await playwrightMCP.callTool("browser_navigate", { url: "https://demo.applitools.com/" })) as PlaywrightToolOutput;
  const isText = (c: { type: string; [k: string]: unknown }): c is { type: "text"; text: string } =>
    c.type === "text" && typeof (c as { text?: unknown }).text === "string";
  const filteredText = filtered.content.filter(isText).map((c) => c.text).join("\n");
  expect(filteredText).not.toMatch(/```yaml([\s\S]*?)```/);

  // Click an element (realistic action) with default filtering
  const clickResult =
    (await playwrightMCP.callTool("browser_click", { selector: "text=Sign in" })) as PlaywrightToolOutput;
  const clickText = clickResult.content.filter(isText).map((c) => c.text).join("\n");
  expect(clickText).not.toMatch(/```yaml([\s\S]*?)```/);

  // Re-navigate with includeSnapshot true and ensure YAML appears
  const withSnapshot = (await playwrightMCP.callTool(
    "browser_navigate",
    { url: "https://demo.applitools.com/" },
    { includeSnapshot: true },
  )) as PlaywrightToolOutput;
  const textItem = withSnapshot.content.find(isText);
  expect(textItem).toBeDefined();
  expect(textItem!.text).toMatch(/```yaml([\s\S]*?)```/);

  // Custom tool should save YAML without fences and be parseable
  await playwrightMCP.callTool("browser_snapshot_and_save", { variable: "applitools_snapshot" });
  expect(getVariable("applitools_snapshot")).toBeDefined();
  expect(getVariable("applitools_snapshot")).not.toMatch(/```yaml([\s\S]*?)```/);
  const parsedSaved = parse(getVariable("applitools_snapshot")!);
  assertSnapshot(context, parsedSaved);

  await playwrightMCP.disconnect();
  await new Promise((resolve) => {
    setTimeout(resolve, 1000);
  });
});
